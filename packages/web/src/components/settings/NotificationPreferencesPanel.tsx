'use client';

import { NOTIFICATION_CHANNELS, NOTIFICATION_PRIORITIES } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { NotificationChannel, NotificationPreference, NotificationPriority } from '@/lib/api';
import {
  notificationPreferencesQuery,
  useDeleteNotificationPreference,
  useSetNotificationPreference,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: 'Push notifications',
  'webhook-slack': 'Slack webhook',
  'webhook-discord': 'Discord webhook',
  'webhook-generic': 'Generic webhook',
  'in-app': 'In-app',
};

const PRIORITY_LABELS: Record<NotificationPriority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

// Placeholder user id — in production this would come from auth context.
// The panel falls back to a stable sentinel so the API call has a real userId.
const CURRENT_USER_ID = 'local';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type PreferenceRowProps = {
  preference: NotificationPreference;
  userId: string;
};

function PreferenceRow({ preference, userId }: PreferenceRowProps): React.JSX.Element {
  const deletePreference = useDeleteNotificationPreference();

  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                preference.priority === 'critical' && 'bg-red-500/15 text-red-500',
                preference.priority === 'high' && 'bg-orange-500/15 text-orange-500',
                preference.priority === 'normal' && 'bg-blue-500/15 text-blue-500',
                preference.priority === 'low' && 'bg-muted text-muted-foreground',
              )}
            >
              {PRIORITY_LABELS[preference.priority]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {preference.channels.map((ch) => (
              <span
                key={ch}
                className="rounded-md border border-border/30 bg-muted/30 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground"
              >
                {CHANNEL_LABELS[ch]}
              </span>
            ))}
          </div>
          {(preference.quietHoursStart ?? preference.quietHoursEnd) && (
            <p className="text-[11px] text-muted-foreground">
              Quiet hours:{' '}
              <span className="font-mono">
                {preference.quietHoursStart ?? '--'} &ndash; {preference.quietHoursEnd ?? '--'}
              </span>
              {preference.timezone ? <span className="ml-1">({preference.timezone})</span> : null}
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 text-[11px] text-muted-foreground/60 transition-colors hover:text-destructive"
          onClick={() => deletePreference.mutate({ id: preference.id, userId })}
          disabled={deletePreference.isPending}
          aria-label="Remove preference"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-preference form
// ---------------------------------------------------------------------------

type FormState = {
  priority: NotificationPriority;
  channels: NotificationChannel[];
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
};

const DEFAULT_FORM: FormState = {
  priority: 'normal',
  channels: ['in-app'],
  quietHoursStart: '',
  quietHoursEnd: '',
  timezone: '',
};

type AddPreferenceFormProps = {
  userId: string;
  onSaved: () => void;
};

function AddPreferenceForm({ userId, onSaved }: AddPreferenceFormProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const setPreference = useSetNotificationPreference();

  function toggleChannel(ch: NotificationChannel): void {
    setForm((prev) => {
      const next = prev.channels.includes(ch)
        ? prev.channels.filter((c) => c !== ch)
        : [...prev.channels, ch];
      return { ...prev, channels: next };
    });
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);

    if (form.channels.length === 0) {
      setError('Select at least one notification channel.');
      return;
    }

    const body: Parameters<typeof setPreference.mutate>[0] = {
      userId,
      priority: form.priority,
      channels: form.channels,
    };
    if (form.quietHoursStart) body.quietHoursStart = form.quietHoursStart;
    if (form.quietHoursEnd) body.quietHoursEnd = form.quietHoursEnd;
    if (form.timezone) body.timezone = form.timezone;

    setPreference.mutate(body, {
      onSuccess: () => {
        setForm(DEFAULT_FORM);
        onSaved();
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to save preference.';
        setError(msg);
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
        New preference
      </div>

      {/* Priority */}
      <div className="space-y-1.5">
        <Label htmlFor="notif-priority" className="text-[13px] font-medium">
          Priority threshold
        </Label>
        <Select
          value={form.priority}
          onValueChange={(v) => setForm((p) => ({ ...p, priority: v as NotificationPriority }))}
        >
          <SelectTrigger id="notif-priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {NOTIFICATION_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Notify for events at this priority level or above.
        </p>
      </div>

      {/* Channels */}
      <div className="space-y-2">
        <div className="text-[13px] font-medium">Channels</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {NOTIFICATION_CHANNELS.map((ch) => {
            const isSelected = form.channels.includes(ch);
            return (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-[12px] transition-all',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/40 bg-muted/10 text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {CHANNEL_LABELS[ch]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quiet hours */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="notif-quiet-start" className="text-[13px] font-medium">
            Quiet hours start
          </Label>
          <Input
            id="notif-quiet-start"
            type="text"
            placeholder="22:00"
            pattern="^\d{1,2}:\d{2}$"
            value={form.quietHoursStart}
            onChange={(e) => setForm((p) => ({ ...p, quietHoursStart: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notif-quiet-end" className="text-[13px] font-medium">
            Quiet hours end
          </Label>
          <Input
            id="notif-quiet-end"
            type="text"
            placeholder="08:00"
            pattern="^\d{1,2}:\d{2}$"
            value={form.quietHoursEnd}
            onChange={(e) => setForm((p) => ({ ...p, quietHoursEnd: e.target.value }))}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        HH:MM format (24-hour). Leave blank to disable quiet hours.
      </p>

      {/* Timezone */}
      <div className="space-y-1.5">
        <Label htmlFor="notif-timezone" className="text-[13px] font-medium">
          Timezone <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="notif-timezone"
          type="text"
          placeholder="America/New_York"
          value={form.timezone}
          onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
        />
      </div>

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <Button type="submit" size="sm" disabled={setPreference.isPending}>
        {setPreference.isPending ? 'Saving\u2026' : 'Add preference'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Public panel
// ---------------------------------------------------------------------------

export function NotificationPreferencesPanel(): React.JSX.Element {
  const userId = CURRENT_USER_ID;
  const query = useQuery(notificationPreferencesQuery(userId));
  const [showForm, setShowForm] = useState(false);

  const preferences = query.data?.preferences ?? [];

  return (
    <div id="notification-preferences" className="scroll-mt-6">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border/30">
        <div>
          <h3 className="text-sm font-semibold">Notification preferences</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Configure per-priority channels and quiet hours for agent event notifications.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-[12px] font-medium text-primary transition-colors hover:underline"
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4">
          <AddPreferenceForm userId={userId} onSaved={() => setShowForm(false)} />
        </div>
      )}

      {query.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!query.isLoading && preferences.length === 0 && (
        <p className="py-4 text-center text-[13px] text-muted-foreground">
          No preferences configured. Add one to start receiving notifications.
        </p>
      )}

      {!query.isLoading && preferences.length > 0 && (
        <div className="space-y-2">
          {preferences.map((pref) => (
            <PreferenceRow key={pref.id} preference={pref} userId={userId} />
          ))}
        </div>
      )}
    </div>
  );
}
