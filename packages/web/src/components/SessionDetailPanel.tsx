'use client';

import Link from 'next/link';
import type React from 'react';
import { cn } from '@/lib/utils';
import type { ApiAccount, Session } from '../lib/api';
import { formatCost, formatDateTime, formatDuration } from '../lib/format-utils';
import { MODEL_OPTIONS_WITH_DEFAULT as MODEL_OPTIONS } from '../lib/model-options';
import { ConfirmButton } from './ConfirmButton';
import { ConvertToAgentForm } from './ConvertToAgentForm';
import { CopyableText } from './CopyableText';
import type { ContextPickerDialogProps } from './context-picker';
import { DetailRow } from './DetailRow';
import { GitStatusBadge } from './GitStatusBadge';
import { SessionContent } from './SessionContent';
import { StatusBadge } from './StatusBadge';

type SessionDetailPanelProps = {
  session: Session;
  accounts: ApiAccount[];
  prompt: string;
  onPromptChange: (value: string) => void;
  resumeModel: string;
  onResumeModelChange: (value: string) => void;
  sending: boolean;
  lastSentMessage: { text: string; ts: number } | null;
  showConvertDialog: boolean;
  convertName: string;
  onConvertNameChange: (name: string) => void;
  convertType: string;
  onConvertTypeChange: (type: string) => void;
  createAgentPending: boolean;
  forkPickerLoading: boolean;
  stopping: boolean;
  onBack: () => void;
  onSend: () => void;
  onStop: () => void;
  onConvertToAgent: () => void;
  onOpenConvertDialog: () => void;
  onCloseConvertDialog: () => void;
  onOpenForkPicker: (defaultTab?: ContextPickerDialogProps['defaultTab']) => void;
};

function inferRuntimeLabel(session: Session): 'Claude' | 'Codex' {
  const metadataRuntime =
    typeof session.metadata?.runtime === 'string' ? session.metadata.runtime.toLowerCase() : '';
  if (metadataRuntime.includes('codex')) return 'Codex';
  if (metadataRuntime.includes('claude')) return 'Claude';

  const model = (
    session.model ?? (typeof session.metadata?.model === 'string' ? session.metadata.model : '')
  ).toLowerCase();
  if (model.includes('codex') || model.startsWith('gpt-')) return 'Codex';
  return 'Claude';
}

