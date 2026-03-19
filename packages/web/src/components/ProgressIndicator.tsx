import { Loader2, Terminal, Timer } from 'lucide-react';
import { memo } from 'react';

type ProgressIndicatorProps = {
  content: string;
  toolName?: string;
  timestamp?: string;
};

export const ProgressIndicator = memo(function ProgressIndicator({
  content,
  toolName,
}: ProgressIndicatorProps): React.JSX.Element {
  const Icon = toolName === 'bash' ? Terminal : toolName === 'task' ? Timer : Loader2;

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-primary/[0.04] border-l-2 border-l-primary/50">
      <Icon size={11} className="text-primary shrink-0" aria-hidden="true" />
      <span className="text-[11px] font-mono text-muted-foreground truncate">{content}</span>
      {toolName && <span className="text-[9px] text-primary/60 shrink-0 ml-auto">{toolName}</span>}
    </div>
  );
});
