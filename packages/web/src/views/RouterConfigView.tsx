'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '../components/ErrorBanner';
import { FetchingBar } from '../components/FetchingBar';
import { RefreshButton } from '../components/RefreshButton';
import type { ModelDeploymentInfo } from '../lib/api';
import { healthQuery, routerModelsInfoQuery } from '../lib/queries';

// ---------------------------------------------------------------------------
// Helpers — extract display fields from a ModelDeploymentInfo
// ---------------------------------------------------------------------------

function extractProvider(d: ModelDeploymentInfo): string {
  const customProvider = d.litellmParams?.custom_llm_provider;
  if (typeof customProvider === 'string') return customProvider;

  const model = d.litellmParams?.model;
  if (typeof model === 'string') {
    if (model.startsWith('bedrock/')) return 'AWS Bedrock';
    if (model.startsWith('vertex_ai/')) return 'Google Vertex AI';
    if (model.startsWith('azure/')) return 'Azure OpenAI';
    if (model.startsWith('openai/')) return 'OpenAI';
  }

  return 'Anthropic';
}

function extractCost(info: Record<string, unknown>, key: string): string | null {
  const val = info[key];
  if (typeof val === 'number') return val.toFixed(6);
  if (typeof val === 'string') return val;
  return null;
}

// ---------------------------------------------------------------------------
// Router config view — LiteLLM proxy status and model list
// ---------------------------------------------------------------------------

export function RouterConfigView(): React.JSX.Element {
  const health = useQuery(healthQuery());
  const modelsInfo = useQuery(routerModelsInfoQuery());
  const litellm = health.data?.dependencies?.litellm;

  const isFetching =
    (health.isFetching && !health.isLoading) || (modelsInfo.isFetching && !modelsInfo.isLoading);

  const deployments = modelsInfo.data?.deployments ?? [];

  return (
    <div className="relative p-4 md:p-6 max-w-3xl space-y-6 animate-page-enter">
      <FetchingBar isFetching={isFetching} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Settings
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight">LiteLLM Router</h1>
        </div>
        <RefreshButton
          onClick={() => {
            void health.refetch();
            void modelsInfo.refetch();
          }}
          isFetching={isFetching}
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
                <span className="font-mono text-xs">{litellm.latencyMs?.toFixed(0) ?? '-'}ms</span>
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

          {modelsInfo.isLoading && (
            <div className="space-y-2 py-4" data-testid="router-models-loading-skeleton">
              <Skeleton className="mx-auto h-4 w-40" />
              <Skeleton className="mx-auto h-4 w-56" />
            </div>
          )}

          {modelsInfo.error && !modelsInfo.isLoading && (
            <div className="py-4 text-center space-y-2">
              <p className="text-xs text-destructive">
                {litellm?.status === 'ok'
                  ? 'Failed to load model info from LiteLLM.'
                  : 'LiteLLM proxy is not configured. Configure the LITELLM_BASE_URL environment variable on the control plane to enable model routing.'}
              </p>
              {litellm?.status === 'ok' && (
                <button
                  type="button"
                  onClick={() => void modelsInfo.refetch()}
                  className="text-xs text-primary hover:underline"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {!modelsInfo.isLoading && !modelsInfo.error && deployments.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No models configured in LiteLLM.
            </p>
          )}

          {deployments.length > 0 && (
            <div className="space-y-2">
              {deployments.map((d) => {
                const provider = extractProvider(d);
                const inputCost = extractCost(d.modelInfo, 'input_cost_per_token');
                const outputCost = extractCost(d.modelInfo, 'output_cost_per_token');

                return (
                  <div
                    key={d.modelName}
                    className="flex items-center justify-between py-2 px-3 bg-muted rounded-md"
                  >
                    <div>
                      <div className="text-[13px] font-medium">{d.modelName}</div>
                      {typeof d.litellmParams?.model === 'string' &&
                        d.litellmParams.model !== d.modelName && (
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {d.litellmParams.model}
                          </div>
                        )}
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-muted-foreground">{provider}</div>
                      {inputCost && outputCost ? (
                        <div className="text-[10px] text-muted-foreground">
                          ${inputCost}/tok in &middot; ${outputCost}/tok out
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Failover Configuration */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold mb-3">Failover Strategy</h2>
          <p className="text-[11px] text-muted-foreground mb-3">
            Failover order is determined by the LiteLLM proxy configuration. Edit the LiteLLM config
            to change priorities and retry behavior.
          </p>
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
