'use client';

import type { AgentSkillOverride } from '@agentctl/shared';
import { isManagedRuntime } from '@agentctl/shared';
import type React from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Agent, AgentConfig } from '@/lib/api';
import { useUpdateAgent } from '@/lib/queries';

import { SkillPicker } from '../SkillPicker';
import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitialOverride(agent: Agent): AgentSkillOverride {
  return agent.config?.skillOverride ?? { excluded: [], custom: [] };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type SkillsTabProps = {
  agent: Agent;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillsTab({ agent }: SkillsTabProps): React.JSX.Element {
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  // Default to 'claude-code' for agents created before runtime selection was added
  const effectiveRuntime =
    agent.runtime && isManagedRuntime(agent.runtime) ? agent.runtime : 'claude-code';

  return (
    <SkillsTabInner
      agent={agent}
      runtime={effectiveRuntime}
      updateAgent={updateAgent}
      toast={toast}
    />
  );
}

// Inner component to avoid hooks after early return
function SkillsTabInner({
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
  const [skillOverride, setSkillOverride] = useState<AgentSkillOverride>(() =>
    getInitialOverride(agent),
  );

  const initialSerialized = JSON.stringify(getInitialOverride(agent));
  const currentSerialized = JSON.stringify(skillOverride);
  const isDirty = currentSerialized !== initialSerialized;

  const handleSave = useCallback(() => {
    const config: AgentConfig = { ...agent.config };
    config.skillOverride = skillOverride;

    updateAgent.mutate(
      { id: agent.id, config },
      {
        onSuccess: () => toast.success('Skills saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [agent.id, agent.config, skillOverride, updateAgent, toast]);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Skills discovered from machine config. Uncheck to exclude, or add custom skills.
        </p>

        <SkillPicker
          machineId={agent.machineId}
          runtime={runtime}
          projectPath={agent.projectPath ?? undefined}
          currentOverrides={skillOverride}
          onChange={setSkillOverride}
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
