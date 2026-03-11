import type { CodexSessionManager } from './codex-session-manager.js';
import type {
  ForkManagedSessionInput,
  ManagedSessionHandle,
  ResumeManagedSessionInput,
  RuntimeAdapter,
  RuntimeCapabilities,
  StartManagedSessionInput,
} from './runtime-adapter.js';

export class CodexRuntimeAdapter implements RuntimeAdapter {
  readonly runtime = 'codex' as const;

  constructor(
    private readonly sessionManager: Pick<
      CodexSessionManager,
      'startSession' | 'resumeSession' | 'forkSession'
    >,
  ) {}

  async startSession(input: StartManagedSessionInput): Promise<ManagedSessionHandle> {
    const session = await this.sessionManager.startSession({
      agentId: input.agentId,
      projectPath: input.projectPath,
      prompt: input.prompt,
      model: input.model ?? undefined,
      sandboxLevel: input.sandboxLevel ?? null,
    });
    return mapCodexSession(session);
  }

  async resumeSession(input: ResumeManagedSessionInput): Promise<ManagedSessionHandle> {
    const session = await this.sessionManager.resumeSession({
      agentId: input.agentId,
      projectPath: input.projectPath,
      nativeSessionId: input.nativeSessionId,
      prompt: input.prompt,
      model: input.model ?? undefined,
      sandboxLevel: input.sandboxLevel ?? null,
    });
    return mapCodexSession(session);
  }

  async forkSession(input: ForkManagedSessionInput): Promise<ManagedSessionHandle> {
    const session = await this.sessionManager.forkSession({
      agentId: input.agentId,
      projectPath: input.projectPath,
      nativeSessionId: input.nativeSessionId,
      prompt: input.prompt ?? null,
      model: input.model ?? undefined,
      sandboxLevel: input.sandboxLevel ?? null,
    });
    return mapCodexSession(session);
  }

  async getCapabilities(): Promise<RuntimeCapabilities> {
    return {
      runtime: this.runtime,
      supportsResume: true,
      supportsFork: true,
    };
  }
}

function mapCodexSession(
  session: Awaited<ReturnType<Pick<CodexSessionManager, 'startSession'>['startSession']>>,
): ManagedSessionHandle {
  return {
    runtime: session.runtime,
    sessionId: session.id,
    nativeSessionId: session.nativeSessionId,
    agentId: session.agentId,
    projectPath: session.projectPath,
    model: session.model,
    status:
      session.status === 'running'
        ? 'active'
        : session.status === 'paused'
          ? 'paused'
          : session.status === 'ended'
            ? 'ended'
            : session.status === 'error'
              ? 'error'
              : 'starting',
    pid: session.pid,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
  };
}
