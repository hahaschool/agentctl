export type CostTrackerUsage = {
  promptTokens?: number | null;
};

export class CostTracker {
  private readonly priceUsdPerMtoken: number;
  private costUsd = 0;
  private estimated = false;
  private tokens = 0;

  constructor(opts: { priceUsdPerMtoken: number }) {
    this.priceUsdPerMtoken = Number.isFinite(opts.priceUsdPerMtoken)
      ? Math.max(0, opts.priceUsdPerMtoken)
      : 0;
  }

  add(usage: CostTrackerUsage): void {
    const promptTokens = Math.max(0, Math.ceil(usage.promptTokens ?? 0));
    this.tokens += promptTokens;
    this.costUsd += (promptTokens / 1_000_000) * this.priceUsdPerMtoken;
  }

  addEstimated(chars: number): void {
    const estimatedTokens = Math.ceil(Math.max(0, chars) / 4);
    this.tokens += estimatedTokens;
    this.costUsd += (estimatedTokens / 1_000_000) * this.priceUsdPerMtoken;
    this.estimated = true;
  }

  get totalCostUsd(): number {
    return this.costUsd;
  }

  get usageEstimated(): boolean {
    return this.estimated;
  }

  get totalTokens(): number {
    return this.tokens;
  }
}
