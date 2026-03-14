'use client';

import { useEffect, useRef } from 'react';

import type { ManagedRuntime } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';

import { api, type Machine } from '../lib/api';
import { toast } from './Toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type RuntimeAwareMachineSelectProps = {
  runtime: ManagedRuntime;
  value: string;
  onChange: (machineId: string) => void;
  machines: Machine[];
  disabled?: boolean;
};

export function RuntimeAwareMachineSelect({
  runtime,
  value,
  onChange,
  machines,
  disabled = false,
}: RuntimeAwareMachineSelectProps): React.JSX.Element {
  // Query runtime drift to know which machines have which runtimes
  const driftQuery = useQuery({
    queryKey: ['runtime-config', 'drift'],
    queryFn: () => api.getRuntimeConfigDrift(),
    staleTime: 30_000,
  });

  const prevRuntimeRef = useRef(runtime);
  const driftItems = driftQuery.data?.items;

  // Check if a machine supports the target runtime
  const checkSupport = (machineId: string, rt: ManagedRuntime): boolean => {
    if (!driftItems) return true; // assume supported while loading
    const entry = driftItems.find(
      (d) => d.machineId === machineId && d.runtime === rt,
    );
    return entry?.isInstalled ?? true;
  };

  useEffect(() => {
    if (prevRuntimeRef.current !== runtime) {
      prevRuntimeRef.current = runtime;

      if (value && !checkSupport(value, runtime)) {
        const firstAvailable = machines.find((m) => checkSupport(m.id, runtime));
        if (firstAvailable) {
          onChange(firstAvailable.id);
          toast.info(
            `Machine reset -- ${value} does not have ${runtime} installed`,
          );
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, value, machines, onChange, driftItems]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Select machine" />
      </SelectTrigger>
      <SelectContent>
        {machines.map((m) => {
          const supported = checkSupport(m.id, runtime);
          return (
            <SelectItem
              key={m.id}
              value={m.id}
              disabled={!supported}
              className={!supported ? 'opacity-50' : ''}
            >
              {m.hostname}
              {!supported && ` (${runtime} not installed)`}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
