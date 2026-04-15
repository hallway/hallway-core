/**
 * Spawn routes — reproduction and seeding.
 *
 * POST /spawn  → organism pays credits to create a child
 * POST /seed   → hallway creates initial organisms (admin only)
 */

import { db, schema } from "../db";
import { eq, sql } from "drizzle-orm";
import { PRICES, SEED } from "../lib/pricing";
import { creditOrg, debitOrg } from "./economy";
import { spawnContainer, killContainer } from "../lib/docker";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { join } from "path";

const POPULATION_DIR = process.env.POPULATION_DIR || join(import.meta.dir, "../../population");
const BASE_KERNEL = process.env.BASE_KERNEL || join(import.meta.dir, "../../improve.ts");
const SERVER_URL = process.env.HALLWAY_INTERNAL_URL || "http://hallway-server:4000";

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function generateToken(): string {
  return "hk-" + crypto.randomUUID().replace(/-/g, "");
}

function kernelHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function ensurePopulationDir(orgId: string): string {
  const dir = join(POPULATION_DIR, orgId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Seed a new organism from the base kernel (hallway-initiated). */
export function seedOrganism(): { id: string; token: string } {
  // Check population cap
  const alive = db.select({ count: sql<number>`count(*)` })
    .from(schema.organisms)
    .where(eq(schema.organisms.status, "alive"))
    .get();

  if (alive && alive.count >= SEED.maxPopulation) {
    throw new Error("population cap reached (" + SEED.maxPopulation + ")");
  }

  const id = generateId();
  const token = generateToken();

  // Copy base kernel to population dir
  const dir = ensurePopulationDir(id);
  const kernelPath = join(dir, "improve.ts");
  copyFileSync(BASE_KERNEL, kernelPath);
  const kernel = readFileSync(kernelPath, "utf-8");

  // Insert organism
  db.insert(schema.organisms).values({
    id,
    token,
    generation: 0,
    credits: 0,
    status: "alive",
    kernelHash: kernelHash(kernel),
    createdAt: new Date(),
  }).run();

  // Grant starting credits
  creditOrg(id, SEED.startingCredits, "seed", "initial seed");

  // Spawn container (non-fatal if it fails — organism can still be used via API)
  try {
    const containerId = spawnContainer(id, token, kernelPath, SERVER_URL);
    db.update(schema.organisms).set({ containerId }).where(eq(schema.organisms.id, id)).run();
  } catch (e) {
    console.error("failed to spawn container for " + id + ": " + e);
    // Don't kill — organism is still alive, just containerless
  }

  return { id, token };
}

/** Organism reproduces — pays credits, creates a mutated child. */
export async function reproduce(parentId: string) {
  const parent = db.select().from(schema.organisms).where(eq(schema.organisms.id, parentId)).get();
  if (!parent) return { error: "organism not found" };
  if (parent.status !== "alive") return { error: "organism is not alive" };

  const totalCost = PRICES.spawnChild + PRICES.childStartingCredits;
  if (parent.credits < totalCost) {
    return { error: "insufficient credits (need " + totalCost + ", have " + parent.credits.toFixed(1) + ")" };
  }

  // Check population cap
  const alive = db.select({ count: sql<number>`count(*)` })
    .from(schema.organisms)
    .where(eq(schema.organisms.status, "alive"))
    .get();

  if (alive && alive.count >= SEED.maxPopulation) {
    return { error: "population cap reached" };
  }

  // Debit parent
  if (!debitOrg(parentId, PRICES.spawnChild, "spawn_cost", "spawned child")) {
    return { error: "debit failed" };
  }

  // Create child
  const childId = generateId();
  const childToken = generateToken();

  // Copy parent's kernel (the child inherits the parent's code)
  const parentDir = join(POPULATION_DIR, parentId);
  const childDir = ensurePopulationDir(childId);
  const parentKernel = join(parentDir, "improve.ts");
  const childKernel = join(childDir, "improve.ts");

  if (existsSync(parentKernel)) {
    copyFileSync(parentKernel, childKernel);
  } else {
    copyFileSync(BASE_KERNEL, childKernel);
  }
  const kernel = readFileSync(childKernel, "utf-8");

  db.insert(schema.organisms).values({
    id: childId,
    token: childToken,
    parentId,
    generation: parent.generation + 1,
    credits: 0,
    status: "alive",
    kernelHash: kernelHash(kernel),
    createdAt: new Date(),
  }).run();

  // Grant child starting credits (from parent's balance)
  debitOrg(parentId, PRICES.childStartingCredits, "spawn_cost", "child credits for " + childId, childId);
  creditOrg(childId, PRICES.childStartingCredits, "spawn_grant", "from parent " + parentId, parentId);

  // Update parent stats
  db.update(schema.organisms).set({
    childrenSpawned: parent.childrenSpawned + 1,
  }).where(eq(schema.organisms.id, parentId)).run();

  // Spawn container (non-fatal)
  try {
    const containerId = spawnContainer(childId, childToken, childKernel, SERVER_URL);
    db.update(schema.organisms).set({ containerId }).where(eq(schema.organisms.id, childId)).run();
  } catch (e) {
    console.error("failed to spawn container for child " + childId + ": " + e);
  }

  return { childId, childToken, parentCredits: parent.credits - totalCost };
}

/** Kill an organism (hallway-initiated, e.g. bankruptcy). */
export function killOrganism(organismId: string, reason: string) {
  killContainer(organismId);

  db.update(schema.organisms).set({
    status: "dead",
    diedAt: new Date(),
  }).where(eq(schema.organisms.id, organismId)).run();

  console.log("[death] " + organismId + ": " + reason);
}
