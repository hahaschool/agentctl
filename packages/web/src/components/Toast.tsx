import type React from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const TOAST_DURATION = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  const contextValue: ToastContextValue = {
    toast: addToast,
    success: useCallback((msg: string) => addToast('success', msg), [addToast]),
    error: useCallback((msg: string) => addToast('error', msg), [addToast]),
    info: useCallback((msg: string) => addToast('info', msg), [addToast]),
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Toast container */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          {toasts.map((t) => (
            <ToastItem
              key={t.id}
              toast={t}
              onDismiss={() => {
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
              }}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Toast item
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<ToastType, { bg: string; border: string; color: string; icon: string }> =
  {
    success: {
      bg: '#14532d',
      border: '#166534',
      color: '#86efac',
      icon: '\u2713',
    },
    error: {
      bg: '#7f1d1d',
      border: '#991b1b',
      color: '#fca5a5',
      icon: '\u2717',
    },
    info: {
      bg: '#1e3a5f',
      border: '#1d4ed8',
      color: '#93c5fd',
      icon: '\u2139',
    },
  };

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}): React.JSX.Element {
  const cfg = TYPE_CONFIG[toast.type];

  return (
    <div
      style={{
        padding: '10px 16px',
        backgroundColor: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 'var(--radius)',
        color: cfg.color,
        fontSize: 13,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 280,
        maxWidth: 420,
        boxShadow: 'var(--shadow-lg)',
        animation: 'fadeInUp 0.2s ease',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{cfg.icon}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: cfg.color,
          fontSize: 14,
          cursor: 'pointer',
          padding: '0 2px',
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        x
      </button>
    </div>
  );
}
