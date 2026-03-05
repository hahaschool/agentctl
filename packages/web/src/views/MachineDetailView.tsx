'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useMemo } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { CopyableText } from '@/components/CopyableText';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LastUpdated } from '@/components/LastUpdated';
import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { PathBadge } from '@/components/PathBadge';
import { RefreshButton } from '@/components/RefreshButton';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { formatDate } from '@/lib/format-utils';
import { agentsQuery, machinesQuery, sessionsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MachineDetailView(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const machineId = params.id;

  const machines = useQuery(machinesQuery());
  const agents = useQuery(agentsQuery());
  const sessions = useQuery(sessionsQuery({ machineId }));

  useHotkeys(
    useMemo(
      () => ({
        r: () => {
          void machines.refetch();
          void agents.refetch();
          void sessions.refetch();
        },
      }),
      [machines, agents, sessions],
    ),
  );

  const machine = useMemo(
    () => machines.data?.find((m) => m.id === machineId) ?? null,
    [machines.data, machineId],
  );

  const machineAgents = useMemo(
    () => (agents.data ?? []).filter((a) => a.machineId === machineId),
    [agents.data, machineId],
  );

  const recentSessions = useMemo(() => {
    const list = sessions.data?.sessions ?? [];
    return [...list].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }, [sessions.data]);

  // -- Loading state --

  if (machines.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1000px]">
        <Skeleton className="h-4 w-32 mb-4" />
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-48 mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6'].map((key) => (
            <Skeleton key={key} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  // -- Error state --

  if (machines.error) {
    return (
      <div className="p-4 md:p-6 max-w-[1000px]">
        <Breadcrumb items={[{ label: 'Machines', href: '/machines' }, { label: 'Error' }]} />
        <ErrorBanner
          message={`Failed to load machines: ${machines.error.message}`}
          onRetry={() => void machines.refetch()}
          className="mt-6"
        />
      </div>
    );
  }

  // -- Not found state --

  if (!machine) {
    return (
      <div className="p-4 md:p-6 max-w-[1000px]">
        <Breadcrumb items={[{ label: 'Machines', href: '/machines' }, { label: 'Not Found' }]} />
        <div className="text-center text-muted-foreground text-sm py-12">Machine not found.</div>
      </div>
    );
  }

  const anyFetching = machines.isFetching || agents.isFetching || sessions.isFetching;

  return (
    <div className="relative p-4 md:p-6 max-w-[1000px]">
      <FetchingBar isFetching={anyFetching && !machines.isLoading} />
      <Breadcrumb items={[{ label: 'Machines', href: '/machines' }, { label: machine.hostname }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-bold">{machine.hostname}</h1>
          <StatusBadge status={machine.status} />
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={machines.dataUpdatedAt} />
          <RefreshButton
            onClick={() => {
              void machines.refetch();
              void agents.refetch();
              void sessions.refetch();
            }}
            isFetching={anyFetching && !machines.isLoading}
          />
        </div>
      </div>

      {/* Machine details card */}
      <Card className="mb-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Machine Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <InfoField label="ID">
              <CopyableText value={machine.id} maxDisplay={16} />
            </InfoField>
            <InfoField label="Tailscale IP">
              {machine.tailscaleIp ? (
                <CopyableText value={machine.tailscaleIp} label={machine.tailscaleIp} />
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </InfoField>
            <InfoField label="OS / Architecture">
              <span>
                {machine.os} / {machine.arch}
              </span>
            </InfoField>
            <InfoField label="Last Heartbeat">
              <span
                className={cn(
                  machine.lastHeartbeat
                    ? isStaleHeartbeat(machine.lastHeartbeat)
                      ? 'text-yellow-500'
                      : 'text-green-500'
                    : 'text-muted-foreground',
                )}
              >
                {machine.lastHeartbeat ? <LiveTimeAgo date={machine.lastHeartbeat} /> : 'Never'}
              </span>
            </InfoField>
            <InfoField label="Registered">
              <span>{formatDate(machine.createdAt)}</span>
            </InfoField>
          </div>
        </CardContent>
      </Card>

      {/* Capabilities card */}
      {machine.capabilities && (
        <Card className="mb-4">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
              <InfoField label="GPU">
                <CapabilityIndicator enabled={machine.capabilities?.gpu ?? false} />
              </InfoField>
              <InfoField label="Docker">
                <CapabilityIndicator enabled={machine.capabilities?.docker ?? false} />
              </InfoField>
              <InfoField label="Max Concurrent Agents">
                <span className="font-mono">{machine.capabilities?.maxConcurrentAgents ?? 0}</span>
              </InfoField>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agents on this machine */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">
            Agents on this Machine
            {machineAgents.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({machineAgents.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agents.isLoading ? (
            <div className="space-y-2">
              {['agent-sk-1', 'agent-sk-2'].map((key) => (
                <Skeleton key={key} className="h-10 rounded" />
              ))}
            </div>
          ) : agents.error ? (
            <ErrorBanner
              message={`Failed to load agents: ${agents.error.message}`}
              onRetry={() => void agents.refetch()}
            />
          ) : machineAgents.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No agents registered on this machine.{' '}
              <Link href="/agents" className="text-primary underline underline-offset-2">
                View all agents
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Agents on this machine">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      Name
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      Status
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium hidden sm:table-cell">
                      Type
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium hidden md:table-cell">
                      Project
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      Last Run
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {machineAgents.map((agent) => (
                    <tr key={agent.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/agents/${agent.id}`}
                          className="text-foreground hover:text-primary transition-colors font-medium no-underline"
                        >
                          {agent.name}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={agent.status} />
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground capitalize hidden sm:table-cell">
                        {agent.type}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px] hidden md:table-cell">
                        <PathBadge path={agent.projectPath} />
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {agent.lastRunAt ? <LiveTimeAgo date={agent.lastRunAt} /> : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Recent Sessions
            {recentSessions.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({recentSessions.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.isLoading ? (
            <div className="space-y-2">
              {['sess-sk-1', 'sess-sk-2', 'sess-sk-3'].map((key) => (
                <Skeleton key={key} className="h-10 rounded" />
              ))}
            </div>
          ) : sessions.error ? (
            <ErrorBanner
              message={`Failed to load sessions: ${sessions.error.message}`}
              onRetry={() => void sessions.refetch()}
            />
          ) : recentSessions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No sessions found for this machine.{' '}
              <Link href="/sessions" className="text-primary underline underline-offset-2">
                View all sessions
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Recent sessions on this machine">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      Session ID
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium">
                      Status
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium hidden sm:table-cell">
                      Agent
                    </th>
                    <th scope="col" className="pb-2 pr-4 font-medium hidden md:table-cell">
                      Project
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.map((session) => (
                    <tr key={session.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/sessions/${session.id}`}
                          className="text-foreground hover:text-primary transition-colors font-mono text-xs no-underline"
                        >
                          {session.id.slice(0, 12)}...
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={session.status} />
                      </td>
                      <td className="py-2.5 pr-4 hidden sm:table-cell">
                        <AgentName agentId={session.agentId} agents={agents.data ?? []} />
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px] hidden md:table-cell">
                        <PathBadge path={session.projectPath} />
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        <LiveTimeAgo date={session.startedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STALE_HEARTBEAT_MS = 60_000;

function isStaleHeartbeat(dateStr: string): boolean {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return diffMs > STALE_HEARTBEAT_MS;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function InfoField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground mb-1">
        {label}
      </div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function CapabilityIndicator({ enabled }: { enabled: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        enabled ? 'text-green-500' : 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          enabled ? 'bg-green-500' : 'bg-muted-foreground/30',
        )}
      />
      {enabled ? 'Available' : 'Not available'}
    </span>
  );
}

function AgentName({
  agentId,
  agents,
}: {
  agentId: string;
  agents: { id: string; name: string }[];
}): React.JSX.Element {
  const agent = agents.find((a) => a.id === agentId);

  if (agent) {
    return (
      <Link
        href={`/agents/${agent.id}`}
        className="text-xs text-foreground hover:text-primary transition-colors no-underline"
      >
        {agent.name}
      </Link>
    );
  }

  return <span className="text-xs font-mono text-muted-foreground">{agentId.slice(0, 12)}...</span>;
}
