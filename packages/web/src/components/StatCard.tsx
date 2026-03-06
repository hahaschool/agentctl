import { Card, CardContent } from '@/components/ui/card';

type Props = {
  label: string;
  value: string;
  sublabel?: string;
};

export function StatCard({ label, value, sublabel }: Props): React.JSX.Element {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-4">
        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">
          {label}
        </div>
        <div className="text-2xl font-semibold text-foreground tracking-tight">{value}</div>
        {sublabel && <div className="mt-1 text-[11px] text-muted-foreground">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}
