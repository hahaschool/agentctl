'use client';

import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';

type ThinkingBlockProps = {
  content: string;
  timestamp?: string;
};

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  timestamp,
}: ThinkingBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  // Show first line as preview
  const firstLine = content.split('\n')[0]?.slice(0, 120) ?? '';

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-left font-[inherit] border-none border-l-2 bg-purple-500/[0.06] border-l-purple-400/60"
      >
        <ChevronRight
          size={12}
          className="text-purple-600 dark:text-purple-400 shrink-0"
          aria-hidden="true"
        />
        <Brain
          size={12}
          className="text-purple-600 dark:text-purple-400 shrink-0"
          aria-hidden="true"
        />
        <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 shrink-0">
          Thinking
        </span>
        <span className="text-[11px] text-muted-foreground truncate">{firstLine}</span>
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">click to expand</span>
      </button>
    );
  }

  return (
    <div className="px-3 py-2 rounded-lg border-l-[3px] bg-purple-500/[0.06] border-l-purple-400/60">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
          <ChevronDown size={12} aria-hidden="true" />
          <Brain size={12} aria-hidden="true" />
          Thinking
        </span>
        <div className="flex gap-2 items-center">
          {timestamp && <span className="text-[10px] text-muted-foreground">{timestamp}</span>}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[10px] text-primary bg-transparent border-none p-0 cursor-pointer"
          >
            collapse
          </button>
        </div>
      </div>
      <div className="text-[12px] text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-auto">
        {content}
      </div>
    </div>
  );
});
