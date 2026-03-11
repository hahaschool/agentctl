'use client';

import type {
  EntityType,
  MemoryEdge,
  MemoryFact,
  MemoryScope,
  RelationType,
} from '@agentctl/shared';
import { PinIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useId, useReducer } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_TYPES: readonly EntityType[] = [
  'pattern',
  'decision',
  'error',
  'concept',
  'code_artifact',
  'preference',
  'person',
  'skill',
  'experience',
  'principle',
  'question',
] as const;

const RELATION_TYPES: readonly RelationType[] = [
  'related_to',
  'depends_on',
  'modifies',
  'caused_by',
  'resolves',
  'supersedes',
  'summarizes',
  'derived_from',
  'validates',
  'contradicts',
] as const;

const SCOPE_PRESETS: readonly string[] = [
  'global',
  'project:agentctl',
  'agent:worker-1',
  'session:current',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FactEditorMode = 'create' | 'edit';

export type PendingEdge = {
  /** Stable client-side id for keyed rendering; not sent to the API. */
  clientId: string;
  targetFactId: string;
  relation: RelationType;
};

export type FactEditorValues = {
  content: string;
  entityType: EntityType;
  scope: MemoryScope;
  confidence: number;
  pinned: boolean;
  /** Edges to add (create mode or new edges in edit mode). */
  pendingEdges: readonly PendingEdge[];
  /** Existing edge ids to remove (edit mode only). */
  edgesToRemove: readonly string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: FactEditorMode;
  /** Populated in edit mode; ignored in create mode. */
  initialFact?: MemoryFact;
  /** Existing edges attached to the fact (edit mode). */
  existingEdges?: readonly MemoryEdge[];
  /** Called when the user saves. The caller is responsible for API calls. */
  onSave: (values: FactEditorValues) => void;
  isSaving?: boolean;
};

// ---------------------------------------------------------------------------
// Form state reducer — immutable updates
// ---------------------------------------------------------------------------

type FormState = {
  content: string;
  entityType: EntityType;
  scope: string;
  customScope: string;
  confidence: number;
  pinned: boolean;
  pendingEdges: readonly PendingEdge[];
  edgesToRemove: readonly string[];
  newEdgeTargetId: string;
  newEdgeRelation: RelationType;
  contentError: string;
  scopeError: string;
};

type FormAction =
  | { type: 'SET_CONTENT'; value: string }
  | { type: 'SET_ENTITY_TYPE'; value: EntityType }
  | { type: 'SET_SCOPE_PRESET'; value: string }
  | { type: 'SET_CUSTOM_SCOPE'; value: string }
  | { type: 'SET_CONFIDENCE'; value: number }
  | { type: 'TOGGLE_PINNED' }
  | { type: 'SET_NEW_EDGE_TARGET'; value: string }
  | { type: 'SET_NEW_EDGE_RELATION'; value: RelationType }
  | { type: 'ADD_PENDING_EDGE' }
  | { type: 'REMOVE_PENDING_EDGE'; clientId: string }
  | { type: 'MARK_EDGE_REMOVE'; edgeId: string }
  | { type: 'UNMARK_EDGE_REMOVE'; edgeId: string }
  | { type: 'VALIDATE' }
  | { type: 'RESET'; fact?: MemoryFact; edges?: readonly MemoryEdge[] };

function buildInitialState(fact?: MemoryFact): FormState {
  return {
    content: fact?.content ?? '',
    entityType: fact?.entity_type ?? 'concept',
    scope: fact?.scope ?? 'global',
    customScope: '',
    confidence: fact?.confidence ?? 0.8,
    pinned: fact?.pinned ?? false,
    pendingEdges: [],
    edgesToRemove: [],
    newEdgeTargetId: '',
    newEdgeRelation: 'related_to',
    contentError: '',
    scopeError: '',
  };
}

function isValidScope(scope: string): boolean {
  if (scope === 'global') return true;
  return scope.startsWith('project:') || scope.startsWith('agent:') || scope.startsWith('session:');
}

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_CONTENT':
      return { ...state, content: action.value, contentError: '' };

    case 'SET_ENTITY_TYPE':
      return { ...state, entityType: action.value };

    case 'SET_SCOPE_PRESET':
      return { ...state, scope: action.value, customScope: '', scopeError: '' };

    case 'SET_CUSTOM_SCOPE':
      return { ...state, customScope: action.value, scope: action.value, scopeError: '' };

    case 'SET_CONFIDENCE':
      return { ...state, confidence: Math.max(0, Math.min(1, action.value)) };

    case 'TOGGLE_PINNED':
      return { ...state, pinned: !state.pinned };

    case 'SET_NEW_EDGE_TARGET':
      return { ...state, newEdgeTargetId: action.value };

    case 'SET_NEW_EDGE_RELATION':
      return { ...state, newEdgeRelation: action.value };

    case 'ADD_PENDING_EDGE': {
      const targetId = state.newEdgeTargetId.trim();
      if (!targetId) return state;
      // Deduplicate by targetId + relation
      const isDuplicate = state.pendingEdges.some(
        (e) => e.targetFactId === targetId && e.relation === state.newEdgeRelation,
      );
      if (isDuplicate) return state;
      const newEdge: PendingEdge = {
        clientId: `${targetId}-${state.newEdgeRelation}-${Date.now()}`,
        targetFactId: targetId,
        relation: state.newEdgeRelation,
      };
      return {
        ...state,
        pendingEdges: [...state.pendingEdges, newEdge],
        newEdgeTargetId: '',
      };
    }

    case 'REMOVE_PENDING_EDGE':
      return {
        ...state,
        pendingEdges: state.pendingEdges.filter((e) => e.clientId !== action.clientId),
      };

    case 'MARK_EDGE_REMOVE':
      return { ...state, edgesToRemove: [...state.edgesToRemove, action.edgeId] };

    case 'UNMARK_EDGE_REMOVE':
      return { ...state, edgesToRemove: state.edgesToRemove.filter((id) => id !== action.edgeId) };

    case 'VALIDATE': {
      const contentError = state.content.trim() === '' ? 'Content is required.' : '';
      const scopeError = !isValidScope(state.scope)
        ? 'Scope must be global, project:…, agent:…, or session:…'
        : '';
      return { ...state, contentError, scopeError };
    }

    case 'RESET':
      return buildInitialState(action.fact);
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
      {children}
    </label>
  );
}

