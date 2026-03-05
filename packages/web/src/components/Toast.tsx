'use client';

import { toast as sonnerToast } from 'sonner';

type ToastContextValue = {
  toast: (type: 'success' | 'error' | 'info', message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

/**
 * Drop-in replacement for the old ToastProvider context.
 * Delegates to Sonner — no context provider needed.
 */
export function useToast(): ToastContextValue {
  return {
    toast(type, message) {
      if (type === 'success') sonnerToast.success(message);
      else if (type === 'error') sonnerToast.error(message);
      else sonnerToast.info(message);
    },
    success: (message: string) => sonnerToast.success(message),
    error: (message: string) => sonnerToast.error(message),
    info: (message: string) => sonnerToast.info(message),
  };
}
