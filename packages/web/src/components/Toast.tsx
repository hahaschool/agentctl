'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import {
  TOAST_DISMISS_ANIMATION_MS,
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
} from '@/lib/ui-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = 'success' | 'error' | 'info';

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  createdAt: number;
  /** Set to true once the dismiss animation starts */
  dismissing: boolean;
};

type ToastContextValue = {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

// ---------------------------------------------------------------------------
// External store (singleton, no React context needed)
// ---------------------------------------------------------------------------

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 0;

function emit(): void {
  for (const fn of listeners) fn();
}

function addToast(type: ToastType, message: string, duration = TOAST_DURATION_MS): string {
  const id = `toast-${++nextId}`;
  toasts = [...toasts, { id, type, message, duration, createdAt: Date.now(), dismissing: false }];
  emit();
  return id;
}

function dismissToast(id: string): void {
  // Mark as dismissing first (triggers exit animation)
  toasts = toasts.map((t) => (t.id === id ? { ...t, dismissing: true } : t));
  emit();
  // Remove after animation completes
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, TOAST_DISMISS_ANIMATION_MS);
}

function dismissAll(): void {
  toasts = toasts.map((t) => ({ ...t, dismissing: true }));
  emit();
  setTimeout(() => {
    toasts = [];
    emit();
  }, TOAST_DISMISS_ANIMATION_MS);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ToastItem[] {
  return toasts;
}

// ---------------------------------------------------------------------------
// Public standalone API (mirrors sonner's toast.success / toast.error / etc.)
// ---------------------------------------------------------------------------

export const toast = {
  success: (message: string) => addToast('success', message),
  error: (message: string) => addToast('error', message, TOAST_ERROR_DURATION_MS),
  info: (message: string) => addToast('info', message),
  dismiss: () => dismissAll(),
};

// ---------------------------------------------------------------------------
// Hook (drop-in replacement for previous useToast)
// ---------------------------------------------------------------------------

const STABLE_TOAST_VALUE: ToastContextValue = {
  toast(type, message) {
    addToast(type, message, type === 'error' ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS);
  },
  success: (message: string) => {
    addToast('success', message);
  },
  error: (message: string) => {
    addToast('error', message, TOAST_ERROR_DURATION_MS);
  },
  info: (message: string) => {
    addToast('info', message);
  },
};

export function useToast(): ToastContextValue {
  return STABLE_TOAST_VALUE;
}

// ---------------------------------------------------------------------------
// Visual config per type
// ---------------------------------------------------------------------------

const typeConfig: Record<
  ToastType,
  {
    icon: typeof CheckCircle2;
    containerClass: string;
    iconClass: string;
    progressClass: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    containerClass: 'border-emerald-500/30 bg-card dark:bg-emerald-950/80',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    progressClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  error: {
    icon: XCircle,
    containerClass: 'border-red-500/30 bg-card dark:bg-red-950/80',
    iconClass: 'text-red-600 dark:text-red-400',
    progressClass: 'bg-red-500 dark:bg-red-400',
  },
  info: {
    icon: Info,
    containerClass: 'border-blue-500/30 bg-card dark:bg-blue-950/80',
    iconClass: 'text-blue-600 dark:text-blue-400',
    progressClass: 'bg-blue-500 dark:bg-blue-400',
  },
};

// ---------------------------------------------------------------------------
// Single toast component
// ---------------------------------------------------------------------------

function ToastCard({ item }: { item: ToastItem }) {
  const { icon: Icon, containerClass, iconClass, progressClass } = typeConfig[item.type];
  const progressRef = useRef<HTMLDivElement>(null);
  const isPaused = useRef(false);
  const remainingRef = useRef(item.duration);
  const startRef = useRef(Date.now());
  const rafRef = useRef<number>(0);

  // Auto-dismiss with pause-on-hover support
  useEffect(() => {
    if (item.dismissing) return;

    startRef.current = Date.now();

    function tick(): void {
      if (isPaused.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = Date.now() - startRef.current;
      const remaining = remainingRef.current - elapsed;
      if (remaining <= 0) {
        dismissToast(item.id);
        return;
      }
      // Update progress bar width
      const pct = (remaining / item.duration) * 100;
      if (progressRef.current) {
        progressRef.current.style.width = `${pct}%`;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [item.id, item.duration, item.dismissing]);

  const handleMouseEnter = useCallback(() => {
    // Snapshot how much time is left
    remainingRef.current = remainingRef.current - (Date.now() - startRef.current);
    isPaused.current = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    startRef.current = Date.now();
    isPaused.current = false;
  }, []);

  return (
    <div
      role="alert"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={[
        'pointer-events-auto relative flex w-80 items-start gap-3 overflow-hidden rounded-lg border p-4 shadow-lg backdrop-blur-sm',
        containerClass,
        item.dismissing ? 'animate-toast-out' : 'animate-toast-in',
      ].join(' ')}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <p className="flex-1 text-sm leading-snug text-foreground">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-0.5 w-full bg-border/50">
        <div
          ref={progressRef}
          className={`h-full transition-none ${progressClass}`}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container — renders the toast stack (mount once in providers)
// ---------------------------------------------------------------------------

export function ToastContainer() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (items.length === 0) return null;

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
