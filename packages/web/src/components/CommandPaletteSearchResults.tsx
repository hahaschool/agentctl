import type React from 'react';

import { cn } from '@/lib/utils';

export type CommandPaletteIcon = React.ComponentType<{ size?: number; className?: string }>;

export type CommandPaletteResultItem = {
  id: string;
  label: string;
  description?: string;
  icon: string | CommandPaletteIcon;
  shortcut?: string;
  badge?: { text: string; variant: 'default' | 'success' | 'warning' | 'destructive' };
  action: () => void;
};

export type CommandPaletteResultSection = {
  key: string;
  title: string;
  items: CommandPaletteResultItem[];
};

type Props = {
  sections: CommandPaletteResultSection[];
  activeIndex: number;
  optionIdPrefix: string;
  emptyText: string;
  onItemHover: (index: number) => void;
};

export function CommandPaletteSearchResults({
  sections,
  activeIndex,
  optionIdPrefix,
  emptyText,
  onItemHover,
}: Props): React.JSX.Element {
  if (sections.length === 0) {
    return <div className="px-4 py-6 text-center text-muted-foreground text-sm">{emptyText}</div>;
  }

  let flatIndex = 0;

  return (
    <>
      {sections.map((section) => (
        <div key={section.key}>
          <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {section.title}
          </div>
          {section.items.map((item) => {
            const idx = flatIndex++;
            const isActive = idx === activeIndex;
            const optionId = `${optionIdPrefix}-command-option-${idx}`;

            return (
              <button
                key={item.id}
                id={optionId}
                type="button"
                role="option"
                aria-selected={isActive}
                data-active={isActive}
                onClick={() => item.action()}
                onMouseEnter={() => onItemHover(idx)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors duration-75 border-none',
                  isActive
                    ? 'bg-accent/15 text-foreground'
                    : 'bg-transparent text-muted-foreground hover:bg-accent/10',
                )}
              >
                {typeof item.icon === 'string' ? (
                  <span className="w-5 text-center text-base shrink-0">{item.icon}</span>
                ) : (
                  <item.icon size={16} className="w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{item.label}</span>
                  {item.description && (
                    <span className="ml-2 text-[11px] text-muted-foreground truncate">
                      {item.description}
                    </span>
                  )}
                </span>
                {item.badge && (
                  <span
                    className={cn(
                      'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded-full',
                      item.badge.variant === 'success' && 'bg-emerald-500/15 text-emerald-500',
                      item.badge.variant === 'warning' && 'bg-amber-500/15 text-amber-500',
                      item.badge.variant === 'destructive' && 'bg-red-500/15 text-red-500',
                      item.badge.variant === 'default' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {item.badge.text}
                  </span>
                )}
                {item.shortcut && (
                  <kbd className="shrink-0 text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-sm border border-border">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
