'use client';

import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import type React from 'react';
import { useCallback } from 'react';

import { meshConfigQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

function truncateKey(key: string, maxLen = 16): string {
  if (key.length <= maxLen) return key;
  return `${key.slice(0, 8)}…${key.slice(-8)}`;
}

type CopyButtonProps = {
  value: string;
  label: string;
};

function CopyButton({ value, label }: CopyButtonProps): React.JSX.Element {
  const handleCopy = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label}`}
      className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/10"
    >
      <Copy size={12} />
    </button>
  );
}

type FieldProps = {
  label: string;
  value: string | null;
  badge?: string | null;
  badgeClass?: string;
  copyable?: boolean;
  truncated?: boolean;
  mono?: boolean;
};

function Field({
  label,
  value,
  badge,
  badgeClass,
  copyable,
  truncated,
  mono,
}: FieldProps): React.JSX.Element {
  const displayValue = value ?? '—';
  const truncatedValue = truncated && value ? truncateKey(value) : displayValue;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span
        className={cn('text-foreground', mono && 'font-mono')}
        title={truncated && value ? value : undefined}
      >
        {truncatedValue}
      </span>
      {badge && (
        <span
          className={cn(
            'px-1.5 py-px rounded-sm text-[10px] font-medium',
            badgeClass ?? 'bg-muted text-muted-foreground',
          )}
        >
          {badge}
        </span>
      )}
      {copyable && value && <CopyButton value={value} label={label} />}
    </div>
  );
}

const SOURCE_BADGE_CLASS: Record<string, string> = {
  db: 'bg-blue-500/15 text-blue-400',
  env: 'bg-purple-500/15 text-purple-400',
  'auto-detect': 'bg-green-500/15 text-green-400',
  derived: 'bg-muted text-muted-foreground',
};

/**
 * §33.12 Phase 4.2 — Display this node's mesh identity at the top of the
 * Mesh Peers page. Shows machine ID, hostname, Tailscale IP, sync URL,
 * public key, and token status with source badges.
 */
export function SelfIdentityCard(): React.JSX.Element | null {
  const { data: config, isLoading } = useQuery(meshConfigQuery());

  if (isLoading) {
    return (
      <div
        data-testid="self-identity-loading"
        className="mb-4 p-3 rounded-lg border border-border bg-card/50 animate-pulse h-24"
      />
    );
  }

  if (!config) return null;

  return (
    <div
      data-testid="self-identity-card"
      className="mb-4 p-3 rounded-lg border border-border bg-card/50"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          This Node
        </h3>
        <a
          href="/settings#mesh-identity"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Settings <ExternalLink size={10} />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        <Field label="Machine ID" value={config.machineId} mono copyable />
        <Field label="Hostname" value={config.hostname} />
        <Field
          label="Tailscale IP"
          value={config.tailscaleIp}
          badge={config.tailscaleIpSource}
          badgeClass={SOURCE_BADGE_CLASS[config.tailscaleIpSource ?? ''] ?? undefined}
          mono
          copyable
        />
        <Field
          label="Sync URL"
          value={config.syncUrl}
          badge={config.syncUrlSource}
          badgeClass={SOURCE_BADGE_CLASS[config.syncUrlSource] ?? undefined}
          mono
          copyable
        />
        <Field label="Public Key" value={config.publicKey} mono truncated copyable />
        <Field
          label="Token"
          value={config.registrationTokenConfigured ? 'Configured' : 'Not set'}
          badge={config.registrationTokenSource}
          badgeClass={
            config.registrationTokenConfigured
              ? (SOURCE_BADGE_CLASS[config.registrationTokenSource ?? ''] ?? undefined)
              : 'bg-yellow-500/15 text-yellow-400'
          }
        />
      </div>
    </div>
  );
}
