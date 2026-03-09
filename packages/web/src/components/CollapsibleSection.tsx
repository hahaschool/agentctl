import type React from 'react';
import { cn } from '@/lib/utils';

export type CollapsibleSectionProps = {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

export function CollapsibleSection({
  title,
  badge,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 mb-2.5 bg-transparent border-none p-0 cursor-pointer text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-md"
      >
        <span
          className={cn(
            'text-xs transition-transform duration-150 text-muted-foreground',
            open ? 'rotate-0' : '-rotate-90',
          )}
        >
          &#x25BC;
        </span>
        <span className="text-[15px] font-semibold text-muted-foreground">{title}</span>
        {badge && <span className="text-[11px] text-muted-foreground font-normal">({badge})</span>}
      </button>
      {open && children}
    </>
  );
}
