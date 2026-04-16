'use client';

import { Search } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import type { DiscoverCandidate, UpsertSyncPeerInput } from '@/lib/api';
import { useDiscoverSyncPeers, useUpsertSyncPeer } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiscoverStep = 'idle' | 'loading' | 'select' | 'confirm';

type SelectedCandidate = DiscoverCandidate & {
  selected: boolean;
  syncIntervalSeconds: number;
};

type DiscoverPeersDialogProps = {
  open: boolean;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_INTERVAL_SECONDS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSelectedCandidates(
  peers: readonly DiscoverCandidate[],
): readonly SelectedCandidate[] {
  return peers.map((peer) => ({
    ...peer,
    selected: peer.reachable,
    syncIntervalSeconds: DEFAULT_SYNC_INTERVAL_SECONDS,
  }));
}

function toggleCandidate(
  candidates: readonly SelectedCandidate[],
  index: number,
): readonly SelectedCandidate[] {
  return candidates.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c));
}

function toggleAll(
  candidates: readonly SelectedCandidate[],
  selected: boolean,
): readonly SelectedCandidate[] {
  return candidates.map((c) => (c.reachable ? { ...c, selected } : c));
}

function updateInterval(
  candidates: readonly SelectedCandidate[],
  index: number,
  value: number,
): readonly SelectedCandidate[] {
  return candidates.map((c, i) => (i === index ? { ...c, syncIntervalSeconds: value } : c));
}

function updateAllIntervals(
  candidates: readonly SelectedCandidate[],
  value: number,
): readonly SelectedCandidate[] {
  return candidates.map((c) => ({ ...c, syncIntervalSeconds: value }));
}

// ---------------------------------------------------------------------------
// Reachability badge
// ---------------------------------------------------------------------------

