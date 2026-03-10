import type { ManagedRuntime } from './runtime-management.js';

export type AccountProvider =
  | 'anthropic_api'
  | 'claude_max'
  | 'claude_team'
  | 'bedrock'
  | 'vertex'
  | 'openai_api';

export const ACCOUNT_PROVIDERS: AccountProvider[] = [
  'anthropic_api',
  'claude_max',
  'claude_team',
  'bedrock',
  'vertex',
  'openai_api',
];

export type AccountSource =
  | 'managed'
  | 'discovered_local'
  | 'managed_mirrored_to_worker'
  | 'takeover_pending';

export type AccountCustody = 'control_plane' | 'worker_local';

export type AccountStatus = 'active' | 'inactive' | 'auth_error' | 'drifted' | 'ignored';

export type ApiAccount = {
  id: string;
  name: string;
  provider: AccountProvider;
  /** Masked credential — never the raw key */
  credentialMasked: string;
  priority: number;
  rateLimit: { itpm?: number; otpm?: number };
  isActive: boolean;
  metadata: Record<string, unknown>;
  source?: AccountSource;
  custody?: AccountCustody;
  status?: AccountStatus;
  runtimeCompatibility?: ManagedRuntime[];
  originMachineId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAccountMapping = {
  id: string;
  projectPath: string;
  accountId: string;
  createdAt: string;
};

export type FailoverPolicy = 'none' | 'priority' | 'round_robin';

export type AccountDefaults = {
  defaultAccountId: string | null;
  failoverPolicy: FailoverPolicy;
};
