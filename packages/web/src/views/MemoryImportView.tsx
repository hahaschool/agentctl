'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileJson,
  Loader2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { importStatusQuery, useCancelImport, useStartImport } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4;

type ImportSource = 'claude-mem' | 'jsonl-history';

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
  onSourceChange: (s: ImportSource) => void;
  onDbPathChange: (p: string) => void;
  onNext: () => void;
};

function Step1SourceDetection({
  source,
  dbPath,
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
          placeholder={
            source === 'claude-mem' ? '~/.claude-mem/claude-mem.db' : '~/.claude/projects/'
          }
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="db-path-input"
        />
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!dbPath.trim()}
        className="px-4 py-2 rounded-md bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        data-testid="step1-next"
      >
        Preview mapping
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Preview Mapping
// ---------------------------------------------------------------------------

type Step2Props = {
  source: ImportSource;
  dbPath: string;
  enableCompression: boolean;
  onCompressionChange: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
};

const FIELD_MAPPINGS: Record<ImportSource, Array<{ from: string; to: string }>> = {
  'claude-mem': [
    { from: 'observation.type', to: 'entity_type' },
    { from: 'observation.title', to: 'content' },
    { from: 'observation.facts', to: 'tags' },
    { from: 'observation.created_at', to: 'created_at' },
  ],
  'jsonl-history': [
    { from: 'message.content', to: 'content' },
    { from: 'session.id', to: 'source.session_id' },
    { from: 'turn_index', to: 'source.turn_index' },
    { from: 'timestamp', to: 'created_at' },
  ],
};

function Step2PreviewMapping({
  source,
  dbPath,
  enableCompression,
  onCompressionChange,
  onBack,
  onNext,
}: Step2Props) {
  const mappings = FIELD_MAPPINGS[source];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Preview field mapping</h2>
        <p className="text-sm text-muted-foreground">
          Review how fields from <span className="font-mono text-xs">{dbPath}</span> will be mapped
          to memory facts.
        </p>
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                Source field
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                Memory field
              </th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.from} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs text-blue-400">{m.from}</td>
                <td className="px-3 py-2 font-mono text-xs text-green-400">{m.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <input
          id="compression-toggle"
          type="checkbox"
          checked={enableCompression}
          onChange={(e) => onCompressionChange(e.target.checked)}
          className="rounded border-border"
          data-testid="compression-toggle"
        />
        <label htmlFor="compression-toggle" className="text-sm">
          Enable semantic deduplication during import
        </label>
      </div>

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
          className="px-4 py-2 rounded-md bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
          data-testid="step2-start"
        >
          Start import
        </button>
      </div>
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
  imported: number;
  status: string;
  onCancel: () => void;
};

function Step3Progress({ jobId, progress, imported, status, onCancel }: Step3Props) {
  const isRunning = status === 'running';
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Importing</h2>
        <p className="text-sm text-muted-foreground">
          {isRunning ? 'Your data is being imported into memory…' : `Import ${status}.`}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-mono">{progress}%</span>
        </div>
        <ProgressBar value={progress} />
        <div className="text-xs text-muted-foreground">{imported} facts imported</div>
      </div>

      {isRunning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span>Processing…</span>
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
  status: string;
  onStartOver: () => void;
};

function Step4Summary({ imported, skipped, errors, status, onStartOver }: Step4Props) {
  const success = status === 'completed';
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
            {success ? 'Import complete' : `Import ${status}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {success
              ? 'All data has been imported into your memory store.'
              : 'The import did not finish successfully.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3" data-testid="import-summary">
        <div className="rounded-md border border-border p-3 text-center">
          <div className="text-2xl font-bold text-green-500" data-testid="imported-count">
            {imported}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Imported</div>
        </div>
        <div className="rounded-md border border-border p-3 text-center">
          <div className="text-2xl font-bold text-yellow-500" data-testid="skipped-count">
            {skipped}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Skipped</div>
        </div>
        <div className="rounded-md border border-border p-3 text-center">
          <div className="text-2xl font-bold text-red-500" data-testid="errors-count">
            {errors}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Errors</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onStartOver}
        className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
        data-testid="start-over"
      >
        Start another import
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function MemoryImportView() {
  const [step, setStep] = useState<WizardStep>(1);
  const [source, setSource] = useState<ImportSource>('claude-mem');
  const [dbPath, setDbPath] = useState('');
  const [enableCompression, setEnableCompression] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const isPolling = step === 3;

  const statusQuery = useQuery(importStatusQuery(isPolling));
  const startImport = useStartImport();
  const cancelImport = useCancelImport();

  const job = statusQuery.data?.job ?? null;
  const progress = job?.progress.current ?? 0;
  const imported = job?.imported ?? 0;
  const skipped = job?.skipped ?? 0;
  const errors = job?.errors ?? 0;
  const jobStatus = job?.status ?? 'pending';
  const isImportDone =
    jobStatus === 'completed' || jobStatus === 'cancelled' || jobStatus === 'failed';

  // Auto-advance from step 3 to step 4 when import completes
  useEffect(() => {
    if (isImportDone && step === 3) {
      setStep(4);
    }
  }, [isImportDone, step]);

  async function handleStartImport() {
    const result = await startImport.mutateAsync({ source, dbPath });
    if (result.job) {
      setActiveJobId(result.job.id);
      setStep(3);
    }
  }

  function handleCancel() {
    if (activeJobId) {
      cancelImport.mutate(activeJobId);
    }
  }

  function handleStartOver() {
    setStep(1);
    setDbPath('');
    setActiveJobId(null);
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">Memory Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Migrate your existing memory data from claude-mem or JSONL conversation history.
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
            onSourceChange={setSource}
            onDbPathChange={setDbPath}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <Step2PreviewMapping
            source={source}
            dbPath={dbPath}
            enableCompression={enableCompression}
            onCompressionChange={setEnableCompression}
            onBack={() => setStep(1)}
            onNext={handleStartImport}
          />
        )}

        {step === 3 && (
          <Step3Progress
            jobId={activeJobId}
            progress={progress}
            imported={imported}
            status={jobStatus}
            onCancel={handleCancel}
          />
        )}

        {step === 4 && (
          <Step4Summary
            imported={imported}
            skipped={skipped}
            errors={errors}
            status={jobStatus}
            onStartOver={handleStartOver}
          />
        )}
      </div>
    </div>
  );
}
