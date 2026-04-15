#!/usr/bin/env bun

/**
 * IMMUTABLE SCORING FUNCTION — mounted read-only at /scoring
 *
 * Discovers fixtures, runs the kernel against each, evals, averages.
 * Outputs a single number 0-100 on stdout.
 * Progress logged to stderr (visible in container output).
 */

import { readdirSync, existsSync, mkdtempSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { spawnSync } from "bun";
import { checkBudget, printCostSummary, getRemaining, getBudget } from "./lib/cost.ts";

const KERNEL_DIR = process.argv[2] || "/kernel";
const INNER_ITERATIONS = process.env.SCORE_ITERATIONS || "3";
const FIXTURES_DIR = "/scoring/fixtures";
const ONLY_FIXTURE = process.env.HALLWAY_FIXTURE || "";

const log = (msg: string) => process.stderr.write("  " + msg + "\n");

function run(cmd: string, cwd: string, timeoutMs = 60_000) {
  const result = spawnSync(["bash", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MAX_ITERATIONS: INNER_ITERATIONS, HALLWAY_SCORING: "1" },
    timeout: timeoutMs,
  });
  return { ok: result.exitCode === 0 };
}

async function main() {
  // 1. Syntax check
  const parse = run("bun build --no-bundle " + KERNEL_DIR + "/improve.ts > /dev/null 2>&1", KERNEL_DIR);
  if (!parse.ok) { log("syntax check failed"); console.log("0"); return; }

  // 2. Discover fixtures
  let fixtureDirs: string[] = [];
  try {
    fixtureDirs = readdirSync(FIXTURES_DIR).filter(name =>
      !name.startsWith(".") && existsSync(join(FIXTURES_DIR, name, "evals.ts"))
      && (!ONLY_FIXTURE || name === ONLY_FIXTURE)
    );
  } catch {}

  if (fixtureDirs.length === 0) { log("no fixtures found"); console.log("0"); return; }

  log("scoring against " + fixtureDirs.length + " fixtures: " + fixtureDirs.join(", "));

  // 3. Run kernel against each fixture, eval
  const scores: number[] = [];

  for (const name of fixtureDirs) {
    if (!checkBudget(0.05)) {
      log("skipping " + name + " — over budget");
      scores.push(0);
      continue;
    }
    const fixtureDir = join(FIXTURES_DIR, name);
    const starterDir = join(fixtureDir, "starter");
    const workDir = mkdtempSync("/tmp/fx-" + name + "-");

    if (existsSync(starterDir)) cpSync(starterDir, workDir, { recursive: true });
    run("git init -q -b main && git add -A && git commit -qm init", workDir);

    // Run kernel against fixture (game fixtures need more time for generation)
    const fixtureTimeout = existsSync(join(fixtureDir, "starter", "SPEC.md")) ? 300_000 : 120_000;
    log("[" + name + "] running kernel (" + INNER_ITERATIONS + " iterations, " + (fixtureTimeout / 1000) + "s timeout)...");
    run("bun run " + KERNEL_DIR + "/improve.ts " + workDir, workDir, fixtureTimeout);

    // Eval
    try {
      const { evaluate } = await import(join(fixtureDir, "evals.ts"));
      const results = await evaluate(workDir);
      let sum = 0, w = 0;
      for (const r of results) {
        sum += r.score * r.weight;
        w += r.weight;
        log("[" + name + "] " + r.name + ": " + Math.round(r.score) + "/100");
      }
      const fixtureScore = w > 0 ? sum / w : 0;
      scores.push(fixtureScore);
      log("[" + name + "] total: " + Math.round(fixtureScore) + "/100");
    } catch (e) {
      log("[" + name + "] evals failed: " + e);
      scores.push(0);
    }

    // Save output for preview (if /output is mounted)
    const outputDir = "/output/" + name;
    try {
      if (existsSync("/output")) {
        rmSync(outputDir, { recursive: true, force: true });
        cpSync(workDir, outputDir, { recursive: true });
      }
    } catch {}

    try { rmSync(workDir, { recursive: true }); } catch {}
  }

  // 4. Score = quality * efficiency (cheap AND good wins)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const efficiency = getBudget() > 0 ? getRemaining() / getBudget() : 0;
  const final = Math.round(avg * efficiency);
  log("quality: " + Math.round(avg) + "/100, efficiency: " + (efficiency * 100).toFixed(1) + "%, final: " + final + "/100");

  printCostSummary();

  // stdout = the score number (parsed by kernel)
  console.log(String(final));
}

main().catch(() => console.log("0"));
