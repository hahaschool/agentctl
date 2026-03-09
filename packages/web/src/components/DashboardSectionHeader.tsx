import Link from 'next/link';
import type React from 'react';

export type DashboardSectionHeaderProps = {
  title: string;
  href?: string;
};

export function DashboardSectionHeader({
  title,
  href,
}: DashboardSectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex justify-between items-center mb-2.5">
      <h2 className="text-[15px] font-semibold text-muted-foreground">{title}</h2>
      {href && (
        <Link
          href={href}
          className="text-[11px] text-primary font-medium no-underline hover:underline"
        >
          View All &rarr;
        </Link>
      )}
    </div>
  );
}
