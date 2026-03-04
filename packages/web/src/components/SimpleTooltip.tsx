'use client';

import type React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type Props = {
  /** Text shown in the tooltip popup */
  content: string;
  /** Side of the trigger to place the tooltip */
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
};

/**
 * Lightweight tooltip wrapper around shadcn/radix Tooltip.
 * Requires `<TooltipProvider>` somewhere above in the tree.
 */
export function SimpleTooltip({ content, side = 'top', children }: Props): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
