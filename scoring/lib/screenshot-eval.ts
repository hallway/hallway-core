/**
 * Screenshot evaluation via Playwright sidecar + Claude vision.
 *
 * 1. Bundles game files into a single HTML string
 * 2. Sends to Playwright sidecar container to render + screenshot
 * 3. Scores screenshot with Claude vision API
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { spawnSync } from "bun";
import { checkBudget, recordLLMCost } from "./cost.ts";

const SCREENSHOT_URL = process.env.SCREENSHOT_URL || "http://hallway-screenshot:3000/screenshot";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

const log = (msg: string) => process.stderr.write("  [screenshot] " + msg + "\n");

// --- bundle game files into single HTML ---

export function bundleToHtml(workDir: string): string {
  // Collect all files
  const files: { [name: string]: string } = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else files[rel] = readFileSync(full, "utf-8");
    }
  };
  walk(workDir, "");

  // If there's an index.html, use it as base and inline scripts/styles
  if (files["index.html"]) {
    let html = files["index.html"];

    // Inline <script src="..."> tags
    html = html.replace(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/gi, (_match, src) => {
      const content = files[src];
      if (content) return "<script>\n" + content + "\n</script>";
      return _match;
    });

    // Inline <link rel="stylesheet" href="..."> tags
    html = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["'][^>]*\/?>/gi, (_match, href) => {
      const content = files[href];
      if (content) return "<style>\n" + content + "\n</style>";
      return _match;
    });

    return html;
  }

  // No index.html — look for any .html file
  const htmlFile = Object.keys(files).find(f => f.endsWith(".html"));
  if (htmlFile) return files[htmlFile];

  // No HTML at all — wrap JS/CSS in a basic HTML page
  const jsFiles = Object.entries(files).filter(([f]) => f.endsWith(".js") || f.endsWith(".ts"));
  const cssFiles = Object.entries(files).filter(([f]) => f.endsWith(".css"));

  const parts = [
    "<!DOCTYPE html>",
    "<html><head><meta charset='utf-8'><title>Game</title>",
    "<style>body{margin:0;overflow:hidden;background:#000}</style>",
  ];
  for (const [, css] of cssFiles) parts.push("<style>" + css + "</style>");
  parts.push("</head><body>");
  parts.push("<canvas id='game' width='800' height='600'></canvas>");
  for (const [, js] of jsFiles) parts.push("<script>" + js + "</script>");
  parts.push("</body></html>");

  return parts.join("\n");
}

// --- screenshot via Playwright sidecar ---

export async function takeScreenshot(html: string): Promise<string | null> {
  if (!SCREENSHOT_URL) {
    log("SCREENSHOT_URL not set, skipping screenshot");
    return null;
  }

  log("requesting screenshot (" + Math.round(html.length / 1024) + "KB HTML)...");

  const reqBody = JSON.stringify({ html, width: 800, height: 600, wait: 3000 });
  const tmpReq = "/tmp/ss-req-" + Date.now() + ".json";
  await Bun.write(tmpReq, reqBody);

  const result = spawnSync([
    "curl", "-sS", "--max-time", "30",
    "-X", "POST", SCREENSHOT_URL,
    "-H", "Content-Type: application/json",
    "-d", "@" + tmpReq,
  ], { stdout: "pipe", stderr: "pipe" });

  try { require("fs").unlinkSync(tmpReq); } catch {}

  if (result.exitCode !== 0) {
    log("screenshot request failed: " + result.stderr.toString().slice(0, 200));
    return null;
  }

  let data: any;
  try { data = JSON.parse(result.stdout.toString()); } catch {
    log("invalid screenshot response");
    return null;
  }

  if (data.error) {
    log("screenshot error: " + data.error);
    return null;
  }

  if (!data.screenshot) {
    log("no screenshot in response");
    return null;
  }

  log("screenshot ok (" + Math.round(data.screenshot.length / 1024) + "KB b64)");
  return data.screenshot;
}

// --- Claude vision: score a screenshot ---

export interface ScoreCriteria {
  name: string;
  description: string;
  weight: number;
}

export interface ScoreResult {
  name: string;
  score: number; // 0-100
  weight: number;
  reason: string;
}

export async function scoreScreenshot(
  screenshotB64: string,
  gameDescription: string,
  criteria: ScoreCriteria[],
): Promise<ScoreResult[]> {
  if (!ANTHROPIC_KEY) {
    log("ANTHROPIC_API_KEY not set");
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "no API key" }));
  }

  // Budget check (~$0.01 per vision call)
  if (!checkBudget(0.01)) {
    log("skipping vision scoring — over budget");
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "over budget" }));
  }

  const criteriaText = criteria.map((c, i) =>
    (i + 1) + ". " + c.name + " (" + Math.round(c.weight * 100) + "%): " + c.description
  ).join("\n");

  const prompt = [
    "You are evaluating a game screenshot. The game should be: " + gameDescription,
    "",
    "Score each criterion 0-100:",
    criteriaText,
    "",
    "Respond in JSON only, no markdown:",
    '[{"name": "...", "score": 0, "reason": "..."}]',
  ].join("\n");

  const reqBody = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotB64 } },
        { type: "text", text: prompt },
      ],
    }],
  });

  const tmpReq = "/tmp/vision-req-" + Date.now() + ".json";
  await Bun.write(tmpReq, reqBody);

  const result = spawnSync([
    "curl", "-sS", "--max-time", "60",
    "https://api.anthropic.com/v1/messages",
    "-H", "x-api-key: " + ANTHROPIC_KEY,
    "-H", "anthropic-version: 2023-06-01",
    "-H", "content-type: application/json",
    "-d", "@" + tmpReq,
  ], { stdout: "pipe", stderr: "pipe" });

  try { require("fs").unlinkSync(tmpReq); } catch {}

  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    log("vision API failed");
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "API error" }));
  }

  let data: any;
  try { data = JSON.parse(stdout); } catch {
    log("invalid vision response");
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "parse error" }));
  }

  if (data.usage) recordLLMCost("claude-sonnet-4-20250514", data.usage, "vision");

  const text = data.content?.[0]?.text || "";

  // Parse JSON from response (may be wrapped in backticks)
  let scores: any[];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    scores = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    log("couldn't parse vision scores: " + text.slice(0, 200));
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "parse error" }));
  }

  // Map back to criteria with weights
  return criteria.map(c => {
    const found = scores.find((s: any) => s.name === c.name);
    return {
      name: c.name,
      score: found ? Math.min(100, Math.max(0, found.score)) : 0,
      weight: c.weight,
      reason: found?.reason || "not scored",
    };
  });
}

// --- convenience: full pipeline ---

export async function screenshotEval(
  workDir: string,
  gameDescription: string,
  criteria: ScoreCriteria[],
): Promise<ScoreResult[]> {
  const html = bundleToHtml(workDir);

  if (html.length < 50) {
    log("no game content found");
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "no content" }));
  }

  log("bundled HTML: " + html.length + " chars");

  const screenshot = await takeScreenshot(html);

  if (!screenshot) {
    log("screenshot failed, scoring zero");
    return criteria.map(c => ({ name: c.name, score: 0, weight: c.weight, reason: "no screenshot" }));
  }

  return scoreScreenshot(screenshot, gameDescription, criteria);
}
