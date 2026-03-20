'use client';

import type React from 'react';
import { cn } from '@/lib/utils';

type PageContainerProps = {
  children: React.ReactNode;
  className?: string;
  /** Use 'wide' for data-dense pages like sessions, 'default' for most pages */
  width?: 'default' | 'wide' | 'full';
};

export function PageContainer({
  children,
  className,
  width = 'default',
}: PageContainerProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6',
        width === 'default' && 'max-w-5xl',
        width === 'wide' && 'max-w-7xl',
        width === 'full' && '',
        className,
      )}
    >
      {children}
    </div>
  );
}
