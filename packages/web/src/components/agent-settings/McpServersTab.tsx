'use client';

import type { AgentMcpOverride, McpServerConfig } from '@agentctl/shared';
import { isManagedRuntime } from '@agentctl/shared';
import type React from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Agent, AgentConfig } from '@/lib/api';
import { useUpdateAgent } from '@/lib/queries';

import { McpServerPicker } from '../McpServerPicker';
import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert legacy flat mcpServers record to the new override model. */
function migrateToOverride(legacy: Record<string, McpServerConfig> | undefined): AgentMcpOverride {
  if (!legacy || Object.keys(legacy).length === 0) return { excluded: [], custom: [] };
  return {
    excluded: [],
    custom: Object.entries(legacy).map(([name, config]) => ({ name, ...config })),
  };
}

function getInitialOverride(agent: Agent): AgentMcpOverride {
  if (agent.config?.mcpOverride) return agent.config.mcpOverride;
  return migrateToOverride(agent.config?.mcpServers);
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

  // Guard: only show picker for managed runtimes
  // Default to 'claude-code' for agents created before runtime selection was added
  const effectiveRuntime =
    agent.runtime && isManagedRuntime(agent.runtime) ? agent.runtime : 'claude-code';

  return (
    <McpServersTabInner
      agent={agent}
      runtime={effectiveRuntime}
      updateAgent={updateAgent}
      toast={toast}
    />
  );
}

// Inner component to avoid hooks after early return
function McpServersTabInner({
  agent,
  runtime,
  updateAgent,
  toast,
}: {
  agent: Agent;
  runtime: 'claude-code' | 'codex';
  updateAgent: ReturnType<typeof useUpdateAgent>;
  toast: ReturnType<typeof useToast>;
}): React.JSX.Element {
  const [mcpOverride, setMcpOverride] = useState<AgentMcpOverride>(() => getInitialOverride(agent));

  const initialSerialized = JSON.stringify(getInitialOverride(agent));
  const currentSerialized = JSON.stringify(mcpOverride);
  const isDirty = currentSerialized !== initialSerialized;

  const handleSave = useCallback(() => {
    const config: AgentConfig = { ...agent.config };
    config.mcpOverride = mcpOverride;
    // Remove legacy field if present
    delete config.mcpServers;

    updateAgent.mutate(
      { id: agent.id, config },
      {
        onSuccess: () => toast.success('MCP servers saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [agent.id, agent.config, mcpOverride, updateAgent, toast]);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          MCP servers discovered from machine config. Uncheck to exclude, or add custom servers.
        </p>

        <McpServerPicker
          machineId={agent.machineId}
          runtime={runtime}
          projectPath={agent.projectPath ?? undefined}
          currentOverrides={mcpOverride}
          onChange={setMcpOverride}
          disabled={updateAgent.isPending}
        />
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
