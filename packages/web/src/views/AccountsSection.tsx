'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiAccount } from '@/lib/api';
import {
  accountsQuery,
  useCreateAccount,
  useDeleteAccount,
  useTestAccount,
  useUpdateAccount,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDERS = [
  { value: 'anthropic_api', label: 'Anthropic API' },
  { value: 'claude_max', label: 'Claude Max (Pro)' },
  { value: 'claude_team', label: 'Claude Team' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'vertex', label: 'Google Vertex AI' },
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic_api: 'Anthropic API',
  claude_max: 'Claude Max',
  claude_team: 'Claude Team',
  bedrock: 'AWS Bedrock',
  vertex: 'Vertex AI',
};

/** Providers that use OAuth / session tokens from `claude login` instead of API keys. */
const OAUTH_PROVIDERS = new Set(['claude_max', 'claude_team']);

type CredentialFieldConfig = {
  label: string;
  placeholder: string;
  hint: string;
  inputType: string;
};

function getCredentialConfig(provider: string): CredentialFieldConfig {
  if (OAUTH_PROVIDERS.has(provider)) {
    return {
      label: 'Session Token',
      placeholder: 'Paste token from `claude login`',
      hint: 'Run `claude login` in terminal, then paste the session token here. OAuth login in browser coming soon.',
      inputType: 'password',
    };
  }
  if (provider === 'bedrock') {
    return {
      label: 'AWS Credentials',
      placeholder: 'ACCESS_KEY_ID:SECRET_ACCESS_KEY:REGION',
      hint: 'Format: ACCESS_KEY_ID:SECRET_ACCESS_KEY:us-east-1 (or configure via AWS_PROFILE env var)',
      inputType: 'password',
    };
  }
  if (provider === 'vertex') {
    return {
      label: 'Service Account Key',
      placeholder: 'Paste service account JSON or path',
      hint: 'Paste the full service account JSON key, or set GOOGLE_APPLICATION_CREDENTIALS env var',
      inputType: 'password',
    };
  }
  return {
    label: 'API Key',
    placeholder: 'sk-ant-...',
    hint: 'Your Anthropic API key from console.anthropic.com',
    inputType: 'password',
  };
}

// ---------------------------------------------------------------------------
// AccountsSection
// ---------------------------------------------------------------------------

export function AccountsSection(): React.JSX.Element {
  const { data: accounts = [], isLoading } = useQuery(accountsQuery());
  const queryClient = useQueryClient();
  const createAccount = useCreateAccount();
  const deleteAccount = useDeleteAccount();
  const testAccount = useTestAccount();
  const updateAccount = useUpdateAccount();

  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; latencyMs?: number }>>(
    {},
  );
  const [oauthLoading, setOauthLoading] = useState(false);

  // -- Create form state --
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [credential, setCredential] = useState('');
  const [priority, setPriority] = useState('0');

  function resetForm(): void {
    setName('');
    setProvider('');
    setCredential('');
    setPriority('0');
    setOauthLoading(false);
  }

  // Listen for OAuth postMessage from popup window
  const handleOAuthMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } | null;
      if (!data?.type) return;

      if (data.type === 'oauth_success') {
        void queryClient.invalidateQueries({ queryKey: ['accounts'] });
        setName('');
        setProvider('');
        setCredential('');
        setPriority('0');
        setOauthLoading(false);
        setShowAdd(false);
      } else if (data.type === 'oauth_error') {
        setOauthLoading(false);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [handleOAuthMessage]);

  async function handleOAuthLogin(): Promise<void> {
    if (!name || !provider) return;
    setOauthLoading(true);
    try {
      const res = await fetch('/api/oauth/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, accountName: name }),
      });
      if (!res.ok) {
        setOauthLoading(false);
        return;
      }
      const body = (await res.json()) as { authorizationUrl: string };
      window.open(body.authorizationUrl, 'anthropic-oauth', 'width=600,height=700');
    } catch {
      setOauthLoading(false);
    }
  }

  async function handleCreate(): Promise<void> {
    await createAccount.mutateAsync({
      name,
      provider,
      credential,
      priority: Number(priority) || 0,
    });
    resetForm();
    setShowAdd(false);
  }

  async function handleTest(id: string): Promise<void> {
    setTestingId(id);
    try {
      const res = await testAccount.mutateAsync(id);
      setTestResult((prev) => ({ ...prev, [id]: res }));
    } catch {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false } }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await deleteAccount.mutateAsync(id);
    setConfirmDeleteId(null);
  }

  async function handleToggleActive(account: ApiAccount): Promise<void> {
    await updateAccount.mutateAsync({ id: account.id, isActive: !account.isActive });
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">API Accounts</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Manage API keys and subscriptions for agent providers
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            Add Account
          </Button>
        </div>

        {/* Account list */}
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-[13px] text-muted-foreground py-6 text-center">
            No accounts configured. Add one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[13px]"
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{account.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {PROVIDER_LABELS[account.provider] ?? account.provider}
                    </Badge>
                    {account.isActive ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-green-500 border-green-500/30"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">{account.credentialMasked}</span>
                    <span>Priority: {account.priority}</span>
                    {(() => {
                      const result = testResult[account.id];
                      if (result == null) return null;
                      return (
                        <span
                          className={cn(
                            'font-medium',
                            result.ok ? 'text-green-500' : 'text-red-500',
                          )}
                        >
                          {result.ok
                            ? `OK${result.latencyMs != null ? ` (${result.latencyMs}ms)` : ''}`
                            : 'Failed'}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleToggleActive(account)}
                    disabled={updateAccount.isPending}
                  >
                    {account.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleTest(account.id)}
                    disabled={testingId === account.id}
                  >
                    {testingId === account.id ? 'Testing...' : 'Test'}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => setConfirmDeleteId(account.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Account Dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Account</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="account-name">
                  Name
                </label>
                <Input
                  id="account-name"
                  placeholder="e.g. My Anthropic Key"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="account-provider">
                  Provider
                </label>
                <Select
                  value={provider}
                  onValueChange={(v) => {
                    setProvider(v);
                    setCredential('');
                  }}
                >
                  <SelectTrigger className="w-full" id="account-provider">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {provider && OAUTH_PROVIDERS.has(provider) && (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    onClick={() => void handleOAuthLogin()}
                    disabled={!name || oauthLoading}
                  >
                    {oauthLoading ? 'Waiting for login...' : 'Login with Anthropic'}
                  </Button>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <div className="flex-1 border-t" />
                    <span>or paste manually</span>
                    <div className="flex-1 border-t" />
                  </div>
                </div>
              )}

              {provider && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="account-credential">
                    {getCredentialConfig(provider).label}
                  </label>
                  <Input
                    id="account-credential"
                    type={getCredentialConfig(provider).inputType}
                    placeholder={getCredentialConfig(provider).placeholder}
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {getCredentialConfig(provider).hint}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="account-priority">
                  Priority
                </label>
                <Input
                  id="account-priority"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Lower number = higher priority for failover routing.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={!name || !provider || !credential || createAccount.isPending}
              >
                {createAccount.isPending ? 'Creating...' : 'Create Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm Delete Dialog */}
        <Dialog open={confirmDeleteId !== null} onOpenChange={() => setConfirmDeleteId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Account</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete this account? This action cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteId && void handleDelete(confirmDeleteId)}
                disabled={deleteAccount.isPending}
              >
                {deleteAccount.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
