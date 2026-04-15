/**
 * LLM proxy — organisms call the LLM through hallway.
 *
 * POST /llm  → proxied Anthropic API call (costs credits)
 *
 * Hallway holds the API key. Organisms never see it.
 * Every call is metered and debited.
 */

import { debitOrg } from "./economy";
import { llmCredits } from "../lib/pricing";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function proxyLLM(organismId: string, body: {
  model?: string;
  messages: any[];
  max_tokens?: number;
}) {
  if (!ANTHROPIC_KEY) return { error: "LLM not configured" };

  const model = body.model || "claude-sonnet-4-20250514";
  const maxTokens = body.max_tokens || 8192;

  // Estimate cost upfront (rough: assume 2000 input tokens, charge actual after)
  // We'll do the real debit after we get the response

  const reqBody = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: body.messages,
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: reqBody,
  });

  const data = await response.json() as any;

  if (data.error) {
    return { error: data.error };
  }

  // Calculate and debit actual cost
  if (data.usage) {
    const credits = llmCredits(model, data.usage.input_tokens, data.usage.output_tokens);
    const ok = debitOrg(organismId, credits, "spend",
      `llm ${model} ${data.usage.input_tokens}in/${data.usage.output_tokens}out (${credits}cr)`
    );
    if (!ok) {
      // Organism can't pay — still return the response but flag it
      // (we already made the API call, can't undo it)
      return { ...data, _hallway: { warning: "insufficient credits, debt incurred", cost: credits } };
    }
  }

  // Return the response with cost info
  const text = data.content?.[0]?.text || "";
  const credits = data.usage
    ? llmCredits(model, data.usage.input_tokens, data.usage.output_tokens)
    : 0;

  return {
    text,
    usage: data.usage,
    cost: credits,
    model,
  };
}
