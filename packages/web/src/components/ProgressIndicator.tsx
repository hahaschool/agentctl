import { Loader2, Terminal, Timer } from 'lucide-react';

type ProgressIndicatorProps = {
  content: string;
  toolName?: string;
  timestamp?: string;
};

export function ProgressIndicator({ content, toolName }: ProgressIndicatorProps): React.JSX.Element {
  const Icon = toolName === 'bash' ? Terminal : toolName === 'task' ? Timer : Loader2;

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-cyan-500/[0.04] border-l-2 border-l-cyan-400/50">
      <Icon size={11} className="text-cyan-400 shrink-0" />
      <span className="text-[11px] font-mono text-muted-foreground truncate">{content}</span>
      {toolName && (
        <span className="text-[9px] text-cyan-400/60 shrink-0 ml-auto">{toolName}</span>
      )}
    </div>
  );
}
