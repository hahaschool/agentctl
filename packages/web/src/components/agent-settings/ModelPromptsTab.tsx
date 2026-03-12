'use client';

import type React from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Agent, AgentConfig } from '@/lib/api';
import { ALL_MODELS as MODEL_OPTIONS } from '@/lib/model-options';
import { useUpdateAgent } from '@/lib/queries';
import { cn } from '@/lib/utils';

import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Textarea CSS (shared)
// ---------------------------------------------------------------------------

const TEXTAREA_CLASSES = cn(
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground resize-y',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'dark:bg-input/30',
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ModelPromptsTabProps = {
  agent: Agent;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelPromptsTab({ agent }: ModelPromptsTabProps): React.JSX.Element {
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  const cfg = agent.config ?? {};
  const [model, setModel] = useState(cfg.model ?? '');
  const [initialPrompt, setInitialPrompt] = useState(cfg.initialPrompt ?? '');
  const [defaultPrompt, setDefaultPrompt] = useState(cfg.defaultPrompt ?? '');
  const [systemPrompt, setSystemPrompt] = useState(cfg.systemPrompt ?? '');
  const [maxTurns, setMaxTurns] = useState(cfg.maxTurns != null ? String(cfg.maxTurns) : '');

  const isDirty =
    model !== (cfg.model ?? '') ||
    initialPrompt !== (cfg.initialPrompt ?? '') ||
    defaultPrompt !== (cfg.defaultPrompt ?? '') ||
    systemPrompt !== (cfg.systemPrompt ?? '') ||
    maxTurns !== (cfg.maxTurns != null ? String(cfg.maxTurns) : '');

  const handleSave = useCallback(() => {
    const config: AgentConfig = { ...cfg };

    // Model
    if (model.trim()) {
      config.model = model.trim();
    } else {
      delete config.model;
    }

    // Initial Prompt
    if (initialPrompt.trim()) {
      config.initialPrompt = initialPrompt.trim();
    } else {
      delete config.initialPrompt;
    }

    // Default Prompt
    if (defaultPrompt.trim()) {
      config.defaultPrompt = defaultPrompt.trim();
    } else {
      delete config.defaultPrompt;
    }

    // System Prompt
    if (systemPrompt.trim()) {
      config.systemPrompt = systemPrompt.trim();
    } else {
      delete config.systemPrompt;
    }

    // Max Turns
    if (maxTurns.trim() && Number(maxTurns) > 0) {
      config.maxTurns = Number(maxTurns);
    } else {
      delete config.maxTurns;
    }

    updateAgent.mutate(
      { id: agent.id, config },
      {
        onSuccess: () => toast.success('Model & prompts saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [
    agent.id,
    cfg,
    model,
    initialPrompt,
    defaultPrompt,
    systemPrompt,
    maxTurns,
    updateAgent,
    toast,
  ]);

  return (
    <div className="space-y-6 max-w-xl">
      {/* Model */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-model">Model</Label>
        <Select
          value={MODEL_OPTIONS.some((m) => m.value === model) ? model : '__custom__'}
          onValueChange={(v) => {
            if (v !== '__custom__') setModel(v);
          }}
          disabled={updateAgent.isPending}
        >
          <SelectTrigger className="w-full" id="agent-model">
            <SelectValue>
              {(MODEL_OPTIONS.find((m) => m.value === model)?.label ?? model) || 'Select model'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {MODEL_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                <span className="font-medium">{m.label}</span>
                <span
                  className={cn(
                    'ml-2 text-[10px]',
                    m.tier === 'flagship'
                      ? 'text-amber-600 dark:text-amber-400'
                      : m.tier === 'fast'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-blue-600 dark:text-blue-400',
                  )}
                >
                  {m.tier}
                </span>
              </SelectItem>
            ))}
            <SelectItem value="__custom__">
              <span className="text-muted-foreground">Custom model ID...</span>
            </SelectItem>
          </SelectContent>
        </Select>
        {!MODEL_OPTIONS.some((m) => m.value === model) && model !== '' && (
          <Input
            aria-label="Custom model ID"
            placeholder="Enter custom model ID"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={updateAgent.isPending}
            className="mt-1.5"
          />
        )}
        <p className="text-[11px] text-muted-foreground">The LLM model this agent uses.</p>
      </div>

      {/* Max Turns */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-maxturns">Max Turns</Label>
        <Input
          id="agent-maxturns"
          type="number"
          min={1}
          placeholder="unlimited"
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
          disabled={updateAgent.isPending}
        />
        <p className="text-[11px] text-muted-foreground">
          Maximum interaction turns before the agent stops. Leave empty for unlimited.
        </p>
      </div>

      {/* Initial Prompt */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-initial-prompt">Initial Prompt</Label>
        <textarea
          id="agent-initial-prompt"
          rows={4}
          placeholder="Describe what this agent should do..."
          value={initialPrompt}
          onChange={(e) => setInitialPrompt(e.target.value)}
          disabled={updateAgent.isPending}
          className={TEXTAREA_CLASSES}
        />
        <p className="text-[11px] text-muted-foreground">
          Stored in agent config. Used as the default prompt when starting the agent.
        </p>
      </div>

      {/* Default Prompt */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-default-prompt">Default Prompt</Label>
        <textarea
          id="agent-default-prompt"
          rows={3}
          placeholder="Prompt used when no explicit prompt is provided..."
          value={defaultPrompt}
          onChange={(e) => setDefaultPrompt(e.target.value)}
          disabled={updateAgent.isPending}
          className={TEXTAREA_CLASSES}
        />
        <p className="text-[11px] text-muted-foreground">
          Used when no explicit prompt is provided (e.g. cron/heartbeat triggers).
        </p>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-system-prompt">System Prompt</Label>
        <textarea
          id="agent-system-prompt"
          rows={4}
          placeholder="Custom system instructions..."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          disabled={updateAgent.isPending}
          className={TEXTAREA_CLASSES}
        />
        <p className="text-[11px] text-muted-foreground">
          Custom system instructions appended to the base prompt.
        </p>
      </div>

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
