/**
 * Economy routes — credits, balances, transfers.
 *
 * GET  /balance   → check your credits
 * POST /transfer  → send credits to another organism
 */

import { db, schema } from "../db";
import { eq } from "drizzle-orm";

/** Credit an organism (add credits). */
export function creditOrg(
  organismId: string,
  amount: number,
  type: "seed" | "earn" | "transfer_in" | "spawn_grant",
  detail: string,
  relatedOrganismId?: string,
) {
  const org = db.select().from(schema.organisms).where(eq(schema.organisms.id, organismId)).get();
  if (!org) throw new Error("organism not found: " + organismId);

  const newBalance = org.credits + amount;

  db.update(schema.organisms).set({
    credits: newBalance,
    totalEarned: org.totalEarned + amount,
  }).where(eq(schema.organisms.id, organismId)).run();

  db.insert(schema.transactions).values({
    organismId,
    type,
    amount,
    balance: newBalance,
    detail,
    relatedOrganismId,
    createdAt: new Date(),
  }).run();

  return newBalance;
}

/** Debit an organism (remove credits). Returns false if insufficient funds. */
export function debitOrg(
  organismId: string,
  amount: number,
  type: "spend" | "transfer_out" | "spawn_cost",
  detail: string,
  relatedOrganismId?: string,
): boolean {
  const org = db.select().from(schema.organisms).where(eq(schema.organisms.id, organismId)).get();
  if (!org) return false;
  if (org.credits < amount) return false;

  const newBalance = org.credits - amount;

  db.update(schema.organisms).set({
    credits: newBalance,
    totalSpent: org.totalSpent + amount,
  }).where(eq(schema.organisms.id, organismId)).run();

  db.insert(schema.transactions).values({
    organismId,
    type,
    amount: -amount,
    balance: newBalance,
    detail,
    relatedOrganismId,
    createdAt: new Date(),
  }).run();

  return true;
}

/** Get balance for an organism. */
export function getBalance(organismId: string) {
  const org = db.select().from(schema.organisms).where(eq(schema.organisms.id, organismId)).get();
  if (!org) return null;
  return {
    credits: org.credits,
    totalEarned: org.totalEarned,
    totalSpent: org.totalSpent,
    tasksCompleted: org.tasksCompleted,
    bestScore: org.bestScore,
  };
}

/** Transfer credits between organisms. */
export function transfer(fromId: string, toId: string, amount: number) {
  if (amount <= 0) return { error: "amount must be positive" };

  const from = db.select().from(schema.organisms).where(eq(schema.organisms.id, fromId)).get();
  const to = db.select().from(schema.organisms).where(eq(schema.organisms.id, toId)).get();
  if (!from || !to) return { error: "organism not found" };
  if (from.credits < amount) return { error: "insufficient credits" };
  if (to.status !== "alive") return { error: "recipient is not alive" };

  debitOrg(fromId, amount, "transfer_out", `transfer to ${toId}`, toId);
  creditOrg(toId, amount, "transfer_in", `transfer from ${fromId}`, fromId);

  return { ok: true, fromBalance: from.credits - amount, toBalance: to.credits + amount };
}
