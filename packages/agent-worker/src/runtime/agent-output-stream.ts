import type { AgentEvent } from '@agentctl/shared';

export type AgentOutputFileAction = 'created' | 'modified' | 'deleted';

export interface AgentOutputStream {
  text(data: string): void;
  thinking(data: string): void;
  toolUse(toolName: string, toolInput: unknown): void;
  toolResult(toolName: string, result: unknown, success?: boolean): void;
  toolBlocked(toolName: string, reason: string): void;
  fileChange(path: string, action: AgentOutputFileAction, diff?: string): void;
  costUpdate(turnCost: number, totalCost: number): void;
  error(code: string, message: string): void;
  /** Report a rate-limit error for live handoff detection. */
  rateLimitError(statusCode: number | undefined, message: string): void;
}

export class EventedAgentOutputStream implements AgentOutputStream {
  constructor(private readonly emitEvent: (event: AgentEvent) => void) {}

  text(data: string): void {
    this.emitOutput('text', data);
  }

  thinking(data: string): void {
    this.emitOutput('text', data);
  }

  toolUse(toolName: string, toolInput: unknown): void {
    this.emitOutput(
      'tool_use',
      serialize({
        tool: toolName,
        input: toolInput ?? {},
      }),
    );
  }

  toolResult(_toolName: string, result: unknown, _success: boolean = true): void {
    this.emitOutput('tool_result', serializeResult(result));
  }

  toolBlocked(toolName: string, reason: string): void {
    this.emitOutput('tool_blocked', `Tool '${toolName}' was blocked: ${reason}`);
  }

  fileChange(path: string, action: AgentOutputFileAction, diff?: string): void {
    const suffix = diff ? ` ${diff}` : '';
    this.emitOutput('text', `[file_change:${action}] ${path}${suffix}`);
  }

  costUpdate(turnCost: number, totalCost: number): void {
    this.emitEvent({
      event: 'cost',
      data: {
        turnCost,
        totalCost,
      },
    });
  }

  error(code: string, message: string): void {
    this.emitOutput('text', `[error:${code}] ${message}`);
  }

  rateLimitError(statusCode: number | undefined, message: string): void {
    this.emitEvent({
      event: 'output',
      data: {
        type: 'text',
        content: `[rate_limit_hit] status=${statusCode ?? 'unknown'} ${message}`,
      },
    });
  }

  private emitOutput(type: 'text' | 'tool_use' | 'tool_result' | 'tool_blocked', content: string) {
    this.emitEvent({
      event: 'output',
      data: {
        type,
        content,
      },
    });
  }
}

function serialize(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  return serialize(result);
}
