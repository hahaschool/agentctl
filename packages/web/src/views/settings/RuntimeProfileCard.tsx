'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import {
  ACCESS_STRATEGY_LABELS,
  RUNTIME_LABELS,
  SWITCHING_POLICY_LABELS,
  type RuntimeAccessStrategy,
  type RuntimeProfileSettings,
  type RuntimeSwitchingPolicy,
} from './types';

const ACCESS_STRATEGIES: RuntimeAccessStrategy[] = [
  'managed_only',
  'local_only',
  'prefer_managed',
  'prefer_local',
  'either',
];

const SWITCHING_POLICIES: RuntimeSwitchingPolicy[] = [
  'locked',
  'failover_only',
  'optimization_enabled',
];

export function RuntimeProfileCard({
  profile,
  allMachineIds,
  managedCredentialCount,
  onChange,
}: {
  profile: RuntimeProfileSettings;
  allMachineIds: string[];
  managedCredentialCount: number;
  onChange: (next: RuntimeProfileSettings) => void;
}): React.JSX.Element {
  const selectedAllMachines =
    allMachineIds.length > 0 &&
    allMachineIds.every((machineId) => profile.allowedMachineIds.includes(machineId));

  return (
    <article className="rounded-[24px] border border-border/50 bg-background/80 p-4 md:p-5">
      <div className="flex flex-col gap-3 border-b border-border/40 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold tracking-tight">
              {RUNTIME_LABELS[profile.runtime]}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{profile.description}</p>
          </div>
          <Badge variant="secondary" className="border border-border/40 bg-muted/70">
            {managedCredentialCount} access record{managedCredentialCount === 1 ? '' : 's'}
          </Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/40 bg-muted/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Default model
            </div>
            <div className="mt-1 text-sm font-medium">{profile.defaultModel}</div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-muted/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Access strategy
            </div>
            <div className="mt-1 text-sm font-medium">
              {ACCESS_STRATEGY_LABELS[profile.accessStrategy]}
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-muted/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Auto-switch
            </div>
            <div className="mt-1 text-sm font-medium">
              {SWITCHING_POLICY_LABELS[profile.switchingPolicy]}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor={`${profile.runtime}-default-model`}>
            Default model
          </label>
          <Select
            value={profile.defaultModel}
            onValueChange={(value) => onChange({ ...profile, defaultModel: value })}
          >
            <SelectTrigger className="w-full" id={`${profile.runtime}-default-model`}>
              <SelectValue placeholder="Select runtime model" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {profile.modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-[13px] font-medium">Access source strategy</div>
          <div className="flex flex-wrap gap-2">
            {ACCESS_STRATEGIES.map((strategy) => (
              <Button
                key={strategy}
                type="button"
                size="sm"
                variant={profile.accessStrategy === strategy ? 'default' : 'outline'}
                onClick={() => onChange({ ...profile, accessStrategy: strategy })}
              >
                {ACCESS_STRATEGY_LABELS[strategy]}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[13px] font-medium">Runtime switching</div>
          <div className="flex flex-wrap gap-2">
            {SWITCHING_POLICIES.map((policy) => (
              <Button
                key={policy}
                type="button"
                size="sm"
                variant={profile.switchingPolicy === policy ? 'default' : 'outline'}
                onClick={() => onChange({ ...profile, switchingPolicy: policy })}
              >
                {SWITCHING_POLICY_LABELS[policy]}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-medium">Allowed workers</div>
            <div className="text-[12px] text-muted-foreground">
              {selectedAllMachines
                ? 'All workers allowed'
                : `${profile.allowedMachineIds.length} worker${profile.allowedMachineIds.length === 1 ? '' : 's'} selected`}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {allMachineIds.map((machineId) => {
              const selected = profile.allowedMachineIds.includes(machineId);
              return (
                <button
                  key={machineId}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...profile,
                      allowedMachineIds: selected
                        ? profile.allowedMachineIds.filter((id) => id !== machineId)
                        : [...profile.allowedMachineIds, machineId],
                    })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/60 bg-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {machineId}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
}
