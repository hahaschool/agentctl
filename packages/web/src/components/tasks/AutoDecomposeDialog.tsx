'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AutoDecomposeDialog — LLM-powered task breakdown UI.
//
// Two-step UX:
//   1. User enters/edits a task description, clicks "Preview decomposition".
//      This fires `POST /api/decompose/preview` (dry-run) and renders the
//      proposed subtasks/edges in a readable list. No persistence.
//   2. User clicks "Apply" to create a real TaskGraph via
//      `POST /api/decompose`. On success we invalidate the task-graphs cache
//      and close the dialog.
//
// Error and empty-result states are handled explicitly — we never silently
// drop a provider error nor claim success when the LLM returned zero tasks.
// ─────────────────────────────────────────────────────────────────────────────

import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DecomposedEdge, DecomposedTask, DecompositionPreviewResponse } from '@/lib/api';
import { useDecomposeTask, useDecomposeTaskPreview } from '@/lib/queries';

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_DESCRIPTION_LENGTH = 5;
const MAX_DESCRIPTION_LENGTH = 4_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function dependencyNamesFor(
  tempId: string,
  tasks: readonly DecomposedTask[],
  edges: readonly DecomposedEdge[],
): string[] {
  const byId = new Map(tasks.map((t) => [t.tempId, t.name] as const));
  return edges
    .filter((e) => e.to === tempId && e.type === 'blocks')
    .map((e) => byId.get(e.from) ?? e.from);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

// ── Subcomponents ────────────────────────────────────────────────────────────

type ProposedTaskRowProps = {
  task: DecomposedTask;
  dependencyNames: string[];
};

function ProposedTaskRow({ task, dependencyNames }: ProposedTaskRowProps): React.JSX.Element {
  return (
    <li
      data-testid={`proposed-task-${task.tempId}`}
      className="border border-border rounded-md bg-card px-3 py-2 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{task.name}</span>
        <span
          className={
            task.type === 'gate'
              ? 'text-[10px] px-1.5 py-0.5 rounded-sm border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'text-[10px] px-1.5 py-0.5 rounded-sm border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400'
          }
        >
          {task.type}
        </span>
      </div>
      {task.description && (
        <p className="text-[12px] text-muted-foreground mt-1">{task.description}</p>
      )}
      <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-muted-foreground font-mono">
        <span>~{task.estimatedTokens.toLocaleString()} tok</span>
        {task.requiredCapabilities.length > 0 && (
          <span>caps: [{task.requiredCapabilities.join(', ')}]</span>
        )}
        {dependencyNames.length > 0 && <span>depends on: {dependencyNames.join(', ')}</span>}
      </div>
    </li>
  );
}

type PreviewBlockProps = {
  preview: DecompositionPreviewResponse;
};

function PreviewBlock({ preview }: PreviewBlockProps): React.JSX.Element {
  const { tasks, edges, reasoning, estimatedTotalTokens, estimatedTotalCostUsd } = preview.result;

  if (tasks.length === 0) {
    return (
      <div
        data-testid="decompose-empty-result"
        className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
      >
        The model returned no subtasks. Try refining your description with more concrete goals or
        constraints.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground font-mono flex flex-wrap gap-x-4 gap-y-1">
        <span>{tasks.length} task(s)</span>
        <span>~{estimatedTotalTokens.toLocaleString()} tokens total</span>
        {estimatedTotalCostUsd !== null && (
          <span>~${estimatedTotalCostUsd.toFixed(3)} est. cost</span>
        )}
      </div>

      {preview.validationErrors.length > 0 && (
        <div
          data-testid="decompose-validation-errors"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <p className="font-medium mb-1">Validation warnings:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {preview.validationErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-1.5" aria-label="Proposed subtasks">
        {tasks.map((task) => (
          <ProposedTaskRow
            key={task.tempId}
            task={task}
            dependencyNames={dependencyNamesFor(task.tempId, tasks, edges)}
          />
        ))}
      </ul>

      {reasoning && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Model reasoning</summary>
          <p className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{reasoning}</p>
        </details>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export type AutoDecomposeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Seed description shown in the textarea when the dialog opens — usually the
   * current task graph name. User can freely edit before previewing.
   */
  initialDescription?: string;
  /**
   * Optional space id to scope the created graph. When omitted, the control
   * plane falls back to the default/global space.
   */
  spaceId?: string;
  /**
   * Called after successful apply with the new graph id — parent can navigate
   * or refresh.
   */
  onApplied?: (graphId: string) => void;
};

export function AutoDecomposeDialog({
  open,
  onOpenChange,
  initialDescription = '',
  spaceId,
  onApplied,
}: AutoDecomposeDialogProps): React.JSX.Element {
  const toast = useToast();
  const previewMutation = useDecomposeTaskPreview();
  const applyMutation = useDecomposeTask();

  const [description, setDescription] = useState<string>(initialDescription);

  const preview = previewMutation.data;
  const isPreviewing = previewMutation.isPending;
  const isApplying = applyMutation.isPending;
  const previewError = previewMutation.error;
  const applyError = applyMutation.error;

  const trimmed = description.trim();
  const descriptionValid =
    trimmed.length >= MIN_DESCRIPTION_LENGTH && trimmed.length <= MAX_DESCRIPTION_LENGTH;
  const hasApplicablePreview = useMemo(
    () => preview !== undefined && preview.result.tasks.length > 0,
    [preview],
  );

  const handlePreview = useCallback(() => {
    if (!descriptionValid || isPreviewing) return;
    // Reset any stale apply error when starting a fresh preview.
    applyMutation.reset();
    previewMutation.mutate(
      { description: trimmed },
      {
        onError: (err) => {
          toast.error(`Preview failed: ${errorMessage(err)}`);
        },
      },
    );
  }, [applyMutation, descriptionValid, isPreviewing, previewMutation, toast, trimmed]);

  const handleApply = useCallback(() => {
    if (!hasApplicablePreview || !descriptionValid || isApplying) return;
    applyMutation.mutate(
      { description: trimmed, spaceId },
      {
        onSuccess: (data) => {
          toast.success(`Decomposition applied — ${data.result.tasks.length} task(s) created`);
          onApplied?.(data.graphId);
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(`Apply failed: ${errorMessage(err)}`);
        },
      },
    );
  }, [
    applyMutation,
    descriptionValid,
    hasApplicablePreview,
    isApplying,
    onApplied,
    onOpenChange,
    spaceId,
    toast,
    trimmed,
  ]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (isPreviewing || isApplying) return; // block close while in-flight
      if (!next) {
        // Reset state on close so re-opening starts fresh.
        previewMutation.reset();
        applyMutation.reset();
        setDescription(initialDescription);
      }
      onOpenChange(next);
    },
    [applyMutation, initialDescription, isApplying, isPreviewing, onOpenChange, previewMutation],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="auto-decompose-dialog"
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-blue-500" aria-hidden="true" />
            Auto-decompose task
          </DialogTitle>
          <DialogDescription>
            Describe the work to break down. The planner will propose subtasks and dependencies;
            nothing is created until you apply.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Description textarea */}
          <div className="space-y-1">
            <label
              htmlFor="auto-decompose-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Task description
            </label>
            <textarea
              id="auto-decompose-description"
              data-testid="auto-decompose-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={MAX_DESCRIPTION_LENGTH}
              disabled={isPreviewing || isApplying}
              placeholder="e.g. Refactor the auth module to support OAuth PKCE and add integration tests"
              className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 resize-y"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>
                {trimmed.length}/{MAX_DESCRIPTION_LENGTH}
              </span>
              {!descriptionValid && trimmed.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  Minimum {MIN_DESCRIPTION_LENGTH} characters
                </span>
              )}
            </div>
          </div>

          {/* Preview button */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={!descriptionValid || isPreviewing || isApplying}
              data-testid="auto-decompose-preview-button"
              className="gap-1.5"
            >
              {isPreviewing ? (
                <>
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Previewing…
                </>
              ) : (
                <>
                  <Sparkles size={13} aria-hidden="true" />
                  {preview ? 'Re-preview' : 'Preview decomposition'}
                </>
              )}
            </Button>
          </div>

          {/* Preview error */}
          {previewError && (
            <div
              role="alert"
              data-testid="auto-decompose-preview-error"
              className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage(previewError)}</span>
            </div>
          )}

          {/* Preview result */}
          {preview && !previewError && (
            <section aria-label="Proposed decomposition" className="border-t border-border pt-3">
              <h3 className="text-sm font-semibold mb-2">Proposed decomposition</h3>
              <PreviewBlock preview={preview} />
            </section>
          )}

          {/* Apply error */}
          {applyError && (
            <div
              role="alert"
              data-testid="auto-decompose-apply-error"
              className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage(applyError)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPreviewing || isApplying}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!hasApplicablePreview || isPreviewing || isApplying}
            data-testid="auto-decompose-apply-button"
            className="gap-1.5 bg-blue-500 text-white hover:bg-blue-500/90 focus-visible:ring-blue-500/40"
          >
            {isApplying ? (
              <>
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                Applying…
              </>
            ) : (
              'Apply decomposition'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
