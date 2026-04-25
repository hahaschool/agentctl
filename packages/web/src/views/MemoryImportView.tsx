'use client';

import type { ImportPreview } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileJson,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  importStatusQuery,
  useCancelImport,
  usePreviewImport,
  useResumeImport,
  useRollbackImport,
  useStartImport,
} from '@/lib/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4;

type ImportSource = 'claude-mem' | 'jsonl-history';

const DEFAULT_PATHS: Record<ImportSource, string> = {
  'claude-mem': '~/.claude-mem/claude-mem.db',
  'jsonl-history': '~/.claude/projects/',
};

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------

function StepIndicator({ step, current }: { step: WizardStep; current: WizardStep }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
          done
            ? 'bg-green-500 text-white'
            : active
              ? 'bg-blue-500 text-white'
              : 'bg-muted text-muted-foreground',
        ].join(' ')}
        aria-current={active ? 'step' : undefined}
      >
        {done ? <CheckCircle2 size={14} /> : step}
      </div>
      <span
        className={[
          'text-sm font-medium',
          active ? 'text-foreground' : 'text-muted-foreground',
        ].join(' ')}
      >
        {step === 1 && 'Source'}
        {step === 2 && 'Preview'}
        {step === 3 && 'Import'}
        {step === 4 && 'Done'}
      </span>
      {step < 4 && <ChevronRight size={14} className="text-muted-foreground" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Source Detection
// ---------------------------------------------------------------------------

type Step1Props = {
  source: ImportSource;
  dbPath: string;
  loading: boolean;
  error: string | null;
  onSourceChange: (s: ImportSource) => void;
  onDbPathChange: (p: string) => void;
  onNext: () => void;
};

function Step1SourceDetection({
  source,
  dbPath,
  loading,
  error,
  onSourceChange,
  onDbPathChange,
  onNext,
}: Step1Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Choose import source</h2>
        <p className="text-sm text-muted-foreground">
          Select the source type and provide the path to the file or database.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSourceChange('claude-mem')}
          className={[
            'flex flex-col items-start gap-2 p-4 rounded-lg border-2 text-left transition-colors',
            source === 'claude-mem'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-border hover:border-muted-foreground',
          ].join(' ')}
          data-testid="source-claude-mem"
        >
          <Database size={20} className="text-blue-400" />
          <div>
            <div className="font-medium text-sm">claude-mem</div>
            <div className="text-xs text-muted-foreground">SQLite database from claude-mem</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onSourceChange('jsonl-history')}
          className={[
            'flex flex-col items-start gap-2 p-4 rounded-lg border-2 text-left transition-colors',
            source === 'jsonl-history'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-border hover:border-muted-foreground',
          ].join(' ')}
          data-testid="source-jsonl-history"
        >
          <FileJson size={20} className="text-purple-400" />
          <div>
            <div className="font-medium text-sm">JSONL history</div>
            <div className="text-xs text-muted-foreground">Claude Code conversation logs</div>
          </div>
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor="db-path-input">
          {source === 'claude-mem' ? 'Database path' : 'History directory'}
        </label>
        <input
          id="db-path-input"
          type="text"
          value={dbPath}
          onChange={(e) => onDbPathChange(e.target.value)}
          placeholder={DEFAULT_PATHS[source]}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="db-path-input"
        />
      </div>

      {error && (
        <div
          className="flex items-center gap-2 text-sm text-destructive"
          data-testid="preview-error"
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!dbPath.trim() || loading}
        className="flex items-center gap-2 px-4 py-2 rounded-md bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        data-testid="step1-next"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        Preview mapping
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Preview Mapping (real data from backend)
// ---------------------------------------------------------------------------

type Step2Props = {
  dbPath: string;
  preview: ImportPreview | null;
  error: string | null;
  onBack: () => void;
  onNext: () => void;
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  decision: 'decision',
  bugfix: 'error',
  feature: 'code_artifact',
  refactor: 'pattern',
  discovery: 'concept',
  change: 'code_artifact',
};

function Step2PreviewMapping({ dbPath, preview, error, onBack, onNext }: Step2Props) {
  const sampleTitleCounts = new Map<string, number>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Preview import</h2>
        <p className="text-sm text-muted-foreground">
          Review data from <span className="font-mono text-xs">{dbPath}</span> before importing.
        </p>
      </div>

      {preview && (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border p-3 text-center">
              <div className="text-2xl font-bold text-foreground">
                {preview.totalObservations.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Total observations</div>
            </div>
            <div className="rounded-md border border-border p-3 text-center">
              <div className="text-2xl font-bold text-green-500">
                {preview.newToImport.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">New to import</div>
            </div>
            <div className="rounded-md border border-border p-3 text-center">
              <div className="text-2xl font-bold text-yellow-500">
                {preview.alreadyImported.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Already imported</div>
            </div>
          </div>

          {/* Type breakdown */}
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                    Source type
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                    Maps to
                  </th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(preview.byType).map(([type, count]) => (
                  <tr key={type} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-blue-400">{type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-green-400">
                      {ENTITY_TYPE_LABELS[type] ?? 'concept'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sample titles */}
          {preview.sampleTitles.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recent observations
              </h3>
              <div className="space-y-1">
                {preview.sampleTitles.map((title) => {
                  const count = (sampleTitleCounts.get(title) ?? 0) + 1;
                  sampleTitleCounts.set(title, count);
                  return (
                    <div
                      key={`${title}-${count}`}
                      className="text-xs text-muted-foreground font-mono truncate px-2 py-1 bg-muted/30 rounded"
                    >
                      {title}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {preview.alreadyImported > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              <CheckCircle2 size={14} className="text-yellow-500 shrink-0" />
              <span>
                {preview.alreadyImported.toLocaleString()} observations were previously imported and
                will be skipped (deduplication).
              </span>
            </div>
          )}
        </>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          data-testid="step2-back"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!preview || preview.newToImport === 0}
          className="px-4 py-2 rounded-md bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="step2-start"
        >
          {preview && preview.newToImport === 0
            ? 'Nothing new to import'
            : `Import ${preview?.newToImport.toLocaleString() ?? ''} observations`}
        </button>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 text-sm text-destructive"
          data-testid="import-error"
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Progress
// ---------------------------------------------------------------------------

type ProgressBarProps = { value: number };

function ProgressBar({ value }: ProgressBarProps) {
  return (
    <div
      className="w-full h-2 rounded-full bg-muted overflow-hidden"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid="progress-bar"
    >
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-500"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

type Step3Props = {
  jobId: string | null;
  progress: number;
  total: number;
  imported: number;
  skipped: number;
  status: string;
  onCancel: () => void;
};

function Step3Progress({
  jobId,
  progress,
  total,
  imported,
  skipped,
  status,
  onCancel,
}: Step3Props) {
  const isRunning = status === 'running';
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Importing</h2>
        <p className="text-sm text-muted-foreground">
          {isRunning ? 'Your data is being imported into memory...' : `Import ${status}.`}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-mono">
            {progress.toLocaleString()} / {total.toLocaleString()} ({pct}%)
          </span>
        </div>
        <ProgressBar value={pct} />
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>
            <span className="text-green-500 font-mono">{imported.toLocaleString()}</span> imported
          </span>
          <span>
            <span className="text-yellow-500 font-mono">{skipped.toLocaleString()}</span> skipped
          </span>
        </div>
      </div>

      {isRunning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span>Processing...</span>
        </div>
      )}

      {isRunning && jobId && (
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-destructive hover:bg-destructive/10 transition-colors"
          data-testid="cancel-import"
        >
          <X size={14} />
          Cancel
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Summary
// ---------------------------------------------------------------------------

type Step4Props = {
  imported: number;
  skipped: number;
  errors: number;
  rolledBack: number;
  status: string;
  canRollback: boolean;
  canResume: boolean;
  rollbackPending: boolean;
  resumePending: boolean;
  onStartOver: () => void;
  onRollback: () => void;
  onResume: () => void;
};

function Step4Summary({
  imported,
  skipped,
  errors,
  rolledBack,
  status,
  canRollback,
  canResume,
  rollbackPending,
  resumePending,
  onStartOver,
  onRollback,
  onResume,
}: Step4Props) {
  const success = status === 'completed';
  const wasRolledBack = status === 'rolled_back';
  const wasInterrupted = status === 'interrupted';
  const summaryColumns = rolledBack > 0 ? 'grid-cols-4' : 'grid-cols-3';
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {success ? (
          <CheckCircle2 size={24} className="text-green-500 shrink-0" />
        ) : (
          <AlertCircle size={24} className="text-yellow-500 shrink-0" />
        )}
        <div>
          <h2 className="text-lg font-semibold">
            {success
              ? 'Import complete'
              : wasRolledBack
                ? 'Import rolled back'
                : wasInterrupted
                  ? 'Import interrupted'
                  : `Import ${status}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {success
              ? 'All data has been imported into your memory store.'
              : wasRolledBack
                ? 'Facts written by this import were removed. You can preview and import again.'
                : wasInterrupted
                  ? 'The import worker stopped before completion. Resume to continue from durable progress.'
                  : 'The import did not finish successfully.'}
          </p>
        </div>
      </div>

      <div className={`grid ${summaryColumns} gap-3`} data-testid="import-summary">
        <div className="rounded-md border border-border p-3 text-center">
          <div className="text-2xl font-bold text-green-500" data-testid="imported-count">
            {imported.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Imported</div>
        </div>
        <div className="rounded-md border border-border p-3 text-center">
          <div className="text-2xl font-bold text-yellow-500" data-testid="skipped-count">
            {skipped.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Skipped (duplicates)</div>
        </div>
        <div className="rounded-md border border-border p-3 text-center">
          <div className="text-2xl font-bold text-red-500" data-testid="errors-count">
            {errors}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Errors</div>
        </div>
        {rolledBack > 0 && (
          <div className="rounded-md border border-border p-3 text-center">
            <div className="text-2xl font-bold text-blue-500" data-testid="rolled-back-count">
              {rolledBack.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Rolled back</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {canResume && (
          <button
            type="button"
            onClick={onResume}
            disabled={resumePending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-500 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="resume-import"
          >
            {resumePending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            Resume import
          </button>
        )}
        {canRollback && (
          <button
            type="button"
            onClick={onRollback}
            disabled={rollbackPending}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-destructive/40 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="rollback-import"
          >
            {rollbackPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            Roll back import
          </button>
        )}
        <button
          type="button"
          onClick={onStartOver}
          className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          data-testid="start-over"
        >
          Start another import
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function MemoryImportView() {
  const [step, setStep] = useState<WizardStep>(1);
  const [source, setSource] = useState<ImportSource>('claude-mem');
  const [dbPath, setDbPath] = useState(DEFAULT_PATHS['claude-mem']);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);

  const isPolling = step === 3;

  const statusQuery = useQuery(importStatusQuery(isPolling));
  const previewImport = usePreviewImport();
  const startImport = useStartImport();
  const cancelImport = useCancelImport();
  const resumeImport = useResumeImport();
  const rollbackImport = useRollbackImport();

  const job = statusQuery.data?.job ?? null;
  const progress = job?.progress.current ?? 0;
  const total = job?.progress.total ?? 0;
  const imported = job?.imported ?? 0;
  const skipped = job?.skipped ?? 0;
  const errors = job?.errors ?? 0;
  const rolledBack = job?.rolledBack ?? 0;
  const jobStatus = job?.status ?? 'pending';
  const canResume = Boolean(activeJobId && job?.resumable);
  const isImportDone =
    jobStatus === 'completed' ||
    jobStatus === 'cancelled' ||
    jobStatus === 'failed' ||
    jobStatus === 'interrupted' ||
    jobStatus === 'rolled_back';

  useEffect(() => {
    if (!activeJobId && job?.id && job.sourcePath && job.id !== dismissedJobId) {
      setActiveJobId(job.id);
      setStep(job.status === 'running' ? 3 : 4);
    }
  }, [activeJobId, dismissedJobId, job?.id, job?.sourcePath, job?.status]);

  // Auto-advance from step 3 to step 4 when import completes
  useEffect(() => {
    if (isImportDone && step === 3) {
      setStep(4);
    }
  }, [isImportDone, step]);

  function handleSourceChange(newSource: ImportSource) {
    setSource(newSource);
    setDbPath(DEFAULT_PATHS[newSource]);
    setPreviewError(null);
    setImportError(null);
    setPreview(null);
  }

  function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string' && code && code !== 'UNKNOWN') return code;
      return err.message;
    }
    return fallback;
  }

  async function handlePreview() {
    setPreviewError(null);
    setImportError(null);
    try {
      const result = await previewImport.mutateAsync({ source, dbPath });
      if (result.ok) {
        setPreview(result.preview);
        setStep(2);
      } else {
        setPreviewError(result.error ?? 'Failed to preview import source');
      }
    } catch (err: unknown) {
      setPreviewError(getErrorMessage(err, 'Failed to connect to server'));
    }
  }

  async function handleStartImport() {
    setImportError(null);
    try {
      const result = await startImport.mutateAsync({ source, dbPath });
      if (result.job) {
        setDismissedJobId(null);
        setActiveJobId(result.job.id);
        setStep(3);
      } else {
        setImportError('Failed to start import');
      }
    } catch (err: unknown) {
      setImportError(getErrorMessage(err, 'Failed to start import'));
    }
  }

  function handleCancel() {
    if (activeJobId) {
      cancelImport.mutate(activeJobId);
    }
  }

  function handleRollback() {
    if (activeJobId) {
      rollbackImport.mutate(activeJobId);
    }
  }

  function handleResume() {
    if (activeJobId) {
      resumeImport.mutate(activeJobId);
      setStep(3);
    }
  }

  function handleStartOver() {
    setDismissedJobId(activeJobId);
    setStep(1);
    setDbPath(DEFAULT_PATHS[source]);
    setActiveJobId(null);
    setPreview(null);
    setPreviewError(null);
    setImportError(null);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Memory Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Migrate existing memory data from claude-mem SQLite or Claude Code JSONL session history.
        </p>
      </div>

      {/* Step indicator */}
      <nav className="flex items-center gap-1" aria-label="Import wizard steps">
        {([1, 2, 3, 4] as WizardStep[]).map((s) => (
          <StepIndicator key={s} step={s} current={step} />
        ))}
      </nav>

      {/* Step content */}
      <div className="rounded-lg border border-border p-6">
        {step === 1 && (
          <Step1SourceDetection
            source={source}
            dbPath={dbPath}
            loading={previewImport.isPending}
            error={previewError}
            onSourceChange={handleSourceChange}
            onDbPathChange={(p) => {
              setDbPath(p);
              setPreviewError(null);
            }}
            onNext={handlePreview}
          />
        )}

        {step === 2 && (
          <Step2PreviewMapping
            dbPath={dbPath}
            preview={preview}
            error={importError}
            onBack={() => setStep(1)}
            onNext={handleStartImport}
          />
        )}

        {step === 3 && (
          <Step3Progress
            jobId={activeJobId}
            progress={progress}
            total={total}
            imported={imported}
            skipped={skipped}
            status={jobStatus}
            onCancel={handleCancel}
          />
        )}

        {step === 4 && (
          <Step4Summary
            imported={imported}
            skipped={skipped}
            errors={errors}
            rolledBack={rolledBack}
            status={jobStatus}
            canRollback={Boolean(activeJobId && isImportDone && jobStatus !== 'rolled_back')}
            canResume={canResume}
            rollbackPending={rollbackImport.isPending}
            resumePending={resumeImport.isPending}
            onStartOver={handleStartOver}
            onRollback={handleRollback}
            onResume={handleResume}
          />
        )}
      </div>
    </div>
  );
}
