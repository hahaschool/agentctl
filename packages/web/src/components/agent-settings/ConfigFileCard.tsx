'use client';

import type { ConfigPreviewFile } from '@agentctl/shared';
import type React from 'react';
import { useState } from 'react';

import { CollapsibleSection } from '@/components/CollapsibleSection';
import { Badge } from '@/components/ui/badge';

type ConfigFileCardProps = ConfigPreviewFile & {
  defaultOpen?: boolean;
};

const STATUS_STYLES = {
  managed: {
    label: 'Managed',
    className: 'bg-green-500/10 text-green-400 border-green-500/30',
  },
  merged: {
    label: 'Merged',
    className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  },
  project: {
    label: 'Project',
    className: 'bg-muted/50 text-muted-foreground border-border/60',
  },
} as const;

export function ConfigFileCard({
  path,
  content,
  status,
  overriddenFields,
  defaultOpen = false,
}: ConfigFileCardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const style = STATUS_STYLES[status];

  const title = (
    <span className="flex items-center gap-2 font-mono text-xs">
      <span>{path}</span>
      <Badge variant="outline" className={style.className}>
        {style.label}
      </Badge>
    </span>
  );

  return (
    <CollapsibleSection title={title} open={open} onToggle={() => setOpen((v) => !v)}>
      <pre className="text-xs bg-card border border-border p-3 rounded-md overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all">
        {status === 'merged' && overriddenFields
          ? renderWithHighlights(content, overriddenFields)
          : content}
      </pre>
    </CollapsibleSection>
  );
}

function renderWithHighlights(content: string, fields: string[]): React.ReactNode {
  const lines = content.split('\n');
  let charOffset = 0;

  return lines.map((line) => {
    const lineOffset = charOffset;
    charOffset += line.length + 1;
    const isOverridden = fields.some((field) => line.includes(field));
    return (
      <span
        key={`${lineOffset}:${line}`}
        className={isOverridden ? 'border-l-2 border-blue-500 pl-2 -ml-2 bg-blue-500/5' : ''}
      >
        {line}
        {lineOffset < content.length - line.length ? '\n' : ''}
      </span>
    );
  });
}
