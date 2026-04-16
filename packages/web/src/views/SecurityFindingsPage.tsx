'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Github, ShieldAlert, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { SecurityFinding, SecurityFindingSeverity } from '@/lib/api';
import {
  securityFindingsQuery,
  securityFindingsSummaryQuery,
  useAcknowledgeSecurityFinding,
  useCreateGithubIssuesFromFindings,
  useDeleteSecurityFinding,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

const FINDINGS_LIMIT = 200;

const SEVERITY_ORDER: readonly SecurityFindingSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;

const SEVERITY_BADGE_CLASSES: Record<SecurityFindingSeverity, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  info: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
};

type SeverityFilter = 'all' | SecurityFindingSeverity;

function formatLocation(finding: SecurityFinding): string {
  if (!finding.file) return '\u2014';
  return finding.line ? `${finding.file}:${String(finding.line)}` : finding.file;
}

function formatRelative(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return 'unknown';
  if (deltaMs < 0) return 'just now';
  const s = Math.floor(deltaMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// FindingRow — individual row with per-row action buttons
// ---------------------------------------------------------------------------

type FindingRowProps = {
  readonly finding: SecurityFinding;
  readonly onAcknowledge: (id: string) => void;
  readonly onDismiss: (id: string) => void;
  readonly isAcknowledging: boolean;
};

export function SecurityFindingRow({
  finding,
  onAcknowledge,
  onDismiss,
  isAcknowledging,
}: FindingRowProps): React.JSX.Element {
  const isOpen = !finding.acknowledged && !finding.issueCreated;

  return (
    <tr
      className={cn(
        'border-t border-border hover:bg-accent/5 align-top',
        finding.acknowledged && 'opacity-60',
      )}
    >
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span
          className={cn(
            'px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase border',
            SEVERITY_BADGE_CLASSES[finding.severity],
          )}
        >
          {finding.severity}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap font-mono">
        {finding.category}
      </td>
      <td className="px-3 py-2.5 text-xs text-foreground max-w-[360px]">
        <div className="truncate" title={finding.title}>
          {finding.title}
        </div>
        <div
          className="text-[10px] text-muted-foreground truncate mt-0.5"
          title={finding.description}
        >
          {finding.description}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[11px] font-mono text-muted-foreground max-w-[260px]">
        <div className="truncate" title={formatLocation(finding)}>
          {formatLocation(finding)}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {finding.acknowledged ? (
          <span className="px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
            Acked
          </span>
        ) : finding.issueCreated ? (
          <span className="px-1.5 py-0.5 rounded-sm bg-blue-500/15 text-blue-400 text-[10px] font-semibold uppercase tracking-wide">
            Issue
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-sm bg-red-500/10 text-red-400 text-[10px] font-semibold uppercase tracking-wide">
            Open
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
        {formatRelative(finding.createdAt)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {isOpen && (
            <button
              type="button"
              data-testid={`ack-btn-${finding.id}`}
              title="Acknowledge finding"
              disabled={isAcknowledging}
              onClick={() => onAcknowledge(finding.id)}
              className="p-1 rounded-sm text-muted-foreground hover:text-green-400 hover:bg-green-500/10 disabled:opacity-40 transition-colors"
            >
              <Check size={14} />
            </button>
          )}
          <button
            type="button"
            data-testid={`dismiss-btn-${finding.id}`}
            title="Dismiss finding"
            onClick={() => onDismiss(finding.id)}
            className="p-1 rounded-sm text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// GitHub Issues Dialog — collects owner/repo before creating issues
// ---------------------------------------------------------------------------

type GithubIssuesDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (owner: string, repo: string) => Promise<void>;
  readonly isPending: boolean;
};

function GithubIssuesDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: GithubIssuesDialogProps): React.JSX.Element | null {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');

  if (!open) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setOwner('');
          setRepo('');
        }
        onOpenChange(next);
      }}
      title="Create GitHub Issues"
      description="Create GitHub issues for all unacknowledged critical/high severity findings. Requires GITHUB_TOKEN on the server."
      confirmLabel={isPending ? 'Creating...' : 'Create Issues'}
      onConfirm={async () => {
        await onSubmit(owner.trim(), repo.trim());
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SecurityFindingsPage(): React.JSX.Element {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);

  const toast = useToast();
  const acknowledgeMutation = useAcknowledgeSecurityFinding();
  const deleteMutation = useDeleteSecurityFinding();
  const githubIssuesMutation = useCreateGithubIssuesFromFindings();

  const listParams = useMemo(
    () => ({
      limit: FINDINGS_LIMIT,
      ...(severityFilter !== 'all' ? { severity: severityFilter } : {}),
    }),
    [severityFilter],
  );

  const findingsQ = useQuery(securityFindingsQuery(listParams));
  const summaryQ = useQuery(securityFindingsSummaryQuery());

  const findings = findingsQ.data?.findings ?? [];
  const total = findingsQ.data?.total ?? 0;
  const summary = summaryQ.data;

  const severityCounts: Record<SecurityFindingSeverity, number> = {
    critical: summary?.critical ?? 0,
    high: summary?.high ?? 0,
    medium: summary?.medium ?? 0,
    low: summary?.low ?? 0,
    info: summary?.info ?? 0,
  };

  const hasCriticalOrHigh = severityCounts.critical > 0 || severityCounts.high > 0;

  const handleAcknowledge = useCallback(
    (id: string) => {
      acknowledgeMutation.mutate(
        { id, acknowledgedBy: 'operator' },
        {
          onSuccess: () => toast.success('Finding acknowledged'),
          onError: (err) => toast.error(`Failed to acknowledge: ${err.message}`),
        },
      );
    },
    [acknowledgeMutation, toast],
  );

  const handleDismissConfirm = useCallback(async () => {
    if (!dismissTarget) return;
    await new Promise<void>((resolve, reject) => {
      deleteMutation.mutate(dismissTarget, {
        onSuccess: () => {
          toast.success('Finding dismissed');
          setDismissTarget(null);
          resolve();
        },
        onError: (err) => {
          reject(err);
        },
      });
    });
  }, [dismissTarget, deleteMutation, toast]);

  const handleGithubSubmit = useCallback(
    async (owner: string, repo: string) => {
      if (!owner || !repo) {
        toast.error('Owner and repo are required');
        return;
      }
      await new Promise<void>((resolve, reject) => {
        githubIssuesMutation.mutate(
          { owner, repo },
          {
            onSuccess: (data) => {
              toast.success(`Created ${String(data.issuesCreated)} GitHub issue(s)`);
              setGithubDialogOpen(false);
              resolve();
            },
            onError: (err) => {
              reject(err);
            },
          },
        );
      });
    },
    [githubIssuesMutation, toast],
  );

  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] animate-page-enter">
      <FetchingBar isFetching={findingsQ.isFetching && !findingsQ.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <ShieldAlert size={22} className="text-primary" aria-hidden="true" />
          <h1 className="text-[22px] font-semibold tracking-tight">Security Findings</h1>
          {summary !== undefined && (
            <span
              className="px-2 py-0.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
              data-testid="total-badge"
            >
              {summary.total} total
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasCriticalOrHigh && (
            <button
              type="button"
              data-testid="create-github-issues-btn"
              onClick={() => setGithubDialogOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted border border-border text-foreground hover:bg-accent/20 transition-colors"
            >
              <Github size={14} />
              Create Issues
            </button>
          )}
          <RefreshButton
            onClick={() => {
              void findingsQ.refetch();
              void summaryQ.refetch();
            }}
            isFetching={findingsQ.isFetching && !findingsQ.isLoading}
          />
        </div>
      </div>

      {summary !== undefined && (
        <div className="flex items-center gap-2 flex-wrap mb-4" data-testid="summary-badges">
          {SEVERITY_ORDER.map((severity) => {
            const count = severityCounts[severity];
            if (count === 0) return null;
            return (
              <span
                key={severity}
                className={cn(
                  'px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase border',
                  SEVERITY_BADGE_CLASSES[severity],
                )}
                data-testid={`summary-${severity}`}
              >
                {count} {severity}
              </span>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-4 max-w-[720px]">
        Security findings ingested from agent scans. Each finding includes a severity, category,
        file location and recommendation. Use the filter to scope the list by severity.
      </p>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-3">
        <label
          htmlFor="severity-filter"
          className="text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Severity
        </label>
        <select
          id="severity-filter"
          data-testid="severity-filter"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
          className="bg-muted border border-border rounded-md text-xs px-2 py-1 text-foreground"
        >
          <option value="all">All</option>
          {SEVERITY_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Showing {findings.length} of {total}
        </span>
      </div>

      {findingsQ.error && (
        <ErrorBanner
          message={`Failed to load findings: ${findingsQ.error.message}`}
          onRetry={() => void findingsQ.refetch()}
          className="mb-4"
        />
      )}

      {findingsQ.isLoading && (
        <div className="space-y-2" data-testid="loading-skeletons">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="h-12 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      )}

      {!findingsQ.isLoading && !findingsQ.error && findings.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p>No security findings.</p>
          <p className="mt-1 text-xs">
            Findings are ingested via <span className="font-mono">POST /api/security/findings</span>{' '}
            from agent scans.
          </p>
        </div>
      )}

      {findings.length > 0 && (
        <div className="border border-border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Security findings">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Title / Description</th>
                  <th className="px-3 py-2 font-medium">File:Line</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <SecurityFindingRow
                    key={finding.id}
                    finding={finding}
                    onAcknowledge={handleAcknowledge}
                    onDismiss={setDismissTarget}
                    isAcknowledging={acknowledgeMutation.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dismiss confirmation dialog */}
      <ConfirmDialog
        open={dismissTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDismissTarget(null);
        }}
        title="Dismiss security finding?"
        description="This will permanently delete the finding. This action cannot be undone."
        confirmLabel="Dismiss"
        destructive
        onConfirm={handleDismissConfirm}
      />

      {/* GitHub issues dialog */}
      <GithubIssuesDialog
        open={githubDialogOpen}
        onOpenChange={setGithubDialogOpen}
        onSubmit={handleGithubSubmit}
        isPending={githubIssuesMutation.isPending}
      />
    </div>
  );
}
