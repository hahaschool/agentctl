'use client';

import { useQuery } from '@tanstack/react-query';
import { Smartphone, Trash2 } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { MobilePushDevice } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format-utils';
import { pushDevicesQuery, useDeactivatePushDevice } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Placeholder user id — mirrors NotificationPreferencesPanel until we have a
// first-class auth context. See settings/NotificationPreferencesPanel.tsx.
// ---------------------------------------------------------------------------

const CURRENT_USER_ID = 'local';

const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iOS',
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type DeviceRowProps = {
  readonly device: MobilePushDevice;
  readonly userId: string;
  readonly isRevoking: boolean;
  readonly onRevoke: (device: MobilePushDevice) => void;
};

function DeviceRow({ device, isRevoking, onRevoke }: DeviceRowProps): React.JSX.Element {
  const platformLabel = PLATFORM_LABELS[device.platform] ?? device.platform;
  const disabled = device.disabledAt !== null;
  const deviceName = `${platformLabel} device`;

  return (
    <div
      data-testid={`push-device-row-${device.id}`}
      className={cn(
        'rounded-lg border border-border/40 bg-muted/10 px-4 py-3',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tracking-tight">{deviceName}</span>
            <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-500">
              {platformLabel}
            </span>
            {disabled && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Revoked
              </span>
            )}
          </div>
          <p className="truncate text-[11px] font-mono text-muted-foreground" title={device.appId}>
            app: {device.appId}
          </p>
          <dl className="grid gap-x-4 gap-y-0.5 pt-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <div className="flex gap-1">
              <dt>Registered:</dt>
              <dd title={formatDateTime(device.createdAt)} className="font-mono">
                {timeAgo(device.createdAt)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Last seen:</dt>
              <dd title={formatDateTime(device.lastSeenAt)} className="font-mono">
                {timeAgo(device.lastSeenAt)}
              </dd>
            </div>
          </dl>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onRevoke(device)}
            disabled={isRevoking}
            data-testid={`push-device-revoke-${device.id}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            aria-label={`Revoke ${deviceName}`}
          >
            <Trash2 size={11} aria-hidden="true" />
            {isRevoking ? 'Revoking' : 'Revoke'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function PushDevicesSection(): React.JSX.Element {
  const userId = CURRENT_USER_ID;
  const query = useQuery(pushDevicesQuery(userId));
  const deactivate = useDeactivatePushDevice();
  const [pendingRevoke, setPendingRevoke] = useState<MobilePushDevice | null>(null);

  const devices = query.data?.devices ?? [];

  // Show active devices first, revoked devices hidden by default because the
  // default listDevices call sets includeDisabled=false. Kept defensive here
  // in case the backend contract changes.
  const activeDevices = devices.filter((d) => d.disabledAt === null);

  function handleRevoke(device: MobilePushDevice): void {
    setPendingRevoke(device);
  }

  const pendingPlatformLabel = pendingRevoke
    ? (PLATFORM_LABELS[pendingRevoke.platform] ?? pendingRevoke.platform)
    : '';
  const pendingDeviceLabel = pendingPlatformLabel ? `${pendingPlatformLabel} device` : 'device';

  return (
    <div data-testid="push-devices-section">
      <div className="pb-3 mb-4 border-b border-border/30">
        <h3 className="text-sm font-semibold">Registered Push Devices</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          iOS devices registered for push notifications. Install the AgentCTL iOS app and enable
          notifications to add a device. Revoking a device stops push delivery until it
          re-registers.
        </p>
      </div>

      {query.isLoading && (
        <div className="space-y-2" data-testid="push-devices-loading">
          {[1, 2].map((k) => (
            <div key={k} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {!query.isLoading && query.error && (
        <div
          role="alert"
          data-testid="push-devices-error"
          className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500"
        >
          <span>
            Failed to load push devices:{' '}
            {query.error instanceof Error ? query.error.message : String(query.error)}
          </span>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {!query.isLoading && !query.error && activeDevices.length === 0 && (
        <div
          className="rounded-lg border border-dashed border-border/50 bg-muted/10 p-6 text-center"
          data-testid="push-devices-empty"
        >
          <Smartphone
            size={20}
            className="mx-auto mb-2 text-muted-foreground/60"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">No devices registered.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            Install the iOS app and enable notifications to register a device.
          </p>
        </div>
      )}

      {!query.isLoading && !query.error && activeDevices.length > 0 && (
        <div className="space-y-2">
          {activeDevices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              userId={userId}
              isRevoking={deactivate.isPending && deactivate.variables?.id === device.id}
              onRevoke={handleRevoke}
            />
          ))}
        </div>
      )}

      {deactivate.isError && (
        <div
          role="alert"
          data-testid="push-devices-revoke-error"
          className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-500"
        >
          Failed to revoke device:{' '}
          {deactivate.error instanceof Error ? deactivate.error.message : String(deactivate.error)}
        </div>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title={`Revoke this ${pendingDeviceLabel}?`}
        description="It will stop receiving push notifications until re-registered from the app."
        confirmLabel="Revoke device"
        cancelLabel="Cancel"
        destructive
        onConfirm={async () => {
          if (!pendingRevoke) return;
          await deactivate.mutateAsync({ id: pendingRevoke.id, userId });
        }}
      />
    </div>
  );
}
