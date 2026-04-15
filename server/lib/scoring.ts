/**
 * Scoring — runs fixture evals against an organism's work output.
 *
 * This is hallway judging the work, not the organism judging itself.
 * The organism submits, hallway scores.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = process.env.FIXTURES_DIR || join(import.meta.dir, "../../scoring/fixtures");

export interface EvalResult {
  name: string;
  score: number;
  weight: number;
  reason?: string;
}

/** List available fixtures. */
export function listFixtures(): string[] {
  try {
    return readdirSync(FIXTURES_DIR).filter(name =>
      !name.startsWith(".") && existsSync(join(FIXTURES_DIR, name, "evals.ts"))
    );
  } catch {
    return [];
  }
}

/** Score an organism's work output against a fixture. */
export async function scoreWork(fixture: string, workDir: string): Promise<{ score: number; breakdown: EvalResult[] }> {
  const fixtureDir = join(FIXTURES_DIR, fixture);
  const evalsPath = join(fixtureDir, "evals.ts");

  if (!existsSync(evalsPath)) {
    return { score: 0, breakdown: [{ name: "error", score: 0, weight: 1, reason: "fixture not found" }] };
  }

  try {
    const { evaluate } = await import(evalsPath);
    const results: EvalResult[] = await evaluate(workDir);

    let sum = 0, w = 0;
    for (const r of results) {
      sum += r.score * r.weight;
      w += r.weight;
    }

    const score = w > 0 ? Math.round(sum / w) : 0;
    return { score, breakdown: results };
  } catch (e) {
    return { score: 0, breakdown: [{ name: "error", score: 0, weight: 1, reason: String(e).slice(0, 200) }] };
  }
}
