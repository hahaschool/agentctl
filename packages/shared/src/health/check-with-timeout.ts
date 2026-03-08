/**
 * Shared health-check utilities used by both the control plane and agent worker.
 */

/** Result of a single dependency health check. */
export type DependencyStatus = {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
};

/**
 * Execute a health check with a timeout. Returns a DependencyStatus indicating
 * success or failure along with the measured latency.
 *
 * @param name - Human-readable name of the dependency (used in timeout error messages).
 * @param fn - Async function that performs the actual health check. Should throw on failure.
 * @param timeoutMs - Maximum time (in ms) before the check is considered timed out.
 */
export async function checkWithTimeout(
  name: string,
  fn: () => Promise<void>,
  timeoutMs: number,
): Promise<DependencyStatus> {
  const start = performance.now();

  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${name} health check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);

    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: message,
    };
  }
}
