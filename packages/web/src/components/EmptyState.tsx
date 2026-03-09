import type React from 'react';

import { cn } from '@/lib/utils';

type Props = {
  icon?: string | React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'compact';
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
}: Props): React.JSX.Element {
  const isCompact = variant === 'compact';

  const renderIcon = (): React.JSX.Element | null => {
    if (!icon) return null;
    if (typeof icon === 'string') {
      return (
        <div className={cn('text-muted-foreground/30', isCompact ? 'text-2xl' : 'text-4xl')}>
          {icon}
        </div>
      );
    }
    const Icon = icon;
    return (
      <div
        className={cn(
          'rounded-full flex items-center justify-center ring-1 ring-border/30 shadow-sm',
          isCompact
            ? 'w-10 h-10 bg-muted/50'
            : 'w-16 h-16 bg-gradient-to-b from-muted/70 to-muted/30',
        )}
      >
        <Icon size={isCompact ? 20 : 28} className="text-muted-foreground/40" />
      </div>
    );
  };

  return (
    <div
      className={cn(
        'text-center flex flex-col items-center animate-fade-in',
        isCompact ? 'py-6 px-4 gap-1.5' : 'py-16 px-6 gap-3',
      )}
    >
      {renderIcon()}
      <div
        className={cn(
          'font-semibold text-muted-foreground',
          isCompact ? 'text-[13px]' : 'text-[15px] mt-1',
        )}
      >
        {title}
      </div>
      {description && (
        <div
          className={cn(
            'text-muted-foreground/70 max-w-[400px] leading-relaxed',
            isCompact ? 'text-[11px]' : 'text-[13px]',
          )}
        >
          {description}
        </div>
      )}
      {action && <div className={cn(isCompact ? 'mt-2' : 'mt-4')}>{action}</div>}
    </div>
  );
}
