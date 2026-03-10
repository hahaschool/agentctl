'use client';

import { cn } from '@/lib/utils';

export type SettingsNavItem = {
  id: string;
  label: string;
  detail: string;
};

export function SettingsShell({
  navItems,
  children,
}: {
  navItems: readonly SettingsNavItem[];
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-[24px] border border-border/50 bg-card/70 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur">
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground/80">
              Runtime control
            </p>
            <p className="mt-2 max-w-[22ch] text-sm text-muted-foreground">
              Configure how managed runtimes, workers, and access policies behave together.
            </p>
          </div>

          <nav aria-label="Settings sections" className="space-y-1.5">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={cn(
                  'group block rounded-2xl border border-transparent px-3 py-3 transition-all',
                  'hover:border-border/60 hover:bg-muted/40',
                )}
              >
                <div className="text-sm font-medium tracking-tight">{item.label}</div>
                <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {item.detail}
                </div>
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <div className="space-y-6">{children}</div>
    </div>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-[28px] border border-border/50 bg-card/75 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.12)] backdrop-blur md:p-6"
    >
      <div className="mb-5 flex flex-col gap-2 border-b border-border/40 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>

      {children}
    </section>
  );
}
