'use client';

import type React from 'react';
import { useState } from 'react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Style = 'prose' | 'bullet' | 'timeline';

const STYLE_OPTIONS: { value: Style; label: string }[] = [
  { value: 'prose', label: 'Prose' },
  { value: 'bullet', label: 'Bullet list' },
  { value: 'timeline', label: 'Timeline' },
];

export default function NarrativeReportPage(): React.JSX.Element {
  const [scope, setScope] = useState('');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState(50);
  const [style, setStyle] = useState<Style>('prose');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; factCount: number; model: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await api.generateNarrativeReport({
        scope: scope.trim() || undefined,
        entity_type: entityType.trim() || undefined,
        limit,
        style,
      });
      if (data.ok) {
        setResult({ text: data.text, factCount: data.factCount, model: data.model });
      } else {
        setError('Report generation returned an unexpected response.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Narrative Report</h1>
        <p className="text-sm text-muted-foreground">
          Generate an LLM-written summary of your memory facts.
        </p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="nr-scope">
            Scope (optional)
          </label>
          <input
            id="nr-scope"
            type="text"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="e.g. project:agentctl"
            className="rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="nr-entity">
            Entity type (optional)
          </label>
          <input
            id="nr-entity"
            type="text"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="e.g. experience"
            className="rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="nr-limit">
            Fact limit (1–200)
          </label>
          <input
            id="nr-limit"
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.min(200, Math.max(1, Number(e.target.value))))}
            className="rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="nr-style">
            Style
          </label>
          <select
            id="nr-style"
            value={style}
            onChange={(e) => setStyle(e.target.value as Style)}
            className="rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {STYLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={loading}
        className={cn(
          'self-start rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity',
          loading && 'cursor-not-allowed opacity-50',
        )}
      >
        {loading ? 'Generating…' : 'Generate Report'}
      </button>

      {/* Error */}
      {error !== null && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Result */}
      {result !== null && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{result.factCount} facts summarized</span>
            <span>·</span>
            <span>{result.model}</span>
          </div>
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-card/60 p-4 font-mono text-sm leading-relaxed">
            {result.text}
          </pre>
        </div>
      )}
    </div>
  );
}
