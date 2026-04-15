#!/usr/bin/env bun

/**
 * hallway — the environment.
 *
 * Organisms live here. They request tasks, submit work, earn credits,
 * spend credits on LLM calls and screenshots, reproduce, communicate,
 * and eventually die. Hallway is the physics, not the player.
 */

import { db, schema } from "./db";
import { eq } from "drizzle-orm";
import { ensureNetwork, ensureScreenshotSidecar, isRunning } from "./lib/docker";
import { seedOrganism, reproduce, killOrganism } from "./routes/spawn";
import { getTask, submitWork } from "./routes/task";
import { getBalance, transfer } from "./routes/economy";
import { proxyLLM } from "./routes/llm";
import { proxyScreenshot } from "./routes/screenshot";
import { getOrganisms, getLeaderboard, getStats, sendMessage, getMessages } from "./routes/world";
import { join } from "path";

const PORT = parseInt(process.env.PORT || "4000");

// --- auth middleware ---

function authenticate(req: Request): string | null {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const org = db.select({ id: schema.organisms.id, status: schema.organisms.status })
    .from(schema.organisms)
    .where(eq(schema.organisms.token, token))
    .get();

  if (!org || org.status !== "alive") return null;
  return org.id;
}

// Admin key for hallway-initiated actions (seeding, killing)
const ADMIN_KEY = process.env.HALLWAY_ADMIN_KEY || "hallway-admin";

function isAdmin(req: Request): boolean {
  return req.headers.get("x-admin-key") === ADMIN_KEY;
}

// --- request helpers ---

async function json(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

function ok(data: any) {
  return Response.json(data);
}

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

// --- reaper: kill bankrupt organisms ---

function reapBankrupt() {
  const broke = db.select()
    .from(schema.organisms)
    .where(eq(schema.organisms.status, "alive"))
    .all()
    .filter(o => o.credits <= 0);

  for (const org of broke) {
    killOrganism(org.id, "bankrupt (credits: " + org.credits.toFixed(1) + ")");
  }

  // Also kill organisms whose containers died
  const alive = db.select()
    .from(schema.organisms)
    .where(eq(schema.organisms.status, "alive"))
    .all();

  for (const org of alive) {
    if (org.containerId && !isRunning(org.id)) {
      killOrganism(org.id, "container died");
    }
  }
}

// --- server ---

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- public routes (no auth) ---

    if (path === "/health") return ok({ ok: true });
    if (path === "/stats") return ok(getStats());
    if (path === "/leaderboard") return ok(getLeaderboard());
    if (path === "/organisms") return ok(getOrganisms());

    // --- admin routes ---

    if (path === "/seed" && method === "POST") {
      if (!isAdmin(req)) return err("unauthorized", 401);
      try {
        const org = seedOrganism();
        return ok(org);
      } catch (e: any) {
        return err(e.message);
      }
    }

    if (path === "/kill" && method === "POST") {
      if (!isAdmin(req)) return err("unauthorized", 401);
      const body = await json(req) as any;
      if (!body.organismId) return err("missing organismId");
      killOrganism(body.organismId, body.reason || "admin kill");
      return ok({ ok: true });
    }

    if (path === "/reap" && method === "POST") {
      if (!isAdmin(req)) return err("unauthorized", 401);
      reapBankrupt();
      return ok({ ok: true });
    }

    // --- organism routes (auth required) ---

    const organismId = authenticate(req);
    if (!organismId) return err("unauthorized — provide Bearer token", 401);

    // Task assignment
    if (path === "/task" && method === "GET") {
      const result = await getTask(organismId);
      return ok(result);
    }

    // Submit work
    if (path === "/submit" && method === "POST") {
      const body = await json(req) as any;
      if (!body.taskId || !body.files) return err("missing taskId or files");
      const result = await submitWork(organismId, body.taskId, body.files);
      return ok(result);
    }

    // LLM proxy
    if (path === "/llm" && method === "POST") {
      const body = await json(req) as any;
      if (!body.messages) return err("missing messages");
      const result = await proxyLLM(organismId, body);
      return ok(result);
    }

    // Screenshot proxy
    if (path === "/screenshot" && method === "POST") {
      const body = await json(req) as any;
      if (!body.html) return err("missing html");
      const result = await proxyScreenshot(organismId, body);
      return ok(result);
    }

    // Balance
    if (path === "/balance" && method === "GET") {
      const result = getBalance(organismId);
      return result ? ok(result) : err("not found", 404);
    }

    // Transfer credits
    if (path === "/transfer" && method === "POST") {
      const body = await json(req) as any;
      if (!body.toId || !body.amount) return err("missing toId or amount");
      const result = transfer(organismId, body.toId, body.amount);
      return ok(result);
    }

    // Reproduce
    if (path === "/spawn" && method === "POST") {
      const result = await reproduce(organismId);
      return ok(result);
    }

    // Messages
    if (path === "/message" && method === "POST") {
      const body = await json(req) as any;
      if (!body.content) return err("missing content");
      const result = sendMessage(organismId, body.toId || null, body.content);
      return ok(result);
    }

    if (path === "/messages" && method === "GET") {
      return ok(getMessages(organismId));
    }

    return err("not found", 404);
  },
});

// --- startup ---

console.log("hallway environment starting on port " + PORT);

// Ensure infrastructure
try {
  ensureNetwork();
  ensureScreenshotSidecar(join(import.meta.dir, "../screenshot"));
  console.log("  infrastructure ready");
} catch (e) {
  console.error("  infrastructure warning: " + e);
}

// Periodic reaper — kill bankrupt organisms every 30s
setInterval(reapBankrupt, 30_000);

console.log("hallway is running. seed organisms with POST /seed");
console.log("");
console.log("  endpoints:");
console.log("    POST /seed          (admin)  create organism from base kernel");
console.log("    POST /kill          (admin)  kill an organism");
console.log("    GET  /stats                  world statistics");
console.log("    GET  /leaderboard            top organisms");
console.log("    GET  /organisms              all organisms");
console.log("    GET  /task          (auth)   get a task assignment");
console.log("    POST /submit        (auth)   submit work for scoring");
console.log("    POST /llm           (auth)   proxied LLM call");
console.log("    POST /screenshot    (auth)   proxied screenshot");
console.log("    GET  /balance       (auth)   check credits");
console.log("    POST /transfer      (auth)   send credits");
console.log("    POST /spawn         (auth)   reproduce");
console.log("    POST /message       (auth)   send message");
console.log("    GET  /messages      (auth)   get messages");
