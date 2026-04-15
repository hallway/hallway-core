/**
 * SimTower fixture evals — screenshot-based scoring via browser-use + Claude vision.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { screenshotEval, bundleToHtml } from "../../lib/screenshot-eval.ts";

export interface EvalResult {
  name: string;
  score: number;
  weight: number;
}

export async function evaluate(workDir: string): Promise<EvalResult[]> {
  // Basic check: does index.html exist?
  const indexPath = join(workDir, "index.html");
  if (!existsSync(indexPath)) {
    return [
      { name: "has_game", score: 0, weight: 0.1 },
      { name: "rendering", score: 0, weight: 0.25 },
      { name: "building", score: 0, weight: 0.25 },
      { name: "ui", score: 0, weight: 0.2 },
      { name: "gameplay", score: 0, weight: 0.2 },
    ];
  }

  const html = readFileSync(indexPath, "utf-8");

  // Static code checks (fast, no API calls)
  const hasCanvas = html.includes("canvas") && (html.includes("getContext") || html.includes("Canvas"));
  const hasGameLoop = html.includes("requestAnimationFrame") || html.includes("setInterval");
  const hasClickHandler = html.includes("click") || html.includes("onclick") || html.includes("mousedown");
  const hasMoney = /money|cash|balance|funds|gold|\$/i.test(html);
  const hasFloor = /floor|story|level|storey/i.test(html);
  const hasTenant = /tenant|resident|person|occupant|people/i.test(html);
  const hasElevator = /elevator|lift/i.test(html);

  const codeScore = [hasCanvas, hasGameLoop, hasClickHandler, hasMoney, hasFloor, hasTenant, hasElevator]
    .filter(Boolean).length;
  const hasGameScore = Math.min(100, Math.round((codeScore / 7) * 100));

  // Screenshot eval (uses browser-use + Claude vision)
  const results = await screenshotEval(
    workDir,
    "A SimTower-style tower building simulation game. Should show a side-view cross-section of a building with multiple floors, small animated tenants/people, an elevator shaft, and a UI showing money/stats. The visual style should resemble a building management sim.",
    [
      {
        name: "rendering",
        description: "Does it render a visible game scene? Is there a building/tower structure with floors visible? Are there colors, shapes, and visual elements beyond a blank screen?",
        weight: 0.25,
      },
      {
        name: "building",
        description: "Does the building look like a tower with distinct floors/rooms? Are floors stacked vertically? Is there structure (walls, dividers, rooms)?",
        weight: 0.25,
      },
      {
        name: "ui",
        description: "Is there a visible UI/HUD showing game stats like money, floor count, or tenant count? Are there buttons or controls for building?",
        weight: 0.2,
      },
      {
        name: "gameplay",
        description: "Are there signs of an active game — animated tenants/people, an elevator, movement, or any dynamic elements? Does it look playable rather than static?",
        weight: 0.2,
      },
    ],
  );

  // Combine code check + screenshot results
  return [
    { name: "has_game", score: hasGameScore, weight: 0.1 },
    ...results,
  ];
}
