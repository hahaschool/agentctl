export type AccountProvider = 'anthropic_api' | 'claude_max' | 'claude_team' | 'bedrock' | 'vertex';

export const ACCOUNT_PROVIDERS: AccountProvider[] = [
  'anthropic_api',
  'claude_max',
  'claude_team',
  'bedrock',
  'vertex',
];

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