function FieldError({ message }: { message: string }): React.JSX.Element | null {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FactEditorModal({
  open,
  onOpenChange,
  mode,
  initialFact,
  existingEdges = [],
  onSave,
  isSaving = false,
}: Props): React.JSX.Element {
  const [state, dispatch] = useReducer(formReducer, buildInitialState(initialFact));

  // Reset form whenever the dialog opens or the fact changes
  useEffect(() => {
    if (open) {
      dispatch({ type: 'RESET', fact: initialFact });
    }
  }, [open, initialFact]);

  const contentId = useId();
  const entityTypeId = useId();
  const scopeId = useId();
  const confidenceId = useId();
  const pinnedId = useId();
  const newEdgeTargetId = useId();
  const newEdgeRelationId = useId();

  const handleSave = useCallback(() => {
    dispatch({ type: 'VALIDATE' });

    const contentError = state.content.trim() === '' ? 'required' : '';
    const scopeError = !isValidScope(state.scope) ? 'invalid' : '';
    if (contentError || scopeError) return;

    onSave({
      content: state.content.trim(),
      entityType: state.entityType,
      scope: state.scope as MemoryScope,
      confidence: state.confidence,
      pinned: state.pinned,
      pendingEdges: state.pendingEdges,
      edgesToRemove: state.edgesToRemove,
    });
  }, [state, onSave]);

  const confidencePct = Math.round(state.confidence * 100);
  const isCustomScope = !SCOPE_PRESETS.includes(state.scope);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New Memory Fact' : 'Edit Memory Fact'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Content */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor={contentId}>Content</FieldLabel>
            <textarea
              id={contentId}
              value={state.content}
              onChange={(e) => dispatch({ type: 'SET_CONTENT', value: e.target.value })}
              rows={4}
              placeholder="Describe the fact…"
              className={cn(
                'w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground',
                'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                state.contentError && 'border-destructive ring-destructive/20',
              )}
              aria-invalid={!!state.contentError}
              aria-describedby={state.contentError ? `${contentId}-err` : undefined}
            />
            <FieldError message={state.contentError} />
          </div>

          {/* Entity type */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor={entityTypeId}>Entity type</FieldLabel>
            <select
              id={entityTypeId}
              value={state.entityType}
              onChange={(e) =>
                dispatch({ type: 'SET_ENTITY_TYPE', value: e.target.value as EntityType })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor={scopeId}>Scope</FieldLabel>
            <select
              id={scopeId}
              value={isCustomScope ? '__custom__' : state.scope}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  dispatch({ type: 'SET_SCOPE_PRESET', value: '' });
                } else {
                  dispatch({ type: 'SET_SCOPE_PRESET', value: e.target.value });
                }
              }}
              className={cn(
                'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring',
                state.scopeError && 'border-destructive',
              )}
            >
              {SCOPE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
            {(isCustomScope || state.scope === '') && (
              <Input
                value={state.customScope || state.scope}
                onChange={(e) => dispatch({ type: 'SET_CUSTOM_SCOPE', value: e.target.value })}
                placeholder="project:my-project"
                aria-label="Custom scope"
                className={state.scopeError ? 'border-destructive' : ''}
              />
            )}
            <FieldError message={state.scopeError} />
          </div>

          {/* Confidence slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor={confidenceId}>Confidence</FieldLabel>
              <span className="text-sm tabular-nums text-muted-foreground">{confidencePct}%</span>
            </div>
            <input
              id={confidenceId}
              type="range"
              min={0}
              max={100}
              step={1}
              value={confidencePct}
              onChange={(e) =>
                dispatch({ type: 'SET_CONFIDENCE', value: Number(e.target.value) / 100 })
              }
              className="w-full cursor-pointer accent-primary"
              aria-label="Confidence"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Pinned toggle */}
          <div className="flex items-center gap-3">
            <button
              id={pinnedId}
              type="button"
              role="switch"
              aria-checked={state.pinned}
              onClick={() => dispatch({ type: 'TOGGLE_PINNED' })}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                state.pinned ? 'bg-primary' : 'bg-input',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
                  state.pinned ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
            <label htmlFor={pinnedId} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <PinIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Pinned
            </label>
          </div>

          {/* Relationships */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Relationships</h3>

            {/* Existing edges (edit mode) */}
            {existingEdges.length > 0 && (
              <ul className="space-y-1.5">
                {existingEdges.map((edge) => {
                  const markedForRemoval = state.edgesToRemove.includes(edge.id);
                  return (
                    <li
                      key={edge.id}
                      className={cn(
                        'flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm',
                        markedForRemoval && 'opacity-40 line-through',
                      )}
                    >
                      <span className="truncate text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {edge.relation.replace(/_/g, ' ')}
                        </span>{' '}
                        → {edge.target_fact_id}
                      </span>
                      <button
                        type="button"
                        aria-label={markedForRemoval ? 'Undo remove edge' : 'Remove edge'}
                        onClick={() =>
                          dispatch({
                            type: markedForRemoval ? 'UNMARK_EDGE_REMOVE' : 'MARK_EDGE_REMOVE',
                            edgeId: edge.id,
                          })
                        }
                        className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Pending new edges */}
            {state.pendingEdges.length > 0 && (
              <ul className="space-y-1.5">
                {state.pendingEdges.map((edge) => (
                  <li
                    key={edge.clientId}
                    className="flex items-center justify-between rounded-md border border-border border-dashed px-3 py-2 text-sm"
                  >
                    <span className="truncate text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {edge.relation.replace(/_/g, ' ')}
                      </span>{' '}
                      → {edge.targetFactId}
                      <span className="ml-1 text-xs text-muted-foreground">(new)</span>
                    </span>
                    <button
                      type="button"
                      aria-label="Remove pending edge"
                      onClick={() =>
                        dispatch({ type: 'REMOVE_PENDING_EDGE', clientId: edge.clientId })
                      }
                      className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add new edge row */}
            <div className="flex gap-2">
              <select
                id={newEdgeRelationId}
                value={state.newEdgeRelation}
                onChange={(e) =>
                  dispatch({ type: 'SET_NEW_EDGE_RELATION', value: e.target.value as RelationType })
                }
                aria-label="Relation type"
                className="h-9 flex-shrink-0 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring"
              >
                {RELATION_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <Input
                id={newEdgeTargetId}
                value={state.newEdgeTargetId}
                onChange={(e) => dispatch({ type: 'SET_NEW_EDGE_TARGET', value: e.target.value })}
                placeholder="Target fact ID"
                aria-label="Target fact ID"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    dispatch({ type: 'ADD_PENDING_EDGE' });
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Add edge"
                onClick={() => dispatch({ type: 'ADD_PENDING_EDGE' })}
                disabled={!state.newEdgeTargetId.trim()}
              >
                <PlusIcon className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : mode === 'create' ? 'Create fact' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
