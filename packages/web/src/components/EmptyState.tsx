import type React from 'react';

type Props = {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon, title, description, action }: Props): React.JSX.Element {
  return (
    <div className="py-12 px-6 text-center flex flex-col items-center gap-2">
      {icon && <div className="text-3xl text-muted-foreground/40 mb-1">{icon}</div>}
      <div className="text-[15px] font-semibold text-muted-foreground">{title}</div>
      {description && (
        <div className="text-[13px] text-muted-foreground/80 max-w-[400px]">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
