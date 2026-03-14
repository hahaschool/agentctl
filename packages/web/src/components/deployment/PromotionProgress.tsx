'use client';

import { CheckCircle, Loader2, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types for SSE events
// ---------------------------------------------------------------------------

type PromotionStep = {
  name: string;
  status: 'running' | 'pass' | 'fail' | 'pending';
};

type PromotionLogLine = {
  timestamp: string;
  text: string;
};

// ---------------------------------------------------------------------------
// PromotionProgress
// ---------------------------------------------------------------------------

type PromotionProgressProps = {
  readonly promotionId: string;
  readonly onClose: () => void;
};

export function PromotionProgress({
  promotionId,
  onClose,
}: PromotionProgressProps): React.JSX.Element {
  const [steps, setSteps] = useState<PromotionStep[]>([]);
  const [logs, setLogs] = useState<PromotionLogLine[]>([]);
  const [completed, setCompleted] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll logs to bottom when new log entries arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs triggers scroll on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Connect to SSE stream
  useEffect(() => {
    const url = `/api/deployment/promote/${encodeURIComponent(promotionId)}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('step', (e: MessageEvent) => {
      try {
        const data = JSON.parse(String(e.data)) as PromotionStep;
        setSteps((prev) => {
          const existing = prev.findIndex((s) => s.name === data.name);
          if (existing >= 0) {
            return prev.map((s, i) => (i === existing ? data : s));
          }
          return [...prev, data];
        });
      } catch {
        // Ignore unparseable events
      }
    });

    es.addEventListener('log', (e: MessageEvent) => {
      try {
        const data = JSON.parse(String(e.data)) as PromotionLogLine;
        setLogs((prev) => [...prev, data]);
      } catch {
        // Ignore unparseable events
      }
    });

    es.addEventListener('complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(String(e.data)) as { success: boolean; error?: string };
        setCompleted(true);
        setSuccess(data.success);
        if (data.error) setError(data.error);
      } catch {
        setCompleted(true);
      }
      es.close();
    });

    es.onerror = () => {
      // If we haven't received a complete event, show an error
      setCompleted(true);
      setError('Lost connection to promotion stream');
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [promotionId]);

  const handleClose = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {!completed && <Loader2 size={14} className="text-blue-400 animate-spin" />}
            {completed && success && <CheckCircle size={14} className="text-green-400" />}
            {completed && !success && <XCircle size={14} className="text-red-400" />}
            <h3 className="text-sm font-semibold">
              {completed ? (success ? 'Promotion Complete' : 'Promotion Failed') : 'Promoting...'}
            </h3>
          </div>
          {completed && (
            <button
              type="button"
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Step indicators */}
        {steps.length > 0 && (
          <div className="px-4 py-2 border-b border-border/50 flex flex-wrap gap-x-4 gap-y-1">
            {steps.map((step) => (
              <div key={step.name} className="flex items-center gap-1.5">
                {step.status === 'running' && (
                  <Loader2 size={11} className="text-blue-400 animate-spin" />
                )}
                {step.status === 'pass' && <CheckCircle size={11} className="text-green-400" />}
                {step.status === 'fail' && <XCircle size={11} className="text-red-400" />}
                {step.status === 'pending' && (
                  <span className="w-[11px] h-[11px] rounded-full border border-muted-foreground/30" />
                )}
                <span
                  className={cn(
                    'text-[11px]',
                    step.status === 'running' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Log output */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[200px] max-h-[400px]">
          <div className="font-mono text-[11px] leading-relaxed space-y-0.5">
            {logs.map((line, i) => (
              <div key={`${line.timestamp}-${i}`} className="flex gap-2">
                <span className="text-muted-foreground/40 shrink-0 select-none">
                  {new Date(line.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-muted-foreground break-all">{line.text}</span>
              </div>
            ))}
            {logs.length === 0 && !completed && (
              <span className="text-muted-foreground/50">Waiting for logs...</span>
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Error footer */}
        {error && (
          <div className="px-4 py-2 border-t border-border bg-destructive/5 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Close button at the bottom when complete */}
        {completed && (
          <div className="px-4 py-3 border-t border-border flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
