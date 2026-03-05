'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// Card removed — parent SettingsGroup provides visual grouping
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
import { api } from '@/lib/api';
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

/** Providers that use OAuth tokens from `claude setup-token` instead of API keys. */
const TOKEN_PROVIDERS = new Set(['claude_max', 'claude_team']);

/** Providers that support browser-based OAuth login. */
const OAUTH_PROVIDERS = new Set(['claude_max', 'claude_team']);

type CredentialFieldConfig = {
  label: string;
  placeholder: string;
  hint: string;
  inputType: string;
};

function getCredentialConfig(provider: string): CredentialFieldConfig {
  if (TOKEN_PROVIDERS.has(provider)) {
    return {
      label: 'OAuth Token',
      placeholder: 'Paste token from `claude setup-token`',
      hint: 'Run `claude setup-token` in your terminal to get a long-lived token (valid ~1 year), then paste it here.',
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
  const createAccount = useCreateAccount();
  const deleteAccount = useDeleteAccount();
  const testAccount = useTestAccount();
  const updateAccount = useUpdateAccount();
  const toast = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; latencyMs?: number }>>(
    {},
  );
  // -- Create form state --
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [credential, setCredential] = useState('');
  const [priority, setPriority] = useState('0');

  const [oauthLoading, setOauthLoading] = useState(false);
  const queryClient = useQueryClient();
  const oauthPopupRef = useRef<Window | null>(null);

  const resetForm = useCallback((): void => {
    setName('');
    setProvider('');
    setCredential('');
    setPriority('0');
  }, []);

  // Listen for OAuth callback postMessage from popup
  useEffect(() => {
    function handleMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; accountId?: string; error?: string } | undefined;
      if (!data?.type) return;

      if (data.type === 'oauth_success') {
        setOauthLoading(false);
        setShowAdd(false);
        resetForm();
        void queryClient.invalidateQueries({ queryKey: ['accounts'] });
        toast.success('Account connected via OAuth');
        oauthPopupRef.current?.close();
      } else if (data.type === 'oauth_error') {
        setOauthLoading(false);
        toast.error(data.error ?? 'OAuth flow failed');
        oauthPopupRef.current?.close();
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [queryClient, resetForm, toast]);

  async function handleOAuth(): Promise<void> {
    if (!name || !provider) return;
    setOauthLoading(true);
    try {
      const { authorizationUrl } = await api.initiateOAuth(provider, name);
      const popup = window.open(authorizationUrl, 'anthropic-oauth', 'width=600,height=700');
      oauthPopupRef.current = popup;

      // Detect popup closed without completing OAuth
      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          setOauthLoading(false);
        }
      }, 1000);
    } catch (err) {
      setOauthLoading(false);
      toast.error(err instanceof Error ? err.message : 'Failed to start OAuth flow');
    }
  }

  async function handleCreate(): Promise<void> {
    try {
      await createAccount.mutateAsync({
        name,
        provider,
        credential,
        priority: Number(priority) || 0,
      });
      resetForm();
      setShowAdd(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create account');
    }
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
    try {
      await deleteAccount.mutateAsync(id);
      setConfirmDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
    }
  }

  async function handleToggleActive(account: ApiAccount): Promise<void> {
    try {
      await updateAccount.mutateAsync({ id: account.id, isActive: !account.isActive });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border/30">
        <h3 className="text-sm font-semibold">Accounts</h3>
        <Button size="sm" variant="default" onClick={() => setShowAdd(true)}>
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
              className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3 text-[13px] transition-colors hover:bg-muted/50"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{account.name}</span>
                  <Badge variant="secondary" className="text-[10px] bg-muted/80 border border-border/40">
                    {PROVIDER_LABELS[account.provider] ?? account.provider}
                  </Badge>
                  {account.isActive ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-green-400 border-green-500/40 bg-green-500/10"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40 bg-muted/40">
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
                        className={cn('font-medium', result.ok ? 'text-green-500' : 'text-red-500')}
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
                <SelectContent position="popper" sideOffset={4}>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {provider && OAUTH_PROVIDERS.has(provider) && (
              <div className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => void handleOAuth()}
                  disabled={!name || oauthLoading}
                >
                  {oauthLoading ? 'Waiting for authorization...' : 'Authorize with Anthropic'}
                </Button>
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-border/40" />
                  <span className="text-[11px] text-muted-foreground">or paste manually</span>
                  <div className="flex-1 border-t border-border/40" />
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
              disabled={!name || !provider || !credential || createAccount.isPending || oauthLoading}
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
    </div>
  );
}
