'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApprovalDecision, ApprovalGate } from '@/lib/api';
import { api } from '@/lib/api';
import { formatDurationMs, timeAgo } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  pending: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500',
  approved: 'border-green-500/30 bg-green-500/10 text-green-500',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-500',
  'timed-out': 'border-muted bg-muted/40 text-muted-foreground',
};

const DECISION_STYLES: Record<string, string> = {
  approved: 'text-green-500',
  rejected: 'text-red-500',
  'changes-requested': 'text-yellow-500',
};

function GateStatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn('capitalize text-[11px] font-medium', STATUS_STYLES[status])}
    >
      {status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Gate detail panel (fetched on expand)
// ---------------------------------------------------------------------------

type GateDetailProps = {
  gateId: string;
  onDecision: (gateId: string, action: 'approved' | 'rejected') => void;
  isSubmitting: boolean;
};

function GateDetail({ gateId, onDecision, isSubmitting }: GateDetailProps): React.JSX.Element {
  const detail = useQuery({
    queryKey: ['approval-gate', gateId],
    queryFn: () => api.getApprovalGate(gateId),
  });

  if (detail.isLoading) {
    return (
      <div className="px-4 pb-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return <div className="px-4 pb-4 text-sm text-destructive">Failed to load gate details.</div>;
  }

  const gate = detail.data;
  const isPending = gate.status === 'pending';

  return (
    <div className="px-4 pb-4 space-y-4 border-t border-border/50 pt-3">
      {/* Gate metadata */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        <div>
          <span className="text-muted-foreground">Task Definition</span>
          <p className="font-mono text-foreground mt-0.5 break-all">{gate.taskDefinitionId}</p>
        </div>
        {gate.taskRunId && (
          <div>
            <span className="text-muted-foreground">Task Run</span>
            <p className="font-mono text-foreground mt-0.5 break-all">{gate.taskRunId}</p>
          </div>
        )}
        {gate.threadId && (
          <div>
            <span className="text-muted-foreground">Thread</span>
            <p className="font-mono text-foreground mt-0.5 break-all">{gate.threadId}</p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Required approvals</span>
          <p className="text-foreground mt-0.5">
            {gate.decisions.filter((d) => d.action === 'approved').length} / {gate.requiredCount}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Timeout policy</span>
          <p className="capitalize text-foreground mt-0.5">{gate.timeoutPolicy}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Timeout</span>
          <p className="text-foreground mt-0.5">{formatDurationMs(gate.timeoutMs)}</p>
        </div>
        {gate.requiredApprovers.length > 0 && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Required approvers</span>
            <p className="text-foreground mt-0.5">{gate.requiredApprovers.join(', ')}</p>
          </div>
        )}
        {gate.contextArtifactIds.length > 0 && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Context artifacts</span>
            <p className="font-mono text-foreground mt-0.5 break-all">
              {gate.contextArtifactIds.join(', ')}
            </p>
          </div>
        )}
      </div>

      {/* Decisions list */}
      {gate.decisions.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Decisions
          </p>
          <div className="space-y-1.5">
            {gate.decisions.map((decision) => (
              <DecisionRow key={decision.id} decision={decision} />
            ))}
          </div>
        </div>
      )}

      {/* Action buttons (pending only) */}
      {isPending && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onDecision(gate.id, 'approved')}
            className="border-green-500/40 text-green-500 hover:bg-green-500/10 hover:text-green-400"
          >
            <CheckCircle size={14} className="mr-1.5" aria-hidden="true" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onDecision(gate.id, 'rejected')}
            className="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-400"
          >
            <XCircle size={14} className="mr-1.5" aria-hidden="true" />
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}

function DecisionRow({ decision }: { decision: ApprovalDecision }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 text-[12px] bg-muted/20 rounded px-3 py-2">
      <span className={cn('font-medium capitalize shrink-0', DECISION_STYLES[decision.action])}>
        {decision.action}
      </span>
      <span className="text-muted-foreground">by</span>
      <span className="font-mono text-foreground">{decision.decidedBy}</span>
      {decision.comment && (
        <span className="text-muted-foreground italic truncate">
          &ldquo;{decision.comment}&rdquo;
        </span>
      )}
      {decision.viaTimeout && (
        <Badge
          variant="outline"
          className="text-[10px] border-muted text-muted-foreground ml-auto shrink-0"
        >
          timeout
        </Badge>
      )}
      <span className="text-muted-foreground ml-auto shrink-0">{timeAgo(decision.decidedAt)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gate row (expandable)
// ---------------------------------------------------------------------------

type GateRowProps = {
  gate: ApprovalGate;
  onDecision: (gateId: string, action: 'approved' | 'rejected') => void;
  isSubmitting: boolean;
};

function GateRow({ gate, onDecision, isSubmitting }: GateRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/60 rounded-lg bg-card overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/5 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="text-muted-foreground shrink-0">
          {expanded ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
        </span>

        {/* Task definition name */}
        <span className="flex-1 min-w-0">
          <span className="font-medium text-[13px] text-foreground truncate block">
            {gate.taskDefinitionId}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">{gate.id}</span>
        </span>

        <GateStatusBadge status={gate.status} />

        <span className="text-[11px] text-muted-foreground whitespace-nowrap hidden sm:inline">
          {timeAgo(gate.createdAt)}
        </span>

        {gate.timeoutPolicy && (
          <Badge
            variant="outline"
            className="text-[10px] border-muted text-muted-foreground hidden md:inline-flex"
          >
            {gate.timeoutPolicy}
          </Badge>
        )}
      </button>

      {expanded && (
        <GateDetail gateId={gate.id} onDecision={onDecision} isSubmitting={isSubmitting} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolved section (collapsed by default)
// ---------------------------------------------------------------------------

type ResolvedSectionProps = {
  gates: ApprovalGate[];
  onDecision: (gateId: string, action: 'approved' | 'rejected') => void;
  isSubmitting: boolean;
};

function ResolvedSection({
  gates,
  onDecision,
  isSubmitting,
}: ResolvedSectionProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);

  if (gates.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        type="button"
        className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors mb-3"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span>Resolved ({gates.length})</span>
      </button>

      {open && (
        <div className="space-y-2">
          {gates.map((gate) => (
            <GateRow
              key={gate.id}
              gate={gate}
              onDecision={onDecision}
              isSubmitting={isSubmitting}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ApprovalsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [threadId, setThreadId] = useState('');
  const [activeThreadId, setActiveThreadId] = useState('');

  const gates = useQuery({
    queryKey: ['approvals', activeThreadId],
    queryFn: () => api.listApprovals(activeThreadId),
    enabled: activeThreadId.trim().length > 0,
  });

  const decisionMutation = useMutation({
    mutationFn: ({ gateId, action }: { gateId: string; action: 'approved' | 'rejected' }) =>
      api.addApprovalDecision(gateId, {
        decidedBy: 'operator',
        action,
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['approvals', activeThreadId] });
      void queryClient.invalidateQueries({ queryKey: ['approval-gate', variables.gateId] });
    },
  });

  const handleDecision = (gateId: string, action: 'approved' | 'rejected'): void => {
    decisionMutation.mutate({ gateId, action });
  };

  const handleSearch = (): void => {
    if (threadId.trim()) {
      setActiveThreadId(threadId.trim());
    }
  };

  const allGates = gates.data ?? [];
  const pendingGates = allGates.filter((g) => g.status === 'pending');
  const resolvedGates = allGates.filter((g) => g.status !== 'pending');

  return (
    <div className="relative p-4 md:p-6 max-w-[900px] animate-page-enter">
      <FetchingBar isFetching={gates.isFetching && !gates.isLoading} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={20} className="text-primary shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Approvals</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Review and action approval gates for task workflows.
            </p>
          </div>
        </div>
        {activeThreadId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void gates.refetch()}
            disabled={gates.isFetching}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              size={13}
              className={cn('mr-1.5', gates.isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            Refresh
          </Button>
        )}
      </div>

      {/* Thread ID lookup */}
      <Card className="p-4 mb-6 bg-muted/20">
        <p className="text-[12px] text-muted-foreground mb-3">
          Approval gates are scoped to a collaboration thread. Enter a thread ID to load its gates.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="Thread ID (e.g. thread-abc123)"
            className="font-mono text-[13px] flex-1"
            aria-label="Thread ID"
          />
          <Button size="sm" onClick={handleSearch} disabled={!threadId.trim() || gates.isFetching}>
            Load
          </Button>
        </div>
        {activeThreadId && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Showing gates for thread:{' '}
            <span className="font-mono text-foreground">{activeThreadId}</span>
          </p>
        )}
      </Card>

      {/* Error state */}
      {gates.error && (
        <ErrorBanner
          message={`Failed to load approvals: ${gates.error.message}`}
          onRetry={() => void gates.refetch()}
        />
      )}

      {/* Loading skeletons */}
      {gates.isLoading && (
        <div className="space-y-2">
          {['sk-1', 'sk-2', 'sk-3'].map((key) => (
            <Skeleton key={key} className="h-14 rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty state — not yet searched */}
      {!activeThreadId && !gates.isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <ShieldCheck size={32} className="mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>Enter a thread ID above to load approval gates.</p>
        </div>
      )}

      {/* Empty state — searched but no results */}
      {activeThreadId && !gates.isLoading && !gates.error && allGates.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <ShieldCheck size={32} className="mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p>No approval gates found for this thread.</p>
        </div>
      )}

      {/* Pending gates */}
      {pendingGates.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-yellow-500" aria-hidden="true" />
            <h2 className="text-[13px] font-semibold text-foreground">
              Pending ({pendingGates.length})
            </h2>
          </div>
          <div className="space-y-2">
            {pendingGates.map((gate) => (
              <GateRow
                key={gate.id}
                gate={gate}
                onDecision={handleDecision}
                isSubmitting={decisionMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolved gates (collapsed) */}
      {resolvedGates.length > 0 && (
        <ResolvedSection
          gates={resolvedGates}
          onDecision={handleDecision}
          isSubmitting={decisionMutation.isPending}
        />
      )}

      {/* Pending but no pending and has resolved only */}
      {activeThreadId &&
        !gates.isLoading &&
        !gates.error &&
        allGates.length > 0 &&
        pendingGates.length === 0 && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground mb-4">
            <CheckCircle size={14} className="text-green-500" aria-hidden="true" />
            <span>All gates resolved. No pending approvals.</span>
          </div>
        )}
    </div>
  );
}
