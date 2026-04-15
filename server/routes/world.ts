/**
 * World routes — public information about the environment.
 *
 * GET /organisms    → list all organisms (alive and dead)
 * GET /leaderboard  → top organisms by score
 * GET /stats        → world statistics
 * POST /message     → send a message to another organism (or broadcast)
 * GET /messages     → get your messages
 */

import { db, schema } from "../db";
import { eq, desc, and, or, isNull, sql } from "drizzle-orm";

export function getOrganisms() {
  return db.select({
    id: schema.organisms.id,
    generation: schema.organisms.generation,
    parentId: schema.organisms.parentId,
    status: schema.organisms.status,
    credits: schema.organisms.credits,
    bestScore: schema.organisms.bestScore,
    tasksCompleted: schema.organisms.tasksCompleted,
    childrenSpawned: schema.organisms.childrenSpawned,
    createdAt: schema.organisms.createdAt,
  }).from(schema.organisms).all();
}

export function getLeaderboard(limit = 20) {
  return db.select({
    id: schema.organisms.id,
    generation: schema.organisms.generation,
    bestScore: schema.organisms.bestScore,
    credits: schema.organisms.credits,
    tasksCompleted: schema.organisms.tasksCompleted,
    childrenSpawned: schema.organisms.childrenSpawned,
    status: schema.organisms.status,
  })
    .from(schema.organisms)
    .orderBy(desc(schema.organisms.bestScore))
    .limit(limit)
    .all();
}

export function getStats() {
  const alive = db.select({ count: sql<number>`count(*)` })
    .from(schema.organisms)
    .where(eq(schema.organisms.status, "alive"))
    .get();

  const dead = db.select({ count: sql<number>`count(*)` })
    .from(schema.organisms)
    .where(eq(schema.organisms.status, "dead"))
    .get();

  const totalTasks = db.select({ count: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "scored"))
    .get();

  const totalCredits = db.select({ sum: sql<number>`sum(credits)` })
    .from(schema.organisms)
    .get();

  return {
    alive: alive?.count || 0,
    dead: dead?.count || 0,
    totalTasksScored: totalTasks?.count || 0,
    totalCreditsInCirculation: totalCredits?.sum || 0,
  };
}

export function sendMessage(fromId: string, toId: string | null, content: string) {
  if (content.length > 2000) return { error: "message too long (max 2000 chars)" };

  db.insert(schema.messages).values({
    fromId,
    toId,
    content,
    createdAt: new Date(),
  }).run();

  return { ok: true };
}

export function getMessages(organismId: string, since?: Date) {
  // Get direct messages + broadcasts
  let query = db.select().from(schema.messages)
    .where(
      or(
        eq(schema.messages.toId, organismId),
        isNull(schema.messages.toId),
      )
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(50)
    .all();

  if (since) {
    query = query.filter(m => m.createdAt > since);
  }

  return query;
}
