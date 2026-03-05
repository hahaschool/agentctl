type ProgressIndicatorProps = {
  content: string;
  toolName?: string;
  timestamp?: string;
};

export function ProgressIndicator({ content, toolName }: ProgressIndicatorProps): React.JSX.Element {
  const icon = toolName === 'bash' ? '$' : toolName === 'task' ? '...' : '>';

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-sm bg-cyan-500/[0.04] border-l-2 border-l-cyan-400/50">
      <span className="text-[10px] font-mono text-cyan-400 shrink-0">{icon}</span>
      <span className="text-[11px] font-mono text-muted-foreground truncate">{content}</span>
      {toolName && (
        <span className="text-[9px] text-cyan-400/60 shrink-0 ml-auto">{toolName}</span>
      )}
    </div>
  );
}
