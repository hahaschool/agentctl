// ---------------------------------------------------------------------------
// Session stream presenter — framework-agnostic business logic for viewing
// a session's live SSE output or replaying completed session content.
//
// For live sessions: connects to the control plane's SSE endpoint for
// real-time streaming. For completed sessions: fetches session content
// from the REST API and presents it for chronological replay.
// ---------------------------------------------------------------------------

import type { AgentEvent, ContentMessage } from '@agentctl/shared';

import { MobileClientError } from '../services/api-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamLine = {
  /** Monotonically increasing line number (1-based). */
  lineNumber: number;
  /** The SSE event that produced this line. */
  event: AgentEvent;
  /** Timestamp when the line was received. */
  receivedAt: Date;
};

export type ReplayMessage = ContentMessage & {
  /** Index position in the message list (0-based). */
  index: number;
  /** Whether the message is currently expanded in the UI. */
  expanded: boolean;
};

export type SessionStreamMode = 'live' | 'replay';

export type SessionStreamState = {
  /** Whether we're in live stream or replay mode. */
  mode: SessionStreamMode;
  /** Live SSE output lines (only populated in live mode). */
  streamLines: readonly StreamLine[];
  /** Parsed session messages (only populated in replay mode). */
  replayMessages: readonly ReplayMessage[];
  /** Current scrubber position in replay mode (index into replayMessages). */
  scrubberPosition: number;
  /** Whether we're currently connected to the SSE stream. */
  isStreaming: boolean;
  /** Whether content is being loaded from the API. */
  isLoading: boolean;
  /** Session ID we're viewing. */
  sessionId: string | null;
  /** Error state. */
  error: MobileClientError | null;
};

