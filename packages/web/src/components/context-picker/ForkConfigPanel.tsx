'use client';

import React from 'react';
import type { Session } from '@/lib/api';
import { MODEL_OPTIONS_WITH_DEFAULT } from '@/lib/model-options';
import { cn } from '@/lib/utils';

export type ForkConfigPanelProps = {
  session: Session;
  forkPrompt: string;
  onForkPromptChange: (prompt: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  detectedStrategy: 'jsonl-truncation' | 'context-injection' | 'resume';
  isSubmitting: boolean;
  onSubmit: () => void;
};

type StrategyDisplay = {
  label: string;
  badgeClass: string;
  description: string;
};

const STRATEGY_MAP: Record<string, StrategyDisplay> = {
  'jsonl-truncation': {
    label: 'JSONL Truncation',
    badgeClass: 'bg-green-500/20 text-green-600',
    description: 'Perfect fidelity',
  },
  'context-injection': {
    label: 'Context Injection',
    badgeClass: 'bg-yellow-500/20 text-yellow-600',
    description: 'Cherry-picked messages',
  },
  resume: {
    label: 'Full Resume',
    badgeClass: 'bg-blue-500/20 text-blue-600',
    description: 'All messages',
  },
};

export const ForkConfigPanel = React.memo(function ForkConfigPanel({
  session,
  forkPrompt,
  onForkPromptChange,
  model,
  onModelChange,
  detectedStrategy,
  isSubmitting,
  onSubmit,
}: ForkConfigPanelProps): React.ReactNode {
  const strategy = STRATEGY_MAP[detectedStrategy];
  const canSubmit = forkPrompt.trim().length > 0 && !isSubmitting;

  return (
    <div className="w-full sm:w-80 shrink-0 flex flex-col overflow-y-auto">
      <div className="p-4 space-y-3.5">
        {/* Fork Prompt */}
        <div>
          <label
            htmlFor="fork-prompt"
            className="block text-[11px] font-medium text-muted-foreground mb-1"
          >
            Fork Prompt
          </label>
          <textarea
            id="fork-prompt"
            value={forkPrompt}
            onChange={(e) => onForkPromptChange(e.target.value)}
            placeholder="What should the forked session do..."
            rows={6}
            aria-label="Fork prompt"
            className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors resize-y leading-relaxed"
          />
        </div>

        {/* Model */}
        <div>
          <label
            htmlFor="fork-model"
            className="block text-[11px] font-medium text-muted-foreground mb-1"
          >
            Model
          </label>
          <select
            id="fork-model"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            aria-label="Fork session model"
            className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
          >
            {MODEL_OPTIONS_WITH_DEFAULT.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Strategy indicator */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Strategy</p>
          <div className="flex items-center gap-2">
            <span
              className={cn('px-2 py-0.5 text-[10px] font-medium rounded-md', strategy?.badgeClass)}
            >
              {strategy?.label}
            </span>
            <span className="text-[10px] text-muted-foreground">{strategy?.description}</span>
          </div>
        </div>

        {/* Source session info */}
        <div className="pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground/60 mb-1">Source Session</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate">
            {session.id.slice(0, 16)}...
          </p>
          {session.agentName && (
            <p className="text-[11px] text-muted-foreground mt-0.5">Agent: {session.agentName}</p>
          )}
          {session.claudeSessionId && (
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
              Claude: {session.claudeSessionId.slice(0, 12)}...
            </p>
          )}
        </div>

        {/* Submit button */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full px-3.5 py-2 text-xs text-white bg-blue-700 hover:bg-blue-600 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Forking...' : 'Fork Session'}
        </button>
      </div>
    </div>
  );
});
