'use client';

import type React from 'react';
import { useCallback, useRef, useState } from 'react';

import { useToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import { useSteerAgent } from '../lib/queries';
import { IME_COMPOSITION_GUARD_MS } from '../lib/ui-constants';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SteerInputProps = {
  agentId: string;
  /** Whether the agent is currently running and can accept steering. */
  isRunning: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SteerInput({ agentId, isRunning }: SteerInputProps): React.JSX.Element {
  const [message, setMessage] = useState('');
  const toast = useToast();
  const steerAgent = useSteerAgent();
  const composingRef = useRef(false);
  const isSending = steerAgent.isPending;

  const handleSubmit = useCallback(() => {
    const text = message.trim();
    if (!text || isSending || !isRunning) return;

    const savedMessage = message;
    setMessage('');

    steerAgent.mutate(
      { agentId, message: text },
      {
        onSuccess: (data) => {
          if (!data.accepted) {
            toast.error(data.reason ?? 'Steering message was not accepted');
            setMessage(savedMessage);
          }
        },
        onError: (err) => {
          toast.error(err.message);
          setMessage(savedMessage);
        },
      },
    );
  }, [message, isSending, isRunning, agentId, steerAgent, toast]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!isRunning) {
    return (
      <div className="px-5 py-3 border-t border-border text-center text-xs text-muted-foreground bg-card">
        Agent is not running. Steering is only available for active sessions.
      </div>
    );
  }

  return (
    <section
      aria-label="Steering input area"
      className="px-5 py-3 border-t border-border bg-card shrink-0"
    >
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              setTimeout(() => {
                composingRef.current = false;
              }, IME_COMPOSITION_GUARD_MS);
            }}
            placeholder="Steer the agent: provide guidance or redirect..."
            rows={1}
            className="w-full px-3 py-2 bg-muted text-foreground border border-border rounded-md text-[13px] outline-none resize-none min-h-[36px] max-h-[120px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            disabled={isSending}
          />
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!message.trim() || isSending}
          className={cn(
            'px-4 py-2 rounded-md text-xs font-medium transition-colors',
            message.trim() && !isSending
              ? 'bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {isSending ? 'Sending...' : 'Steer'}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        Enter to send steering guidance · Shift+Enter for newline
      </div>
    </section>
  );
}
