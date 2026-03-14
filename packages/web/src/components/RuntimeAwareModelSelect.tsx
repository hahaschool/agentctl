'use client';

import { useEffect, useRef } from 'react';

import type { ManagedRuntime } from '@agentctl/shared';

import { DEFAULT_RUNTIME_MODELS, RUNTIME_MODEL_OPTIONS } from '../lib/model-options';
import { toast } from './Toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const DEFAULT_SENTINEL = '__default__';

type RuntimeAwareModelSelectProps = {
  runtime: ManagedRuntime;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
};

export function RuntimeAwareModelSelect({
  runtime,
  value,
  onChange,
  disabled = false,
}: RuntimeAwareModelSelectProps): React.JSX.Element {
  const prevRuntimeRef = useRef(runtime);

  useEffect(() => {
    if (prevRuntimeRef.current !== runtime) {
      prevRuntimeRef.current = runtime;

      const models = RUNTIME_MODEL_OPTIONS[runtime];
      const isValid =
        !value || value === DEFAULT_SENTINEL || models.some((m) => m.value === value);
      if (!isValid) {
        const newDefault = DEFAULT_RUNTIME_MODELS[runtime];
        onChange(newDefault);
        toast.info(`Model reset to ${newDefault}`);
      }
    }
  }, [runtime, value, onChange]);

  const models = RUNTIME_MODEL_OPTIONS[runtime];

  return (
    <Select
      value={value || DEFAULT_SENTINEL}
      onValueChange={(v) => onChange(v === DEFAULT_SENTINEL ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Default" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_SENTINEL}>Default</SelectItem>
        {models.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
