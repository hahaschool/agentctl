import type React from 'react';

type Props = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-3',
} as const;

export function Spinner({ size = 'md', className = '' }: Props): React.JSX.Element {
  return (
    <div
      role="status"
      className={`animate-spin rounded-full border-muted-foreground/30 border-t-muted-foreground ${sizeClasses[size]} ${className}`}
      aria-label="Loading"
    />
  );
}
