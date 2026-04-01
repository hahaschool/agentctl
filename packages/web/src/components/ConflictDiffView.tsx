'use client';

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { SyncConflictItem } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConflictDiffViewProps = {
  conflict: SyncConflictItem;
  onResolve: (resolution: 'local' | 'remote' | 'merged', payload?: Record<string, unknown> | null) => void;
  isResolving: boolean;
};

type DiffField = {
  key: string;
  localValue: unknown;
  remoteValue: unknown;
  changed: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDiffFields(
  localPayload: Record<string, unknown> | null,
  remotePayload: Record<string, unknown> | null,
): DiffField[] {
  const allKeys = new Set([
    ...Object.keys(localPayload ?? {}),
    ...Object.keys(remotePayload ?? {}),
  ]);

  return Array.from(allKeys)
    .sort()
    .map((key) => {
      const localValue = localPayload?.[key];
      const remoteValue = remotePayload?.[key];
      return {
        key,
        localValue,
        remoteValue,
        changed: JSON.stringify(localValue) !== JSON.stringify(remoteValue),
      };
    });
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

// ---------------------------------------------------------------------------
// DeleteBadge
// ---------------------------------------------------------------------------

function DeletedBadge({ nodeName }: { nodeName: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-center">
      <span className="inline-block px-3 py-1 rounded-md bg-red-500/15 text-red-400 text-xs font-semibold tracking-wide mb-2">
        DELETED
      </span>
      <span className="text-xs text-muted-foreground">
        Record deleted on <span className="font-mono text-foreground">{nodeName}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PayloadPanel
// ---------------------------------------------------------------------------

function PayloadPanel({
  label,
  payload,
  nodeName,
  diffFields,
  side,
}: {
  label: string;
  payload: Record<string, unknown> | null;
  nodeName: string;
  diffFields: DiffField[];
  side: 'local' | 'remote';
}): React.JSX.Element {
  if (payload === null) {
    return (
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-muted-foreground mb-2">{label}</div>
        <div className="border border-border rounded-md p-3 bg-muted/30">
          <DeletedBadge nodeName={nodeName} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium text-muted-foreground mb-2">{label}</div>
      <div className="border border-border rounded-md overflow-hidden bg-muted/30">
        <table className="w-full text-xs">
          <tbody>
            {diffFields.map((field) => {
              const value = side === 'local' ? field.localValue : field.remoteValue;
              return (
                <tr
                  key={field.key}
                  className={cn(
                    'border-b border-border last:border-b-0',
                    field.changed && 'bg-yellow-500/5',
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-muted-foreground w-[140px] align-top whitespace-nowrap">
                    {field.key}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 font-mono break-all',
                      field.changed ? 'text-yellow-300' : 'text-foreground',
                    )}
                  >
                    <pre className="whitespace-pre-wrap m-0">{formatValue(value)}</pre>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VectorClockDisplay
// ---------------------------------------------------------------------------

function VectorClockDisplay({
  label,
  vclock,
}: {
  label: string;
  vclock: Record<string, number>;
}): React.JSX.Element {
  const entries = Object.entries(vclock).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <span className="text-[10px] text-muted-foreground/70 mr-1">{label}:</span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {'{'}{entries.map(([k, v], i) => (
          <span key={k}>
            {i > 0 ? ', ' : ''}{k.slice(0, 8)}:{v}
          </span>
        ))}{'}'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConflictDiffView
// ---------------------------------------------------------------------------

export function ConflictDiffView({
  conflict,
  onResolve,
  isResolving,
}: ConflictDiffViewProps): React.JSX.Element {
  const [editMode, setEditMode] = useState(false);
  const [mergedJson, setMergedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const isDeleteConflict = conflict.localPayload === null || conflict.remotePayload === null;
  const localNodeId = 'local';
  const remoteNodeId = conflict.remoteNodeId;

  const diffFields = useMemo(
    () => computeDiffFields(conflict.localPayload, conflict.remotePayload),
    [conflict.localPayload, conflict.remotePayload],
  );

  const handleKeepLocal = useCallback(() => {
    onResolve('local');
  }, [onResolve]);

  const handleKeepRemote = useCallback(() => {
    onResolve('remote');
  }, [onResolve]);

  const handleStartMerge = useCallback(() => {
    // Pre-populate with a merge of both payloads (remote wins for conflicts)
    const base = { ...(conflict.localPayload ?? {}), ...(conflict.remotePayload ?? {}) };
    setMergedJson(JSON.stringify(base, null, 2));
    setJsonError(null);
    setEditMode(true);
  }, [conflict.localPayload, conflict.remotePayload]);

  const handleSubmitMerge = useCallback(() => {
    try {
      const parsed = JSON.parse(mergedJson) as Record<string, unknown>;
      setJsonError(null);
      onResolve('merged', parsed);
    } catch {
      setJsonError('Invalid JSON');
    }
  }, [mergedJson, onResolve]);

  const handleCancelMerge = useCallback(() => {
    setEditMode(false);
    setJsonError(null);
  }, []);

  // Labels for delete conflicts
  const localLabel = isDeleteConflict && conflict.localPayload === null
    ? 'Local (Deleted)'
    : `Local (this node)`;
  const remoteLabel = isDeleteConflict && conflict.remotePayload === null
    ? `Remote (Deleted)`
    : `Remote (${remoteNodeId.slice(0, 12)})`;

  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Table: <span className="font-mono text-foreground">{conflict.tableName}</span>
        </span>
        <span>
          Row: <span className="font-mono text-foreground">{conflict.rowId.slice(0, 12)}</span>
        </span>
        <span>
          Remote node: <span className="font-mono text-foreground">{remoteNodeId.slice(0, 12)}</span>
        </span>
      </div>

      {/* Vector clocks */}
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <VectorClockDisplay label="Local vclock" vclock={conflict.localVclock} />
        <VectorClockDisplay label="Remote vclock" vclock={conflict.remoteVclock} />
      </div>

      {/* Side-by-side diff */}
      <div className="flex gap-4 flex-col sm:flex-row">
        <PayloadPanel
          label={localLabel}
          payload={conflict.localPayload}
          nodeName={localNodeId}
          diffFields={diffFields}
          side="local"
        />
        <PayloadPanel
          label={remoteLabel}
          payload={conflict.remotePayload}
          nodeName={remoteNodeId.slice(0, 12)}
          diffFields={diffFields}
          side="remote"
        />
      </div>

      {/* Manual merge editor */}
      {editMode && (
        <div className="space-y-2">
          <label htmlFor="merge-json" className="text-xs font-medium text-muted-foreground">
            Merged payload (edit JSON)
          </label>
          <textarea
            id="merge-json"
            value={mergedJson}
            onChange={(e) => {
              setMergedJson(e.target.value);
              setJsonError(null);
            }}
            rows={10}
            className="w-full px-3 py-2 bg-muted text-foreground border border-border rounded-md text-xs font-mono outline-none resize-y focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          {jsonError && (
            <p className="text-xs text-red-400">{jsonError}</p>
          )}
        </div>
      )}

      {/* Actions */}
      {conflict.status === 'pending' && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          {!editMode ? (
            <>
              <button
                type="button"
                onClick={handleKeepLocal}
                disabled={isResolving}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {isDeleteConflict && conflict.localPayload === null
                  ? 'Keep Deleted'
                  : 'Keep Local'}
              </button>
              <button
                type="button"
                onClick={handleKeepRemote}
                disabled={isResolving}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  'bg-green-600/20 text-green-400 hover:bg-green-600/30',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {isDeleteConflict && conflict.remotePayload === null
                  ? 'Keep Deleted'
                  : isDeleteConflict && conflict.localPayload === null
                    ? 'Restore'
                    : 'Keep Remote'}
              </button>
              {!isDeleteConflict && (
                <button
                  type="button"
                  onClick={handleStartMerge}
                  disabled={isResolving}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                    'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  Edit &amp; Merge
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSubmitMerge}
                disabled={isResolving}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {isResolving ? 'Resolving...' : 'Apply Merge'}
              </button>
              <button
                type="button"
                onClick={handleCancelMerge}
                disabled={isResolving}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-muted text-muted-foreground hover:bg-accent/20"
              >
                Cancel
              </button>
            </>
          )}
          {isResolving && !editMode && (
            <span className="text-xs text-muted-foreground ml-2">Resolving...</span>
          )}
        </div>
      )}

      {/* Resolved state */}
      {conflict.status === 'resolved' && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <span className="inline-block px-2 py-0.5 rounded-md bg-green-500/15 text-green-400 text-[10px] font-semibold tracking-wide">
            RESOLVED
          </span>
          <span className="text-xs text-muted-foreground">
            Resolution: <span className="font-mono text-foreground">{conflict.resolution}</span>
          </span>
          {conflict.resolvedAt && (
            <span className="text-xs text-muted-foreground ml-2">
              at {new Date(conflict.resolvedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
