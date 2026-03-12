'use client';

import type React from 'react';
import { type ChangeEvent, useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Agent, AgentConfig } from '@/lib/api';
import { useUpdateAgent } from '@/lib/queries';

import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpServerEntry = {
  name: string;
  command: string;
  args: string;
  envPairs: ReadonlyArray<{ key: string; value: string }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyMcpEntry(): McpServerEntry {
  return { name: '', command: '', args: '', envPairs: [] };
}

function mcpEntriesToRecord(
  entries: ReadonlyArray<McpServerEntry>,
): Record<string, { command: string; args?: string[]; env?: Record<string, string> }> | undefined {
  const record: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> =
    {};
  for (const entry of entries) {
    const key = entry.name.trim();
    if (!key || !entry.command.trim()) continue;
    const args = entry.args
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const env: Record<string, string> = {};
    for (const pair of entry.envPairs) {
      if (pair.key.trim()) env[pair.key.trim()] = pair.value;
    }
    record[key] = {
      command: entry.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function mcpRecordToEntries(
  record:
    | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
    | undefined,
): McpServerEntry[] {
  if (!record) return [];
  return Object.entries(record).map(([name, cfg]) => ({
    name,
    command: cfg.command,
    args: cfg.args?.join(', ') ?? '',
    envPairs: cfg.env ? Object.entries(cfg.env).map(([key, value]) => ({ key, value })) : [],
  }));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type McpServersTabProps = {
  agent: Agent;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpServersTab({ agent }: McpServersTabProps): React.JSX.Element {
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  const [mcpEntries, setMcpEntries] = useState<McpServerEntry[]>(
    mcpRecordToEntries(agent.config?.mcpServers),
  );

  // Track initial serialization for dirty check
  const initialSerialized = JSON.stringify(mcpRecordToEntries(agent.config?.mcpServers));
  const currentSerialized = JSON.stringify(mcpEntries);
  const isDirty = currentSerialized !== initialSerialized;

  // -------------------------------------------------------------------
  // MCP entry CRUD (immutable updates)
  // -------------------------------------------------------------------

  const addMcpEntry = useCallback(() => {
    setMcpEntries((prev) => [...prev, createEmptyMcpEntry()]);
  }, []);

  const removeMcpEntry = useCallback((index: number) => {
    setMcpEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateMcpEntry = useCallback(
    (index: number, field: keyof McpServerEntry, value: string) => {
      setMcpEntries((prev) =>
        prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
      );
    },
    [],
  );

  const addMcpEnvPair = useCallback((entryIndex: number) => {
    setMcpEntries((prev) =>
      prev.map((entry, i) =>
        i === entryIndex
          ? { ...entry, envPairs: [...entry.envPairs, { key: '', value: '' }] }
          : entry,
      ),
    );
  }, []);

  const removeMcpEnvPair = useCallback((entryIndex: number, pairIndex: number) => {
    setMcpEntries((prev) =>
      prev.map((entry, i) =>
        i === entryIndex
          ? { ...entry, envPairs: entry.envPairs.filter((_, pi) => pi !== pairIndex) }
          : entry,
      ),
    );
  }, []);

  const updateMcpEnvPair = useCallback(
    (entryIndex: number, pairIndex: number, field: 'key' | 'value', val: string) => {
      setMcpEntries((prev) =>
        prev.map((entry, i) =>
          i === entryIndex
            ? {
                ...entry,
                envPairs: entry.envPairs.map((pair, pi) =>
                  pi === pairIndex ? { ...pair, [field]: val } : pair,
                ),
              }
            : entry,
        ),
      );
    },
    [],
  );

  // -------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------

  const handleSave = useCallback(() => {
    const config: AgentConfig = { ...agent.config };
    const mcpRecord = mcpEntriesToRecord(mcpEntries);
    if (mcpRecord) {
      config.mcpServers = mcpRecord;
    } else {
      delete config.mcpServers;
    }

    updateAgent.mutate(
      { id: agent.id, config },
      {
        onSuccess: () => toast.success('MCP servers saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [agent.id, agent.config, mcpEntries, updateAgent, toast]);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          MCP server definitions written to <code className="font-mono text-xs">.mcp.json</code>{' '}
          before agent startup.
        </p>

        <div className="space-y-4">
          {mcpEntries.map((entry, idx) => (
            <div
              key={`mcp-${idx}`}
              className="space-y-3 rounded-md border border-border p-4 bg-muted/30"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Server {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeMcpEntry(idx)}
                  disabled={updateAgent.isPending}
                  className="text-xs text-destructive hover:text-destructive/80 transition-colors"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`mcp-${idx}-name`} className="text-[11px] text-muted-foreground">
                    Name (key)
                  </Label>
                  <Input
                    id={`mcp-${idx}-name`}
                    placeholder="e.g. filesystem"
                    value={entry.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateMcpEntry(idx, 'name', e.target.value)
                    }
                    disabled={updateAgent.isPending}
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`mcp-${idx}-command`}
                    className="text-[11px] text-muted-foreground"
                  >
                    Command
                  </Label>
                  <Input
                    id={`mcp-${idx}-command`}
                    placeholder="e.g. npx"
                    value={entry.command}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      updateMcpEntry(idx, 'command', e.target.value)
                    }
                    disabled={updateAgent.isPending}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`mcp-${idx}-args`} className="text-[11px] text-muted-foreground">
                  Args (comma-separated)
                </Label>
                <Input
                  id={`mcp-${idx}-args`}
                  placeholder="e.g. -y, @modelcontextprotocol/server-filesystem, /path"
                  value={entry.args}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    updateMcpEntry(idx, 'args', e.target.value)
                  }
                  disabled={updateAgent.isPending}
                />
              </div>

              {/* Env vars */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Environment Variables</span>
                  <button
                    type="button"
                    onClick={() => addMcpEnvPair(idx)}
                    disabled={updateAgent.isPending}
                    className="text-[11px] text-primary hover:text-primary/80 transition-colors"
                  >
                    + Add Variable
                  </button>
                </div>
                {entry.envPairs.map((pair, pairIdx) => (
                  <div key={`env-${idx}-${pairIdx}`} className="flex items-center gap-1.5">
                    <Input
                      placeholder="KEY"
                      value={pair.key}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateMcpEnvPair(idx, pairIdx, 'key', e.target.value)
                      }
                      disabled={updateAgent.isPending}
                      className="flex-1 font-mono text-xs"
                    />
                    <span className="text-muted-foreground text-xs">=</span>
                    <Input
                      placeholder="value"
                      value={pair.value}
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        updateMcpEnvPair(idx, pairIdx, 'value', e.target.value)
                      }
                      disabled={updateAgent.isPending}
                      className="flex-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeMcpEnvPair(idx, pairIdx)}
                      disabled={updateAgent.isPending}
                      className="text-xs text-destructive hover:text-destructive/80 transition-colors shrink-0"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMcpEntry}
            disabled={updateAgent.isPending}
          >
            + Add MCP Server
          </Button>
        </div>
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
