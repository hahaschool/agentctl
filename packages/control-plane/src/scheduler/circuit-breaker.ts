import type { Logger } from 'pino';

export type CircuitState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerOptions = {
  /** Number of consecutive failures before the circuit opens. Defaults to 3. */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from open to half-open. Defaults to 60_000. */
  resetTimeoutMs: number;
  /** Optional structured logger. */
  logger?: Logger;
};

type MachineCircuit = {
  state: CircuitState;
  consecutiveFailures: number;
  /** Timestamp (ms) when the circuit transitioned to open. */
  openedAt: number;
};

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RESET_TIMEOUT_MS = 60_000;

export class MachineCircuitBreaker {
  private readonly circuits = new Map<string, MachineCircuit>();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly logger: Logger | undefined;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    this.logger = options?.logger;
  }

  /**
   * Record a successful dispatch to `machineId`.
   *
   * - In `half-open` state this closes the circuit.
   * - In `closed` state this resets the consecutive failure counter.
   */
  recordSuccess(machineId: string): void {
    const circuit = this.getOrCreate(machineId);
    const previousState = circuit.state;

    circuit.consecutiveFailures = 0;
    circuit.state = 'closed';

    if (previousState !== 'closed') {
      this.logger?.info(
        { machineId, previousState, newState: 'closed' },
        'Circuit breaker closed after successful probe',
      );
    }
  }

  /**
   * Record a failed dispatch to `machineId`.
   *
   * - Increments the consecutive failure counter.
   * - If the counter reaches `failureThreshold`, the circuit opens.
   * - If already `half-open`, a single failure re-opens the circuit.
   */
  recordFailure(machineId: string): void {
    const circuit = this.getOrCreate(machineId);

    circuit.consecutiveFailures += 1;

    if (circuit.state === 'half-open') {
      circuit.state = 'open';
      circuit.openedAt = Date.now();

      this.logger?.warn(
        { machineId, consecutiveFailures: circuit.consecutiveFailures },
        'Circuit breaker re-opened after half-open probe failure',
      );
      return;
    }

    if (circuit.state === 'closed' && circuit.consecutiveFailures >= this.failureThreshold) {
      circuit.state = 'open';
      circuit.openedAt = Date.now();

      this.logger?.warn(
        {
          machineId,
          consecutiveFailures: circuit.consecutiveFailures,
          failureThreshold: this.failureThreshold,
        },
        'Circuit breaker opened after reaching failure threshold',
      );
    }
  }

  /**
   * Returns `true` when the circuit for `machineId` is `open` and requests
   * should be blocked.
   *
   * If the reset timeout has elapsed, the circuit transitions to `half-open`
   * and this method returns `false` (allowing one probe request through).
   */
  isOpen(machineId: string): boolean {
    const circuit = this.circuits.get(machineId);

    if (!circuit) {
      return false;
    }

    if (circuit.state === 'open') {
      const elapsed = Date.now() - circuit.openedAt;

      if (elapsed >= this.resetTimeoutMs) {
        circuit.state = 'half-open';

        this.logger?.info(
          { machineId, elapsedMs: elapsed, resetTimeoutMs: this.resetTimeoutMs },
          'Circuit breaker transitioned to half-open after reset timeout',
        );

        return false;
      }

      return true;
    }

    return false;
  }

  /** Returns the current circuit state for `machineId`, defaulting to `closed`. */
  getState(machineId: string): CircuitState {
    const circuit = this.circuits.get(machineId);

    if (!circuit) {
      return 'closed';
    }

    // Ensure the state reflects any pending open→half-open transition.
    if (circuit.state === 'open') {
      const elapsed = Date.now() - circuit.openedAt;

      if (elapsed >= this.resetTimeoutMs) {
        circuit.state = 'half-open';

        this.logger?.info(
          { machineId, elapsedMs: elapsed, resetTimeoutMs: this.resetTimeoutMs },
          'Circuit breaker transitioned to half-open after reset timeout',
        );
      }
    }

    return circuit.state;
  }

  /** Resets the circuit for `machineId` back to `closed` with zero failures. */
  reset(machineId: string): void {
    this.circuits.delete(machineId);

    this.logger?.info({ machineId }, 'Circuit breaker reset');
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private getOrCreate(machineId: string): MachineCircuit {
    let circuit = this.circuits.get(machineId);

    if (!circuit) {
      circuit = { state: 'closed', consecutiveFailures: 0, openedAt: 0 };
      this.circuits.set(machineId, circuit);
    }

    return circuit;
  }
}