function ReachabilityBadge({
  reachable,
  error,
}: {
  reachable: boolean;
  error: string | null;
}): React.JSX.Element {
  if (reachable) {
    return (
      <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase bg-green-500/15 text-green-400">
        Reachable
      </span>
    );
  }
  return (
    <span
      title={error ?? 'Unreachable'}
      className="px-1.5 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide uppercase bg-red-500/15 text-red-400"
    >
      Unreachable
    </span>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Select candidates
// ---------------------------------------------------------------------------

type SelectStepProps = {
  candidates: readonly SelectedCandidate[];
  source: 'tailscale' | 'none';
  onToggle: (index: number) => void;
  onToggleAll: (selected: boolean) => void;
  onNext: () => void;
  onCancel: () => void;
};

function SelectStep({
  candidates,
  source,
  onToggle,
  onToggleAll,
  onNext,
  onCancel,
}: SelectStepProps): React.JSX.Element {
  const reachableCandidates = candidates.filter((c) => c.reachable);
  const selectedCount = candidates.filter((c) => c.selected).length;
  const allReachableSelected =
    reachableCandidates.length > 0 && reachableCandidates.every((c) => c.selected);

  return (
    <>
      <div className="px-5 py-3 border-b border-border">
        <h2 id="discover-dialog-title" className="text-sm font-semibold text-foreground">
          Discovered peers
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Source: <span className="font-mono text-foreground">{source}</span>
          {' -- '}
          {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} found
        </p>
      </div>

      <div className="px-5 py-3 max-h-[400px] overflow-y-auto">
        {candidates.length === 0 ? (
          <div data-testid="discover-empty">
            <EmptyState
              icon={Search}
              title="No Tailscale mesh-node peers found"
              description="All discovered peers may already be registered, or no peers carry the tag:mesh-node tag."
              variant="compact"
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={allReachableSelected}
                  onChange={() => onToggleAll(!allReachableSelected)}
                  className="accent-primary"
                  data-testid="discover-select-all"
                />
                Select all reachable
              </label>
            </div>

            <table className="w-full text-left" aria-label="Discovered peer candidates">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-1.5 pr-2 font-medium w-8" />
                  <th className="pb-1.5 pr-3 font-medium">Hostname</th>
                  <th className="pb-1.5 pr-3 font-medium">Tailscale IP</th>
                  <th className="pb-1.5 pr-3 font-medium">Status</th>
                  <th className="pb-1.5 pr-3 font-medium">Machine ID</th>
                  <th className="pb-1.5 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate, index) => (
                  <tr
                    key={`${candidate.hostname}-${candidate.tailscaleIp}`}
                    data-testid={`discover-row-${candidate.hostname}`}
                    className={cn(
                      'border-t border-border/50',
                      !candidate.reachable && 'opacity-60',
                    )}
                  >
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={candidate.selected}
                        disabled={!candidate.reachable}
                        onChange={() => onToggle(index)}
                        className="accent-primary"
                        aria-label={`Select ${candidate.hostname}`}
                      />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-foreground">
                      {candidate.hostname}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                      {candidate.tailscaleIp}
                    </td>
                    <td className="py-2 pr-3">
                      <ReachabilityBadge reachable={candidate.reachable} error={candidate.error} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground truncate max-w-[160px]">
                      {candidate.machineId ?? (
                        <span className="italic text-muted-foreground/60">--</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-muted-foreground">
                      {candidate.appVersion ?? '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{selectedCount} selected</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={selectedCount === 0}
            data-testid="discover-next"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Next: configure
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Confirm & tweak intervals
// ---------------------------------------------------------------------------

type ConfirmStepProps = {
  candidates: readonly SelectedCandidate[];
  onUpdateInterval: (index: number, value: number) => void;
  onUpdateAllIntervals: (value: number) => void;
  onBack: () => void;
  onConfirm: () => void;
  isAdding: boolean;
  addProgress: number;
  addTotal: number;
};

function ConfirmStep({
  candidates,
  onUpdateInterval,
  onUpdateAllIntervals,
  onBack,
  onConfirm,
  isAdding,
  addProgress,
  addTotal,
}: ConfirmStepProps): React.JSX.Element {
  const selected = candidates.filter((c) => c.selected);
  const [bulkInterval, setBulkInterval] = useState(String(DEFAULT_SYNC_INTERVAL_SECONDS));

  const handleBulkIntervalChange = (value: string): void => {
    setBulkInterval(value);
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 300) {
      onUpdateAllIntervals(parsed);
    }
  };

  return (
    <>
      <div className="px-5 py-3 border-b border-border">
        <h2 id="discover-dialog-title" className="text-sm font-semibold text-foreground">
          Confirm bulk add
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {selected.length} peer{selected.length !== 1 ? 's' : ''} will be added. Tweak sync
          intervals below.
        </p>
      </div>

      <div className="px-5 py-3 max-h-[400px] overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <label
            htmlFor="discover-bulk-interval"
            className="text-[11px] text-muted-foreground whitespace-nowrap"
          >
            Bulk interval (s):
          </label>
          <input
            id="discover-bulk-interval"
            inputMode="numeric"
            value={bulkInterval}
            onChange={(e) => handleBulkIntervalChange(e.target.value)}
            data-testid="discover-bulk-interval"
            className="w-16 bg-muted border border-border rounded-md text-xs px-2 py-1 font-mono text-foreground"
          />
        </div>

        <table className="w-full text-left" aria-label="Selected peers to add">
          <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="pb-1.5 pr-3 font-medium">Hostname</th>
              <th className="pb-1.5 pr-3 font-medium">Sync URL</th>
              <th className="pb-1.5 pr-3 font-medium">Machine ID</th>
              <th className="pb-1.5 font-medium w-20">Interval (s)</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((candidate) => {
              const originalIndex = candidates.indexOf(candidate);
              return (
                <tr
                  key={`${candidate.hostname}-${candidate.tailscaleIp}`}
                  className="border-t border-border/50"
                >
                  <td className="py-2 pr-3 font-mono text-xs text-foreground">
                    {candidate.hostname}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground break-all max-w-[200px]">
                    {candidate.syncUrl}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground truncate max-w-[140px]">
                    {candidate.machineId ?? '--'}
                  </td>
                  <td className="py-2">
                    <input
                      inputMode="numeric"
                      value={String(candidate.syncIntervalSeconds)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isSafeInteger(val) && val >= 1 && val <= 300) {
                          onUpdateInterval(originalIndex, val);
                        }
                      }}
                      className="w-16 bg-muted border border-border rounded-md text-xs px-2 py-1 font-mono text-foreground"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        {isAdding ? (
          <span className="text-[11px] text-muted-foreground font-mono">
            Adding {addProgress}/{addTotal}...
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {selected.length} peer{selected.length !== 1 ? 's' : ''}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={isAdding}
            className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isAdding}
            data-testid="discover-confirm"
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isAdding
              ? 'Adding...'
              : `Add ${selected.length} peer${selected.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function DiscoverPeersDialog({
  open,
  onClose,
}: DiscoverPeersDialogProps): React.JSX.Element | null {
  const toast = useToast();
  const discoverMutation = useDiscoverSyncPeers();
  const upsertPeer = useUpsertSyncPeer();

  const [step, setStep] = useState<DiscoverStep>('idle');
  const [candidates, setCandidates] = useState<readonly SelectedCandidate[]>([]);
  const [source, setSource] = useState<'tailscale' | 'none'>('none');
  const [addProgress, setAddProgress] = useState(0);
  const [addTotal, setAddTotal] = useState(0);
  const [isAdding, setIsAdding] = useState(false);

  // Reset state when dialog opens. Initialize to false so the first render
  // with `open=true` triggers discovery.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setStep('loading');
      setCandidates([]);
      setSource('none');
      setAddProgress(0);
      setAddTotal(0);
      setIsAdding(false);
      discoverMutation.mutate(undefined, {
        onSuccess: (result) => {
          setCandidates(buildSelectedCandidates(result.peers));
          setSource(result.source);
          setStep('select');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Discovery failed');
          onClose();
        },
      });
    }
  }

  const handleClose = useCallback(() => {
    if (isAdding) return;
    onClose();
  }, [isAdding, onClose]);

  const handleToggle = useCallback((index: number) => {
    setCandidates((prev) => toggleCandidate(prev, index));
  }, []);

  const handleToggleAll = useCallback((selected: boolean) => {
    setCandidates((prev) => toggleAll(prev, selected));
  }, []);

  const handleUpdateInterval = useCallback((index: number, value: number) => {
    setCandidates((prev) => updateInterval(prev, index, value));
  }, []);

  const handleUpdateAllIntervals = useCallback((value: number) => {
    setCandidates((prev) => updateAllIntervals(prev, value));
  }, []);

  const handleConfirm = useCallback(async () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length === 0) return;

    setIsAdding(true);
    setAddTotal(selected.length);
    setAddProgress(0);

    let successes = 0;
    let failures = 0;

    for (const candidate of selected) {
      try {
        const body: UpsertSyncPeerInput = {
          machineId: candidate.machineId ?? candidate.hostname,
          hostname: candidate.hostname,
          syncUrl: candidate.syncUrl,
          tailscaleIp: candidate.tailscaleIp,
          role: 'full',
          syncStatus: candidate.reachable ? 'reachable' : 'unknown',
          syncIntervalMs: candidate.syncIntervalSeconds * 1000,
          isSelf: false,
          publicKey: candidate.nodePublicKey ?? null,
        };
        await upsertPeer.mutateAsync(body);
        successes += 1;
      } catch {
        failures += 1;
      }
      setAddProgress((prev) => prev + 1);
    }

    setIsAdding(false);

    if (successes > 0 && failures === 0) {
      toast.success(`Added ${successes} peer${successes !== 1 ? 's' : ''}`);
    } else if (successes > 0) {
      toast.success(`Added ${successes} peer${successes !== 1 ? 's' : ''}, ${failures} failed`);
    } else {
      toast.error(`Failed to add all ${failures} peers`);
    }
    onClose();
  }, [candidates, onClose, toast, upsertPeer]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="discover-dialog-title"
      data-testid="discover-peers-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-2xl rounded-md border border-border bg-card shadow-xl">
        {step === 'loading' && (
          <div className="px-5 py-12 text-center">
            <div className="inline-block size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-xs text-muted-foreground">
              Discovering Tailscale mesh peers...
            </p>
          </div>
        )}

        {step === 'select' && (
          <SelectStep
            candidates={candidates}
            source={source}
            onToggle={handleToggle}
            onToggleAll={handleToggleAll}
            onNext={() => setStep('confirm')}
            onCancel={handleClose}
          />
        )}

        {step === 'confirm' && (
          <ConfirmStep
            candidates={candidates}
            onUpdateInterval={handleUpdateInterval}
            onUpdateAllIntervals={handleUpdateAllIntervals}
            onBack={() => setStep('select')}
            onConfirm={() => void handleConfirm()}
            isAdding={isAdding}
            addProgress={addProgress}
            addTotal={addTotal}
          />
        )}
      </div>
    </div>
  );
}
