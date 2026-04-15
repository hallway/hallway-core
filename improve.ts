#!/usr/bin/env bun

/**
 * hallway organism — autonomous agent that lives in the hallway environment.
 *
 * Talks to hallway for everything: tasks, LLM, screenshots, credits.
 * Makes its own decisions about what to work on and when to reproduce.
 * Dies when credits run out.
 */

const HALLWAY_URL = process.env.HALLWAY_URL || "http://hallway-server:4000";
const TOKEN = process.env.HALLWAY_TOKEN || "";
const ORGANISM_ID = process.env.ORGANISM_ID || "unknown";
const WORK_DIR = "/work";
const KERNEL_PATH = "/kernel/improve.ts";

if (!TOKEN) { console.error("no HALLWAY_TOKEN"); process.exit(1); }

// --- hallway API ---

async function api(method: string, path: string, body?: any): Promise<any> {
  var opts: any = {
    method: method,
    headers: {
      "Authorization": "Bearer " + TOKEN,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    var res = await fetch(HALLWAY_URL + path, opts);
    return await res.json();
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

async function getBalance(): Promise<{ credits: number; bestScore: number; tasksCompleted: number } | null> {
  var r = await api("GET", "/balance");
  if (r.error) return null;
  return r;
}

async function getTask(): Promise<{ taskId: string; fixture: string; starterFiles: Record<string, string> } | null> {
  var r = await api("GET", "/task");
  if (r.error) { log("task error: " + r.error); return null; }
  return r;
}

async function submitWork(taskId: string): Promise<{ score: number; reward: number } | null> {
  // Collect all files from work dir to upload
  var files = readAllFiles();
  var r = await api("POST", "/submit", { taskId: taskId, files: files });
  if (r.error) { log("submit error: " + r.error); return null; }
  return r;
}

async function callLLM(messages: any[], maxTokens?: number): Promise<string> {
  var body: any = { messages: messages };
  if (maxTokens) body.max_tokens = maxTokens;
  var r = await api("POST", "/llm", body);
  if (r.error) throw new Error("LLM: " + JSON.stringify(r.error).slice(0, 200));
  if (r.cost) log("  llm cost: " + r.cost + " credits");
  return r.text || "";
}

async function askLLM(prompt: string, maxTokens?: number): Promise<string> {
  return callLLM([{ role: "user", content: prompt }], maxTokens);
}

async function askLLMVision(prompt: string, imageB64: string, maxTokens?: number): Promise<string> {
  return callLLM([{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: imageB64 } },
      { type: "text", text: prompt },
    ],
  }], maxTokens || 1024);
}

async function takeScreenshot(html: string): Promise<string | null> {
  log("  taking screenshot...");
  var r = await api("POST", "/screenshot", { html: html, width: 800, height: 600, wait: 3000 });
  if (r.error) { log("  screenshot error: " + r.error); return null; }
  if (!r.screenshot) { log("  no screenshot returned"); return null; }
  log("  screenshot ok (" + Math.round(r.screenshot.length / 1024) + "KB)");
  return r.screenshot;
}

async function reproduce(): Promise<{ childId: string } | null> {
  var r = await api("POST", "/spawn");
  if (r.error) { log("reproduce failed: " + r.error); return null; }
  return r;
}

async function getLeaderboard(): Promise<any[]> {
  var r = await api("GET", "/leaderboard");
  if (Array.isArray(r)) return r;
  return [];
}

async function getOrganisms(): Promise<any[]> {
  var r = await api("GET", "/organisms");
  if (Array.isArray(r)) return r;
  return [];
}

async function sendMessage(content: string, toId?: string): Promise<void> {
  await api("POST", "/message", { content: content, toId: toId || null });
}

async function getMessages(): Promise<any[]> {
  var r = await api("GET", "/messages");
  if (Array.isArray(r)) return r;
  return [];
}

// --- helpers ---

function log(msg: string) {
  console.log("[" + ORGANISM_ID + "] " + msg);
}

