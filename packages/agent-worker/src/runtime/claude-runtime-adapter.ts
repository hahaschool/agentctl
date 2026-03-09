import type { CliSessionManager } from './cli-session-manager.js';
import type {
  ManagedSessionHandle,
  ResumeManagedSessionInput,
  RuntimeAdapter,
  RuntimeCapabilities,
  StartManagedSessionInput,
} from './runtime-adapter.js';

export class ClaudeRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'claude-code' as const;

  constructor(private readonly sessionManager: Pick<CliSessionManager, 'startSession'>) {}

  async startSession(input: StartManagedSessionInput): Promise<ManagedSessionHandle> {
    const session = this.sessionManager.startSession({
      agentId: input.agentId,
      projectPath: input.projectPath,
      prompt: input.prompt,
      model: input.model ?? undefined,
      resumeSessionId: undefined,
    });

    return mapCliSession(session, this.runtime);
  }

  async resumeSession(input: ResumeManagedSessionInput): Promise<ManagedSessionHandle> {
    const session = this.sessionManager.startSession({
      agentId: input.agentId,
      projectPath: input.projectPath,
      prompt: input.prompt,
      model: input.model ?? undefined,
      resumeSessionId: input.nativeSessionId,
    });

    return mapCliSession(session, this.runtime);
  }

  async getCapabilities(): Promise<RuntimeCapabilities> {
    return {
      runtime: this.runtime,
      supportsResume: true,
      supportsFork: false,
    };
  }
}

function mapCliSession(
  session: ReturnType<Pick<CliSessionManager, 'startSession'>['startSession']>,
  runtime: 'claude-code',
): ManagedSessionHandle {
  return {
    runtime,
    sessionId: session.id,
    nativeSessionId: session.claudeSessionId,
    agentId: session.agentId,
    projectPath: session.projectPath,
    model: session.model,
    status: mapCliStatus(session.status),
    pid: session.pid,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
  };
}

function mapCliStatus(status: string) {
  switch (status) {
    case 'running':
      return 'active' as const;
    case 'paused':
      return 'paused' as const;
    case 'ended':
      return 'ended' as const;
    case 'error':
      return 'error' as const;
    default:
      return 'starting' as const;
  }
}
