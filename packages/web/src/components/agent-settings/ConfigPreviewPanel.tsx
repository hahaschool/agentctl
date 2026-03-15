'use client';

import { isManagedRuntime } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';

import { api } from '@/lib/api';

import { ConfigFileCard } from './ConfigFileCard';

type ConfigPreviewPanelProps = {
  agentId: string;
  runtime?: string;
};

export function ConfigPreviewPanel({
  agentId,
  runtime,
}: ConfigPreviewPanelProps): React.JSX.Element | null {
  if (!runtime || !isManagedRuntime(runtime)) {
    return null;
  }

  return <ConfigPreviewPanelInner agentId={agentId} />;
}

function ConfigPreviewPanelInner({ agentId }: { agentId: string }): React.JSX.Element {
  const previewQuery = useQuery({
    queryKey: ['agents', agentId, 'config-preview'],
    queryFn: () => api.getAgentConfigPreview(agentId),
    staleTime: 10_000,
  });

  if (previewQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-neutral-800/50 rounded-md animate-pulse" />
        ))}
      </div>
    );
  }

  if (previewQuery.error) {
    return (
      <div className="text-sm text-muted-foreground p-4 border border-neutral-800 rounded-md">
        Preview unavailable — worker offline
      </div>
    );
  }

  const files = previewQuery.data?.files ?? [];

  if (files.length === 0) {
    return <div className="text-sm text-muted-foreground">No config files to preview.</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Config Preview ({files.length} files)
      </h3>
      {files.map((file, index) => (
        <ConfigFileCard key={`${file.scope}:${file.path}`} {...file} defaultOpen={index === 0} />
      ))}
    </div>
  );
}
