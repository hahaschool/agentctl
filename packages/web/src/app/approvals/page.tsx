'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Clock, Filter, ShieldCheck } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import { PermissionRequestCard } from '@/components/PermissionRequestCard';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PermissionDecision, PermissionRequest } from '@/lib/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Extract the most readable summary from a tool request */
function summarizeRequest(r: PermissionRequest): string {
  // For Bash: show the command directly
  if (r.toolName === 'Bash' && r.toolInput) {
    const cmd = (r.toolInput as Record<string, unknown>).command;
    if (typeof cmd === 'string') return cmd.length > 120 ? `${cmd.slice(0, 120)}…` : cmd;
  }
  // For Read/Edit/Write/Glob: show the path
  if (['Read', 'Edit', 'Write', 'Glob'].includes(r.toolName) && r.toolInput) {
    const input = r.toolInput as Record<string, unknown>;
    const path = input.file_path ?? input.path ?? input.pattern;
    if (typeof path === 'string') return path;
  }
  // For Grep: show pattern
  if (r.toolName === 'Grep' && r.toolInput) {
    const pattern = (r.toolInput as Record<string, unknown>).pattern;
    if (typeof pattern === 'string') return `/${pattern}/`;
  }
  // For AskUserQuestion: show the question
  if (r.toolName === 'AskUserQuestion' && r.toolInput) {
    const q = (r.toolInput as Record<string, unknown>).question;
    if (typeof q === 'string') return q.length > 100 ? `${q.slice(0, 100)}…` : q;
    // May have questions array
    const qs = (r.toolInput as Record<string, unknown>).questions;
    if (typeof qs === 'string') return qs.slice(0, 100);
    if (Array.isArray(qs)) return JSON.stringify(qs).slice(0, 100);
  }
  // Description fallback
  if (r.description) return r.description.slice(0, 120);
  // Raw JSON fallback
  if (r.toolInput) return JSON.stringify(r.toolInput).slice(0, 100);
  return '';
}

function toolIcon(toolName: string): string {
  const map: Record<string, string> = {
    Bash: '⚡',
    Read: '📄',
    Edit: '✏️',
    Write: '📝',
    Grep: '🔍',
    Glob: '📁',
    Agent: '🤖',
    WebSearch: '🌐',
    AskUserQuestion: '💬',
  };
  return map[toolName] ?? '🔧';
}

type SessionGroup = {
  sessionId: string;
  agentId: string;
  requests: PermissionRequest[];
  toolSummary: Map<string, number>;
  latestAt: string;
  autoCount: number;
  firstDescription: string;
};

