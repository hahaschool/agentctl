'use client';

import { Send } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// EventComposer
// ---------------------------------------------------------------------------

export type EventComposerProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function EventComposer({
  onSend,
  disabled,
  placeholder = 'Type a message...',
}: EventComposerProps): React.JSX.Element {
  const [text, setText] = useState('');

  const handleSend = useCallback((): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-border px-3 py-2 bg-card">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 px-3 py-2 bg-muted text-foreground border border-border rounded-md text-xs outline-none resize-none min-h-[36px] max-h-[120px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:opacity-50"
          style={{
            height: 'auto',
            minHeight: '36px',
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
          }}
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="shrink-0"
          aria-label="Send message"
        >
          <Send size={14} />
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground/50 mt-1 px-1">
        Press Enter to send, Shift+Enter for newline
      </div>
    </div>
  );
}
