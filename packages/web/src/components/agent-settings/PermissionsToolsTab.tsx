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
import { useUpdateAgent } from '@/lib/queries';

import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseToolsList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toolsToString(tools: string[] | undefined): string {
  return (tools ?? []).join(', ');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type PermissionsToolsTabProps = {
  agent: Agent;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionsToolsTab({ agent }: PermissionsToolsTabProps): React.JSX.Element {
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  const cfg = agent.config ?? {};
  const [permissionMode, setPermissionMode] = useState<string>(cfg.permissionMode ?? 'default');
  const [allowedTools, setAllowedTools] = useState(toolsToString(cfg.allowedTools));
  const [disallowedTools, setDisallowedTools] = useState(toolsToString(cfg.disallowedTools));

  const isDirty =
    permissionMode !== (cfg.permissionMode ?? 'default') ||
    allowedTools !== toolsToString(cfg.allowedTools) ||
    disallowedTools !== toolsToString(cfg.disallowedTools);

  const handleSave = useCallback(() => {
    const config: AgentConfig = { ...cfg };

    // Permission mode
    if (permissionMode && permissionMode !== 'default') {
      config.permissionMode = permissionMode as AgentConfig['permissionMode'];
    } else {
      delete config.permissionMode;
    }

    // Allowed tools
    const allowed = parseToolsList(allowedTools);
    if (allowed.length > 0) {
      config.allowedTools = allowed;
    } else {
      delete config.allowedTools;
    }

    // Disallowed tools
    const disallowed = parseToolsList(disallowedTools);
    if (disallowed.length > 0) {
      config.disallowedTools = disallowed;
    } else {
      delete config.disallowedTools;
    }

    updateAgent.mutate(
      { id: agent.id, config },
      {
        onSuccess: () => toast.success('Permissions & tools saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [agent.id, cfg, permissionMode, allowedTools, disallowedTools, updateAgent, toast]);

  return (
    <div className="space-y-6 max-w-xl">
      {/* Permission Mode */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-permission-mode">Permission Mode</Label>
        <Select
          value={permissionMode}
          onValueChange={setPermissionMode}
          disabled={updateAgent.isPending}
        >
          <SelectTrigger className="w-full" id="agent-permission-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            <SelectItem value="default">
              <span className="font-medium">Default</span>
              <span className="ml-2 text-muted-foreground text-[10px]">
                Ask before risky actions
              </span>
            </SelectItem>
            <SelectItem value="acceptEdits">
              <span className="font-medium">Accept Edits</span>
              <span className="ml-2 text-muted-foreground text-[10px]">
                Auto-approve file edits
              </span>
            </SelectItem>
            <SelectItem value="plan">
              <span className="font-medium">Plan Only</span>
              <span className="ml-2 text-muted-foreground text-[10px]">
                No file changes, planning mode
              </span>
            </SelectItem>
            <SelectItem value="bypassPermissions">
              <span className="font-medium">Bypass Permissions</span>
              <span className="ml-2 text-muted-foreground text-[10px]">
                Auto-approve everything
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Controls what actions the agent can take without manual approval.
        </p>
      </div>

      {/* Allowed Tools */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-allowed-tools">Allowed Tools</Label>
        <Input
          id="agent-allowed-tools"
          placeholder="e.g. Read, Write, Bash, Grep (comma-separated)"
          value={allowedTools}
          onChange={(e) => setAllowedTools(e.target.value)}
          disabled={updateAgent.isPending}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Comma-separated list of tools the agent is allowed to use. Leave empty to allow all.
        </p>
      </div>

      {/* Disallowed Tools */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-disallowed-tools">Disallowed Tools</Label>
        <Input
          id="agent-disallowed-tools"
          placeholder="e.g. Bash, Write (comma-separated)"
          value={disallowedTools}
          onChange={(e) => setDisallowedTools(e.target.value)}
          disabled={updateAgent.isPending}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Comma-separated list of tools the agent is not allowed to use. Overrides allowed tools.
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
