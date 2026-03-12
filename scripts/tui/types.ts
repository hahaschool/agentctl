// =============================================================================
// Shared types for the TUI monitoring panel
// =============================================================================

export type ServiceStatus = 'ok' | 'error' | 'loading';

export type ServiceInfo = {
  readonly name: string;
  readonly port: number;
  readonly status: ServiceStatus;
  readonly uptime: string | null;
  readonly memory: string | null;
};

export type AgentStatus = 'running' | 'idle' | 'stopped' | 'error';

export type AgentInfo = {
  readonly id: string;
  readonly name: string;
  readonly status: AgentStatus;
  readonly cost: number | null;
  readonly duration: string | null;
};

export type ActivityEventType = 'success' | 'error' | 'info' | 'warning';

export type ActivityEvent = {
  readonly timestamp: string;
  readonly source: string;
  readonly message: string;
  readonly type: ActivityEventType;
};

export type PanelId = 'services' | 'agents';

export type ViewMode = 'main' | 'logs';
