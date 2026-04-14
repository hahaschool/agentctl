'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCog } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import {
  AGENT_RUNTIME_TYPES,
  type AgentProfile,
  type AgentRuntimeType,
  agentProfilesApi,
  type CreateAgentProfileInput,
  isAgentRuntimeType,
} from '@/lib/api/agent-profiles';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_PROFILES_QUERY_KEY = ['agent-profiles'] as const;
const AGENT_PROFILES_POLL_INTERVAL = 30_000;
const DEFAULT_RUNTIME: AgentRuntimeType = 'claude-code';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function parseCapabilityList(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

type CreateDialogState = {
  name: string;
  runtimeType: AgentRuntimeType;
  modelId: string;
  providerId: string;
  capabilities: string;
  toolScopes: string;
};

function emptyCreateState(): CreateDialogState {
  return {
    name: '',
    runtimeType: DEFAULT_RUNTIME,
    modelId: '',
    providerId: '',
    capabilities: '',
    toolScopes: '',
  };
}

type CreateDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (profile: AgentProfile) => void;
};

function CreateAgentProfileDialog({
  open,
  onClose,
  onCreated,
}: CreateDialogProps): React.JSX.Element | null {
  const toast = useToast();
  const [state, setState] = useState<CreateDialogState>(() => emptyCreateState());
  const [error, setError] = useState<string | null>(null);

  const openKey = open ? 'open' : 'closed';
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setState(emptyCreateState());
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: (input: CreateAgentProfileInput) => agentProfilesApi.createAgentProfile(input),
    onSuccess: (profile) => {
      toast.success(`Profile ${profile.name} created`);
      onCreated(profile);
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err, 'Failed to create agent profile'));
    },
  });

  if (!open) return null;

  const validate = (): { body: CreateAgentProfileInput } | { error: string } => {
    const name = state.name.trim();
    const modelId = state.modelId.trim();
    const providerId = state.providerId.trim();

    if (!name) return { error: 'Name is required' };
    if (!isAgentRuntimeType(state.runtimeType)) return { error: 'Invalid runtime type' };
    if (!modelId) return { error: 'Model ID is required' };
    if (!providerId) return { error: 'Provider ID is required' };

    return {
      body: {
        name,
        runtimeType: state.runtimeType,
        modelId,
        providerId,
        capabilities: parseCapabilityList(state.capabilities),
        toolScopes: parseCapabilityList(state.toolScopes),
      },
    };
  };

  const handleSubmit = (evt: React.FormEvent<HTMLFormElement>): void => {
    evt.preventDefault();
    const result = validate();
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    mutation.mutate(result.body);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-profile-form-title"
      data-testid="agent-profile-form-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-xl rounded-md border border-border bg-card shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col" noValidate>
          <div className="px-5 py-3 border-b border-border">
            <h2 id="agent-profile-form-title" className="text-sm font-semibold text-foreground">
              New agent profile
            </h2>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div>
              <label
                htmlFor="agent-profile-name"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                Name
              </label>
              <input
                id="agent-profile-name"
                value={state.name}
                onChange={(e) => setState((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                placeholder="code-reviewer"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="agent-profile-runtime"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Runtime
                </label>
                <select
                  id="agent-profile-runtime"
                  value={state.runtimeType}
                  onChange={(e) =>
                    setState((p) => ({ ...p, runtimeType: e.target.value as AgentRuntimeType }))
                  }
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                >
                  {AGENT_RUNTIME_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="agent-profile-model"
                  className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
                >
                  Model ID
                </label>
                <input
                  id="agent-profile-model"
                  value={state.modelId}
                  onChange={(e) => setState((p) => ({ ...p, modelId: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                  placeholder="claude-opus-4-5"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="agent-profile-provider"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                Provider ID
              </label>
              <input
                id="agent-profile-provider"
                value={state.providerId}
                onChange={(e) => setState((p) => ({ ...p, providerId: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                placeholder="anthropic"
              />
            </div>

            <div>
              <label
                htmlFor="agent-profile-capabilities"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                Capabilities (comma-separated)
              </label>
              <input
                id="agent-profile-capabilities"
                value={state.capabilities}
                onChange={(e) => setState((p) => ({ ...p, capabilities: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                placeholder="code-review, planning"
              />
            </div>

            <div>
              <label
                htmlFor="agent-profile-tool-scopes"
                className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1"
              >
                Tool scopes (comma-separated)
              </label>
              <input
                id="agent-profile-tool-scopes"
                value={state.toolScopes}
                onChange={(e) => setState((p) => ({ ...p, toolScopes: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md text-xs px-2 py-1.5 font-mono text-foreground"
                placeholder="Read, Grep"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Cost guards (<span className="font-mono">maxTokensPerTask</span>,{' '}
              <span className="font-mono">maxCostPerHour</span>) can be adjusted later via the API
              directly.
            </p>

            {error && (
              <p
                role="alert"
                className="text-xs text-red-400"
                data-testid="agent-profile-form-error"
              >
                {error}
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              data-testid="agent-profile-submit"
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50"
            >
              {mutation.isPending ? 'Creating…' : 'Create profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type ProfileRowProps = {
  profile: AgentProfile;
  onDelete: (profile: AgentProfile) => void;
  deletingId: string | null;
};

function AgentProfileRow({ profile, onDelete, deletingId }: ProfileRowProps): React.JSX.Element {
  const thisRowIsDeleting = deletingId === profile.id;
  const capabilities = profile.capabilities.length === 0 ? '—' : profile.capabilities.join(', ');

  return (
    <tr className="border-t border-border hover:bg-accent/5">
      <td className="px-4 py-3 align-top">
        <div className="font-mono text-xs text-foreground">{profile.name}</div>
        <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate max-w-[240px]">
          {profile.id}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <span className="px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase bg-primary/15 text-primary">
          {profile.runtimeType}
        </span>
      </td>
      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
        {profile.modelId}
      </td>
      <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
        {profile.providerId}
      </td>
      <td className="px-4 py-3 align-top text-xs text-muted-foreground max-w-[280px]">
        <span className="font-mono break-words">{capabilities}</span>
      </td>
      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => onDelete(profile)}
          disabled={thisRowIsDeleting}
          data-testid={`delete-${profile.id}`}
          title="Delete profile"
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
            'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10',
          )}
        >
          {thisRowIsDeleting ? 'Deleting…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AgentProfilesPage(): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profilesData = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEY,
    queryFn: agentProfilesApi.listAgentProfiles,
    refetchInterval: AGENT_PROFILES_POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgentProfile | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentProfilesApi.deleteAgentProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY });
    },
  });

  const profiles = profilesData.data ?? [];

  const handleCreated = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY });
  }, [queryClient]);

  const confirmDelete = useCallback((): void => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        toast.success(`Profile ${target.name} deleted`);
        setPendingDelete(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Failed to delete profile'));
        setPendingDelete(null);
      },
    });
  }, [deleteMutation, pendingDelete, toast]);

  const deletingId = deleteMutation.isPending
    ? ((deleteMutation.variables as string | undefined) ?? null)
    : null;

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={profilesData.isFetching && !profilesData.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <UserCog size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Agent Profiles</h1>
          {profiles.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
              {profiles.length} total
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton
            onClick={() => void profilesData.refetch()}
            isFetching={profilesData.isFetching && !profilesData.isLoading}
          />
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            data-testid="new-agent-profile"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb]"
          >
            + New profile
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Reusable agent identities. Each profile captures a runtime, model, provider, and a set of
        capabilities/tool scopes. Instances spawned from a profile inherit these defaults and are
        managed per-machine via <span className="font-mono">/api/agent-profiles/:id/instances</span>
        .
      </p>

      {profilesData.error && (
        <ErrorBanner
          message={`Failed to load agent profiles: ${profilesData.error.message}`}
          onRetry={() => void profilesData.refetch()}
          className="mb-4"
        />
      )}

      {profilesData.isLoading && (
        <div className="space-y-2" data-testid="agent-profiles-loading">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-14 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {!profilesData.isLoading && !profilesData.error && profiles.length === 0 && (
        <div
          className="text-center py-16 text-muted-foreground text-sm"
          data-testid="agent-profiles-empty"
        >
          <p>No agent profiles yet.</p>
          <p className="mt-1 text-xs">
            Profiles let you spin up reusable agent identities with consistent runtime, model, and
            tool settings.
          </p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            data-testid="empty-new-agent-profile"
            className="mt-4 px-3 py-1.5 rounded-md text-xs font-medium bg-[#3b82f6] text-white hover:bg-[#2563eb]"
          >
            Create your first profile
          </button>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Agent profiles">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Runtime</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Capabilities</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <AgentProfileRow
                    key={profile.id}
                    profile={profile}
                    onDelete={setPendingDelete}
                    deletingId={deletingId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateAgentProfileDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-profile-delete-title"
          data-testid="agent-profile-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card shadow-xl p-5">
            <h2 id="agent-profile-delete-title" className="text-sm font-semibold text-foreground">
              Delete agent profile?
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              This removes the profile and detaches any active instances running under it.
            </p>
            <p className="mt-1.5 text-[11px] font-mono text-foreground break-all">
              {pendingDelete.name}{' '}
              <span className="text-muted-foreground">({pendingDelete.id})</span>
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                data-testid="confirm-delete-agent-profile"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <AgentProfilesPage />
    </ErrorBoundary>
  );
}
