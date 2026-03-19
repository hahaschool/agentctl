'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import type React from 'react';

import { PermissionRequestCard } from '@/components/PermissionRequestCard';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { PermissionDecision, PermissionRequest } from '@/lib/api';
import { api } from '@/lib/api';

export default function ApprovalsPage(): React.JSX.Element {
  const queryClient = useQueryClient();

  const allQuery = useQuery({
    queryKey: ['permission-requests'],
    queryFn: () => api.getPermissionRequests(),
    refetchInterval: 5_000,
  });

  const requests: PermissionRequest[] = (allQuery.data as PermissionRequest[] | undefined) ?? [];
  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  const handleResolve = async (
    id: string,
    decision: PermissionDecision,
    options?: { allowForSession?: boolean },
  ): Promise<void> => {
    await api.resolvePermissionRequest(id, decision, options);
    queryClient.invalidateQueries({ queryKey: ['permission-requests'] });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold">Permission Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Review and action agent tool permission requests.
          </p>
        </div>
      </div>

      {/* Pending */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pending
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {pending.length}
          </Badge>
        </div>

        {allQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            No pending permission requests.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((request) => (
              <PermissionRequestCard
                key={request.id}
                permissionRequest={request}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </section>

      {/* Resolved */}
      {resolved.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Resolved ({resolved.length})
          </h2>
          <div className="space-y-2">
            {resolved.slice(0, 50).map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between rounded-md border border-border/40 bg-muted/10 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {request.toolName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Agent {request.agentId.slice(0, 8)}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    request.status === 'approved'
                      ? 'text-emerald-500 border-emerald-500/30'
                      : request.status === 'denied'
                        ? 'text-red-500 border-red-500/30'
                        : 'text-yellow-500 border-yellow-500/30'
                  }
                >
                  {request.status}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
