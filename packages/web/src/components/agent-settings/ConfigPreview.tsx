'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';

import { CollapsibleSection } from '@/components/CollapsibleSection';
import { agentConfigPreviewQuery } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ConfigPreviewProps = {
  agentId: string;
  runtime: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfigPreview({ agentId }: ConfigPreviewProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const previewQuery = useQuery({
    ...agentConfigPreviewQuery(agentId),
    enabled: open,
  });

  return (
    <CollapsibleSection title="Config Preview" open={open} onToggle={() => setOpen((v) => !v)}>
      <div className="space-y-3">
        {previewQuery.isLoading && (
          <span className="text-sm text-muted-foreground">Loading preview...</span>
        )}

        {previewQuery.error && (
          <span className="text-sm text-red-400">
            Failed to load preview: {previewQuery.error.message}
          </span>
        )}

        {previewQuery.data?.rendered?.files?.map((file) => (
          <div key={`${file.scope}:${file.path}`}>
            <div className="text-xs text-muted-foreground mb-1 font-mono">
              [{file.scope}] {file.path}
            </div>
            <pre className="text-xs bg-neutral-900 p-3 rounded-md overflow-x-auto font-mono max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
              {file.content}
            </pre>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
