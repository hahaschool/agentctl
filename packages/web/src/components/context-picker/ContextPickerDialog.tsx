'use client';

import type { MemoryFact, MemoryObservation } from '@agentctl/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Session, type SessionContentMessage } from '@/lib/api';
import type { AgentRuntime } from '@/lib/model-options';
import { AGENT_RUNTIMES, FORK_AGENT_TYPES, MODEL_OPTIONS_WITH_DEFAULT } from '@/lib/model-options';
import { cn } from '@/lib/utils';

import { ContextMessageRow } from './ContextMessageRow';
import { ContextPickerToolbar } from './ContextPickerToolbar';
import { ContextSummaryBar } from './ContextSummaryBar';
import { ForkConfigPanel } from './ForkConfigPanel';
import {
  MemoryPanel,
  matchFactToMessages,
  matchObservationToMessages,
  UnifiedMemoryPanel,
} from './MemoryPanel';
import { buildPromptPreview, PromptPreview } from './PromptPreview';
import { findByTopicIndices, findKeyDecisionIndices } from './SmartSelectTools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ForkSubmitConfig = {
  prompt: string;
  model?: string;
  runtime: AgentRuntime;
  strategy: 'jsonl-truncation' | 'context-injection' | 'resume';
  forkAtIndex?: number;
  selectedMessages?: SessionContentMessage[];
};

export type CreateAgentSubmitConfig = {
  name: string;
  type: string;
  runtime: AgentRuntime;
  model?: string;
  systemPrompt?: string;
  selectedMessageIds: number[];
};

