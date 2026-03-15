'use client';

import type { AgentRuntimeConfigOverrides } from '@agentctl/shared';
import { isManagedRuntime } from '@agentctl/shared';
import type React from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Agent, AgentConfig } from '@/lib/api';
import { useUpdateAgent } from '@/lib/queries';

import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel value for "Use fleet default" since Radix Select requires non-empty strings. */
const DEFAULT_SENTINEL = '__default__';

const SANDBOX_OPTIONS = [
  { value: DEFAULT_SENTINEL, label: 'Use fleet default' },
  { value: 'read-only', label: 'Read Only' },
  { value: 'workspace-write', label: 'Workspace Write' },
  { value: 'danger-full-access', label: 'Full Access (Danger)' },
] as const;

const APPROVAL_OPTIONS = [
  { value: DEFAULT_SENTINEL, label: 'Use fleet default' },
  { value: 'untrusted', label: 'Untrusted' },
  { value: 'on-failure', label: 'On Failure' },
  { value: 'on-request', label: 'On Request' },
  { value: 'never', label: 'Never' },
] as const;

const REASONING_OPTIONS = [
  { value: DEFAULT_SENTINEL, label: 'Use fleet default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

const PROVIDER_OPTIONS = [
  { value: DEFAULT_SENTINEL, label: 'Use fleet default' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure OpenAI' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an override value to the Select value (using sentinel for undefined). */
function toSelectValue(v: string | undefined): string {
  return v ?? DEFAULT_SENTINEL;
}

/** Convert a Select value back to an override value (stripping sentinel). */
function fromSelectValue(v: string): string | undefined {
  return v === DEFAULT_SENTINEL ? undefined : v;
}

/** Build an AgentRuntimeConfigOverrides from the current form state, omitting undefined values. */
function buildOverrides(
  sandbox: string | undefined,
  approvalPolicy: string | undefined,
  reasoningEffort: string | undefined,
  modelProvider: string | undefined,
): AgentRuntimeConfigOverrides {
  const result: AgentRuntimeConfigOverrides = {};
  if (sandbox) result.sandbox = sandbox as AgentRuntimeConfigOverrides['sandbox'];
  if (approvalPolicy)
    result.approvalPolicy = approvalPolicy as AgentRuntimeConfigOverrides['approvalPolicy'];
  if (reasoningEffort)
    result.codexReasoningEffort =
      reasoningEffort as AgentRuntimeConfigOverrides['codexReasoningEffort'];
  if (modelProvider)
    result.codexModelProvider = modelProvider as AgentRuntimeConfigOverrides['codexModelProvider'];
  return result;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type RuntimeConfigTabProps = {
  agent: Agent;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuntimeConfigTab({ agent }: RuntimeConfigTabProps): React.JSX.Element {
  if (!agent.runtime || !isManagedRuntime(agent.runtime)) {
    return (
      <div className="space-y-6 max-w-xl">
        <p className="text-sm text-muted-foreground">
          Runtime config is only available for managed runtimes (claude-code, codex).
        </p>
      </div>
    );
  }

  return <RuntimeConfigTabInner agent={agent} runtime={agent.runtime} />;
}

// ---------------------------------------------------------------------------
// Inner component (hooks after early return guard)
// ---------------------------------------------------------------------------

function RuntimeConfigTabInner({
  agent,
  runtime,
}: {
  agent: Agent;
  runtime: 'claude-code' | 'codex';
}): React.JSX.Element {
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  const overrides = agent.config?.runtimeConfigOverrides ?? {};

  const [sandbox, setSandbox] = useState(toSelectValue(overrides.sandbox));
  const [approvalPolicy, setApprovalPolicy] = useState(toSelectValue(overrides.approvalPolicy));
  const [reasoningEffort, setReasoningEffort] = useState(
    toSelectValue(overrides.codexReasoningEffort),
  );
  const [modelProvider, setModelProvider] = useState(toSelectValue(overrides.codexModelProvider));

  const isCodex = runtime === 'codex';

  const currentOverrides = buildOverrides(
    fromSelectValue(sandbox),
    fromSelectValue(approvalPolicy),
    isCodex ? fromSelectValue(reasoningEffort) : undefined,
    isCodex ? fromSelectValue(modelProvider) : undefined,
  );

  const initialSerialized = JSON.stringify(overrides);
  const currentSerialized = JSON.stringify(currentOverrides);
  const isDirty = currentSerialized !== initialSerialized;

  const handleSave = useCallback(() => {
    const config: AgentConfig = {
      ...agent.config,
      runtimeConfigOverrides:
        Object.keys(currentOverrides).length > 0 ? currentOverrides : undefined,
    };

    updateAgent.mutate(
      { id: agent.id, config },
      {
        onSuccess: () => toast.success('Runtime config saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [agent.id, agent.config, currentOverrides, updateAgent, toast]);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="text-[15px] font-semibold mb-1">Runtime Configuration Overrides</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Override fleet-wide defaults for this agent. Leave as &quot;Use fleet default&quot; to
          inherit the global setting.
        </p>
      </div>

      {/* Sandbox Level */}
      <div className="space-y-1.5">
        <Label htmlFor="sandbox-select">Sandbox Level</Label>
        <Select value={sandbox} onValueChange={setSandbox}>
          <SelectTrigger id="sandbox-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SANDBOX_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1 pt-1 text-xs text-muted-foreground">
          <p>read-only: Agent can read files but cannot write or modify anything.</p>
          <p>
            workspace-write: Agent can read and write files within the project workspace (default,
            recommended).
          </p>
          <p>danger-full-access: Agent has unrestricted filesystem access (use with caution).</p>
          <p>Applies to both Claude Code and Codex.</p>
        </div>
      </div>

      {/* Approval Policy */}
      <div className="space-y-1.5">
        <Label htmlFor="approval-select">Approval Policy</Label>
        <Select value={approvalPolicy} onValueChange={setApprovalPolicy}>
          <SelectTrigger id="approval-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPROVAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1 pt-1 text-xs text-muted-foreground">
          <p>untrusted: Every tool use requires manual approval.</p>
          <p>on-failure: Only re-approve after a tool use fails.</p>
          <p>on-request: Approve when the agent explicitly asks.</p>
          <p>never: No approval needed, fully autonomous (use with caution).</p>
          <p>Applies to both Claude Code and Codex.</p>
        </div>
      </div>

      {/* Codex-only fields */}
      {isCodex && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="reasoning-select">Reasoning Effort</Label>
            <Select value={reasoningEffort} onValueChange={setReasoningEffort}>
              <SelectTrigger id="reasoning-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONING_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="pt-1 text-xs text-muted-foreground">Codex only.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-select">Model Provider</Label>
            <Select value={modelProvider} onValueChange={setModelProvider}>
              <SelectTrigger id="provider-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="pt-1 text-xs text-muted-foreground">Codex only.</p>
          </div>
        </>
      )}

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={updateAgent.isPending || !isDirty}>
          {updateAgent.isPending ? 'Saving...' : 'Save'}
        </Button>
        {isDirty && <span className="text-xs text-muted-foreground">You have unsaved changes</span>}
      </div>
    </div>
  );
}
