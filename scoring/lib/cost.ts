/**
 * Cost tracking and budget enforcement.
 *
 * All costs accumulate in a JSON file so they persist across process
 * boundaries (kernel, scorer, fixture evals all run as separate processes).
 *
 * Budget set via HALLWAY_BUDGET env var (dollars, default $2.00).
 */

import { existsSync, readFileSync, writeFileSync } from "fs";

const COST_FILE = process.env.HALLWAY_COST_FILE || "/tmp/hallway-cost.json";
const DEFAULT_BUDGET = 2.0;

// Anthropic pricing (per million tokens)
const PRICING: { [model: string]: { input: number; output: number } } = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-sonnet-4.6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

export interface CostEntry {
  type: "llm" | "vision" | "browser-use";
  cost: number;
  detail: string;
  ts: number;
}

interface CostState {
  entries: CostEntry[];
  total: number;
}

function readState(): CostState {
  try {
    if (existsSync(COST_FILE)) {
      return JSON.parse(readFileSync(COST_FILE, "utf-8"));
    }
  } catch {}
  return { entries: [], total: 0 };
}

function writeState(state: CostState) {
  writeFileSync(COST_FILE, JSON.stringify(state, null, 2));
}

/** Record a cost entry. */
export function recordCost(type: CostEntry["type"], cost: number, detail: string) {
  const state = readState();
  state.entries.push({ type, cost, detail, ts: Date.now() });
  state.total = +(state.total + cost).toFixed(6);
  writeState(state);
}

/** Calculate LLM cost from Anthropic API usage field. */
export function llmCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model] || DEFAULT_PRICING;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Record an LLM call cost from Anthropic response usage. */
export function recordLLMCost(model: string, usage: { input_tokens: number; output_tokens: number }, label?: string) {
  const cost = llmCost(model, usage.input_tokens, usage.output_tokens);
  const detail = (label || "llm") + " " + model + " " + usage.input_tokens + "in/" + usage.output_tokens + "out";
  recordCost("llm", cost, detail);
  return cost;
}

/** Record browser-use session cost (from their API response). */
export function recordBrowserUseCost(totalCostUsd: string | number, sessionId: string) {
  const cost = typeof totalCostUsd === "string" ? parseFloat(totalCostUsd) : totalCostUsd;
  recordCost("browser-use", cost, "session " + sessionId);
  return cost;
}

/** Get current total spend. */
export function getTotalCost(): number {
  return readState().total;
}

/** Get the budget (dollars). */
export function getBudget(): number {
  return parseFloat(process.env.HALLWAY_BUDGET || String(DEFAULT_BUDGET));
}

/** Get remaining budget. */
export function getRemaining(): number {
  return Math.max(0, getBudget() - getTotalCost());
}

/** Check if we're under budget. */
export function underBudget(): boolean {
  return getTotalCost() < getBudget();
}

/** Check budget and log if over. Returns true if OK to proceed. */
export function checkBudget(operationCostEstimate?: number): boolean {
  const remaining = getRemaining();
  if (remaining <= 0) {
    process.stderr.write("  [cost] OVER BUDGET: spent $" + getTotalCost().toFixed(4) + " / $" + getBudget().toFixed(2) + "\n");
    return false;
  }
  if (operationCostEstimate && operationCostEstimate > remaining) {
    process.stderr.write("  [cost] operation ($" + operationCostEstimate.toFixed(4) + ") would exceed remaining budget ($" + remaining.toFixed(4) + ")\n");
    return false;
  }
  return true;
}

/** Reset cost tracking (call at start of each evolution run). */
export function resetCosts() {
  writeState({ entries: [], total: 0 });
}

/** Print a cost summary to stderr. */
export function printCostSummary() {
  const state = readState();
  const byType: { [k: string]: number } = {};
  for (const e of state.entries) {
    byType[e.type] = (byType[e.type] || 0) + e.cost;
  }

  process.stderr.write("\n  [cost] === Summary ===\n");
  process.stderr.write("  [cost] Total: $" + state.total.toFixed(4) + " / $" + getBudget().toFixed(2) + "\n");
  for (const [type, cost] of Object.entries(byType)) {
    process.stderr.write("  [cost]   " + type + ": $" + cost.toFixed(4) + " (" + state.entries.filter(e => e.type === type).length + " calls)\n");
  }
  process.stderr.write("  [cost] Remaining: $" + getRemaining().toFixed(4) + "\n");
}
