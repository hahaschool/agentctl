'use client';

import type { EmbeddingProvider } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangleIcon, SettingsIcon } from 'lucide-react';
import type React from 'react';

import { memoryProvidersQuery } from '@/lib/queries';

type MissingEmbeddingAlertProps = {
  showPeerNote?: boolean;
};

function providerNeedsAttention(provider: EmbeddingProvider | undefined): boolean {
  if (!provider) return true;
  if (provider.metadata.lastTestOk === true) return false;
  if (provider.metadata.lastTestOk === false) return true;
  return !provider.metadata.lastTestedAt;
}

function alertMessage(
  providers: readonly EmbeddingProvider[],
  activeProvider: EmbeddingProvider | undefined,
  showPeerNote: boolean,
): string {
  if (providers.length === 0) {
    return showPeerNote
      ? 'No embedding provider is configured on this machine. Configure one to run jobs here; remote jobs can still be viewed.'
      : 'No embedding provider configured. Add one to enable vector search and memory operation jobs.';
  }

  if (!activeProvider) {
    return showPeerNote
      ? 'No active embedding provider is selected on this machine. Configure one to run jobs here; remote jobs can still be viewed.'
      : 'No active embedding provider selected. Choose one in Settings to enable vector search and memory operation jobs.';
  }

  if (activeProvider.metadata.lastTestOk === false) {
    const detail = activeProvider.metadata.lastTestError ?? 'unknown error';
    return `Provider test failed: ${detail}. Update or retest the provider in Settings.`;
  }

  return 'Embedding provider has not been tested yet. Test it in Settings before running memory operation jobs.';
}

export function MissingEmbeddingAlert({
  showPeerNote = false,
}: MissingEmbeddingAlertProps): React.JSX.Element | null {
  const { data, isPending, isError } = useQuery(memoryProvidersQuery());

  if (isPending || isError) return null;

  const providers = data?.providers ?? [];
  const activeProvider = providers.find((provider) => provider.isActive);

  if (!providerNeedsAttention(activeProvider) && providers.length > 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 shadow-xs dark:text-amber-200 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 gap-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="leading-6">{alertMessage(providers, activeProvider, showPeerNote)}</p>
      </div>
      {!showPeerNote ? (
        <a
          href="/settings#memory-embeddings"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-amber-950 underline underline-offset-4 hover:text-amber-800 dark:text-amber-100 dark:hover:text-amber-50"
        >
          <SettingsIcon className="size-3.5" aria-hidden="true" />
          Go to Settings
        </a>
      ) : null}
    </div>
  );
}
