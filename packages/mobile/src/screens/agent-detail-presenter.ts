// ---------------------------------------------------------------------------
// Agent detail screen presenter — framework-agnostic business logic for
// viewing and controlling a single agent. Handles fetching agent details,
// start/stop/signal actions, SSE streaming, and output buffering.
// ---------------------------------------------------------------------------

import type { Agent, AgentEvent, AgentRun, ExecutionSummary } from '@agentctl/shared';
import { toExecutionSummary } from '@agentctl/shared';

import type {
  ApiClient,
  SignalAgentResponse,
  StartAgentResponse,
  StopAgentResponse,
} from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';
import type { SseClient } from '../services/sse-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputLine = {
  /** Monotonically increasing line number (1-based). */
  lineNumber: number;
  /** The SSE event that produced this line. */
  event: AgentEvent;
  /** Timestamp when the line was received. */
  receivedAt: Date;
};

export type AgentDetailState = {
  agent: Agent | null;
  runs: AgentRun[];
  latestRunSummary: ExecutionSummary | null;
  outputLines: OutputLine[];
  isLoading: boolean;
  isStreaming: boolean;
  error: MobileClientError | null;
  lastUpdated: Date | null;
};

export type AgentDetailPresenterConfig = {
  /** The API client instance for HTTP calls. */
  apiClient: ApiClient;
  /** The SSE client instance for real-time streaming. */
  sseClient: SseClient;
  /** Maximum number of output lines to buffer (default: 10 000). */
  maxOutputLines?: number;
  /** Maximum number of recent runs to fetch (default: 20). */
  maxRuns?: number;
  /** Callback invoked whenever state changes. */
  onChange?: (state: AgentDetailState) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_OUTPUT_LINES = 10_000;
const DEFAULT_MAX_RUNS = 20;

function getLatestRunSummary(runs: AgentRun[]): ExecutionSummary | null {
  for (const run of runs) {
    const summary = toExecutionSummary(run.resultSummary, {
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      costUsd: run.costUsd,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
    });

    if (summary) {
      return summary;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export class AgentDetailPresenter {
  private readonly apiClient: ApiClient;
  private readonly sseClient: SseClient;
  private readonly maxOutputLines: number;
  private readonly maxRuns: number;
  private onChange: ((state: AgentDetailState) => void) | undefined;

  private agentId: string | null = null;
  private lineCounter = 0;

  private state: AgentDetailState = {
    agent: null,
    runs: [],
    latestRunSummary: null,
    outputLines: [],
    isLoading: false,
    isStreaming: false,
    error: null,
    lastUpdated: null,
  };

  // Bound handler references for SSE event cleanup
  private readonly handleSseEvent: (event: AgentEvent) => void;
  private readonly handleSseOpen: () => void;
  private readonly handleSseClose: () => void;
  private readonly handleSseError: (err: Error) => void;

  constructor(config: AgentDetailPresenterConfig) {
    this.apiClient = config.apiClient;
    this.sseClient = config.sseClient;
    this.maxOutputLines = config.maxOutputLines ?? DEFAULT_MAX_OUTPUT_LINES;
    this.maxRuns = config.maxRuns ?? DEFAULT_MAX_RUNS;
    this.onChange = config.onChange;

    // Pre-bind event handlers
    this.handleSseEvent = (event: AgentEvent) => this.onSseEvent(event);
    this.handleSseOpen = () => this.setState({ isStreaming: true });
    this.handleSseClose = () => this.setState({ isStreaming: false });
    this.handleSseError = (err: Error) => {
      const error =
        err instanceof MobileClientError ? err : new MobileClientError('SSE_ERROR', err.message);
      this.setState({ error });
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Load agent details and recent runs for the given agent ID. */
  async loadAgent(agentId: string): Promise<void> {
    this.agentId = agentId;
    this.setState({ isLoading: true, error: null });

    try {
      const [agent, runs] = await Promise.all([
        this.apiClient.getAgent(agentId),
        this.apiClient.getAgentRuns(agentId, this.maxRuns),
      ]);

      this.setState({
        agent,
        runs,
        latestRunSummary: getLatestRunSummary(runs),
        isLoading: false,
        lastUpdated: new Date(),
      });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'AGENT_LOAD_FAILED',
              err instanceof Error ? err.message : String(err),
            );
      this.setState({ isLoading: false, error });
    }
  }

  /** Refresh only the agent details (not runs). */
  async refreshAgent(): Promise<void> {
    if (!this.agentId) {
      return;
    }

    this.setState({ isLoading: true, error: null });

    try {
      const agent = await this.apiClient.getAgent(this.agentId);
      this.setState({ agent, isLoading: false, lastUpdated: new Date() });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'AGENT_REFRESH_FAILED',
              err instanceof Error ? err.message : String(err),
            );
      this.setState({ isLoading: false, error });
    }
  }

  /** Start the agent with an optional prompt. */
  async startAgent(prompt?: string, model?: string): Promise<StartAgentResponse> {
    if (!this.agentId) {
      throw new MobileClientError('NO_AGENT_LOADED', 'No agent has been loaded');
    }

    const response = await this.apiClient.startAgent(this.agentId, { prompt, model });
    await this.refreshAgent();
    return response;
  }

  /** Stop the agent. */
  async stopAgent(
    reason: 'user' | 'timeout' | 'error' | 'schedule' = 'user',
    graceful = true,
  ): Promise<StopAgentResponse> {
    if (!this.agentId) {
      throw new MobileClientError('NO_AGENT_LOADED', 'No agent has been loaded');
    }

    const response = await this.apiClient.stopAgent(this.agentId, reason, graceful);
    await this.refreshAgent();
    return response;
  }

  /** Send a signal to the running agent. */
  async signalAgent(
    prompt: string,
    metadata?: Record<string, unknown>,
  ): Promise<SignalAgentResponse> {
    if (!this.agentId) {
      throw new MobileClientError('NO_AGENT_LOADED', 'No agent has been loaded');
    }

    return this.apiClient.signalAgent(this.agentId, { prompt, metadata });
  }

  /** Connect to the agent's SSE stream for real-time output. */
  startStreaming(): void {
    if (!this.agentId) {
      throw new MobileClientError('NO_AGENT_LOADED', 'No agent has been loaded');
    }

    this.sseClient.on('event', this.handleSseEvent);
    this.sseClient.on('open', this.handleSseOpen);
    this.sseClient.on('close', this.handleSseClose);
    this.sseClient.on('error', this.handleSseError);

    this.sseClient.connect(this.agentId);
  }

  /** Disconnect from the SSE stream. */
  stopStreaming(): void {
    this.sseClient.off('event', this.handleSseEvent);
    this.sseClient.off('open', this.handleSseOpen);
    this.sseClient.off('close', this.handleSseClose);
    this.sseClient.off('error', this.handleSseError);

    this.sseClient.close();
    this.setState({ isStreaming: false });
  }

  /** Clear the output buffer. */
  clearOutput(): void {
    this.lineCounter = 0;
    this.setState({ outputLines: [] });
  }

  /** Returns a shallow copy of the current state (immutable access). */
  getState(): AgentDetailState {
    return {
      ...this.state,
      outputLines: [...this.state.outputLines],
      runs: [...this.state.runs],
    };
  }

  /** Full cleanup: stops streaming and resets state. */
  destroy(): void {
    this.stopStreaming();
    this.agentId = null;
    this.lineCounter = 0;
    this.state = {
      agent: null,
      runs: [],
      latestRunSummary: null,
      outputLines: [],
      isLoading: false,
      isStreaming: false,
      error: null,
      lastUpdated: null,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private onSseEvent(event: AgentEvent): void {
    this.lineCounter++;
    const line: OutputLine = {
      lineNumber: this.lineCounter,
      event,
      receivedAt: new Date(),
    };

    const newLines = [...this.state.outputLines, line];

    // Trim to maxOutputLines by dropping oldest
    if (newLines.length > this.maxOutputLines) {
      newLines.splice(0, newLines.length - this.maxOutputLines);
    }

    this.setState({
      outputLines: newLines,
      latestRunSummary:
        event.event === 'execution_summary' ? event.data.summary : this.state.latestRunSummary,
    });
  }

  private setState(partial: Partial<AgentDetailState>): void {
    this.state = { ...this.state, ...partial };
    this.onChange?.(this.getState());
  }
}
