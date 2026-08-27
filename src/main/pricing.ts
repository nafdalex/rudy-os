/**
 * Fallback-only model → price table (USD per million tokens).
 *
 * The LIVE telemetry path does NOT use this. Claude Code emits a pre-computed,
 * per-model `cost_usd` on every `api_request` log and a `claude_code.cost.usage`
 * metric (verified by the 7A.1 spike), so the collector (`telemetry.ts`) trusts
 * Claude's own figure. This table exists solely for the OFFLINE transcript
 * reconciler (`transcript.ts`), which runs when telemetry is off and must
 * estimate cost from raw token counts.
 *
 * It supersedes the old hard-coded Sonnet-for-everyone constants that lived in
 * `transcript.ts` (cost bug #1 — Opus undercosted ~5×, Haiku overcosted). Prices
 * are now matched per model family. This is the ONE place per-model pricing
 * lives; both the transcript backend and the collector's fallback import it.
 */

/** USD per million tokens for one model family. */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

// Anthropic list prices, USD per million tokens. Approximate, fallback-only —
// the live path uses Claude's own per-model cost, so drift here is harmless.
const OPUS: ModelPrice = { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5, cacheWritePerM: 18.75 };
const SONNET: ModelPrice = { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 };
const HAIKU: ModelPrice = { inputPerM: 0.8, outputPerM: 4, cacheReadPerM: 0.08, cacheWritePerM: 1.0 };

/** When the model id is unknown, assume Sonnet (the historical default). */
const DEFAULT_PRICE: ModelPrice = SONNET;

/**
 * Strip Claude Code's variant suffix so `claude-opus-4-8[1m]` (the form the
 * `token.usage` metric carries) and `claude-opus-4-8` (the base id the
 * `api_request` log carries) resolve to the same family. Case is preserved;
 * matching is done case-insensitively in `priceFor`.
 */
export function normalizeModel(model: string | undefined | null): string {
  return (model ?? '').trim().replace(/\[[^\]]*\]\s*$/, '');
}

/** Resolve a model id to its price row by family, falling back to Sonnet. */
export function priceFor(model: string | undefined | null): ModelPrice {
  const m = normalizeModel(model).toLowerCase();
  if (m.includes('opus')) return OPUS;
  if (m.includes('haiku')) return HAIKU;
  if (m.includes('sonnet')) return SONNET;
  return DEFAULT_PRICE;
}

/** Token split used by the cost estimator (matches `AgentUsage` token fields). */
export interface TokenSplit {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Estimate USD cost for a token split using the model's fallback price row.
 * Used only by the transcript reconciler; the live path trusts Claude's cost.
 */
export function estimateCostUsd(model: string | undefined | null, tokens: TokenSplit): number {
  const p = priceFor(model);
  return (
    (tokens.inputTokens / 1_000_000) * p.inputPerM +
    (tokens.outputTokens / 1_000_000) * p.outputPerM +
    (tokens.cacheReadTokens / 1_000_000) * p.cacheReadPerM +
    (tokens.cacheWriteTokens / 1_000_000) * p.cacheWritePerM
  );
}
