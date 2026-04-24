'use client';

import { EMBEDDING_MODEL_CATALOG, type EmbeddingProviderKind } from '@agentctl/shared';
import { useEffect, useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ApiError,
  type CreateProviderBody,
  memoryProvidersApi,
  type ProviderMutationBody,
  type TestEphemeralResult,
} from '@/lib/api';

const VERIFIED_CATALOG = EMBEDDING_MODEL_CATALOG.filter((entry) => entry.verified);
const DEFAULT_ENTRY = VERIFIED_CATALOG[0];

type InitialProvider = {
  id: string;
  name: string;
  provider: EmbeddingProviderKind;
  model: string;
  isActive: boolean;
};

export type ProviderDialogSaveBody = CreateProviderBody | ProviderMutationBody;

export type ProviderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (body: ProviderDialogSaveBody) => Promise<void>;
  initial?: InitialProvider;
};

type TestedInput = {
  provider: EmbeddingProviderKind;
  model: string;
  apiKey: string;
};

function providerLabel(provider: EmbeddingProviderKind): string {
  return provider === 'openai' ? 'OpenAI' : 'Gemini';
}

function formatCost(costUsd: number): string {
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.0001) return '<$0.0001';
  return `$${costUsd.toFixed(4)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Provider test failed';
}

export function ProviderDialog({
  open,
  onOpenChange,
  onSave,
  initial,
}: ProviderDialogProps): React.JSX.Element {
  const nameId = useId();
  const apiKeyId = useId();
  const activeId = useId();
  const defaultProvider = initial?.provider ?? DEFAULT_ENTRY?.provider ?? 'openai';
  const defaultModel =
    initial?.model ??
    VERIFIED_CATALOG.find((entry) => entry.provider === defaultProvider)?.model ??
    DEFAULT_ENTRY?.model ??
    '';

  const [name, setName] = useState(initial?.name ?? '');
  const [provider, setProvider] = useState<EmbeddingProviderKind>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [active, setActive] = useState(initial?.isActive ?? true);
  const [testResult, setTestResult] = useState<TestEphemeralResult | null>(null);
  const [testedInput, setTestedInput] = useState<TestedInput | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextProvider = initial?.provider ?? DEFAULT_ENTRY?.provider ?? 'openai';
    const nextModel =
      initial?.model ??
      VERIFIED_CATALOG.find((entry) => entry.provider === nextProvider)?.model ??
      DEFAULT_ENTRY?.model ??
      '';
    setName(initial?.name ?? '');
    setProvider(nextProvider);
    setModel(nextModel);
    setApiKey('');
    setActive(initial?.isActive ?? true);
    setTestResult(null);
    setTestedInput(null);
    setTestError(null);
    setSaveError(null);
    setTesting(false);
    setSaving(false);
  }, [initial, open]);

  const providerOptions = useMemo(
    () => Array.from(new Set(VERIFIED_CATALOG.map((entry) => entry.provider))),
    [],
  );
  const modelOptions = useMemo(
    () => VERIFIED_CATALOG.filter((entry) => entry.provider === provider),
    [provider],
  );

  const currentInputMatchesTest =
    testResult !== null &&
    testedInput?.provider === provider &&
    testedInput.model === model &&
    testedInput.apiKey === apiKey;
  const requiresCredentialTest = !initial || apiKey.trim().length > 0;
  const canSave =
    name.trim().length > 0 &&
    !saving &&
    (!requiresCredentialTest || (apiKey.trim().length > 0 && currentInputMatchesTest));

  function resetTestState(): void {
    setTestResult(null);
    setTestedInput(null);
    setTestError(null);
  }

  function handleProviderChange(nextProvider: string): void {
    const typedProvider = nextProvider as EmbeddingProviderKind;
    const nextModel =
      VERIFIED_CATALOG.find((entry) => entry.provider === typedProvider)?.model ?? '';
    setProvider(typedProvider);
    setModel(nextModel);
    resetTestState();
  }

  function handleModelChange(nextModel: string): void {
    setModel(nextModel);
    resetTestState();
  }

  async function handleTest(): Promise<void> {
    if (!apiKey.trim() || !model) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    setTestedInput(null);
    try {
      const result = await memoryProvidersApi.testEphemeral({
        provider,
        model,
        apiKey,
      });
      setTestResult(result);
      setTestedInput({ provider, model, apiKey });
    } catch (error) {
      setTestError(errorMessage(error));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const credentialFields =
        apiKey.trim().length > 0
          ? {
              apiKey,
              recentTestResult: testResult
                ? {
                    signedToken: testResult.signedToken,
                    apiKey,
                  }
                : undefined,
            }
          : {};
      const body: ProviderDialogSaveBody = initial
        ? {
            name: name.trim(),
            active,
            ...credentialFields,
          }
        : {
            name: name.trim(),
            provider,
            model,
            active,
            ...credentialFields,
          };
      await onSave(body);
      onOpenChange(false);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? 'Edit embedding provider' : 'Add embedding provider'}
          </DialogTitle>
          <DialogDescription>
            Configure the local provider used for memory embeddings and backfill jobs.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Embedding credentials are available only on this machine and are never mesh-synced.
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="OpenAI memory"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {providerLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={handleModelChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((entry) => (
                    <SelectItem key={`${entry.provider}:${entry.model}`} value={entry.model}>
                      {entry.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={apiKeyId}>API key</Label>
            <Input
              id={apiKeyId}
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                resetTestState();
              }}
              placeholder={initial ? 'Leave blank to keep the saved key' : 'Provider API key'}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              New or rotated keys must pass a live embedding test before saving.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id={activeId}
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <Label htmlFor={activeId} className="text-sm font-normal">
              Set as active provider
            </Label>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border/50 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Credential test</div>
                <div className="text-xs text-muted-foreground">
                  Confirms the selected provider returns 1536-dimensional embeddings.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={testing || !apiKey.trim() || !model}
              >
                {testing ? 'Testing...' : 'Test credential'}
              </Button>
            </div>
            {testResult && (
              <div className="text-sm text-green-700 dark:text-green-300">
                Test passed: dim {testResult.dim}, {testResult.latencyMs}ms,{' '}
                {formatCost(testResult.costUsd)}
              </div>
            )}
            {testError && <div className="text-sm text-destructive">{testError}</div>}
          </div>

          {saveError && <div className="text-sm text-destructive">{saveError}</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving...' : 'Save provider'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
