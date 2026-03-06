import type React from 'react';

export function LogsSectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-[15px] font-semibold text-muted-foreground mb-2.5">{children}</h2>;
}