export function SessionDetailPanel({
  session: selected,
  accounts,
  prompt,
  onPromptChange,
  resumeModel,
  onResumeModelChange,
  sending,
  lastSentMessage,
  showConvertDialog,
  convertName,
  onConvertNameChange,
  convertType,
  onConvertTypeChange,
  createAgentPending,
  forkPickerLoading,
  stopping,
  onBack,
  onSend,
  onStop,
  onConvertToAgent,
  onOpenConvertDialog,
  onCloseConvertDialog,
  onOpenForkPicker,
}: SessionDetailPanelProps): React.JSX.Element {
  const agentLabel = selected.agentName ? selected.agentName : selected.agentId.slice(0, 8);
  const runtimeLabel = inferRuntimeLabel(selected);
  const modelLabel =
    selected.model ??
    (typeof selected.metadata?.model === 'string' ? selected.metadata.model : 'default');
  const durationLabel = formatDuration(selected.startedAt, selected.endedAt);
  const costLabel = formatCost(
    typeof selected.metadata?.costUsd === 'number' ? selected.metadata.costUsd : 0,
  );
  const canResumeQuickAction =
    selected.status === 'ended' || selected.status === 'error' || selected.status === 'paused';

  return (
    <>
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Mobile back button */}
            <button
              type="button"
              onClick={onBack}
              className="md:hidden text-muted-foreground text-sm shrink-0 hover:text-foreground transition-colors duration-200"
              aria-label="Back to session list"
            >
              {'\u2190'}
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{agentLabel}</div>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <StatusBadge status={selected.status} />
                <span
                  className={cn(
                    'inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium',
                    runtimeLabel === 'Codex'
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                      : 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300',
                  )}
                >
                  {runtimeLabel}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-border bg-muted px-2 text-[11px] font-mono text-foreground/80">
                  {modelLabel}
                </span>
                <CopyableText
                  value={selected.id}
                  maxDisplay={16}
                  className="font-mono text-[11px] text-muted-foreground"
                />
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground flex gap-2 flex-wrap items-center">
                <span>{durationLabel}</span>
                <span className="text-muted-foreground/40">&#x2022;</span>
                <span>{costLabel}</span>
                <span className="text-muted-foreground/40">&#x2022;</span>
                <span>{selected.machineId}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center shrink-0 flex-wrap">
          <Link
            href={`/sessions/${selected.id}`}
            className="h-8 px-3.5 bg-muted text-foreground border border-border rounded-md text-xs font-medium no-underline transition-all duration-200 hover:bg-accent hover:text-foreground inline-flex items-center"
          >
            Open Full View
          </Link>
          {selected.claudeSessionId && (
            <button
              type="button"
              onClick={() => onOpenForkPicker('fork')}
              disabled={forkPickerLoading}
              className="h-8 px-3.5 bg-blue-100/50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300/40 dark:border-blue-800/40 rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-blue-200/70 dark:hover:bg-blue-900/70 disabled:opacity-50"
              title="Fork this session with context picker"
            >
              {forkPickerLoading ? 'Loading...' : 'Fork'}
            </button>
          )}
          {canResumeQuickAction && (
            <button
              type="button"
              onClick={onSend}
              aria-label="Quick resume session"
              disabled={sending || !prompt.trim()}
              className={cn(
                'h-8 px-3.5 rounded-md text-xs font-medium transition-all duration-200',
                sending || !prompt.trim()
                  ? 'bg-muted text-muted-foreground border border-border cursor-not-allowed opacity-60'
                  : 'bg-emerald-600 text-white border border-emerald-600 cursor-pointer hover:bg-emerald-500',
              )}
            >
              {sending ? 'Resuming...' : 'Resume'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (selected.claudeSessionId && selected.machineId) {
                onOpenForkPicker('agent');
              } else {
                onOpenConvertDialog();
              }
            }}
            disabled={forkPickerLoading}
            className="h-8 px-3.5 bg-emerald-900/40 text-emerald-300 border border-emerald-800/40 rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-emerald-900/70 disabled:opacity-50"
          >
            {forkPickerLoading ? 'Loading...' : 'Create Agent'}
          </button>
          {(selected.status === 'active' || selected.status === 'starting') && (
            <ConfirmButton
              label={stopping ? 'Ending...' : 'End Session'}
              confirmLabel="End Session?"
              onConfirm={onStop}
              disabled={stopping}
              className="h-8 px-3.5 bg-red-100/60 dark:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-300/40 dark:border-red-800/40 rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50"
              confirmClassName="h-8 px-3.5 bg-red-700 text-white rounded-md text-xs font-medium cursor-pointer animate-pulse"
            />
          )}
        </div>
      </div>

      {/* Session metadata */}
      <div className="px-5 py-4 border-b border-border text-[13px]">
        <div className="bg-card rounded-lg p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DetailRow label="ID" value={selected.id} mono />
          <DetailRow label="Status" value={selected.status} />
          <DetailRow label="Agent" value={agentLabel} mono />
          <DetailRow label="Machine" value={selected.machineId} mono />
          <DetailRow label="Project" value={selected.projectPath ?? '-'} mono />
          <DetailRow label="Claude Session" value={selected.claudeSessionId ?? '-'} mono />
          <DetailRow label="PID" value={selected.pid ? String(selected.pid) : '-'} mono />
          {selected.accountId && (
            <DetailRow
              label="Account"
              value={accounts.find((a) => a.id === selected.accountId)?.name ?? selected.accountId}
              mono
            />
          )}
          <DetailRow label="Model" value={selected.model ?? '(default)'} />
          {selected.metadata?.forkedFrom && (
            <DetailRow label="Forked From" value={selected.metadata.forkedFrom} mono />
          )}
          <DetailRow label="Started" value={formatDateTime(selected.startedAt)} />
          {selected.endedAt && <DetailRow label="Ended" value={formatDateTime(selected.endedAt)} />}
          <DetailRow label="Duration" value={durationLabel} />
        </div>

        {/* Git status */}
        {selected.projectPath && selected.machineId && (
          <div className="mt-2.5 col-span-full">
            <GitStatusBadge machineId={selected.machineId} projectPath={selected.projectPath} />
          </div>
        )}

        {/* Error message display */}
        {selected.status === 'error' && selected.metadata && (
          <div className="mt-3 px-3 py-2.5 bg-red-100/20 dark:bg-red-900/20 border border-red-500/20 rounded-md text-red-700 dark:text-red-300 text-xs">
            <span className="font-semibold">Error: </span>
            {selected.metadata.errorMessage ?? 'Unknown error'}
          </div>
        )}

        {/* Starting state indicator */}
        {selected.status === 'starting' && (
          <div className="mt-3 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/15 rounded-md text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-2">
            <span className="animate-pulse">&#x25CF;</span>
            Session is starting... Waiting for worker to respond.
          </div>
        )}
      </div>

      {/* Convert to Agent dialog */}
      {showConvertDialog && (
        <ConvertToAgentForm
          convertName={convertName}
          onNameChange={onConvertNameChange}
          convertType={convertType}
          onTypeChange={onConvertTypeChange}
          machineId={selected.machineId}
          projectPath={selected.projectPath}
          model={selected.model}
          isPending={createAgentPending}
          onSubmit={onConvertToAgent}
          onCancel={onCloseConvertDialog}
        />
      )}

      {/* Session content viewer */}
      {selected.claudeSessionId && selected.machineId && (
        <SessionContent
          sessionId={selected.claudeSessionId}
          rcSessionId={selected.id}
          machineId={selected.machineId}
          projectPath={selected.projectPath ?? undefined}
          isActive={selected.status === 'active' || selected.status === 'starting'}
          lastSentMessage={lastSentMessage}
        />
      )}

      {!selected.claudeSessionId && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-[13px]">
          <span>
            {selected.status === 'error'
              ? 'Session failed before the CLI process started'
              : selected.status === 'starting'
                ? 'Waiting for CLI to initialize...'
                : 'No conversation content available'}
          </span>
          {selected.status === 'error' && selected.metadata?.errorMessage && (
            <span className="text-xs text-muted-foreground opacity-70">
              {selected.metadata.errorMessage}
            </span>
          )}
        </div>
      )}

      {/* Prompt input — only for active sessions or ended sessions that can be resumed */}
      {(selected.status === 'active' ||
        selected.status === 'ended' ||
        selected.status === 'error') && (
        <div className="px-5 py-3.5 border-t border-border bg-background/50 space-y-2">
          {selected.status !== 'active' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Model:</span>
              <select
                value={resumeModel}
                onChange={(e) => onResumeModelChange(e.target.value)}
                aria-label="Resume model"
                className="px-2 h-7 bg-muted text-foreground border border-border rounded-md text-[11px] outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value ? opt.label : `Keep current (${selected.model ?? 'default'})`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2.5">
            <input
              type="text"
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={
                selected.status === 'active' ? 'Send message...' : 'Resume session with prompt...'
              }
              aria-label={
                selected.status === 'active'
                  ? 'Message to send to session'
                  : 'Prompt to resume session'
              }
              className="flex-1 px-3.5 h-9 bg-muted text-foreground border border-border rounded-md text-[13px] outline-none transition-all duration-200 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-muted-foreground/50"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={sending || !prompt.trim()}
              aria-label={selected.status === 'active' ? 'Send message' : 'Resume session'}
              className={cn(
                'h-9 px-5 bg-primary text-white rounded-md text-[13px] font-medium transition-all duration-200 hover:bg-primary/90',
                sending || !prompt.trim() ? 'opacity-50' : 'opacity-100',
              )}
            >
              {sending ? '...' : selected.status === 'active' ? 'Send' : 'Resume'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
