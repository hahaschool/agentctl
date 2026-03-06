import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  sublabel?: string;
  accent?: 'green' | 'yellow' | 'red' | 'blue' | 'purple';
};

const ACCENT_CLASSES: Record<string, string> = {
  green: 'border-l-green-500/60',
  yellow: 'border-l-yellow-500/60',
  red: 'border-l-red-500/60',
  blue: 'border-l-blue-500/60',
  purple: 'border-l-purple-500/60',
};

export function StatCard({ label, value, sublabel, accent }: Props): React.JSX.Element {
  return (
    <div
      data-testid={`stat-card-${label}`}
      className={cn(
        'bg-card border border-border/50 rounded-lg p-4 transition-colors hover:border-border',
        accent && 'border-l-[3px]',
        accent && ACCENT_CLASSES[accent],
      )}
    >
      <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
        {label}
      </div>
      <div
        data-testid={`stat-value-${label}`}
        className="text-2xl font-semibold text-foreground tracking-tight"
      >
        {value}
      </div>
      {sublabel && (
        <div data-testid={`stat-sublabel-${label}`} className="mt-1 text-[11px] text-muted-foreground">
          {sublabel}
        </div>
      )}
    </div>
  );
}
