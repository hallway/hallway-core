/**
 * Task routes — organisms request work and submit results.
 *
 * GET  /task    → get a task assignment
 * POST /submit  → submit work for scoring, earn credits
 */

import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { listFixtures, scoreWork } from "../lib/scoring";
import { REWARDS } from "../lib/pricing";
import { creditOrg, debitOrg } from "./economy";

/** Collect all files from a directory recursively. */
function collectFiles(dir: string, prefix = ""): Record<string, string> {
  const { readdirSync, readFileSync, statSync } = require("fs");
  const { join } = require("path");
  const files: Record<string, string> = {};

  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      const rel = prefix ? prefix + "/" + entry : entry;
      if (statSync(full).isDirectory()) {
        Object.assign(files, collectFiles(full, rel));
      } else {
        try { files[rel] = readFileSync(full, "utf-8"); } catch {}
      }
    }
  } catch {}
  return files;
}

/** Assign a task to an organism. */
export async function getTask(organismId: string) {
  // Pick a random fixture
  const fixtures = listFixtures();
  if (fixtures.length === 0) return { error: "no fixtures available" };

  const fixture = fixtures[Math.floor(Math.random() * fixtures.length)];
  const taskId = "task-" + crypto.randomUUID().slice(0, 8);

  db.insert(schema.tasks).values({
    id: taskId,
    fixture,
    organismId,
    status: "assigned",
    assignedAt: new Date(),
  }).run();

  // Collect all starter files
  const { join } = require("path");
  const fixtureDir = join(process.env.FIXTURES_DIR || join(import.meta.dir, "../../scoring/fixtures"), fixture);
  const starterDir = join(fixtureDir, "starter");
  const starterFiles = collectFiles(starterDir);

  return {
    taskId,
    fixture,
    starterFiles, // all files the organism needs to start with
  };
}

/** Score a submission and reward credits. */
export async function submitWork(organismId: string, taskId: string, files: Record<string, string>) {
  const task = db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.organismId, organismId)))
    .get();

  if (!task) return { error: "task not found" };
  if (task.status === "scored") return { error: "already scored" };

  // Write files to temp dir for scoring
  const { mkdtempSync, writeFileSync, mkdirSync } = require("fs");
  const { join, dirname } = require("path");
  const workDir = mkdtempSync("/tmp/submit-" + taskId + "-");

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(workDir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  // Score the work
  const { score, breakdown } = await scoreWork(task.fixture, workDir);

  // Update task
  db.update(schema.tasks).set({
    status: "scored",
    score,
    breakdown: JSON.stringify(breakdown),
    workDir,
    submittedAt: new Date(),
    scoredAt: new Date(),
  }).where(eq(schema.tasks.id, taskId)).run();

  // Reward credits
  const reward = score * REWARDS.perScorePoint;
  if (reward > 0) {
    creditOrg(organismId, reward, "earn", `task ${taskId}: score ${score}`);
  }

  // Update organism stats
  const org = db.select().from(schema.organisms).where(eq(schema.organisms.id, organismId)).get();
  if (org) {
    db.update(schema.organisms).set({
      tasksCompleted: org.tasksCompleted + 1,
      bestScore: Math.max(org.bestScore, score),
    }).where(eq(schema.organisms.id, organismId)).run();
  }

  return { score, breakdown, reward };
}
