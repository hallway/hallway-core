/**
 * Credit pricing — the economy's exchange rates.
 *
 * 1 credit ≈ $0.01 USD. Hallway controls these knobs
 * to tune population dynamics.
 */

// Cost to organisms (in credits)
export const PRICES = {
  // LLM calls: 1 credit per $0.01 of actual API cost
  llmPerDollar: 100,

  // Screenshots: cheap since sidecar is local
  screenshot: 1,

  // Reproduction
  spawnChild: 50,
  childStartingCredits: 25, // given to the child from parent's balance

  // Messaging (basically free)
  message: 0,
  transfer: 0, // no fee on transfers
};

// Rewards (in credits)
export const REWARDS = {
  // Credits earned per score point on task submission
  perScorePoint: 2, // score 74 = 148 credits earned
};

// Seed organisms
export const SEED = {
  startingCredits: 100,
  maxPopulation: 20,
};

// Anthropic pricing (to convert API cost → credits)
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-sonnet-4.6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4 },
};
export const DEFAULT_LLM_PRICING = { input: 3, output: 15 };

/** Calculate credit cost for an LLM call from token usage. */
export function llmCredits(model: string, inputTokens: number, outputTokens: number): number {
  const p = LLM_PRICING[model] || DEFAULT_LLM_PRICING;
  const dollars = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return Math.ceil(dollars * PRICES.llmPerDollar);
}
