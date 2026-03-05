type SubagentBlockProps = {
  content: string;
  toolName?: string;
  subagentId?: string;
  timestamp?: string;
};

export function SubagentBlock({ content, toolName, subagentId, timestamp }: SubagentBlockProps): React.JSX.Element {
  return (
    <div className="px-3 py-2 rounded-lg border-l-[3px] bg-orange-500/[0.06] border-l-orange-400/60">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold text-orange-400">Subagent</span>
        {toolName && (
          <span className="text-[10px] font-mono text-muted-foreground">{toolName}</span>
        )}
        {subagentId && (
          <span className="text-[9px] font-mono text-muted-foreground/60">{subagentId.slice(0, 8)}</span>
        )}
        {timestamp && (
          <span className="text-[10px] text-muted-foreground ml-auto">{timestamp}</span>
        )}
      </div>
      <div className="text-[12px] text-foreground/80 whitespace-pre-wrap leading-relaxed max-h-[200px] overflow-auto">
        {content}
      </div>
    </div>
  );
}
