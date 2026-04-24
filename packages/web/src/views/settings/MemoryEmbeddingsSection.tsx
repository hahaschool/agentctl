'use client';

import type { EmbeddingProvider } from '@agentctl/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, Star, TestTube2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ProviderDialog, type ProviderDialogSaveBody } from '@/components/memory/ProviderDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ApiError,
  type CreateProviderBody,
  memoryProvidersApi,
  type ProviderTestResult,
} from '@/lib/api';
import { memoryProvidersQuery, queryKeys } from '@/lib/queries';
import { cn } from '@/lib/utils';

type SavedProviderTestState =
  | (Omit<ProviderTestResult, 'ok'> & { ok: true })
  | { ok: false; error?: string };

function providerLabel(provider: EmbeddingProvider['provider']): string {
  return provider === 'openai' ? 'OpenAI' : 'Gemini';
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function passedTestStatus(result: { dim?: number | null; latencyMs?: number | null }): string {
  const latency = result.latencyMs ? ` · ${result.latencyMs}ms` : '';
  const dim = result.dim ? ` · dim ${result.dim}` : '';
  return `Test passed${dim}${latency}`;
}

function testFailed(provider: EmbeddingProvider, testResult?: SavedProviderTestState): boolean {
  return testResult ? testResult.ok === false : provider.metadata.lastTestOk === false;
}

function testStatus(provider: EmbeddingProvider, testResult?: SavedProviderTestState): string {
  if (testResult) {
    if (testResult.ok) {
      return passedTestStatus(testResult);
    }
    return testResult.error ? `Test failed: ${testResult.error}` : 'Test failed';
  }
  if (provider.metadata.lastTestOk === true) {
    return passedTestStatus(provider.metadata);
  }
  if (provider.metadata.lastTestOk === false) {
    return provider.metadata.lastTestError
      ? `Test failed: ${provider.metadata.lastTestError}`
      : 'Test failed';
  }
  return 'Not tested';
}

function ProviderRow({
  provider,
  testResult,
  actionPending,
  onEdit,
  onSetActive,
  onTest,
  onDelete,
}: {
  provider: EmbeddingProvider;
  testResult?: SavedProviderTestState;
  actionPending: boolean;
  onEdit: () => void;
  onSetActive: () => void;
  onTest: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <li className="border-border/40 border-b py-4 last:border-b-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{provider.name}</span>
            {provider.isActive && (
              <Badge className="bg-green-600/10 text-green-700 dark:text-green-300">Active</Badge>
            )}
            {testFailed(provider, testResult) && (
              <Badge variant="outline" className="border-red-500/30 text-red-700 dark:text-red-300">
                Test failed
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{providerLabel(provider.provider)}</span>
            <span className="font-mono text-xs text-foreground">{provider.model}</span>
            {provider.apiKeyLast4 && <span>Key ending {provider.apiKeyLast4}</span>}
          </div>
          <div
            className={cn(
              'text-xs',
              testFailed(provider, testResult)
                ? 'text-red-700 dark:text-red-300'
                : 'text-muted-foreground',
            )}
          >
            {testStatus(provider, testResult)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!provider.isActive && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onSetActive}
              disabled={actionPending}
              aria-label={`Set ${provider.name} active`}
            >
              <Star className="size-4" />
              Set active
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={actionPending}
            aria-label={`Test ${provider.name}`}
          >
            <TestTube2 className="size-4" />
            Test
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onEdit}
            disabled={actionPending}
            aria-label={`Edit ${provider.name}`}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDelete}
            disabled={actionPending}
            aria-label={`Delete ${provider.name}`}
            className="text-red-700 hover:text-red-700 dark:text-red-300"
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}

export function MemoryEmbeddingsSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const providersQuery = useQuery(memoryProvidersQuery());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EmbeddingProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EmbeddingProvider | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedTestResults, setSavedTestResults] = useState<Record<string, SavedProviderTestState>>(
    {},
  );

  const invalidateProviders = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.memory.providers });

  const createProvider = useMutation({
    mutationFn: memoryProvidersApi.create,
    onSuccess: () => {
      setActionError(null);
      void invalidateProviders();
    },
    onError: (error) => {
      setActionError(errorText(error, 'Failed to save provider'));
    },
  });

  const updateProvider = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProviderDialogSaveBody }) =>
      memoryProvidersApi.update(id, body),
    onSuccess: (_data, variables) => {
      setActionError(null);
      setSavedTestResults((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      void invalidateProviders();
    },
    onError: (error) => {
      setActionError(errorText(error, 'Failed to update provider'));
    },
  });

  const activateProvider = useMutation({
    mutationFn: memoryProvidersApi.setActive,
    onSuccess: () => {
      setActionError(null);
      void invalidateProviders();
    },
    onError: (error) => {
      setActionError(errorText(error, 'Failed to activate provider'));
    },
  });

  const deleteProvider = useMutation({
    mutationFn: memoryProvidersApi.remove,
    onSuccess: (_data, providerId) => {
      setActionError(null);
      setDeleteTarget(null);
      setSavedTestResults((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      void invalidateProviders();
    },
    onError: (error) => {
      setActionError(errorText(error, 'Failed to delete provider'));
    },
  });

  const testSavedProvider = useMutation({
    mutationFn: memoryProvidersApi.testSaved,
    onSuccess: (result, providerId) => {
      setActionError(null);
      setSavedTestResults((current) => ({
        ...current,
        [providerId]: result.ok ? { ...result, ok: true } : { ok: false },
      }));
    },
    onError: (error, providerId) => {
      const message = errorText(error, 'Provider test failed');
      setActionError(message);
      setSavedTestResults((current) => ({
        ...current,
        [providerId]: { ok: false, error: message },
      }));
    },
    onSettled: (_data, _error, providerId) => {
      void invalidateProviders().then(() => {
        setSavedTestResults((current) => {
          const next = { ...current };
          delete next[providerId];
          return next;
        });
      });
    },
  });

  const providers = providersQuery.data?.providers ?? [];
  const anyActionPending =
    createProvider.isPending ||
    updateProvider.isPending ||
    activateProvider.isPending ||
    deleteProvider.isPending ||
    testSavedProvider.isPending;

  async function handleSave(body: ProviderDialogSaveBody): Promise<void> {
    if (editTarget) {
      await updateProvider.mutateAsync({ id: editTarget.id, body });
    } else {
      await createProvider.mutateAsync(body as CreateProviderBody);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Embedding Providers</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Local credentials for vector search, memory writes, and maintenance backfills.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditTarget(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          Add provider
        </Button>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {actionError}
        </div>
      )}

      {providersQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {providersQuery.isError && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-3">
          <span className="text-sm text-muted-foreground">
            {errorText(providersQuery.error, 'Failed to load embedding providers')}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void providersQuery.refetch()}
          >
            <RefreshCw className="size-4" />
            Retry
          </Button>
        </div>
      )}

      {!providersQuery.isLoading && !providersQuery.isError && providers.length === 0 && (
        <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
          No embedding providers configured.
        </div>
      )}

      {providers.length > 0 && (
        <ul className="rounded-md border border-border/50 px-4">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              testResult={savedTestResults[provider.id]}
              actionPending={anyActionPending}
              onEdit={() => {
                setEditTarget(provider);
                setDialogOpen(true);
              }}
              onSetActive={() => activateProvider.mutate(provider.id)}
              onTest={() => testSavedProvider.mutate(provider.id)}
              onDelete={() => setDeleteTarget(provider)}
            />
          ))}
        </ul>
      )}

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editTarget ?? undefined}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete embedding provider?"
        description={
          deleteTarget
            ? `Delete ${deleteTarget.name}. Running memory jobs that depend on it will keep their existing records.`
            : undefined
        }
        confirmLabel="Delete provider"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteProvider.mutateAsync(deleteTarget.id);
        }}
      />
    </div>
  );
}
