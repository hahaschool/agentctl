'use client';

import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { PermissionDecision, PermissionRequest, PermissionRequestStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

type PermissionRequestCardProps = {
  permissionRequest: PermissionRequest;
  onResolve: (
    id: string,
    decision: PermissionDecision,
    options?: { allowForSession?: boolean },
  ) => Promise<void> | void;
  className?: string;
};

function formatToolInput(toolName: string, toolInput: PermissionRequest['toolInput']): string {
  if (toolInput == null) return '// no tool input provided';
  try {
    const input = toolInput as Record<string, unknown>;
    // For Bash: show command directly with real newlines
    if (toolName === 'Bash' && typeof input.command === 'string') {
      const parts: string[] = [`$ ${input.command}`];
      if (input.description) parts.push(`# ${String(input.description)}`);
      if (input.timeout) parts.push(`# timeout: ${String(input.timeout)}ms`);
      return parts.join('\n');
    }
    // For Read/Edit/Write: show path prominently
    if (['Read', 'Edit', 'Write', 'Glob'].includes(toolName)) {
      const path = input.file_path ?? input.path ?? input.pattern;
      if (typeof path === 'string') {
        const parts = [path];
        if (input.old_string) parts.push(`- ${String(input.old_string).slice(0, 200)}`);
        if (input.new_string) parts.push(`+ ${String(input.new_string).slice(0, 200)}`);
        if (input.content) parts.push(String(input.content).slice(0, 300));
        return parts.join('\n');
      }
    }
    // For Grep: show pattern + path
    if (toolName === 'Grep' && typeof input.pattern === 'string') {
      return `/${input.pattern}/${input.path ? ` in ${String(input.path)}` : ''}`;
    }
    // For AskUserQuestion: show question text and options
    if (toolName === 'AskUserQuestion') {
      if (typeof input.question === 'string') return input.question;
      if (Array.isArray(input.questions)) {
        return (input.questions as Array<Record<string, unknown>>)
          .map((q) => {
            const header = q.header ?? q.question ?? '';
            const opts = Array.isArray(q.options)
              ? (q.options as Array<Record<string, unknown>>)
                  .map(
                    (o) =>
                      `  • ${String(o.label ?? o.value ?? '')}${o.description ? ` — ${String(o.description)}` : ''}`,
                  )
                  .join('\n')
              : '';
            return opts ? `${String(header)}\n${opts}` : String(header);
          })
          .join('\n\n');
      }
    }
    // Fallback: pretty-print JSON
    const value = JSON.stringify(input, null, 2);
    if (value.length <= 1_200) return value;
    return `${value.slice(0, 1_200)}\n...`;
  } catch {
    return String(toolInput);
  }
}

function formatCountdown(secondsRemaining: number): string {
  const safeSeconds = Math.max(0, secondsRemaining);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')} left`;
}

function countdownClassName(secondsRemaining: number): string {
  if (secondsRemaining > 120) {
    return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200';
  }
  if (secondsRemaining > 30) {
    return 'border-yellow-400/40 bg-yellow-500/15 text-yellow-700 dark:text-yellow-100';
  }
  return 'border-red-400/40 bg-red-500/15 text-red-700 dark:text-red-100';
}

function statusLabel(status: PermissionRequestStatus): string {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired (auto-denied)';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

function statusClassName(status: PermissionRequestStatus): string {
  switch (status) {
    case 'approved':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'denied':
      return 'text-red-700 dark:text-red-300';
    case 'expired':
      return 'text-yellow-700 dark:text-yellow-200';
    case 'cancelled':
      return 'text-muted-foreground';
    default:
      return 'text-foreground';
  }
}

export function PermissionRequestCard({
  permissionRequest,
  onResolve,
  className,
}: PermissionRequestCardProps): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [submittingDecision, setSubmittingDecision] = useState<PermissionDecision | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<PermissionRequestStatus | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if ((optimisticStatus ?? permissionRequest.status) !== 'pending') return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [permissionRequest.status, optimisticStatus]);

  const timeoutMs = useMemo(
    () => new Date(permissionRequest.timeoutAt).getTime(),
    [permissionRequest.timeoutAt],
  );
  const secondsRemaining = Math.max(0, Math.ceil((timeoutMs - nowMs) / 1_000));
  const effectiveStatus = optimisticStatus ?? permissionRequest.status;
  const isResolved = effectiveStatus !== 'pending';

  const toolInputPreview = useMemo(
    () => formatToolInput(permissionRequest.toolName, permissionRequest.toolInput),
    [permissionRequest.toolName, permissionRequest.toolInput],
  );

  const handleResolve = async (
    decision: PermissionDecision,
    allowForSession?: boolean,
  ): Promise<void> => {
    if (isResolved) return;
    setResolveError(null);
    setSubmittingDecision(decision);
    try {
      await onResolve(permissionRequest.id, decision, { allowForSession });
      setOptimisticStatus(decision);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : 'Failed to resolve request');
    } finally {
      setSubmittingDecision(null);
    }
  };

  return (
    <Card
      className={cn(
        'gap-3 border-yellow-500/30 bg-yellow-500/5 py-4 shadow-none',
        'dark:border-yellow-400/30 dark:bg-yellow-400/5',
        className,
      )}
    >
      <CardHeader className="px-4 pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm text-yellow-900 dark:text-yellow-100">
            <ShieldAlert className="size-4 text-yellow-700 dark:text-yellow-300" />
            Permission Required
          </CardTitle>
          <Badge
            variant="outline"
            className={cn('font-mono text-[11px]', countdownClassName(secondsRemaining))}
          >
            {formatCountdown(secondsRemaining)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 px-4">
        <div className="text-xs text-muted-foreground">
          Tool: <span className="font-semibold text-foreground">{permissionRequest.toolName}</span>
        </div>
        <pre className="max-h-44 overflow-auto rounded-md border border-border bg-muted p-2 text-xs leading-relaxed text-foreground">
          {toolInputPreview}
        </pre>
      </CardContent>

      <CardFooter className="px-4 pt-0">
        {isResolved ? (
          <p className={cn('text-xs font-medium', statusClassName(effectiveStatus))}>
            {statusLabel(effectiveStatus)}
          </p>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              disabled={Boolean(submittingDecision)}
              onClick={() => void handleResolve('approved')}
            >
              {submittingDecision === 'approved' ? 'Approving…' : 'Allow once'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
              disabled={Boolean(submittingDecision)}
              onClick={() => void handleResolve('approved', true)}
            >
              Allow for session
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={Boolean(submittingDecision)}
              onClick={() => void handleResolve('denied')}
            >
              {submittingDecision === 'denied' ? 'Denying…' : 'Deny'}
            </Button>
            {resolveError && <span className="text-xs text-destructive">{resolveError}</span>}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
