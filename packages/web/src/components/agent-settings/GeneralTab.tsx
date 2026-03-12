'use client';

import type React from 'react';
import { useCallback, useState } from 'react';

import { CronBuilder } from '@/components/CronBuilder';
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
import type { Agent, Machine } from '@/lib/api';
import { AGENT_TYPES } from '@/lib/model-options';
import { useUpdateAgent } from '@/lib/queries';
import { cn } from '@/lib/utils';

import { useToast } from '../Toast';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type GeneralTabProps = {
  agent: Agent;
  machines: Machine[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GeneralTab({ agent, machines }: GeneralTabProps): React.JSX.Element {
  const updateAgent = useUpdateAgent();
  const toast = useToast();

  const [name, setName] = useState(agent.name);
  const [machineId, setMachineId] = useState(agent.machineId);
  const [type, setType] = useState<string>(agent.type);
  const [schedule, setSchedule] = useState(agent.schedule ?? '');

  const isDirty =
    name !== agent.name ||
    machineId !== agent.machineId ||
    type !== agent.type ||
    schedule !== (agent.schedule ?? '');

  const handleSave = useCallback(() => {
    if (!name.trim() || !machineId) return;

    updateAgent.mutate(
      {
        id: agent.id,
        name: name.trim(),
        machineId,
        type,
        schedule: type === 'cron' && schedule.trim() ? schedule.trim() : null,
      },
      {
        onSuccess: () => toast.success('General settings saved'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [agent.id, name, machineId, type, schedule, updateAgent, toast]);

  return (
    <div className="space-y-6 max-w-xl">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={updateAgent.isPending}
          placeholder="my-agent"
        />
      </div>

      {/* Machine */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-machine">
          Machine <span className="text-destructive">*</span>
        </Label>
        <Select value={machineId} onValueChange={setMachineId} disabled={updateAgent.isPending}>
          <SelectTrigger className="w-full" id="agent-machine">
            <SelectValue placeholder="Select a machine" />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-block w-2 h-2 rounded-full',
                      m.status === 'online' ? 'bg-green-500' : 'bg-gray-400',
                    )}
                  />
                  {m.hostname}
                  <span className="text-muted-foreground text-[11px]">({m.id})</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Type */}
      <div className="space-y-1.5">
        <Label htmlFor="agent-type">Type</Label>
        <Select value={type} onValueChange={setType} disabled={updateAgent.isPending}>
          <SelectTrigger className="w-full" id="agent-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {AGENT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                <span className="font-medium">{t.label}</span>
                <span className="ml-2 text-muted-foreground text-[10px]">{t.desc}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule (cron only) */}
      {type === 'cron' && (
        <div className="space-y-1.5">
          <Label htmlFor="agent-schedule">Schedule</Label>
          <CronBuilder
            value={schedule || '0 */6 * * *'}
            onChange={setSchedule}
            disabled={updateAgent.isPending}
          />
        </div>
      )}

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={updateAgent.isPending || !isDirty || !name.trim()}>
          {updateAgent.isPending ? 'Saving...' : 'Save'}
        </Button>
        {isDirty && <span className="text-xs text-muted-foreground">You have unsaved changes</span>}
      </div>
    </div>
  );
}
