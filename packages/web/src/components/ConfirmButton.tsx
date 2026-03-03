'use client';

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  /** Text shown in default state */
  label: string;
  /** Text shown during confirmation state */
  confirmLabel?: string;
  /** Called when confirmed (second click) */
  onConfirm: () => void;
  /** Time in ms before reverting to default state (default: 3000) */
  timeout?: number;
  className?: string;
  confirmClassName?: string;
};

/**
 * Button that requires two clicks for destructive actions.
 * First click changes label to confirmation text, second click executes.
 * Auto-reverts after timeout.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Confirm?',
  onConfirm,
  timeout = 3000,
  className,
  confirmClassName,
}: Props): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const handleClick = useCallback(() => {
    if (confirming) {
      clearTimer();
      setConfirming(false);
      onConfirm();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), timeout);
    }
  }, [confirming, onConfirm, timeout, clearTimer]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(confirming ? confirmClassName : className)}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}
