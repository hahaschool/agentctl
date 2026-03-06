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
  /** Whether button is disabled (default: false) */
  disabled?: boolean;
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
  disabled = false,
}: Props): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const handleClick = useCallback(() => {
    if (disabled) {
      return;
    }
    if (confirming) {
      clearTimers();
      setConfirming(false);
      setSecondsLeft(0);
      onConfirm();
    } else {
      const totalSeconds = Math.ceil(timeout / 1000);
      setConfirming(true);
      setSecondsLeft(totalSeconds);
      intervalRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      timerRef.current = setTimeout(() => {
        setConfirming(false);
        setSecondsLeft(0);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }, timeout);
    }
  }, [confirming, onConfirm, timeout, clearTimers, disabled]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-live="polite"
      disabled={disabled}
      className={cn(confirming ? confirmClassName : className, disabled && 'cursor-not-allowed')}
    >
      {confirming ? (
        <>
          {confirmLabel}
          <span className="ml-1 text-xs opacity-70">({secondsLeft}s)</span>
        </>
      ) : label}
    </button>
  );
}
