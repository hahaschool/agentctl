'use client';

// ---------------------------------------------------------------------------
// Mesh identity config section — §33.12 Phase 2.4
//
// Surfaces GET/PUT /api/mesh/config so the operator can view and edit
// Tailscale IP override, sync URL override, and registration token
// directly from the settings page. No restart required.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useToast } from '@/components/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { meshConfigQuery, useUpdateMeshConfig } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Source badge — shows where a resolved value came from
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: string | null }): React.JSX.Element | null {
  if (!source) return null;
  const label: Record<string, string> = {
    db: 'manual override',
    env: 'env var',
    'auto-detect': 'auto-detected',
    derived: 'derived',
  };
  const isOverride = source === 'db';
  return (
    <Badge
      variant="outline"
      className={cn(
        'ml-2 border-border/40 text-[10px]',
        isOverride
          ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
          : 'bg-muted/60 text-muted-foreground',
      )}
    >
      {label[source] ?? source}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Read-only field row
// ---------------------------------------------------------------------------

function ReadOnlyField({
  label,
  value,
  mono,
  copyable,
  truncate,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  copyable?: boolean;
  truncate?: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const display = value ?? '—';

  const handleCopy = useCallback(() => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      toast.success('Copied to clipboard');
    });
  }, [value, toast]);

  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <span
          className={cn('text-sm', mono && 'font-mono', truncate && 'max-w-[200px] truncate')}
          title={truncate ? (value ?? undefined) : undefined}
        >
          {display}
        </span>
        {copyable && value && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={handleCopy}>
            Copy
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable field with override/clear
// ---------------------------------------------------------------------------

function EditableField({
  label,
  resolvedValue,
  source,
  placeholder,
  onSave,
  onClear,
  isPending,
  validate,
}: {
  label: string;
  resolvedValue: string | null;
  source: string | null;
  placeholder: string;
  onSave: (value: string) => void;
  onClear: () => void;
  isPending: boolean;
  validate?: (value: string) => string | null;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleEdit = useCallback(() => {
    setDraft('');
    setError(null);
    setEditing(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!draft.trim()) return;
    if (validate) {
      const err = validate(draft.trim());
      if (err) {
        setError(err);
        return;
      }
    }
    onSave(draft.trim());
    setEditing(false);
    setDraft('');
    setError(null);
  }, [draft, onSave, validate]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft('');
    setError(null);
  }, []);

  const isOverride = source === 'db';

  return (
    <div className="space-y-2 border-b border-border/30 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center">
          <span className="text-sm font-medium">{label}</span>
          <SourceBadge source={source} />
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={handleEdit}
                disabled={isPending}
              >
                Override
              </Button>
              {isOverride && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px] text-muted-foreground"
                  onClick={onClear}
                  disabled={isPending}
                >
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="font-mono text-sm text-foreground">
        {resolvedValue ?? <span className="text-muted-foreground">not configured</span>}
      </div>

      {editing && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            className="h-8 font-mono text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') handleCancel();
            }}
          />
          <Button
            size="sm"
            className="h-8"
            onClick={handleSave}
            disabled={isPending || !draft.trim()}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}

      {error && <div className="text-[12px] text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token field — write-only with Generate + Copy + Clear
// ---------------------------------------------------------------------------

function TokenField({
  configured,
  source,
  onSave,
  onClear,
  isPending,
}: {
  configured: boolean;
  source: string | null;
  onSave: (token: string) => void;
  onClear: () => void;
  isPending: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [generated, setGenerated] = useState(false);

  const statusText = configured
    ? `Configured (${source === 'db' ? 'manual' : (source ?? 'unknown')})`
    : 'Not configured';

  const handleGenerate = useCallback(() => {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    setDraft(hex);
    setGenerated(true);
    setEditing(true);
  }, []);

  const handleCopy = useCallback(() => {
    if (!draft) return;
    void navigator.clipboard.writeText(draft).then(() => {
      toast.success('Token copied to clipboard');
    });
  }, [draft, toast]);

  const handleSave = useCallback(() => {
    if (!draft.trim()) return;
    onSave(draft.trim());
    setEditing(false);
    setDraft('');
    setGenerated(false);
  }, [draft, onSave]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft('');
    setGenerated(false);
  }, []);

  const isDbOverride = source === 'db';

  return (
    <div className="space-y-2 border-b border-border/30 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center">
          <span className="text-sm font-medium">Registration Token</span>
          <SourceBadge source={source} />
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={handleGenerate}
                disabled={isPending}
              >
                Generate
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-[11px]"
                onClick={() => {
                  setEditing(true);
                  setGenerated(false);
                }}
                disabled={isPending}
              >
                Enter manually
              </Button>
              {isDbOverride && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px] text-muted-foreground"
                  onClick={onClear}
                  disabled={isPending}
                >
                  Clear
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="text-sm">
        <Badge
          variant="outline"
          className={cn(
            'border-border/40',
            configured
              ? 'bg-green-500/10 text-green-700 dark:text-green-300'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}
        >
          {statusText}
        </Badge>
      </div>

      {editing && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setGenerated(false);
              }}
              placeholder="Paste or type a registration token"
              className="h-8 font-mono text-sm"
              autoFocus
            />
            {(generated || draft) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-[11px]"
                onClick={handleCopy}
              >
                Copy
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8"
              onClick={handleSave}
              disabled={isPending || !draft.trim()}
            >
              Save token
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
          {generated && (
            <div className="text-[12px] text-amber-600 dark:text-amber-300">
              Copy this token now. Once saved, the raw value will not be shown again.
            </div>
          )}
        </div>
      )}

      {!configured && !editing && (
        <div className="mt-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          Registration token not set. Adding this node as a peer on another machine will require
          manual retry after configuring a matching token on both sides.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function MeshConfigSection(): React.JSX.Element {
  const toast = useToast();
  const configQuery = useQuery(meshConfigQuery());
  const updateMutation = useUpdateMeshConfig();

  const handleUpdateTailscaleIp = useCallback(
    (value: string) => {
      updateMutation.mutate(
        { tailscaleIpOverride: value },
        {
          onSuccess: () => toast.success('Tailscale IP override saved'),
          onError: (err) => toast.error(`Failed: ${err.message}`),
        },
      );
    },
    [updateMutation, toast],
  );

  const handleClearTailscaleIp = useCallback(() => {
    updateMutation.mutate(
      { tailscaleIpOverride: null },
      {
        onSuccess: () => toast.success('Tailscale IP override cleared'),
        onError: (err) => toast.error(`Failed: ${err.message}`),
      },
    );
  }, [updateMutation, toast]);

  const handleUpdateSyncUrl = useCallback(
    (value: string) => {
      updateMutation.mutate(
        { syncUrlOverride: value },
        {
          onSuccess: () => toast.success('Sync URL override saved'),
          onError: (err) => toast.error(`Failed: ${err.message}`),
        },
      );
    },
    [updateMutation, toast],
  );

  const handleClearSyncUrl = useCallback(() => {
    updateMutation.mutate(
      { syncUrlOverride: null },
      {
        onSuccess: () => toast.success('Sync URL override cleared'),
        onError: (err) => toast.error(`Failed: ${err.message}`),
      },
    );
  }, [updateMutation, toast]);

  const handleSaveToken = useCallback(
    (token: string) => {
      updateMutation.mutate(
        { registrationToken: token },
        {
          onSuccess: () => toast.success('Registration token saved'),
          onError: (err) => toast.error(`Failed: ${err.message}`),
        },
      );
    },
    [updateMutation, toast],
  );

  const handleClearToken = useCallback(() => {
    updateMutation.mutate(
      { registrationToken: null },
      {
        onSuccess: () => toast.success('Registration token cleared'),
        onError: (err) => toast.error(`Failed: ${err.message}`),
      },
    );
  }, [updateMutation, toast]);

  if (configQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="mesh-config-loading">
        <Skeleton className="h-64 rounded-[24px]" />
      </div>
    );
  }

  if (configQuery.error || !configQuery.data) {
    return (
      <div className="rounded-[24px] border border-dashed border-border/60 bg-muted/20 p-5 text-sm text-muted-foreground">
        Unable to load mesh config.
        {configQuery.error instanceof Error ? ` ${configQuery.error.message}` : null}
      </div>
    );
  }

  const config = configQuery.data;

  return (
    <article className="rounded-[24px] border border-border/50 bg-background/80 p-4 md:p-5">
      <div className="border-b border-border/40 pb-4">
        <h3 className="text-base font-semibold tracking-tight">Mesh Identity</h3>
        <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">
          This node&apos;s mesh identity and connection parameters. Overrides take effect
          immediately without restart.
        </p>
      </div>

      <div className="divide-y divide-border/30">
        <ReadOnlyField label="Machine ID" value={config.machineId} mono copyable />
        <ReadOnlyField label="Hostname" value={config.hostname} />

        <EditableField
          label="Tailscale IP"
          resolvedValue={config.tailscaleIp}
          source={config.tailscaleIpSource}
          placeholder="e.g. 100.64.0.10"
          onSave={handleUpdateTailscaleIp}
          onClear={handleClearTailscaleIp}
          isPending={updateMutation.isPending}
          validate={(v) => {
            const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
            if (!ipv4.test(v)) return 'Must be a valid IPv4 address';
            if (v.startsWith('127.') || v.startsWith('169.254.'))
              return 'Loopback and link-local addresses are not allowed';
            return null;
          }}
        />

        <EditableField
          label="Sync URL"
          resolvedValue={config.syncUrl}
          source={config.syncUrlSource}
          placeholder="e.g. http://100.64.0.10:8080"
          onSave={handleUpdateSyncUrl}
          onClear={handleClearSyncUrl}
          isPending={updateMutation.isPending}
          validate={(v) => {
            try {
              const parsed = new URL(v);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
                return 'URL must use http or https';
              return null;
            } catch {
              return 'Must be a valid URL';
            }
          }}
        />

        <TokenField
          configured={config.registrationTokenConfigured}
          source={config.registrationTokenSource}
          onSave={handleSaveToken}
          onClear={handleClearToken}
          isPending={updateMutation.isPending}
        />

        <ReadOnlyField label="Public Key" value={config.publicKey} mono copyable truncate />
      </div>

      {config.registrationTokenConfigured && (
        <div className="mt-4 rounded-md border border-border/30 bg-muted/15 px-3 py-2 text-[12px] text-muted-foreground">
          Changing the token only affects future reverse registration attempts. Existing peer sync
          connections use Ed25519 key auth, not the bootstrap token.
        </div>
      )}
    </article>
  );
}
