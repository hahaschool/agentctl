'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { CopyableText } from '@/components/CopyableText';
import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCost, formatDate, formatDurationMs } from '@/lib/format-utils';
import { agentQuery, agentRunsQuery, useStartAgent, useStopAgent } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function AgentDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const agent = useQuery(agentQuery(agentId));
  const runs = useQuery(agentRunsQuery(agentId));

  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const toast = useToast();

  const [promptVisible, setPromptVisible] = useState(false);
  const [prompt, setPrompt] = useState('');

  // -- Handlers --

  const handleStart = (): void => {
    if (!prompt.trim()) return;
    startAgent.mutate(
      { id: agentId, prompt: prompt.trim() },
      {
        onSuccess: () => {
          toast.success('Agent started');
          setPrompt('');
          setPromptVisible(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const handleStop = (): void => {
    stopAgent.mutate(agentId, {
      onSuccess: () => toast.success('Agent stopped'),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  };

  // -- Loading state --

  if (agent.isLoading) {
    return (
      <div className="p-6 max-w-[1000px]">
        <div className="mb-5">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
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

  if (agent.error) {
    return (
      <div className="p-6 max-w-[1000px]">
        <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: 'Error' }]} />
        <div className="mt-6 px-4 py-3 bg-red-900/50 text-red-300 rounded-lg text-sm">
          Failed to load agent: {agent.error.message}
        </div>
      </div>
    );
  }

  const data = agent.data;

  if (!data) {
    return (
      <div className="p-6 max-w-[1000px]">
        <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: 'Error' }]} />
        <div className="mt-6 text-center text-muted-foreground text-sm py-12">Agent not found.</div>
      </div>
    );
  }

  const runList = runs.data ?? [];

  return (
    <div className="p-6 max-w-[1000px]">
      <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: data.name }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-bold">{data.name}</h1>
          <StatusBadge status={data.status} />
        </div>
        <div className="flex gap-2">
          {data.status === 'running' ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              disabled={stopAgent.isPending}
            >
              {stopAgent.isPending ? 'Stopping...' : 'Stop'}
            </Button>
          ) : promptVisible ? (
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStart();
                  if (e.key === 'Escape') {
                    setPromptVisible(false);
                    setPrompt('');
                  }
                }}
                placeholder="Enter prompt..."
                className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none min-w-[200px]"
              />
              <Button
                size="sm"
                onClick={handleStart}
                disabled={!prompt.trim() || startAgent.isPending}
              >
                {startAgent.isPending ? 'Starting...' : 'Go'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPromptVisible(false);
                  setPrompt('');
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setPromptVisible(true)}>
              Start
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void agent.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Info grid */}
      <Card className="mb-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Agent Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <InfoField label="ID">
              <CopyableText value={data.id} maxDisplay={16} />
            </InfoField>
            <InfoField label="Machine ID">
              <CopyableText value={data.machineId} maxDisplay={16} />
            </InfoField>
            <InfoField label="Type">
              <span className="capitalize">{data.type}</span>
            </InfoField>
            <InfoField label="Schedule">
              <span className="font-mono text-xs">{data.schedule ?? 'None'}</span>
            </InfoField>
            <InfoField label="Project Path">
              <span className="font-mono text-xs break-all">{data.projectPath ?? 'Not set'}</span>
            </InfoField>
            <InfoField label="Branch">
              <span className="font-mono text-xs">{data.worktreeBranch ?? 'Not set'}</span>
            </InfoField>
            <InfoField label="Created">
              <span>{formatDate(data.createdAt)}</span>
            </InfoField>
            <InfoField label="Last Run">
              <span>{data.lastRunAt ? <LiveTimeAgo date={data.lastRunAt} /> : 'Never'}</span>
            </InfoField>
            {data.currentSessionId && (
              <InfoField label="Current Session">
                <Link
                  href={`/sessions/${data.currentSessionId}`}
                  className="text-blue-400 hover:text-blue-300 underline underline-offset-2 font-mono text-xs"
                >
                  {data.currentSessionId.slice(0, 12)}...
                </Link>
              </InfoField>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cost cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              Last Run Cost
            </div>
            <div className="text-2xl font-bold text-foreground">{formatCost(data.lastCostUsd)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              Total Cost
            </div>
            <div className="text-2xl font-bold text-foreground">
              {formatCost(data.totalCostUsd)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.isLoading ? (
            <div className="space-y-2">
              {['run-sk-1', 'run-sk-2', 'run-sk-3'].map((key) => (
                <Skeleton key={key} className="h-10 rounded" />
              ))}
            </div>
          ) : runs.error ? (
            <div className="px-3 py-2 bg-red-900/50 text-red-300 rounded text-xs">
              Failed to load runs: {runs.error.message}
            </div>
          ) : runList.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No runs recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Prompt</th>
                    <th className="pb-2 pr-4 font-medium">Duration</th>
                    <th className="pb-2 pr-4 font-medium">Cost</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 font-medium">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {runList.map((run) => (
                    <tr key={run.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="py-2.5 pr-4 max-w-[200px]">
                        <span
                          className={cn(
                            'text-xs',
                            run.prompt ? 'text-foreground' : 'text-muted-foreground',
                          )}
                          title={run.prompt}
                        >
                          {run.prompt
                            ? run.prompt.length > 50
                              ? `${run.prompt.slice(0, 50)}...`
                              : run.prompt
                            : '-'}
                        </span>
                        {run.errorMessage && (
                          <div
                            className="text-[11px] text-red-400 mt-0.5 truncate max-w-[200px]"
                            title={run.errorMessage}
                          >
                            {run.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-xs font-mono text-muted-foreground">
                        {formatDurationMs(run.durationMs)}
                      </td>
                      <td className="py-2.5 pr-4 text-xs font-mono text-muted-foreground">
                        {formatCost(run.costUsd)}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                        <LiveTimeAgo date={run.startedAt} />
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {run.endedAt ? <LiveTimeAgo date={run.endedAt} /> : 'In progress'}
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
