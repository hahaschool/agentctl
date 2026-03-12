'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Simple Tabs implementation (no external deps). Follows shadcn/ui patterns.
// ---------------------------------------------------------------------------

type TabsContextValue = {
  value: string;
  onValueChange: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    const err = new Error('Tabs compound components must be used within <Tabs>');
    err.name = 'TabsContextError';
    throw err;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
};

function Tabs({ value, onValueChange, className, children }: TabsProps): React.JSX.Element {
  const ctx = React.useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// TabsList
// ---------------------------------------------------------------------------

function TabsList({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// TabsTrigger
// ---------------------------------------------------------------------------

type TabsTriggerProps = React.ComponentProps<'button'> & {
  value: string;
};

function TabsTrigger({ className, value, ...props }: TabsTriggerProps): React.JSX.Element {
  const ctx = useTabsContext();
  const isActive = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? 'active' : 'inactive'}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'hover:bg-background/50 hover:text-foreground',
        className,
      )}
      onClick={() => ctx.onValueChange(value)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// TabsContent
// ---------------------------------------------------------------------------

type TabsContentProps = React.ComponentProps<'div'> & {
  value: string;
};

function TabsContent({ className, value, ...props }: TabsContentProps): React.JSX.Element | null {
  const ctx = useTabsContext();
  if (ctx.value !== value) return null;

  return (
    <div
      role="tabpanel"
      data-state="active"
      className={cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
