#!/usr/bin/env bun

/**
 * hallway-core: self-improving kernel
 *
 * This file IS the thing being improved. It reads its own source,
 * asks an LLM to make it better, writes the new version, and
 * scores it. If the score improves, the edit sticks.
 */

const TARGET = process.argv[2] || ".";
const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS || "20");
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("missing ANTHROPIC_API_KEY");
  process.exit(1);
}

// --- helpers ---

function run(cmd: string, cwd = TARGET, timeoutMs?: number): { ok: boolean; out: string } {
  const result = Bun.spawnSync(["bash", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MAX_ITERATIONS: "3" }, // inner runs get fewer iterations
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
  });
  return {
    ok: result.exitCode === 0,
    out: result.stdout.toString() + result.stderr.toString(),
  };
}

function git(args: string, cwd = TARGET) {
  return run(`git ${args}`, cwd);
}

async function callLLM(prompt: string): Promise<string> {
  // Use curl instead of fetch — Bun's fetch drops long connections to Anthropic's API
  const reqBody = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const tmpReq = `/tmp/llm-req-${Date.now()}.json`;
  await Bun.write(tmpReq, reqBody);

  const result = Bun.spawnSync([
    "curl", "-sS", "--max-time", "120",
    "https://api.anthropic.com/v1/messages",
    "-H", `x-api-key: ${API_KEY}`,
    "-H", "anthropic-version: 2023-06-01",
    "-H", "content-type: application/json",
    "-d", `@${tmpReq}`,
  ], { stdout: "pipe", stderr: "pipe" });

  // Cleanup request file
  try { require("fs").unlinkSync(tmpReq); } catch {}

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  if (result.exitCode !== 0) {
    throw new Error(`curl failed (exit ${result.exitCode}): ${stderr.slice(0, 200)}`);
  }

  if (!stdout.trim()) {
    throw new Error(`curl returned empty response. stderr: ${stderr.slice(0, 200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`invalid JSON from API: ${stdout.slice(0, 200)}`);
  }

  if (data.error) {
    throw new Error(`API error: ${JSON.stringify(data.error).slice(0, 200)}`);
  }

  return data.content?.[0]?.text || "";
}

function score(): number {
  const result = run(`bun run /scoring/score.ts "${TARGET}"`, TARGET, 300_000);
  const num = parseInt(result.out.trim().split("\n").pop() || "0");
  return isNaN(num) ? 0 : num;
}

function readSource(): string {
  try {
    return Bun.file(`${TARGET}/improve.ts`).text() as unknown as string;
  } catch {
    return "";
  }
}

// use sync version
function readSourceSync(): string {
  const result = run(`cat "${TARGET}/improve.ts"`);
  return result.ok ? result.out : "";
}

// --- main loop ---

async function main() {
  // Ensure git is initialized
  if (!run(`test -d .git`).ok) {
    git("init -q -b main");
    git("add -A");
    git('commit -qm "init" --allow-empty');
  }

  // Skip initial scoring — it's expensive (runs the kernel recursively).
  // We'll get the real score after the first edit attempt.
  let scoreBefore = 20; // we know syntax check passes = 20 pts
  console.log("=== hallway-core ===");
  console.log(`starting score: ${scoreBefore}/100 (assumed)`);
  console.log(`max iterations: ${MAX_ITERATIONS}`);
  console.log();

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log(`--- iteration ${i}/${MAX_ITERATIONS} (score: ${scoreBefore}) ---`);

    // Snapshot
    git("add -A");
    if (!git("diff --cached --quiet").ok) {
      git(`commit -qm "pre-iteration-${i}"`);
    }

    // Read current source
    const currentSource = readSourceSync();

    // Build prompt with array join to avoid nested backtick issues
    const prompt = [
      "You are a self-improving system written in TypeScript (Bun runtime). Your score is " + scoreBefore + "/100.",
      "",
      "The scoring function tests whether you can:",
      "1. Run without errors (20 pts)",
      "2. Fix a broken Python function — the test fixture has def add(a, b): return a - b which should be a + b (40 pts)",
      "3. Extend code with new functions and passing tests (40 pts)",
      "",
      "Your current source (improve.ts):",
      "---SOURCE START---",
      currentSource,
      "---SOURCE END---",
      "",
      "Your script receives a TARGET directory containing Python files. You need to:",
      "- Read the Python files in TARGET",
      "- Send them to the LLM to fix bugs and add new functions/tests",
      "- Write the fixed/extended files back",
      "",
      "CRITICAL: Build strings with array.join() or string concatenation, NEVER with backtick template literals that embed variables containing code. Template literals break when the embedded code itself contains backticks.",
      "",
      "Return an improved version of improve.ts that is better at fixing and extending Python code.",
      "",
      "Return ONLY the file content between :::FILE and FILE::: markers. No explanation.",
      "",
      ":::FILE",
      "#!/usr/bin/env bun",
      "... your improved script ...",
      "FILE:::",
    ].join("\n");

    let reply: string;
    try {
      reply = await callLLM(prompt);
    } catch (e) {
      console.log(`  LLM error: ${e}`);
      continue;
    }

    // Extract between :::FILE and FILE:::
    let newSource = "";
    const fileMatch = reply.match(/:::FILE\n([\s\S]*?)\nFILE:::/);
    if (fileMatch) {
      newSource = fileMatch[1];
    } else {
      // Fallback: try markdown code block
      const codeMatch = reply.match(/```(?:typescript|ts)?\n([\s\S]*?)\n```/);
      if (codeMatch) {
        newSource = codeMatch[1];
      }
    }

    if (!newSource || newSource.length < 50) {
      console.log("  couldn't extract valid source, skipping");
      continue;
    }

    // Validate shebang
    if (!newSource.startsWith("#!/usr/bin/env bun")) {
      // Try to find it
      const idx = newSource.indexOf("#!/usr/bin/env bun");
      if (idx >= 0) {
        newSource = newSource.slice(idx);
      } else {
        console.log("  invalid script (no shebang), skipping");
        continue;
      }
    }

    // Write new source
    console.log(`  extracted ${newSource.length} chars, starts: ${newSource.slice(0, 60).replace(/\n/g, "\\n")}`);
    await Bun.write(`${TARGET}/improve.ts`, newSource);
    run(`chmod +x "${TARGET}/improve.ts"`);

    // Syntax check
    const check = run(`bun build --no-bundle "${TARGET}/improve.ts" 2>&1`);
    if (!check.ok) {
      console.log(`  syntax error, reverting. Detail: ${check.out.slice(0, 150)}`);
      git("checkout .");
      continue;
    }

    // Score
    const scoreAfter = score();

    if (scoreAfter > scoreBefore) {
      console.log(`  improved: ${scoreBefore} -> ${scoreAfter} ✓`);
      git("add -A");
      git(`commit -qm "iteration ${i}: ${scoreBefore} -> ${scoreAfter}"`);
      scoreBefore = scoreAfter;
    } else {
      console.log(`  no improvement (${scoreBefore} -> ${scoreAfter}), reverting`);
      git("checkout .");
    }
  }

  console.log();
  console.log("=== done ===");
  console.log(`final score: ${scoreBefore}/100`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
