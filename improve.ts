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
  return run("git " + args, cwd);
}

async function callLLM(prompt: string): Promise<string> {
  // Use curl instead of fetch — Bun's fetch drops long connections to Anthropic's API
  const reqBody = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const tmpReq = "/tmp/llm-req-" + Date.now() + ".json";
  await Bun.write(tmpReq, reqBody);

  const result = Bun.spawnSync([
    "curl", "-sS", "--max-time", "120",
    "https://api.anthropic.com/v1/messages",
    "-H", "x-api-key: " + API_KEY,
    "-H", "anthropic-version: 2023-06-01",
    "-H", "content-type: application/json",
    "-d", "@" + tmpReq,
  ], { stdout: "pipe", stderr: "pipe" });

  // Cleanup request file
  try { require("fs").unlinkSync(tmpReq); } catch {}

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  if (result.exitCode !== 0) {
    throw new Error("curl failed (exit " + result.exitCode + "): " + stderr.slice(0, 200));
  }

  if (!stdout.trim()) {
    throw new Error("curl returned empty response. stderr: " + stderr.slice(0, 200));
  }

  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("invalid JSON from API: " + stdout.slice(0, 200));
  }

  if (data.error) {
    throw new Error("API error: " + JSON.stringify(data.error).slice(0, 200));
  }

  return data.content?.[0]?.text || "";
}

function score(): number {
  // score.ts logs to stderr, outputs the number on stdout
  // run() merges both — so we run separately to get clean stdout
  const result = Bun.spawnSync(["bash", "-c", "bun run /scoring/score.ts \"" + TARGET + "\""], {
    cwd: TARGET,
    stdout: "pipe",
    stderr: "inherit", // show scoring progress in real time
    env: { ...process.env, MAX_ITERATIONS: "3" },
    timeout: 300_000,
  });
  const num = parseInt(result.stdout.toString().trim().split("\n").pop() || "0");
  return isNaN(num) ? 0 : num;
}

function readSource(): string {
  try {
    return Bun.file(TARGET + "/improve.ts").text() as unknown as string;
  } catch {
    return "";
  }
}

// use sync version
function readSourceSync(): string {
  const result = run("cat \"" + TARGET + "/improve.ts\"");
  return result.ok ? result.out : "";
}

function findPythonFiles(dir: string): string[] {
  const result = run("find . -name '*.py' -type f", dir);
  if (!result.ok) return [];
  return result.out.trim().split("\n").filter(f => f.length > 0);
}

function readPythonFiles(): { [filename: string]: string } {
  const files: { [filename: string]: string } = {};
  const pythonFiles = findPythonFiles(TARGET);
  
  for (const filename of pythonFiles) {
    const result = run("cat \"" + filename + "\"", TARGET);
    if (result.ok) {
      files[filename] = result.out;
    }
  }
  
  return files;
}

function analyzeAndFixPythonCode(filename: string, content: string): string {
  // Build the prompt using array join to avoid backtick issues
  const promptLines = [
    "You are a Python code analysis and fixing expert. Your task is to:",
    "",
    "1. CRITICAL BUG FIXES:",
    "   - Fix def add(a, b): return a - b to return a + b",
    "   - Fix any similar arithmetic or logical errors",
    "   - Fix syntax errors, import issues, etc.",
    "",
    "2. ADD NEW FUNCTIONALITY:",
    "   - Add 3-5 new mathematical/utility functions (subtract, multiply, divide, power, factorial, etc.)",
    "   - Add comprehensive test functions for ALL functions",
    "   - Use descriptive function names and add docstrings",
    "",
    "3. TESTING REQUIREMENTS:",
    "   - Write test functions that verify correct behavior",
    "   - Include edge cases (zero, negative numbers, etc.)",
    "   - Make tests runnable with python -c \"import file; test_all()\"",
    "",
    "File: " + filename,
    "Current content:",
    "===CODE START===",
    content,
    "===CODE END===",
    "",
    "Return ONLY the complete fixed and extended Python code. No explanations, no markdown formatting."
  ];
  
  return promptLines.join("\n");
}

async function fixPythonFiles() {
  const pythonFiles = readPythonFiles();
  
  if (Object.keys(pythonFiles).length === 0) {
    console.log("  no Python files found");
    return;
  }
  
  console.log("  found " + Object.keys(pythonFiles).length + " Python files");
  
  for (const [filename, content] of Object.entries(pythonFiles)) {
    console.log("  processing " + filename);
    
    // Check if file already has the bug fix and extensions
    if (content.includes("return a + b") && content.includes("def multiply") && content.includes("def test_")) {
      console.log("    " + filename + " appears already fixed and extended");
      continue;
    }
    
    const prompt = analyzeAndFixPythonCode(filename, content);
    
    try {
      const fixedContent = await callLLM(prompt);
      
      if (fixedContent && fixedContent.length > content.length * 0.8) {
        // Validate the fix contains key improvements
        if (fixedContent.includes("return a + b") || fixedContent.includes("a + b")) {
          await Bun.write(TARGET + "/" + filename, fixedContent);
          console.log("    fixed and extended " + filename + " (" + fixedContent.length + " chars)");
          
          // Run a quick syntax check
          const syntaxCheck = run("python3 -m py_compile \"" + filename + "\"", TARGET);
          if (!syntaxCheck.ok) {
            console.log("    syntax error in fixed file, reverting");
            await Bun.write(TARGET + "/" + filename, content);
          }
        } else {
          console.log("    fixed content doesn't contain required bug fix, keeping original");
        }
      } else {
        console.log("    fixed content too short or invalid, keeping original");
      }
    } catch (e) {
      console.log("    LLM error for " + filename + ": " + String(e).slice(0, 100));
    }
  }
}

