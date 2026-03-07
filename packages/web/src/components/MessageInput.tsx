'use client';

import { useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import type { Attachment, Session } from '../lib/api';
import { clipboardImageToAttachment, fileToAttachment } from '../lib/api';
import { formatFileSize } from '../lib/format-utils';
import { queryKeys, useResumeSession, useSendMessage } from '../lib/queries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { RESUME_MODEL_OPTIONS } from '../lib/model-options';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type MessageInputProps = {
  session: Session;
  onOptimisticSend?: (text: string) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageInput({ session, onOptimisticSend }: MessageInputProps): React.JSX.Element {
  const [message, setMessage] = useState('');
  const [resumeModel, setResumeModel] = useState('');
  const lostKey = `lost:${session.id}`;
  const [sessionLost, setSessionLost] = useState(() => sessionStorage.getItem(lostKey) === '1');
  const toast = useToast();
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();
  const resumeSession = useResumeSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draggingOver, setDraggingOver] = useState(false);

  // Draft persistence — survive page refreshes
  const storageKey = `draft:${session.id}`;

  // Load draft from sessionStorage on mount (or when session changes)
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) setMessage(saved);
  }, [storageKey]);

  // Save draft to sessionStorage on change (debounced 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (message) {
        sessionStorage.setItem(storageKey, message);
      } else {
        sessionStorage.removeItem(storageKey);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [message, storageKey]);

  const isActive = session.status === 'active';
  const isStarting = session.status === 'starting';
  const canResume =
    !sessionLost &&
    (session.status === 'ended' || session.status === 'paused' || session.status === 'error');
  const canSend = isActive || canResume;
  const isSending = sendMessage.isPending || resumeSession.isPending;

  /** Detect SESSION_LOST errors and persist the state. */
  const markSessionLost = useCallback(() => {
    setSessionLost(true);
    sessionStorage.setItem(lostKey, '1');
  }, [lostKey]);

  const isSessionLostError = useCallback((err: Error): boolean => {
    return err.message.includes('session was lost') || err.message.includes('SESSION_LOST');
  }, []);

  const handleSubmit = useCallback(() => {
    const text = message.trim();
    if (!text && attachments.length === 0) return;
    if (isSending) return;

    // Build final message with attachments
    let finalMessage = text;
    if (attachments.length > 0) {
      const attachmentDescriptions = attachments.map((a) => {
        if (a.type === 'image') {
          return `[Attached image: ${a.name} (${formatFileSize(a.size)})]`;
        }
        if (!a.isBase64 && a.content.length < 5000) {
          return `[Attached file: ${a.name}]\n\`\`\`\n${a.content}\n\`\`\``;
        }
        return `[Attached file: ${a.name} (${formatFileSize(a.size)})]`;
      });
      finalMessage = [text, ...attachmentDescriptions].filter(Boolean).join('\n\n');
    }

    if (!finalMessage.trim()) return;

    // Clear input immediately for instant feedback — restore on error
    const savedMessage = message;
    const savedAttachments = [...attachments];
    setMessage('');
    setAttachments([]);
    sessionStorage.removeItem(storageKey);

    // Show optimistic message immediately
    onOptimisticSend?.(finalMessage);

    const handleError = (err: Error): void => {
      if (isSessionLostError(err)) {
        markSessionLost();
      }
      toast.error(err.message);
      // Restore message so user doesn't lose their text
      setMessage(savedMessage);
      setAttachments(savedAttachments);
      // Refresh session data so the UI reflects any status change
      void queryClient.invalidateQueries({
        queryKey: queryKeys.session(session.id),
      });
    };

    const handleSuccess = (toastMsg?: string): void => {
      if (toastMsg) toast.success(toastMsg);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.session(session.id),
      });
      // Delay content invalidation to allow CLI time to write JSONL file to disk
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ['session-content'],
          exact: false,
        });
      }, 500);
    };

    if (isActive) {
      sendMessage.mutate(
        { id: session.id, message: finalMessage },
        { onSuccess: () => handleSuccess(), onError: handleError },
      );
    } else if (canResume) {
      resumeSession.mutate(
        { id: session.id, prompt: finalMessage, model: resumeModel || undefined },
        { onSuccess: () => handleSuccess('Session resumed'), onError: handleError },
      );
    }
  }, [
    message,
    attachments,
    isSending,
    isActive,
    canResume,
    session.id,
    storageKey,
    sendMessage,
    resumeSession,
    onOptimisticSend,
    isSessionLostError,
    markSessionLost,
    resumeModel,
    toast,
    queryClient,
  ]);

  // IME composition tracking — prevent Enter from submitting during Chinese/Japanese input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Skip if IME is composing (e.g. Chinese input confirming with Enter)
      if (e.nativeEvent.isComposing || composingRef.current) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Use Array.from — DataTransferItemList may not support for..of in all browsers
      const items = Array.from(e.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            try {
              const attachment = await clipboardImageToAttachment(blob);
              setAttachments((prev) => [...prev, attachment]);
              toast.success(`Image pasted: ${attachment.name}`);
            } catch {
              toast.error('Failed to read pasted image');
            }
          }
          return;
        }
      }
    },
    [toast],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 10 MB)`);
          continue;
        }
        try {
          const attachment = await fileToAttachment(file);
          setAttachments((prev) => [...prev, attachment]);
        } catch {
          toast.error(`Failed to read ${file.name}`);
        }
      }
      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    [toast],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDraggingOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 10 MB)`);
          continue;
        }
        try {
          const attachment = await fileToAttachment(file);
          setAttachments((prev) => [...prev, attachment]);
        } catch {
          toast.error(`Failed to read ${file.name}`);
        }
      }
    },
    [toast],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the container (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDraggingOver(false);
  }, []);

  if (sessionLost) {
    return (
      <div className="px-5 py-3 border-t border-border bg-card shrink-0">
        <div className="flex items-center gap-3 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
          <span className="text-yellow-500 text-sm font-medium">!</span>
          <div className="flex-1 text-xs text-muted-foreground">
            This session was lost due to a worker restart. You can fork this session or create a new
            one to continue.
          </div>
        </div>
      </div>
    );
  }

  if (isStarting) {
    return (
      <div className="px-5 py-3 border-t border-border text-center text-xs text-muted-foreground bg-card animate-pulse">
        Session is starting. Please wait...
      </div>
    );
  }

  if (!canSend) {
    return (
      <div className="px-5 py-3 border-t border-border text-center text-xs text-muted-foreground bg-card">
        Session is {session.status}. Cannot send messages.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'px-5 py-3 border-t border-border bg-card shrink-0 transition-colors',
        draggingOver && 'bg-primary/5 border-t-primary/40',
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop zone overlay */}
      {draggingOver && (
        <div className="mb-2 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-primary/40 rounded-md bg-primary/5 text-primary text-xs font-medium pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Drop files here
        </div>
      )}
      {canResume && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground">Model:</span>
          <select
            value={resumeModel}
            onChange={(e) => setResumeModel(e.target.value)}
            aria-label="Resume model"
            className="px-2 py-1 bg-muted text-foreground border border-border rounded-md text-[11px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            {RESUME_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground/60">
            Current: {session.model ?? 'default'}
          </span>
        </div>
      )}
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="relative group flex items-center gap-1.5 px-2 py-1 bg-muted border border-border rounded-md text-[11px]"
            >
              {a.type === 'image' && a.previewUrl ? (
                // biome-ignore lint/performance/noImgElement: dynamic blob URL preview, not suitable for next/image
                <img src={a.previewUrl} alt={a.name} className="w-8 h-8 object-cover rounded-sm" />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
              <span className="max-w-[120px] truncate">{a.name}</span>
              <span className="text-muted-foreground/60">{formatFileSize(a.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                aria-label={`Remove ${a.name}`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              // Delay clearing — in Chromium, compositionend fires BEFORE the
              // Enter keydown that confirmed the IME selection, so the ref must
              // still be true when keydown runs in the same event loop turn.
              setTimeout(() => {
                composingRef.current = false;
              }, 0);
            }}
            onPaste={handlePaste}
            placeholder={
              isActive
                ? 'Send a message... (paste images with Ctrl+V)'
                : 'Resume session with a prompt...'
            }
            rows={1}
            className="w-full px-3 py-2 pr-9 bg-muted text-foreground border border-border rounded-md text-[13px] outline-none resize-none min-h-[36px] max-h-[120px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            disabled={isSending}
          />
          {/* Upload button inside textarea */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute right-2 bottom-1.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            aria-label="Attach file"
            title="Attach file (or drag &amp; drop)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.ts,.tsx,.js,.jsx,.json,.md,.py,.sh,.yaml,.yml,.toml,.csv,.sql,.html,.css,.xml"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={(!message.trim() && attachments.length === 0) || isSending}
          className={cn(
            'px-4 py-2 rounded-md text-xs font-medium transition-colors',
            (message.trim() || attachments.length > 0) && !isSending
              ? 'bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {isSending ? 'Sending...' : canResume ? 'Resume' : 'Send'}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        Enter to send · Shift+Enter for newline · {'\u2318'}V paste images · Drag &amp; drop files
      </div>
    </div>
  );
}
