import type { MemoryFact, MemoryObservation } from '@agentctl/shared';
import React from 'react';

import { cn } from '@/lib/utils';

const TYPE_COLORS: Record<string, string> = {
  decision: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  bugfix: 'text-red-600 bg-red-500/10 border-red-500/20',
  feature: 'text-green-600 bg-green-500/10 border-green-500/20',
  refactor: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  discovery: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  change: 'text-muted-foreground bg-muted/50 border-border',
};

const SCOPE_COLORS: Record<string, string> = {
  global: 'text-violet-600 bg-violet-500/10 border-violet-500/20',
  project: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  session: 'text-green-600 bg-green-500/10 border-green-500/20',
  agent: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
};

/**
 * Match a claude-mem observation to message indices by extracting keywords
 * from the observation's files_modified, facts, and title, then checking
 * which messages contain those keywords.
 */
export function matchObservationToMessages(
  observation: MemoryObservation,
  messages: { type: string; content: string }[],
): number[] {
  const indices = new Set<number>();
  const keywords: string[] = [];

  // Extract filenames from files_modified JSON array
  if (observation.files_modified) {
    try {
      const files = JSON.parse(observation.files_modified) as string[];
      for (const f of files) {
        const filename = f.split('/').pop();
        if (filename && filename.length >= 3) keywords.push(filename.toLowerCase());
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Extract keywords from facts JSON array
  if (observation.facts) {
    try {
      const facts = JSON.parse(observation.facts) as string[];
      for (const fact of facts) {
        const words = fact.split(/\s+/).filter((w) => w.length > 4);
        for (const w of words.slice(0, 5)) {
          keywords.push(w.toLowerCase());
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Extract keywords from title
  const titleWords = observation.title.split(/\s+/).filter((w) => w.length > 3);
  for (const w of titleWords) {
    keywords.push(w.toLowerCase());
  }

  // Match keywords against messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const content = msg.content.toLowerCase();
    for (const kw of keywords) {
      if (content.includes(kw)) {
        indices.add(i);
        break;
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Match a unified MemoryFact to message indices by extracting keywords
 * from the fact content, then checking which messages contain those keywords.
 */
export function matchFactToMessages(
  fact: MemoryFact,
  messages: { type: string; content: string }[],
): number[] {
  const indices = new Set<number>();
  const keywords = fact.content
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 10)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const content = msg.content.toLowerCase();
    for (const kw of keywords) {
      if (kw.length >= 4 && content.includes(kw)) {
        indices.add(i);
        break;
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Legacy claude-mem MemoryPanel
// ---------------------------------------------------------------------------

type MemoryPanelProps = {
  observations: MemoryObservation[];
  isLoading: boolean;
  onSelectObservation: (observation: MemoryObservation) => void;
  selectedObservationId?: number;
};

export const MemoryPanel = React.memo(function MemoryPanel({
  observations,
  isLoading,
  onSelectObservation,
  selectedObservationId,
}: MemoryPanelProps): React.ReactNode {
  if (isLoading) {
    return (
      <div className="p-3 text-xs text-muted-foreground animate-pulse">Searching memories...</div>
    );
  }

  if (observations.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No matching memories found.</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-2 max-h-48 overflow-y-auto">
      {observations.map((obs) => (
        <button
          key={obs.id}
          type="button"
          onClick={() => onSelectObservation(obs)}
          className={cn(
            'text-left p-2 rounded-md border text-xs transition-colors cursor-pointer',
            selectedObservationId === obs.id ? 'ring-2 ring-primary/40' : 'hover:bg-muted/50',
            TYPE_COLORS[obs.type] ?? TYPE_COLORS.change,
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-medium uppercase opacity-70">{obs.type}</span>
            <span className="font-medium truncate">{obs.title}</span>
          </div>
        </button>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Unified memory facts panel
// ---------------------------------------------------------------------------

type UnifiedMemoryPanelProps = {
  facts: MemoryFact[];
  isLoading: boolean;
  onSelectFact: (fact: MemoryFact) => void;
  selectedFactId?: string;
  label?: string;
};

export const UnifiedMemoryPanel = React.memo(function UnifiedMemoryPanel({
  facts,
  isLoading,
  onSelectFact,
  selectedFactId,
  label,
}: UnifiedMemoryPanelProps): React.ReactNode {
  if (isLoading) {
    return (
      <div className="p-3 text-xs text-muted-foreground animate-pulse">
        {label ?? 'Searching memory...'}
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">No relevant facts found in memory.</div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2 max-h-48 overflow-y-auto">
      {facts.map((fact) => {
        const scopeClass = SCOPE_COLORS[fact.scope] ?? SCOPE_COLORS.project;
        const confidencePct = Math.round((fact.confidence ?? 1) * 100);
        return (
          <button
            key={fact.id}
            type="button"
            onClick={() => onSelectFact(fact)}
            className={cn(
              'text-left p-2 rounded-md border text-xs transition-colors cursor-pointer',
              selectedFactId === fact.id ? 'ring-2 ring-primary/40' : 'hover:bg-muted/50',
              scopeClass,
            )}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[9px] font-medium uppercase opacity-70 shrink-0">
                  {fact.scope}
                </span>
                <span className="font-medium truncate">{fact.content}</span>
              </div>
              <span className="text-[9px] opacity-60 shrink-0">{confidencePct}%</span>
            </div>
          </button>
        );
      })}
    </div>
  );
});