export type SessionStreamPresenterConfig = {
  /** Base URL of the control plane (e.g. "https://cp.example.com"). */
  baseUrl: string;
  /** Optional bearer token for authentication. */
  authToken?: string;
  /** Maximum number of stream lines to buffer (default: 5 000). */
  maxStreamLines?: number;
  /** Request timeout in ms for REST API calls (default: 30 000). */
  timeoutMs?: number;
  /** Callback invoked whenever state changes. */
  onChange?: (state: SessionStreamState) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_STREAM_LINES = 5_000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export class SessionStreamPresenter {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly maxStreamLines: number;
  private readonly timeoutMs: number;
  private onChange: ((state: SessionStreamState) => void) | undefined;

  private lineCounter = 0;
  private streamAbortController: AbortController | null = null;

  private state: SessionStreamState = {
    mode: 'live',
    streamLines: [],
    replayMessages: [],
    scrubberPosition: 0,
    isStreaming: false,
    isLoading: false,
    sessionId: null,
    error: null,
  };

  constructor(config: SessionStreamPresenterConfig) {
    this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    this.authToken = config.authToken;
    this.maxStreamLines = config.maxStreamLines ?? DEFAULT_MAX_STREAM_LINES;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onChange = config.onChange;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Connect to a live session SSE stream. */
  connectLive(sessionId: string): void {
    this.disconnect();
    this.lineCounter = 0;

    this.setState({
      mode: 'live',
      sessionId,
      streamLines: [],
      replayMessages: [],
      scrubberPosition: 0,
      isLoading: false,
      error: null,
    });

    this.startSessionStream(sessionId);
  }

  /** Load completed session content for replay. */
  async loadReplay(sessionId: string, machineId: string): Promise<void> {
    this.disconnect();
    this.lineCounter = 0;

    this.setState({
      mode: 'replay',
      sessionId,
      streamLines: [],
      replayMessages: [],
      scrubberPosition: 0,
      isLoading: true,
      error: null,
    });

    try {
      const content = await this.fetchSessionContent(sessionId, machineId);
      const replayMessages: ReplayMessage[] = content.map((msg, index) => ({
        ...msg,
        index,
        expanded: false,
      }));

      this.setState({
        replayMessages,
        scrubberPosition: replayMessages.length > 0 ? replayMessages.length - 1 : 0,
        isLoading: false,
      });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'CONTENT_LOAD_FAILED',
              err instanceof Error ? err.message : String(err),
            );
      this.setState({ isLoading: false, error });
    }
  }

  /** Toggle expand/collapse for a replay message. */
  toggleMessageExpanded(index: number): void {
    const messages = this.state.replayMessages;
    if (index < 0 || index >= messages.length) return;

    const updated = messages.map((msg) =>
      msg.index === index ? { ...msg, expanded: !msg.expanded } : msg,
    );

    this.setState({ replayMessages: updated });
  }

  /** Update scrubber position for timeline navigation. */
  setScrubberPosition(position: number): void {
    const max = this.state.replayMessages.length - 1;
    const clamped = Math.max(0, Math.min(position, max < 0 ? 0 : max));
    this.setState({ scrubberPosition: clamped });
  }

  /** Disconnect from SSE stream and clean up. */
  disconnect(): void {
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
    this.setState({ isStreaming: false });
  }

  /** Full cleanup: disconnects and resets all state. */
  destroy(): void {
    this.disconnect();
    this.lineCounter = 0;
    this.state = {
      mode: 'live',
      streamLines: [],
      replayMessages: [],
      scrubberPosition: 0,
      isStreaming: false,
      isLoading: false,
      sessionId: null,
      error: null,
    };
  }

  /** Returns a copy of the current state. */
  getState(): SessionStreamState {
    return { ...this.state };
  }

  // -----------------------------------------------------------------------
  // Internal — SSE stream via fetch
  // -----------------------------------------------------------------------

  private startSessionStream(sessionId: string): void {
    this.streamAbortController = new AbortController();
    void this.runSessionStream(sessionId);
  }

  private async runSessionStream(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/stream`;

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        signal: this.streamAbortController?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const message = err instanceof Error ? err.message : String(err);
      this.setState({
        error: new MobileClientError('NETWORK_ERROR', `SSE connection failed: ${message}`, {
          sessionId,
        }),
      });
      return;
    }

    if (!response.ok) {
      this.setState({
        error: new MobileClientError('HTTP_ERROR', `SSE stream returned HTTP ${response.status}`, {
          status: response.status,
          sessionId,
        }),
      });
      return;
    }

    this.setState({ isStreaming: true });

    if (!response.body) {
      this.setState({
        isStreaming: false,
        error: new MobileClientError('NO_BODY', 'SSE response has no body', { sessionId }),
      });
      return;
    }

    try {
      await this.readSseStream(response.body);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const message = err instanceof Error ? err.message : String(err);
      this.setState({
        error: new MobileClientError('STREAM_ERROR', `SSE stream error: ${message}`, {
          sessionId,
        }),
      });
    }

    this.setState({ isStreaming: false });
  }

  private async readSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by double newlines
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frameText of frames) {
          if (frameText.trim() === '') continue;
          this.handleSseFrame(frameText);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleSseFrame(text: string): void {
    const lines = text.split('\n');
    let eventName = '';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith(':')) continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const field = line.slice(0, colonIndex);
      const valueStart = line[colonIndex + 1] === ' ' ? colonIndex + 2 : colonIndex + 1;
      const value = line.slice(valueStart);

      if (field === 'event') {
        eventName = value;
      } else if (field === 'data') {
        dataLines.push(value);
      }
    }

    const data = dataLines.join('\n');
    if (!data) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const agentEvent = this.toAgentEvent(eventName, parsed);
    if (agentEvent) {
      this.onSseEvent(agentEvent);
    }
  }

  private toAgentEvent(eventName: string, parsed: unknown): AgentEvent | null {
    // If the parsed data already has `event` and `data` fields, use it as-is
    if (
      parsed &&
      typeof parsed === 'object' &&
      'event' in parsed &&
      typeof parsed.event === 'string' &&
      'data' in parsed
    ) {
      return parsed as AgentEvent;
    }

    if (!eventName) return null;

    return {
      event: eventName as AgentEvent['event'],
      data: parsed as AgentEvent['data'],
    } as AgentEvent;
  }

  // -----------------------------------------------------------------------
  // Internal — event handling
  // -----------------------------------------------------------------------

  private onSseEvent(event: AgentEvent): void {
    this.lineCounter++;
    const line: StreamLine = {
      lineNumber: this.lineCounter,
      event,
      receivedAt: new Date(),
    };

    const currentLines = this.state.streamLines;
    const newLines =
      currentLines.length >= this.maxStreamLines
        ? [...currentLines.slice(currentLines.length - this.maxStreamLines + 1), line]
        : [...currentLines, line];

    this.setState({ streamLines: newLines });
  }

  // -----------------------------------------------------------------------
  // Internal — API calls
  // -----------------------------------------------------------------------

  private async fetchSessionContent(
    sessionId: string,
    machineId: string,
  ): Promise<ContentMessage[]> {
    const path = `/api/sessions/content/${encodeURIComponent(sessionId)}?machineId=${encodeURIComponent(machineId)}`;
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new MobileClientError('REQUEST_TIMEOUT', 'Session content request timed out');
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new MobileClientError('NETWORK_ERROR', `Network error: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new MobileClientError(
        `HTTP_${response.status}`,
        `Failed to load session content: HTTP ${response.status}`,
        { status: response.status },
      );
    }

    const body = (await response.json()) as { messages?: ContentMessage[] } | ContentMessage[];

    if (Array.isArray(body)) {
      return body;
    }

    return body.messages ?? [];
  }

  // -----------------------------------------------------------------------
  // Internal — state management
  // -----------------------------------------------------------------------

  private setState(partial: Partial<SessionStreamState>): void {
    this.state = { ...this.state, ...partial };
    this.onChange?.({ ...this.state });
  }
}
