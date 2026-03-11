'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  CheckCircle2Icon,
  ClipboardCopyIcon,
  DownloadIcon,
  HeartPulseIcon,
  Loader2Icon,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ReportCardConfig, ReportType } from '@/components/memory/ReportCard';
import { ReportCard } from '@/components/memory/ReportCard';
import { ScopeSelector } from '@/components/memory/ScopeSelector';
import { Button } from '@/components/ui/button';
import type { MemoryReportTimeRange } from '@/lib/api';
import { memoryReportsQuery, useGenerateMemoryReport } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORT_CONFIGS: readonly ReportCardConfig[] = [
  {
    type: 'project-progress',
    title: 'Project Progress',
    description:
      'Summarise completed milestones, open tasks, and upcoming priorities extracted from memory.',
    icon: <CheckCircle2Icon className="size-4" aria-hidden="true" />,
  },
  {
    type: 'knowledge-health',
    title: 'Knowledge Health',
    description:
      'Analyse confidence distribution, staleness, and coverage gaps across stored facts.',
    icon: <HeartPulseIcon className="size-4" aria-hidden="true" />,
  },
  {
    type: 'activity-digest',
    title: 'Activity Digest',
    description:
      'Digest of agent activity, tool usage patterns, and notable events over the selected period.',
    icon: <ActivityIcon className="size-4" aria-hidden="true" />,
  },
] as const;

const TIME_RANGE_OPTIONS: readonly { value: MemoryReportTimeRange; label: string }[] = [
  { value: 'last-7d', label: 'Last 7 days' },
  { value: 'last-30d', label: 'Last 30 days' },
  { value: 'last-90d', label: 'Last 90 days' },
  { value: 'all-time', label: 'All time' },
] as const;

const SCOPE_OPTIONS = ['all', 'project:agentctl', 'global'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadMarkdown(markdown: string, title: string): void {
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  const filename = `${slug}-${new Date().toISOString().slice(0, 10)}.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ControlBar({
  scope,
  onScopeChange,
  timeRange,
  onTimeRangeChange,
}: {
  scope: string;
  onScopeChange: (value: string) => void;
  timeRange: MemoryReportTimeRange;
  onTimeRangeChange: (value: MemoryReportTimeRange) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <ScopeSelector value={scope} options={SCOPE_OPTIONS} onValueChange={onScopeChange} />
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Time range</span>
        <select
          aria-label="Time range"
          value={timeRange}
          onChange={(e) => onTimeRangeChange(e.target.value as MemoryReportTimeRange)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
        >
          {TIME_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ReportDisplay({
  markdown,
  title,
}: {
  markdown: string;
  title: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [markdown]);

  const handleDownload = useCallback(() => {
    downloadMarkdown(markdown, title);
  }, [markdown, title]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Generated report</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} aria-label="Copy report">
            <ClipboardCopyIcon className="size-3.5" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} aria-label="Download report">
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            Download
          </Button>
        </div>
      </div>
      <div className="prose prose-sm prose-invert max-w-none rounded-lg border border-border bg-card px-6 py-5 text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function MemoryReportsView(): React.JSX.Element {
  const [selectedType, setSelectedType] = useState<ReportType>('project-progress');
  const [scope, setScope] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<MemoryReportTimeRange>('last-30d');
  const [generatedMarkdown, setGeneratedMarkdown] = useState<string | null>(null);

  const scopeParam = scope === 'all' ? undefined : scope;

  const reportsQuery = useQuery(
    memoryReportsQuery({ reportType: selectedType, scope: scopeParam, limit: 1 }),
  );
  const latestReport = reportsQuery.data?.reports?.[0] ?? null;

  const generateMutation = useGenerateMemoryReport();

  const handleGenerate = useCallback(() => {
    generateMutation.mutate(
      { reportType: selectedType, scope: scopeParam, timeRange },
      {
        onSuccess: (data) => {
          setGeneratedMarkdown(data.report.markdown);
        },
      },
    );
  }, [generateMutation, selectedType, scopeParam, timeRange]);

  const selectedConfig = REPORT_CONFIGS.find((c) => c.type === selectedType);
  const displayMarkdown = generatedMarkdown ?? latestReport?.markdown ?? null;

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold">Memory Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate LLM-powered summaries of your agent memory data.
        </p>
      </div>

      {/* Report type selector */}
      <section aria-label="Report type">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Report type
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {REPORT_CONFIGS.map((config) => (
            <ReportCard
              key={config.type}
              config={config}
              selected={selectedType === config.type}
              onSelect={setSelectedType}
            />
          ))}
        </div>
      </section>

      {/* Controls */}
      <section aria-label="Report parameters">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Parameters
        </h2>
        <ControlBar
          scope={scope}
          onScopeChange={setScope}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
      </section>

      {/* Generate button */}
      <div>
        <Button
          onClick={handleGenerate}
          disabled={generateMutation.isPending}
          aria-label="Generate report"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              Generating…
            </>
          ) : (
            'Generate report'
          )}
        </Button>
        {generateMutation.isError ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Failed to generate report. Please try again.
          </p>
        ) : null}
      </div>

      {/* Report output */}
      {displayMarkdown ? (
        <ReportDisplay markdown={displayMarkdown} title={selectedConfig?.title ?? 'Report'} />
      ) : null}

      {/* Empty state when no report yet and no error */}
      {!displayMarkdown && !generateMutation.isPending ? (
        <p className="text-sm text-muted-foreground">
          Select a report type and click &ldquo;Generate report&rdquo; to produce a summary.
        </p>
      ) : null}
    </div>
  );
}
