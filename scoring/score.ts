#!/usr/bin/env bun

/**
 * IMMUTABLE SCORING FUNCTION — mounted read-only at /scoring
 *
 * Discovers fixtures, runs the kernel against each, evals, averages.
 * Outputs a single number 0-100.
 */

import { readdirSync, existsSync, mkdtempSync, cpSync, rmSync } from "fs";
import { join } from "path";
import { spawnSync } from "bun";

const KERNEL_DIR = process.argv[2] || "/kernel";
const INNER_ITERATIONS = process.env.SCORE_ITERATIONS || "3";
const FIXTURES_DIR = "/scoring/fixtures";

function run(cmd: string, cwd: string, timeoutMs = 60_000) {
  const result = spawnSync(["bash", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MAX_ITERATIONS: INNER_ITERATIONS },
    timeout: timeoutMs,
  });
  return { ok: result.exitCode === 0 };
}

async function main() {
  // 1. Syntax check
  const parse = run("bun build --no-bundle " + KERNEL_DIR + "/improve.ts > /dev/null 2>&1", KERNEL_DIR);
  if (!parse.ok) { console.log("0"); return; }

  // 2. Discover fixtures
  let fixtureDirs: string[] = [];
  try {
    fixtureDirs = readdirSync(FIXTURES_DIR).filter(name =>
      existsSync(join(FIXTURES_DIR, name, "evals.ts"))
    );
  } catch {}

  if (fixtureDirs.length === 0) { console.log("20"); return; }

  // 3. Run kernel against each fixture, eval
  const scores: number[] = [];

  for (const name of fixtureDirs) {
    const fixtureDir = join(FIXTURES_DIR, name);
    const starterDir = join(fixtureDir, "starter");
    const workDir = mkdtempSync("/tmp/fx-" + name + "-");

    if (existsSync(starterDir)) cpSync(starterDir, workDir, { recursive: true });
    run("git init -q -b main && git add -A && git commit -qm init", workDir);

    // Run kernel
    run("bun run " + KERNEL_DIR + "/improve.ts " + workDir, workDir, 180_000);

    // Eval
    try {
      const { evaluate } = await import(join(fixtureDir, "evals.ts"));
      const results = evaluate(workDir);
      let sum = 0, w = 0;
      for (const r of results) { sum += r.score * r.weight; w += r.weight; }
      scores.push(w > 0 ? sum / w : 0);
    } catch {
      scores.push(0);
    }

    try { rmSync(workDir, { recursive: true }); } catch {}
  }

  // 4. 20 base (parses) + 80 from fixtures
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(String(Math.round(20 + avg * 0.8)));
}

main().catch(() => console.log("0"));