export type ContextPickerDialogProps = {
  defaultTab?: 'fork' | 'agent';
  session: Session;
  messages: SessionContentMessage[];
  open: boolean;
  onClose: () => void;
  onForkSubmit?: (config: ForkSubmitConfig) => void;
  onCreateAgentSubmit?: (config: CreateAgentSubmitConfig) => void;
  isSubmitting?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESTIMATED_ROW_HEIGHT = 56;
const VIRTUALIZER_OVERSCAN = 20;
const CHARS_PER_TOKEN = 3.5;
const COLLAPSED_THINKING_CHARS = 30;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContextPickerDialog({
  defaultTab = 'fork',
  session,
  messages,
  open,
  onClose,
  onForkSubmit,
  onCreateAgentSubmit,
  isSubmitting = false,
}: ContextPickerDialogProps): React.ReactNode {
  // -------------------------------------------------------------------------
  // State — shared
  // -------------------------------------------------------------------------

  const [activeTab, setActiveTab] = useState<'fork' | 'agent'>(defaultTab ?? 'fork');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(messages.map((_, i) => i)),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [hideToolResults, setHideToolResults] = useState(false);
  const [collapseThinking, setCollapseThinking] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(true);

  // -------------------------------------------------------------------------
  // State — fork mode
  // -------------------------------------------------------------------------

  const [forkPrompt, setForkPrompt] = useState('');
  const [forkModel, setForkModel] = useState(session.model ?? '');
  const [forkRuntime, setForkRuntime] = useState<AgentRuntime>('claude-code');

  // -------------------------------------------------------------------------
  // State — create-agent mode
  // -------------------------------------------------------------------------

  const [agentName, setAgentName] = useState(`${session.agentName ?? 'agent'}-fork`);
  const [agentType, setAgentType] = useState('adhoc');
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntime>('claude-code');
  const [agentModel, setAgentModel] = useState(session.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [debouncedMemoryQuery, setDebouncedMemoryQuery] = useState('');
  const [timelineObservations, setTimelineObservations] = useState<MemoryObservation[]>([]);
  const [searchObservations, setSearchObservations] = useState<MemoryObservation[]>([]);
  const [unifiedFacts, setUnifiedFacts] = useState<MemoryFact[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [selectedObservationId, setSelectedObservationId] = useState<number | undefined>();
  const [selectedFactId, setSelectedFactId] = useState<string | undefined>();

  useEffect(() => {
    if (!open) {
      setMemoryQuery('');
      setDebouncedMemoryQuery('');
      setSelectedObservationId(undefined);
      setSelectedFactId(undefined);
      setSearchObservations([]);
      setUnifiedFacts([]);
      setMemoryLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedMemoryQuery(memoryQuery.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [open, memoryQuery]);

  useEffect(() => {
    if (!open || debouncedMemoryQuery.length >= 2) {
      return;
    }
    if (!session.claudeSessionId) {
      setTimelineObservations([]);
      return;
    }

    let cancelled = false;
    setMemoryLoading(true);

    api
      .getMemoryTimeline(session.claudeSessionId, 30)
      .then((res) => {
        if (!cancelled) setTimelineObservations(res.observations ?? []);
      })
      .catch(() => {
        if (!cancelled) setTimelineObservations([]);
      })
      .finally(() => {
        if (!cancelled) setMemoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, session.claudeSessionId, debouncedMemoryQuery]);

  useEffect(() => {
    if (!open || debouncedMemoryQuery.length < 2) {
      setSearchObservations([]);
      setUnifiedFacts([]);
      return;
    }

    let cancelled = false;
    setMemoryLoading(true);

    // Run legacy claude-mem search and unified memory search in parallel
    Promise.allSettled([
      api.searchMemory({
        q: debouncedMemoryQuery,
        ...(session.projectPath ? { project: session.projectPath } : {}),
        limit: 20,
      }),
      api.searchMemoryFacts({
        q: debouncedMemoryQuery,
        ...(session.agentId ? { agentId: session.agentId } : {}),
        limit: 20,
      }),
    ])
      .then(([legacyResult, unifiedResult]) => {
        if (cancelled) return;
        if (legacyResult.status === 'fulfilled') {
          setSearchObservations(legacyResult.value.observations ?? []);
        } else {
          setSearchObservations([]);
        }
        if (unifiedResult.status === 'fulfilled') {
          setUnifiedFacts(unifiedResult.value.facts ?? []);
        } else {
          setUnifiedFacts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setMemoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, debouncedMemoryQuery, session.projectPath, session.agentId]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const filteredMessages = useMemo(() => {
    return messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => {
        if (filterType !== 'all' && msg.type !== filterType) return false;
        if (searchQuery && !msg.content.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
        return true;
      });
  }, [messages, filterType, searchQuery]);

  const detectedStrategy = useMemo((): 'jsonl-truncation' | 'context-injection' | 'resume' => {
    const sortedIds = Array.from(selectedIds).sort((a, b) => a - b);
    if (sortedIds.length === messages.length) return 'resume';
    const isContiguousFromStart = sortedIds.length > 0 && sortedIds.every((id, i) => id === i);
    return isContiguousFromStart ? 'jsonl-truncation' : 'context-injection';
  }, [selectedIds, messages.length]);

  const estimatedTokens = useMemo(() => {
    let totalChars = 0;
    for (const id of selectedIds) {
      const msg = messages[id];
      if (!msg) continue;
      if (hideToolResults && msg.type === 'tool_result') continue;
      if (collapseThinking && msg.type === 'thinking') {
        totalChars += COLLAPSED_THINKING_CHARS;
        continue;
      }
      totalChars += msg.content.length;
    }
    return Math.round(totalChars / CHARS_PER_TOKEN);
  }, [selectedIds, messages, hideToolResults, collapseThinking]);

  const memoryObservations = useMemo(
    () => (debouncedMemoryQuery.length >= 2 ? searchObservations : timelineObservations),
    [debouncedMemoryQuery, searchObservations, timelineObservations],
  );

  // -------------------------------------------------------------------------
  // Virtualizer
  // -------------------------------------------------------------------------

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: VIRTUALIZER_OVERSCAN,
  });

  // -------------------------------------------------------------------------
  // Selection callbacks
  // -------------------------------------------------------------------------

  const handleToggle = useCallback((index: number) => {
    setLastClickedIndex(index);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleShiftClick = useCallback(
    (index: number) => {
      if (lastClickedIndex === null) {
        handleToggle(index);
        return;
      }
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(i);
        return next;
      });
    },
    [lastClickedIndex, handleToggle],
  );

  const handleForkHere = useCallback((index: number) => {
    setSelectedIds(new Set(Array.from({ length: index + 1 }, (_, i) => i)));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(messages.map((_, i) => i)));
  }, [messages]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleInvert = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set<number>();
      for (let i = 0; i < messages.length; i++) {
        if (!prev.has(i)) next.add(i);
      }
      return next;
    });
  }, [messages.length]);

  const handleSelectKeyDecisions = useCallback(() => {
    const indices = findKeyDecisionIndices(messages);
    if (indices.length > 0) {
      setSelectedIds(new Set(indices));
    }
  }, [messages]);

  const handleSelectByTopic = useCallback(
    (topic: string) => {
      const indices = findByTopicIndices(messages, topic);
      if (indices.length > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const i of indices) next.add(i);
          return next;
        });
      }
    },
    [messages],
  );

  const handleSelectRelated = useCallback((indices: number[]) => {
    setSelectedIds(new Set(indices));
  }, []);

  const handleSelectObservation = useCallback(
    (observation: MemoryObservation) => {
      setSelectedObservationId(observation.id);
      setSelectedFactId(undefined);
      const matches = matchObservationToMessages(observation, messages);
      if (matches.length === 0) return;

      setFilterType('all');
      setSearchQuery('');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const index of matches) next.add(index);
        return next;
      });

      const firstMatch = matches[0];
      window.setTimeout(() => {
        const row = document.getElementById(`cpd-row-${String(firstMatch)}`);
        row?.scrollIntoView({ block: 'center' });
      }, 0);
    },
    [messages],
  );

  const handleSelectFact = useCallback(
    (fact: MemoryFact) => {
      setSelectedFactId(fact.id);
      setSelectedObservationId(undefined);
      const matches = matchFactToMessages(fact, messages);
      if (matches.length === 0) return;

      setFilterType('all');
      setSearchQuery('');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const index of matches) next.add(index);
        return next;
      });

      const firstMatch = matches[0];
      window.setTimeout(() => {
        const row = document.getElementById(`cpd-row-${String(firstMatch)}`);
        row?.scrollIntoView({ block: 'center' });
      }, 0);
    },
    [messages],
  );

  // -------------------------------------------------------------------------
  // Submit handlers
  // -------------------------------------------------------------------------

  const handleForkSubmit = useCallback(() => {
    if (!forkPrompt.trim()) return;
    const sortedIds = Array.from(selectedIds).sort((a, b) => a - b);
    onForkSubmit?.({
      prompt: forkPrompt.trim(),
      model: forkModel || undefined,
      runtime: forkRuntime,
      strategy: detectedStrategy,
      forkAtIndex:
        detectedStrategy === 'jsonl-truncation' ? sortedIds[sortedIds.length - 1] : undefined,
      selectedMessages:
        detectedStrategy === 'context-injection'
          ? (sortedIds
              .map((i) => messages[i])
              .filter((m): m is SessionContentMessage => m != null) as SessionContentMessage[])
          : undefined,
    });
  }, [forkPrompt, forkModel, forkRuntime, selectedIds, detectedStrategy, messages, onForkSubmit]);

  const handleCreateAgentSubmit = useCallback(() => {
    if (!agentName.trim()) return;
    onCreateAgentSubmit?.({
      name: agentName.trim(),
      type: agentType,
      runtime: agentRuntime,
      model: agentModel || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      selectedMessageIds: Array.from(selectedIds).sort((a, b) => a - b),
    });
  }, [
    agentName,
    agentType,
    agentRuntime,
    agentModel,
    systemPrompt,
    selectedIds,
    onCreateAgentSubmit,
  ]);

  // -------------------------------------------------------------------------
  // Derived UI values (must be before early return to keep hook count stable)
  // -------------------------------------------------------------------------

  const previewText = useMemo(() => {
    const sortedIds = Array.from(selectedIds).sort((a, b) => a - b);
    return buildPromptPreview({
      strategy: detectedStrategy,
      forkPrompt: activeTab === 'fork' ? forkPrompt : systemPrompt,
      forkAtIndex:
        detectedStrategy === 'jsonl-truncation' ? sortedIds[sortedIds.length - 1] : undefined,
      selectedMessages:
        detectedStrategy === 'context-injection'
          ? sortedIds
              .map((i) => messages[i])
              .filter((m): m is SessionContentMessage => m != null)
              .map((m) => ({ type: m.type, content: m.content }))
          : [],
      systemPrompt: activeTab === 'agent' ? systemPrompt : undefined,
    });
  }, [selectedIds, detectedStrategy, activeTab, forkPrompt, systemPrompt, messages]);

  // -------------------------------------------------------------------------
  // Early return
  // -------------------------------------------------------------------------

  if (!open) return null;

  const title = activeTab === 'fork' ? 'Fork Session' : 'Create Agent from Session';
  const subtitle =
    activeTab === 'fork'
      ? 'Select messages and configure the fork'
      : 'Select messages to include as context for the new agent';

  const canSubmitFork = forkPrompt.trim().length > 0 && !isSubmitting;
  const canSubmitAgent = agentName.trim().length > 0 && !isSubmitting;

  const submitLabel =
    activeTab === 'fork'
      ? isSubmitting
        ? 'Forking...'
        : 'Fork Session'
      : isSubmitting
        ? 'Creating...'
        : 'Create Agent';

  const handleSubmit = activeTab === 'fork' ? handleForkSubmit : handleCreateAgentSubmit;
  const canSubmit = activeTab === 'fork' ? canSubmitFork : canSubmitAgent;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm border-none p-0 cursor-default"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        tabIndex={-1}
        aria-label="Close dialog"
      />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-4xl max-h-[85vh] bg-card border border-border rounded-md shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-label={title}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M1 1L13 13M1 13L13 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body — two-column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Toolbar + virtualized list + summary bar */}
          <div className="flex-1 flex flex-col border-r border-border min-w-0">
            <ContextPickerToolbar
              totalMessages={messages.length}
              selectedCount={selectedIds.size}
              estimatedTokens={estimatedTokens}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              memoryQuery={memoryQuery}
              onMemoryQueryChange={setMemoryQuery}
              filterType={filterType}
              onFilterChange={setFilterType}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onInvert={handleInvert}
              onSelectKeyDecisions={handleSelectKeyDecisions}
              onSelectByTopic={handleSelectByTopic}
              onSelectRelated={handleSelectRelated}
              allMessages={messages}
              selectedIndices={selectedIds}
            />

            <div className="border-b border-border bg-purple-500/[0.03]">
              <div className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground">
                {debouncedMemoryQuery.length >= 2 ? 'Memory Search Results' : 'Session Memories'}
              </div>
              {debouncedMemoryQuery.length >= 2 && unifiedFacts.length > 0 ? (
                <UnifiedMemoryPanel
                  facts={unifiedFacts}
                  isLoading={memoryLoading}
                  onSelectFact={handleSelectFact}
                  selectedFactId={selectedFactId}
                  label="Searching unified memory..."
                />
              ) : (
                <MemoryPanel
                  observations={memoryObservations}
                  isLoading={memoryLoading}
                  onSelectObservation={handleSelectObservation}
                  selectedObservationId={selectedObservationId}
                />
              )}
            </div>

            {/* Virtualized message list */}
            <div
              ref={parentRef}
              className="flex-1 overflow-y-auto px-2 py-1.5"
              data-testid="message-list-scroll"
            >
              {filteredMessages.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                  {messages.length === 0
                    ? 'No messages in this session'
                    : 'No messages match the current filter'}
                </div>
              ) : (
                <div
                  style={{
                    height: `${String(virtualizer.getTotalSize())}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualItem) => {
                    const item = filteredMessages[virtualItem.index];
                    if (!item) return null;
                    const { msg, idx } = item;
                    return (
                      <div
                        key={`vrow-${String(idx)}`}
                        id={`cpd-row-${String(idx)}`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${String(virtualItem.start)}px)`,
                        }}
                      >
                        <ContextMessageRow
                          message={msg}
                          index={idx}
                          checked={selectedIds.has(idx)}
                          onToggle={handleToggle}
                          onForkHere={handleForkHere}
                          onShiftClick={handleShiftClick}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <ContextSummaryBar
              selectedCount={selectedIds.size}
              estimatedTokens={estimatedTokens}
              hideToolResults={hideToolResults}
              collapseThinking={collapseThinking}
              onToggleHideToolResults={() => setHideToolResults((v) => !v)}
              onToggleCollapseThinking={() => setCollapseThinking((v) => !v)}
            />

            <PromptPreview
              previewText={previewText}
              collapsed={previewCollapsed}
              onToggle={() => setPreviewCollapsed((v) => !v)}
            />
          </div>

          {/* Right panel */}
          <div className="w-full sm:w-80 shrink-0 flex flex-col overflow-hidden">
            {/* Tab toggle */}
            <div
              role="tablist"
              aria-label="Context picker mode"
              className="flex border-b border-border shrink-0"
            >
              <button
                id="cpd-tab-fork"
                role="tab"
                type="button"
                aria-selected={activeTab === 'fork'}
                aria-controls="cpd-tabpanel-fork"
                onClick={() => setActiveTab('fork')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors cursor-pointer',
                  activeTab === 'fork'
                    ? 'text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Quick Fork
              </button>
              <button
                id="cpd-tab-agent"
                role="tab"
                type="button"
                aria-selected={activeTab === 'agent'}
                aria-controls="cpd-tabpanel-agent"
                onClick={() => setActiveTab('agent')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium transition-colors cursor-pointer',
                  activeTab === 'agent'
                    ? 'text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Create as Agent
              </button>
            </div>

            {/* Tab content */}
            {activeTab === 'fork' ? (
              <div
                id="cpd-tabpanel-fork"
                role="tabpanel"
                aria-labelledby="cpd-tab-fork"
                className="flex flex-col flex-1 min-h-0 overflow-hidden"
              >
                <ForkConfigPanel
                  session={session}
                  forkPrompt={forkPrompt}
                  onForkPromptChange={setForkPrompt}
                  model={forkModel}
                  onModelChange={setForkModel}
                  runtime={forkRuntime}
                  onRuntimeChange={setForkRuntime}
                  detectedStrategy={detectedStrategy}
                  isSubmitting={isSubmitting}
                  onSubmit={handleForkSubmit}
                />
              </div>
            ) : (
              <div
                id="cpd-tabpanel-agent"
                role="tabpanel"
                aria-labelledby="cpd-tab-agent"
                className="p-4 space-y-3.5 overflow-y-auto"
              >
                {/* Agent Name */}
                <div>
                  <label
                    htmlFor="cpd-agent-name"
                    className="block text-[11px] font-medium text-muted-foreground mb-1"
                  >
                    Agent Name
                  </label>
                  <input
                    id="cpd-agent-name"
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="my-agent"
                    className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
                  />
                </div>

                {/* Agent Type */}
                <div>
                  <label
                    htmlFor="cpd-agent-type"
                    className="block text-[11px] font-medium text-muted-foreground mb-1"
                  >
                    Agent Type
                  </label>
                  <select
                    id="cpd-agent-type"
                    value={agentType}
                    onChange={(e) => setAgentType(e.target.value)}
                    aria-label="Agent type"
                    className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
                  >
                    {FORK_AGENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} -- {t.desc}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Agent Runtime */}
                <div>
                  <label
                    htmlFor="cpd-agent-runtime"
                    className="block text-[11px] font-medium text-muted-foreground mb-1"
                  >
                    Runtime
                  </label>
                  <select
                    id="cpd-agent-runtime"
                    value={agentRuntime}
                    onChange={(e) => setAgentRuntime(e.target.value as AgentRuntime)}
                    aria-label="Agent runtime"
                    className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
                  >
                    {AGENT_RUNTIMES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label} — {r.desc}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model */}
                <div>
                  <label
                    htmlFor="cpd-agent-model"
                    className="block text-[11px] font-medium text-muted-foreground mb-1"
                  >
                    Model
                  </label>
                  <select
                    id="cpd-agent-model"
                    value={agentModel}
                    onChange={(e) => setAgentModel(e.target.value)}
                    aria-label="Agent model"
                    className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
                  >
                    {MODEL_OPTIONS_WITH_DEFAULT.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* System Prompt */}
                <div>
                  <label
                    htmlFor="cpd-system-prompt"
                    className="block text-[11px] font-medium text-muted-foreground mb-1"
                  >
                    System Prompt (optional)
                  </label>
                  <textarea
                    id="cpd-system-prompt"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Additional instructions for the agent..."
                    rows={6}
                    aria-label="System prompt"
                    className="w-full px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors resize-y leading-relaxed"
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
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted cursor-pointer disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-3.5 py-1.5 text-xs text-white bg-blue-700 hover:bg-blue-600 rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