function groupBySession(requests: PermissionRequest[]): SessionGroup[] {
  const groups = new Map<string, PermissionRequest[]>();
  for (const r of requests) {
    const arr = groups.get(r.sessionId);
    if (arr) arr.push(r);
    else groups.set(r.sessionId, [r]);
  }

  return Array.from(groups.entries())
    .map(([sessionId, reqs]) => {
      const sorted = [...reqs].sort(
        (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
      );
      const toolSummary = new Map<string, number>();
      let autoCount = 0;
      for (const r of sorted) {
        toolSummary.set(r.toolName, (toolSummary.get(r.toolName) ?? 0) + 1);
        if (r.resolvedBy?.startsWith('auto:')) autoCount++;
      }
      // Find first meaningful description
      const firstDesc =
        sorted.find((r) => r.description)?.description ??
        summarizeRequest(sorted[0] ?? ({} as PermissionRequest));
      return {
        sessionId,
        agentId: sorted[0]?.agentId ?? '',
        requests: sorted,
        toolSummary,
        latestAt: sorted[0]?.requestedAt ?? '',
        autoCount,
        firstDescription: firstDesc,
      };
    })
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ApprovalsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [toolFilter, setToolFilter] = useState<string>('all');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const allQuery = useQuery({
    queryKey: ['permission-requests'],
    queryFn: () => api.getPermissionRequests(),
    refetchInterval: 5_000,
  });

  const requests: PermissionRequest[] = (allQuery.data as PermissionRequest[] | undefined) ?? [];
  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  const toolNames = useMemo(() => {
    const names = new Set(requests.map((r) => r.toolName));
    return Array.from(names).sort();
  }, [requests]);

  const filteredResolved = useMemo(
    () => (toolFilter === 'all' ? resolved : resolved.filter((r) => r.toolName === toolFilter)),
    [resolved, toolFilter],
  );

  const sessionGroups = useMemo(() => groupBySession(filteredResolved), [filteredResolved]);

  const handleResolve = async (
    id: string,
    decision: PermissionDecision,
    options?: { allowForSession?: boolean },
  ): Promise<void> => {
    await api.resolvePermissionRequest(id, decision, options);
    queryClient.invalidateQueries({ queryKey: ['permission-requests'] });
  };

  const toggleSession = (sessionId: string): void => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold">Permission Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length > 0
              ? `${pending.length} pending · ${resolved.length} resolved`
              : `${resolved.length} total, all resolved`}
          </p>
        </div>
      </div>

      {/* Pending */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-yellow-500">
              Pending
            </h2>
            <Badge className="bg-yellow-500/15 text-yellow-500 border-yellow-500/30">
              {pending.length}
            </Badge>
          </div>
          <div className="space-y-3">
            {pending.map((request) => (
              <PermissionRequestCard
                key={request.id}
                permissionRequest={request}
                onResolve={handleResolve}
              />
            ))}
          </div>
        </section>
      )}

      {/* History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            History ({filteredResolved.length})
          </h2>
          {toolNames.length > 1 && (
            <div className="flex items-center gap-1">
              <Filter className="size-3 text-muted-foreground" />
              <select
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                className="text-xs bg-transparent border border-border/50 rounded px-2 py-1 text-foreground"
              >
                <option value="all">All tools</option>
                {toolNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {allQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : sessionGroups.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
            No resolved permission requests.
          </div>
        ) : (
          <div className="space-y-2">
            {sessionGroups.map((group) => {
              const isExpanded = expandedSessions.has(group.sessionId);
              return (
                <div
                  key={group.sessionId}
                  className="rounded-lg border border-border/40 overflow-hidden"
                >
                  {/* Session header */}
                  <button
                    type="button"
                    onClick={() => toggleSession(group.sessionId)}
                    className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      {/* Session ID + agent */}
                      <div className="flex items-center gap-2 mb-1">
                        {isExpanded ? (
                          <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-[11px] font-mono text-blue-500">
                          Session {group.sessionId.slice(0, 12)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          · Agent {group.agentId.slice(0, 8)}
                        </span>
                      </div>
                      {/* Tool badges */}
                      <div className="flex items-center gap-1.5 flex-wrap ml-5">
                        {Array.from(group.toolSummary.entries()).map(([tool, count]) => (
                          <Badge
                            key={tool}
                            variant="outline"
                            className="text-[10px] gap-1 shrink-0"
                          >
                            {toolIcon(tool)} {tool}
                            {count > 1 && <span className="text-muted-foreground">×{count}</span>}
                          </Badge>
                        ))}
                      </div>
                      {/* First description preview */}
                      {group.firstDescription && (
                        <p className="mt-1 ml-5 text-[11px] text-muted-foreground truncate max-w-[500px]">
                          {group.firstDescription}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      {group.autoCount > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-blue-500 border-blue-500/30"
                        >
                          {group.autoCount} auto
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[10px] text-emerald-500 border-emerald-500/30"
                      >
                        {group.requests.length}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="size-3" />
                        {timeAgo(group.latestAt)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-border/30 bg-muted/5 divide-y divide-border/20 max-h-96 overflow-auto">
                      {group.requests.map((r) => (
                        <div key={r.id} className="px-4 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm">{toolIcon(r.toolName)}</span>
                            <span className="text-xs font-mono font-medium">{r.toolName}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[9px]',
                                r.status === 'approved'
                                  ? 'text-emerald-500 border-emerald-500/30'
                                  : r.status === 'denied'
                                    ? 'text-red-500 border-red-500/30'
                                    : 'text-yellow-500 border-yellow-500/30',
                              )}
                            >
                              {r.resolvedBy?.startsWith('auto:') ? 'auto-approved' : r.status}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {timeAgo(r.requestedAt)}
                            </span>
                          </div>
                          {/* Show the extracted command/path, not raw JSON */}
                          <p className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed pl-6">
                            {summarizeRequest(r)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
