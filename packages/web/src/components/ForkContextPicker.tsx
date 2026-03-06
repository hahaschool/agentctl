'use client';

import { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { Session, SessionContentMessage } from '@/lib/api';
import { getMessageStyle } from '@/lib/message-styles';

const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

const AGENT_TYPES = [
  { value: 'adhoc', label: 'Ad-hoc', desc: 'One-shot task' },
  { value: 'manual', label: 'Manual', desc: 'Started/stopped manually' },
  { value: 'loop', label: 'Loop', desc: 'Runs in a loop' },
  { value: 'autonomous', label: 'Autonomous', desc: 'Long-running agent' },
];

type ForkContextPickerProps = {
  session: Session;
  messages: SessionContentMessage[];
  open: boolean;
  onClose: () => void;
  onSubmit: (config: {
    name: string;
    type: string;
    model?: string;
    systemPrompt?: string;
    selectedMessageIds: number[];
  }) => void;
  isSubmitting?: boolean;
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function formatCharCount(count: number): string {
  if (count >= 1000) {
    return `~${(count / 1000).toFixed(1)}k`;
  }
  return `${count}`;
}

export function ForkContextPicker({
  session,
  messages,
  open,
  onClose,
  onSubmit,
  isSubmitting = false,
}: ForkContextPickerProps): React.ReactNode {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(messages.map((_, i) => i)));
  const [name, setName] = useState(`${session.agentName ?? 'agent'}-fork`);
  const [type, setType] = useState('adhoc');
  const [model, setModel] = useState(session.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState('');

  const toggleId = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(messages.map((_, i) => i)));
  }, [messages]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const contextStats = useMemo(() => {
    let totalChars = 0;
    let count = 0;
    for (const id of selectedIds) {
      const msg = messages[id];
      if (msg) {
        totalChars += msg.content.length;
        count++;
      }
    }
    return { count, totalChars };
  }, [selectedIds, messages]);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      type,
      model: model || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      selectedMessageIds: Array.from(selectedIds).sort((a, b) => a - b),
    });
  }, [name, type, model, systemPrompt, selectedIds, onSubmit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close dialog"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] bg-card border border-border rounded-md shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Create Agent from Session</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Select messages to include as context for the new agent
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-sm hover:bg-muted transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body — two-column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Message list */}
          <div className="flex-1 flex flex-col border-r border-border min-w-0">
            {/* Bulk actions */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20">
              <span className="text-[11px] text-muted-foreground mr-auto">
                {messages.length} messages
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="px-2 py-0.5 text-[10px] text-blue-400 hover:text-blue-300 border border-blue-800/50 rounded-sm hover:bg-blue-900/30 cursor-pointer transition-colors"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded-sm hover:bg-muted cursor-pointer transition-colors"
              >
                Deselect All
              </button>
            </div>

            {/* Scrollable message list */}
            <div className="flex-1 overflow-y-auto px-2 py-1.5">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                  No messages in this session
                </div>
              )}
              {messages.map((msg, idx) => {
                const style = getMessageStyle(msg.type);
                const checked = selectedIds.has(idx);
                return (
                  <label
                    key={idx}
                    className={cn(
                      'flex items-start gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer transition-colors border-l-2',
                      checked
                        ? 'bg-muted/50 border-l-blue-500'
                        : 'border-l-transparent hover:bg-muted/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(idx)}
                      className="mt-0.5 accent-blue-500 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={cn('text-[10px] font-medium', style.textClass)}>
                          {style.label}
                        </span>
                        {msg.toolName && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {msg.toolName}
                          </span>
                        )}
                        {msg.timestamp && (
                          <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
                        {truncate(msg.content, 120)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Right: Configuration form */}
          <div className="w-80 shrink-0 flex flex-col overflow-y-auto">
            <div className="p-4 space-y-3.5">
              {/* Agent Name */}
              <div>
                <label htmlFor="fork-name" className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Agent Name
                </label>
                <input
                  id="fork-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-agent"
                  className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none focus:border-blue-600 transition-colors"
                />
              </div>

              {/* Agent Type */}
              <div>
                <label htmlFor="fork-type" className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Agent Type
                </label>
                <select
                  id="fork-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none focus:border-blue-600 transition-colors"
                >
                  {AGENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} -- {t.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model */}
              <div>
                <label htmlFor="fork-model" className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Model
                </label>
                <select
                  id="fork-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none focus:border-blue-600 transition-colors"
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* System Prompt */}
              <div>
                <label htmlFor="fork-prompt" className="block text-[11px] font-medium text-muted-foreground mb-1">
                  System Prompt (optional)
                </label>
                <textarea
                  id="fork-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Additional instructions for the agent..."
                  rows={6}
                  className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-sm text-xs outline-none focus:border-blue-600 transition-colors resize-y leading-relaxed"
                />
              </div>

              {/* Source session info */}
              <div className="pt-2 border-t border-border">
                <p className="text-[10px] text-muted-foreground/60 mb-1">Source Session</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {session.id.slice(0, 16)}...
                </p>
                {session.agentName && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Agent: {session.agentName}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/20">
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{contextStats.count}</span>
            {' '}message{contextStats.count !== 1 ? 's' : ''} selected
            <span className="mx-1.5 text-border">|</span>
            <span className="font-medium text-foreground">{formatCharCount(contextStats.totalChars)}</span>
            {' '}chars
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-sm hover:bg-muted cursor-pointer disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!name.trim() || contextStats.count === 0 || isSubmitting}
              className="px-3.5 py-1.5 text-xs text-white bg-blue-700 hover:bg-blue-600 rounded-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
