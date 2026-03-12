'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useState } from 'react';

import { AgentMemorySection } from '@/components/memory/AgentMemorySection';
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
import type { Agent } from '@/lib/api';
import { memoryScopesQuery } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_MAX_TOKENS = 2400;
const DEFAULT_MEMORY_MAX_FACTS = 20;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type MemoryTabProps = {
  agent: Agent;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryTab({ agent }: MemoryTabProps): React.JSX.Element {
  const scopesQuery = useQuery(memoryScopesQuery());

  // NOTE: Memory budget is currently a create-time-only concept (not stored
  // on the agent config). We show the controls here as informational / future
  // ready. Until the API supports PATCH-ing memory budget, save is disabled.
  const [scopeId, setScopeId] = useState('');
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MEMORY_MAX_TOKENS));
  const [maxFacts, setMaxFacts] = useState(String(DEFAULT_MEMORY_MAX_FACTS));

  const handleSave = useCallback(() => {
    // Future: PATCH memory budget once API supports it
  }, []);

  return (
    <div className="space-y-8 max-w-xl">
      {/* Live memory section for this agent */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Agent Memory</h3>
        <AgentMemorySection agentId={agent.id} />
      </div>

      {/* Memory budget configuration (informational for now) */}
      <div className="space-y-4 border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">Memory Budget</h3>
          <p className="text-[11px] text-muted-foreground">
            Configure memory injection limits for this agent. These settings control how much
            context from the memory layer is injected into agent sessions.
          </p>
        </div>

        {/* Scope */}
        <div className="space-y-1.5">
          <Label htmlFor="memory-scope">Memory Scope</Label>
          <Select
            value={scopeId || '__none__'}
            onValueChange={(v) => setScopeId(v === '__none__' ? '' : v)}
          >
            <SelectTrigger className="w-full" id="memory-scope">
              <SelectValue placeholder="All scopes (default)" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="__none__">All scopes (default)</SelectItem>
              {(scopesQuery.data?.scopes ?? []).map((scope) => (
                <SelectItem key={scope.id} value={scope.id}>
                  <span className="font-medium capitalize">{scope.type}</span>
                  <span className="ml-2 text-muted-foreground text-[10px]">{scope.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Restrict memory injection to a specific scope. Leave blank to include all scopes.
          </p>
        </div>

        {/* Token / Fact limits */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="memory-max-tokens">Max Tokens</Label>
            <Input
              id="memory-max-tokens"
              type="number"
              min={100}
              max={32000}
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              placeholder={String(DEFAULT_MEMORY_MAX_TOKENS)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memory-max-facts">Max Facts</Label>
            <Input
              id="memory-max-facts"
              type="number"
              min={1}
              max={200}
              value={maxFacts}
              onChange={(e) => setMaxFacts(e.target.value)}
              placeholder={String(DEFAULT_MEMORY_MAX_FACTS)}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Default: {DEFAULT_MEMORY_MAX_TOKENS} tokens / {DEFAULT_MEMORY_MAX_FACTS} facts.
        </p>

        {/* Save (disabled until API support) */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled>
            Save
          </Button>
          <span className="text-xs text-muted-foreground">
            Memory budget updates coming in a future release.
          </span>
        </div>
      </div>
    </div>
  );
}
