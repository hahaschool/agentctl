import type React from 'react';

export type DashboardActionButtonProps = {
  label: string;
  onClick: () => void;
};

export function DashboardActionButton({
  label,
  onClick,
}: DashboardActionButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 bg-transparent text-primary border border-primary/50 rounded-md text-xs font-medium cursor-pointer hover:bg-primary/10 transition-colors"
    >
      {label}
    </button>
  );
}