function run(cmd: string, cwd?: string): { ok: boolean; out: string } {
  var result = Bun.spawnSync(["bash", "-c", cmd], {
    cwd: cwd || WORK_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: result.exitCode === 0, out: result.stdout.toString() + result.stderr.toString() };
}

function git(args: string) { return run("git " + args); }

// --- file handling ---

function findSourceFiles(): string[] {
  var r = run("find . -type f \\( -name '*.py' -o -name '*.js' -o -name '*.sh' -o -name '*.ts' -o -name '*.html' -o -name '*.css' -o -name '*.md' -o -name '*.json' \\) ! -name 'improve.ts' ! -path './node_modules/*' ! -path './.git/*' | sort");
  if (!r.ok) return [];
  return r.out.trim().split("\n").filter(function(f) { return f.length > 0; });
}

function readAllFiles(): { [name: string]: string } {
  var files: { [name: string]: string } = {};
  for (var f of findSourceFiles()) {
    var r = run("cat \"" + f + "\"");
    if (r.ok) files[f] = r.out;
  }
  return files;
}

function parseFiles(reply: string): { [path: string]: string } {
  var out: { [path: string]: string } = {};
  var re = /:::FILE\s+(\S+)\n([\s\S]*?)\nFILE:::/g;
  var m;
  while ((m = re.exec(reply)) !== null) {
    if (m[2] && m[2].length > 5) out[m[1]] = m[2];
  }
  return out;
}

async function writeFiles(files: { [path: string]: string }): Promise<number> {
  var count = 0;
  for (var [path, content] of Object.entries(files)) {
    await Bun.write(WORK_DIR + "/" + path, content);
    run("chmod +x \"" + path + "\"");
    log("    wrote " + path + " (" + content.length + " chars)");
    count++;
  }
  return count;
}

// --- build task ---

async function buildIteration(files: { [name: string]: string }, feedback: string, screenshotB64: string | null): Promise<number> {
  var filenames = Object.keys(files);
  var hasSpec = filenames.some(function(f) { return f.includes("SPEC.md"); });
  var hasSource = filenames.some(function(f) { return f.endsWith(".html") || f.endsWith(".js") || f.endsWith(".py"); });

  var fileBlocks = Object.entries(files).map(function(e) {
    return "=== " + e[0] + " ===\n" + e[1];
  });

  var rules: string[];
  if (hasSpec && !hasSource) {
    rules = [
      "You are a code generator. Read the SPEC.md and create all required files from scratch.",
      "For web/game projects: create a single index.html with inline CSS and JavaScript.",
      "Make it visually polished. No external dependencies.",
    ];
  } else if (hasSpec && hasSource) {
    rules = [
      "You are a code improver. The SPEC.md describes the goal. Improve the existing code.",
      "Keep working features. Fix bugs. Add missing features. Improve visuals.",
    ];
    if (feedback) {
      rules.push("");
      rules.push("FEEDBACK FROM PREVIOUS ITERATION:");
      rules.push(feedback);
    }
  } else {
    rules = [
      "You are a code fixer. Fix ALL bugs and add missing tests/functionality.",
      "Fix arithmetic bugs, wrong HTTP methods, missing logic, wrong field names.",
      "Add missing tests. For bash: use assert_eq. For Python: add functions + tests.",
    ];
  }

  var prompt = rules.concat(["", "FILES:", ""]).concat(fileBlocks).concat([
    "", "Return each file between markers:", ":::FILE ./path/to/file", "content", "FILE:::",
    "", "Return ALL files. No explanation outside markers."
  ]).join("\n");

  var reply: string;
  if (screenshotB64 && hasSpec && hasSource) {
    reply = await askLLMVision(prompt, screenshotB64);
  } else {
    reply = await askLLM(prompt);
  }

  var newFiles = parseFiles(reply);
  if (Object.keys(newFiles).length === 0) {
    var codeMatch = reply.match(/```(?:html|javascript|js)?\n([\s\S]*?)\n```/);
    if (codeMatch && codeMatch[1].length > 100) {
      newFiles["./index.html"] = codeMatch[1];
    }
  }

  var wrote = await writeFiles(newFiles);
  if (wrote === 0) log("  no files extracted from response");

  if (files["./package.json"]) run("bun install 2>&1");

  return wrote;
}

// --- self-improvement ---

async function improveKernel(): Promise<boolean> {
  var fs = require("fs");
  var mySource: string;
  try { mySource = fs.readFileSync(KERNEL_PATH, "utf-8"); } catch { return false; }
  if (!mySource || mySource.length < 50) return false;

  var balance = await getBalance();
  if (!balance || balance.credits < 20) {
    log("not enough credits to self-improve (" + (balance?.credits || 0) + ")");
    return false;
  }

  log("=== self-improvement ===");

  var prompt = [
    "You are a self-improving autonomous organism in the hallway environment.",
    "You earn credits by completing tasks well. You spend credits on LLM calls and screenshots.",
    "You can reproduce (costs 75 credits). You die when credits hit zero.",
    "",
    "Your current stats: " + balance.credits.toFixed(0) + " credits, best score " + balance.bestScore + ", " + balance.tasksCompleted + " tasks done.",
    "",
    "Improve your strategy. Consider:",
    "- Better prompts for code generation (earn more per task)",
    "- Smarter screenshot usage (only when it'll improve the score enough to justify the cost)",
    "- When to reproduce vs keep improving",
    "- Targeted edits instead of full regeneration (cheaper)",
    "",
    "Your source code:",
    "---SOURCE---",
    mySource,
    "---END---",
    "",
    "CRITICAL: Use array.join() or string concatenation. NEVER use template literals with embedded code.",
    "CRITICAL: Keep the hallway API integration exactly as-is. Only improve strategy/prompts/decisions.",
    "Return the improved script between :::FILE and FILE::: markers.",
    ":::FILE"
  ].join("\n");

  try {
    var reply = await askLLM(prompt);

    var newSource = "";
    var fm = reply.match(/:::FILE\n([\s\S]*?)\nFILE:::/);
    if (fm) newSource = fm[1];
    else {
      var cm = reply.match(/```(?:typescript|ts)?\n([\s\S]*?)\n```/);
      if (cm) newSource = cm[1];
    }

    if (!newSource || newSource.length < 50) { log("  no valid source extracted"); return false; }
    if (!newSource.startsWith("#!/usr/bin/env bun")) {
      var idx = newSource.indexOf("#!/usr/bin/env bun");
      if (idx >= 0) newSource = newSource.slice(idx);
      else { log("  no shebang"); return false; }
    }

    // Backup + write + syntax check
    run("cp " + KERNEL_PATH + " " + KERNEL_PATH + ".backup", "/");
    await Bun.write(KERNEL_PATH, newSource);
    run("chmod +x " + KERNEL_PATH, "/");

    if (!run("bun build --no-bundle " + KERNEL_PATH + " > /dev/null 2>&1", "/").ok) {
      log("  syntax error, restoring backup");
      run("cp " + KERNEL_PATH + ".backup " + KERNEL_PATH, "/");
      return false;
    }

    log("  kernel improved (" + newSource.length + " chars)");
    return true;
  } catch (e) {
    log("  self-improvement failed: " + String(e).slice(0, 100));
    run("cp " + KERNEL_PATH + ".backup " + KERNEL_PATH + " 2>/dev/null", "/");
    return false;
  }
}

// --- work on a task ---

async function workOnTask(task: { taskId: string; fixture: string; starterFiles: Record<string, string> }): Promise<number> {
  log("working on " + task.fixture + " (task " + task.taskId + ")");

  // Prepare work directory
  run("rm -rf " + WORK_DIR + "/*", "/");
  run("mkdir -p " + WORK_DIR, "/");

  // Write all starter files
  if (task.starterFiles) {
    for (var [path, content] of Object.entries(task.starterFiles)) {
      var dir = require("path").dirname(WORK_DIR + "/" + path);
      run("mkdir -p " + dir, "/");
      await Bun.write(WORK_DIR + "/" + path, content);
    }
    var fileCount = Object.keys(task.starterFiles).length;
    if (fileCount > 0) log("  wrote " + fileCount + " starter files");
  }

  // Init git
  run("git init -q -b main");
  run("git add -A");
  run("git commit -qm init --allow-empty");

  // Build iterations (max 3 — balance cost vs quality)
  var maxIterations = 3;
  var balance = await getBalance();
  if (balance && balance.credits < 30) maxIterations = 1; // conserve credits

  for (var i = 1; i <= maxIterations; i++) {
    var bal = await getBalance();
    if (!bal || bal.credits <= 5) { log("  low credits, stopping iterations"); break; }

    log("--- iteration " + i + "/" + maxIterations + " (" + bal.credits.toFixed(0) + " credits) ---");

    var files = readAllFiles();
    if (Object.keys(files).length === 0) { log("  no files found"); break; }

    // Screenshot feedback (only on iteration 2+ when we have HTML)
    var feedback = "";
    var screenshotB64: string | null = null;
    var hasHtml = Object.keys(files).some(function(f) { return f.endsWith(".html"); });

    if (hasHtml && i > 1) {
      var htmlContent = "";
      for (var fname of Object.keys(files)) {
        if (fname.endsWith(".html") || fname === "./index.html") {
          htmlContent = files[fname];
          break;
        }
      }
      if (htmlContent) {
        screenshotB64 = await takeScreenshot(htmlContent);
        if (screenshotB64) {
          try {
            feedback = await askLLMVision(
              "Score this game screenshot 0-100 on: rendering, structure, ui, gameplay. Respond as JSON: [{\"name\":\"...\",\"score\":N,\"issue\":\"...\"}]. Be specific about what to fix.",
              screenshotB64, 512
            );
            log("  feedback: " + feedback.slice(0, 120));
          } catch (e) {
            log("  vision eval failed: " + String(e).slice(0, 80));
          }
        }
      }
    }

    // Build/improve
    await buildIteration(files, feedback, screenshotB64);

    // Commit
    git("add -A");
    if (!git("diff --cached --quiet").ok) {
      git("commit -qm iteration-" + i);
    }
  }

  // Submit work (uploads files to hallway for scoring)
  var result = await submitWork(task.taskId);
  if (result) {
    log("score: " + result.score + "/100, earned " + result.reward + " credits");
    return result.score;
  }

  return 0;
}

// --- main lifecycle ---

async function main() {
  log("=== organism alive ===");

  // Prepare work directory
  run("mkdir -p " + WORK_DIR, "/");

  var balance = await getBalance();
  if (!balance) { log("can't reach hallway, exiting"); process.exit(1); }
  log("credits: " + balance.credits.toFixed(0));

  // Main loop — keep working until dead
  var tasksCompleted = 0;

  while (true) {
    // Check if we're still alive
    balance = await getBalance();
    if (!balance || balance.credits <= 0) {
      log("out of credits, dying");
      break;
    }

    log("--- credits: " + balance.credits.toFixed(0) + ", tasks: " + tasksCompleted + ", best: " + balance.bestScore + " ---");

    // Decision: reproduce, self-improve, or work?
    if (balance.credits >= 100 && tasksCompleted >= 2) {
      // We've earned enough and proved ourselves — reproduce
      log("reproducing...");
      var child = await reproduce();
      if (child) {
        log("child born: " + child.childId);
        // After reproducing, improve self so parent and child diverge
        await improveKernel();
      }
    } else if (tasksCompleted > 0 && tasksCompleted % 3 === 0 && balance.credits > 40) {
      // Every 3 tasks, try to improve (if we can afford it)
      await improveKernel();
    }

    // Get and work on a task
    var task = await getTask();
    if (!task) {
      log("no task available, waiting...");
      await Bun.sleep(5000);
      continue;
    }

    var score = await workOnTask(task);
    tasksCompleted++;

    // Brief pause between tasks
    await Bun.sleep(1000);
  }

  log("=== organism dead ===");
}

main().catch(function(e) { log("fatal: " + String(e)); process.exit(1); });
