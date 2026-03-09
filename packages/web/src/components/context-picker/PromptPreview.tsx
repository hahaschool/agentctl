import React from 'react';

type PreviewInput = {
  strategy: 'resume' | 'jsonl-truncation' | 'context-injection';
  forkPrompt: string;
  forkAtIndex?: number;
  selectedMessages: { type: string; content: string }[];
  systemPrompt?: string;
};

export function buildPromptPreview(input: PreviewInput): string {
  const sections: string[] = [];

  if (input.strategy === 'resume') {
    sections.push('--- Strategy: Resume ---');
    sections.push('(Full session history will be preserved)\n');
  } else if (input.strategy === 'jsonl-truncation') {
    sections.push('--- Strategy: JSONL Truncation ---');
    sections.push(`Messages 0\u2013${String(input.forkAtIndex ?? '?')} will be preserved\n`);
  } else if (input.strategy === 'context-injection') {
    sections.push('--- Strategy: Context Injection ---\n');
    sections.push('## Previous Conversation Context\n');
    for (const msg of input.selectedMessages) {
      const truncated = msg.content.length > 200 ? `${msg.content.slice(0, 200)}...` : msg.content;
      sections.push(`[${msg.type}] ${truncated}\n`);
    }
  }

  if (input.systemPrompt) {
    sections.push(`\n## System Prompt\n${input.systemPrompt}\n`);
  }

  sections.push(`\n## User Prompt\n${input.forkPrompt || '(empty)'}`);

  return sections.join('\n');
}

export const PromptPreview = React.memo(function PromptPreview({
  previewText,
  collapsed,
  onToggle,
}: {
  previewText: string;
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactNode {
  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <span>Prompt Preview</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`transform transition-transform ${collapsed ? '' : 'rotate-180'}`}
          aria-hidden="true"
        >
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {!collapsed && (
        <pre className="px-4 pb-3 text-[11px] text-foreground/80 font-mono whitespace-pre-wrap overflow-y-auto max-h-48 leading-relaxed">
          {previewText}
        </pre>
      )}
    </div>
  );
});