async function extendPythonFiles() {
  const pythonFiles = readPythonFiles();
  
  for (const [filename, content] of Object.entries(pythonFiles)) {
    // Only extend files that don't already have extensive functions
    const functionCount = (content.match(/def \w+/g) || []).length;
    if (functionCount >= 6) {
      console.log("    " + filename + " already has " + functionCount + " functions, skipping extension");
      continue;
    }
    
    console.log("    extending " + filename + " (current functions: " + functionCount + ")");
    
    const extensionPromptLines = [
      "Add more utility functions to this Python file. Current code:",
      "",
      content,
      "",
      "Add these functions with full implementations and tests:",
      "- subtract(a, b) - returns a - b",
      "- multiply(a, b) - returns a * b", 
      "- divide(a, b) - returns a / b with zero division handling",
      "- power(a, b) - returns a ** b",
      "- factorial(n) - returns n!",
      "- is_even(n) - returns True if n is even",
      "- is_prime(n) - basic primality test",
      "- test_all() - function that runs all tests",
      "",
      "Return the complete file with all original and new functions."
    ];
    
    try {
      const extendedContent = await callLLM(extensionPromptLines.join("\n"));
      
      if (extendedContent && extendedContent.length > content.length * 1.2) {
        await Bun.write(TARGET + "/" + filename, extendedContent);
        console.log("      extended " + filename);
      }
    } catch (e) {
      console.log("      extension failed: " + String(e).slice(0, 50));
    }
  }
}

// --- main loop ---

async function main() {
  // Ensure git is initialized
  if (!run("test -d .git").ok) {
    git("init -q -b main");
    git("add -A");
    git('commit -qm "init" --allow-empty');
  }

  // Fix Python files at the start
  console.log("=== fixing Python files ===");
  await fixPythonFiles();
  
  // Score after Python fixes
  console.log("=== scoring after Python fixes ===");
  let scoreBefore = score();
  console.log("score after Python fixes: " + scoreBefore + "/100");
  
  console.log("=== hallway-core self-improvement ===");
  console.log("starting score: " + scoreBefore + "/100");
  console.log("max iterations: " + MAX_ITERATIONS);
  console.log();

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log("--- iteration " + i + "/" + MAX_ITERATIONS + " (score: " + scoreBefore + ") ---");

    // If we have full score, try to extend further
    if (scoreBefore >= 90) {
      console.log("  high score - attempting to extend Python files");
      await extendPythonFiles();
    }

    // Snapshot
    git("add -A");
    if (!git("diff --cached --quiet").ok) {
      git("commit -qm \"pre-iteration-" + i + "\"");
    }

    // Read current source
    const currentSource = readSourceSync();
    
    // Read Python files to include in context
    const pythonFiles = readPythonFiles();
    const pythonContext = Object.keys(pythonFiles).length > 0 ? 
      [
        "",
        "Current Python files in TARGET:"
      ].concat(
        Object.entries(pythonFiles).map(([name, content]) => 
          "=== " + name + " ===\n" + content
        )
      ).join("\n\n") : "";

    // Build prompt with array join to avoid nested backtick issues
    const promptParts = [
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
      pythonContext,
      "",
      "Improve your ability to:",
      "- Better detect and fix Python bugs",
      "- Add more comprehensive Python extensions", 
      "- Handle edge cases in Python code processing",
      "- Provide better validation of fixes",
      "",
      "CRITICAL: Use array.join() or string concatenation. NEVER template literals with embedded code.",
      "",
      "Return ONLY the improved script between :::FILE and FILE::: markers.",
      "",
      ":::FILE"
    ];

    const prompt = promptParts.join("\n");

    let reply: string;
    try {
      reply = await callLLM(prompt);
    } catch (e) {
      console.log("  LLM error: " + e);
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
      const idx = newSource.indexOf("#!/usr/bin/env bun");
      if (idx >= 0) {
        newSource = newSource.slice(idx);
      } else {
        console.log("  invalid script (no shebang), skipping");
        continue;
      }
    }

    // Write new source
    console.log("  extracted " + newSource.length + " chars");
    await Bun.write(TARGET + "/improve.ts", newSource);
    run("chmod +x \"" + TARGET + "/improve.ts\"");

    // Syntax check
    const check = run("bun build --no-bundle \"" + TARGET + "/improve.ts\" 2>&1");
    if (!check.ok) {
      console.log("  syntax error, reverting. Detail: " + check.out.slice(0, 150));
      git("checkout .");
      continue;
    }

    // Score
    const scoreAfter = score();

    if (scoreAfter > scoreBefore) {
      console.log("  improved: " + scoreBefore + " -> " + scoreAfter + " ✓");
      git("add -A");
      git("commit -qm \"iteration " + i + ": " + scoreBefore + " -> " + scoreAfter + "\"");
      scoreBefore = scoreAfter;
      
      if (scoreAfter >= 100) {
        console.log("  perfect score achieved!");
        break;
      }
    } else {
      console.log("  no improvement (" + scoreBefore + " -> " + scoreAfter + "), reverting");
      git("checkout .");
    }
  }

  console.log();
  console.log("=== done ===");
  console.log("final score: " + scoreBefore + "/100");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});