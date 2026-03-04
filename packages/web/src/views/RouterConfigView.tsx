'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { RefreshButton } from '../components/RefreshButton';
import { healthQuery } from '../lib/queries';

// ---------------------------------------------------------------------------
// Router config view — LiteLLM proxy status and model list
// ---------------------------------------------------------------------------

export function RouterConfigView(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const litellm = health.data?.dependencies?.litellm;

  return (
    <div className="relative p-4 md:p-6 max-w-3xl space-y-6 animate-fade-in">
      <FetchingBar isFetching={health.isFetching && !health.isLoading} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Settings
          </Link>
          <h1 className="text-[22px] font-bold">LiteLLM Router</h1>
        </div>
        <RefreshButton
          onClick={() => void health.refetch()}
          isFetching={health.isFetching && !health.isLoading}
        />
      </div>

      {health.error && (
        <ErrorBanner message={health.error.message} onRetry={() => void health.refetch()} />
      )}

      {/* Proxy Status */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3">Proxy Status</h2>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">LiteLLM Proxy</span>
              <span
                className={cn(
                  'font-medium',
                  litellm?.status === 'ok' ? 'text-green-500' : 'text-muted-foreground',
                )}
              >
                {health.isLoading
                  ? 'Checking...'
                  : litellm?.status === 'ok'
                    ? 'Connected'
                    : litellm
                      ? `Error: ${litellm.error ?? 'Unknown'}`
                      : 'Not configured'}
              </span>
            </div>
            {litellm && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Latency</span>
                <span className="font-mono text-xs">{litellm.latencyMs}ms</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Model Configuration */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3">Available Models</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Models configured in LiteLLM for multi-provider failover routing.
          </p>
          <div className="space-y-2">
            {MODELS.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-2 px-3 bg-muted rounded-sm"
              >
                <div>
                  <div className="text-[13px] font-medium">{m.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{m.id}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-muted-foreground">{m.provider}</div>
                  <div className="text-[10px] text-muted-foreground">
                    ${m.inputCostPer1k}/1K in &middot; ${m.outputCostPer1k}/1K out
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Failover Configuration */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3">Failover Strategy</h2>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Primary</span>
              <span className="font-mono text-xs">Anthropic Direct</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fallback 1</span>
              <span className="font-mono text-xs">AWS Bedrock</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fallback 2</span>
              <span className="font-mono text-xs">Google Vertex AI</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Retry on error</span>
              <span className="font-mono text-xs">3 attempts</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Static model list — in production this would come from the API
const MODELS = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    inputCostPer1k: '0.015',
    outputCostPer1k: '0.075',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    inputCostPer1k: '0.003',
    outputCostPer1k: '0.015',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    inputCostPer1k: '0.0008',
    outputCostPer1k: '0.004',
  },
];
