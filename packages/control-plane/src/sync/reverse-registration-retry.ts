/**
 * §33.12 Phase 4.1 — In-memory automatic retry scheduler for failed reverse
 * registrations.
 *
 * Schedule: 30s → 60s → 120s (3 attempts max, then give up).
 * - Process restart clears the map (acceptable; operator can manually retry).
 * - Manual UI retry cancels any pending automatic retry for that peer.
 * - On success: clear the entry. On final failure: clear the entry.
 */

import type {
  ReverseRegistrationOptions,
  ReverseRegistrationResult,
} from './peer-reverse-registration.js';
import { performReverseRegistration } from './peer-reverse-registration.js';

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export type RetryState = {
  attempt: number;
  maxAttempts: number;
  nextAt: Date;
};

type RetryEntry = {
  attempt: number;
  timer: ReturnType<typeof setTimeout>;
  nextAt: Date;
};

type OnRetryComplete = (
  peerId: string,
  result: ReverseRegistrationResult,
  attempt: number,
) => Promise<void>;

export class ReverseRegistrationRetryScheduler {
  private readonly entries = new Map<string, RetryEntry>();
  private readonly buildOpts: (peerId: string) => ReverseRegistrationOptions | null;
  private readonly onComplete: OnRetryComplete;

  constructor(
    buildOpts: (peerId: string) => ReverseRegistrationOptions | null,
    onComplete: OnRetryComplete,
  ) {
    this.buildOpts = buildOpts;
    this.onComplete = onComplete;
  }

  /**
   * Schedule automatic retries for a peer whose reverse registration just failed.
   * Call this after the initial attempt fails.
   */
  scheduleRetry(peerId: string): void {
    // Don't double-schedule
    if (this.entries.has(peerId)) return;

    this.scheduleAttempt(peerId, 0);
  }

  /**
   * Cancel any pending automatic retry for a peer. Call this when:
   * - The operator manually retries (to avoid duplicate attempts)
   * - The peer is deleted
   * - Reverse registration succeeds
   */
  cancel(peerId: string): void {
    const entry = this.entries.get(peerId);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(peerId);
    }
  }

  /**
   * Get the current retry state for a peer, if any.
   * Returns null when no retry is scheduled.
   */
  getRetryState(peerId: string): RetryState | null {
    const entry = this.entries.get(peerId);
    if (!entry) return null;
    return {
      attempt: entry.attempt + 1,
      maxAttempts: MAX_ATTEMPTS,
      nextAt: entry.nextAt,
    };
  }

  /** Cancel all pending retries (call on shutdown). */
  cancelAll(): void {
    for (const [, entry] of this.entries) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }

  private scheduleAttempt(peerId: string, attemptIndex: number): void {
    if (attemptIndex >= MAX_ATTEMPTS) {
      this.entries.delete(peerId);
      return;
    }

    const delayMs = RETRY_DELAYS_MS[attemptIndex];
    const nextAt = new Date(Date.now() + delayMs);

    const timer = setTimeout(() => {
      void this.executeAttempt(peerId, attemptIndex);
    }, delayMs);

    // Don't hold the process open for retry timers
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.entries.set(peerId, { attempt: attemptIndex, timer, nextAt });
  }

  private async executeAttempt(peerId: string, attemptIndex: number): Promise<void> {
    // Entry may have been cancelled between scheduling and execution
    if (!this.entries.has(peerId)) return;

    const opts = this.buildOpts(peerId);
    if (!opts) {
      this.entries.delete(peerId);
      return;
    }

    const result = await performReverseRegistration(opts);

    // Notify the caller (to persist the outcome)
    await this.onComplete(peerId, result, attemptIndex + 1);

    if (result.status === 'ok') {
      this.entries.delete(peerId);
      return;
    }

    // Schedule next attempt
    this.scheduleAttempt(peerId, attemptIndex + 1);
  }
}
