'use client';

import type React from 'react';
import { cn } from '@/lib/utils';

type Machine = {
  id: string;
  hostname: string;
};

type DiscoverNewSessionFormProps = {
  machines: Machine[];
  machineId: string;
  onMachineIdChange: (value: string) => void;
  projectPath: string;
  onProjectPathChange: (value: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  creating: boolean;
  onSubmit: () => void;
};

export function DiscoverNewSessionForm({
  machines,
  machineId,
  onMachineIdChange,
  projectPath,
  onProjectPathChange,
  prompt,
  onPromptChange,
  creating,
  onSubmit,
}: DiscoverNewSessionFormProps): React.JSX.Element {
  return (
    <div className="p-4 bg-card border border-border/50 rounded-lg mb-4 flex gap-3 items-end flex-wrap">
      <div className="min-w-[120px]">
        <label
          htmlFor="new-session-machine"
          className="text-[11px] text-muted-foreground mb-1 block"
        >
          Machine
        </label>
        <select
          id="new-session-machine"
          value={machineId}
          onChange={(e) => onMachineIdChange(e.target.value)}
          disabled={creating}
          className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md font-mono text-xs outline-none box-border focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          {machines.length === 0 ? (
            <option value="">No machines</option>
          ) : (
            machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.hostname}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="flex-1 min-w-[150px]">
        <label
          htmlFor="new-session-project-path"
          className="text-[11px] text-muted-foreground mb-1 block"
        >
          Project Path
        </label>
        <input
          id="new-session-project-path"
          type="text"
          value={projectPath}
          onChange={(e) => onProjectPathChange(e.target.value)}
          disabled={creating}
          placeholder="/Users/hahaschool/my-project"
          className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md font-mono text-xs outline-none box-border focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
      </div>
      <div className="flex-[2] min-w-[200px]">
        <label
          htmlFor="new-session-prompt"
          className="text-[11px] text-muted-foreground mb-1 block"
        >
          Prompt
        </label>
        <input
          id="new-session-prompt"
          type="text"
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          disabled={creating}
          placeholder="What should Claude work on?"
          className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border rounded-md text-xs outline-none box-border focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!projectPath.trim() || !prompt.trim() || creating}
        className={cn(
          'px-[18px] py-1.5 bg-primary text-white rounded-md text-[13px] font-medium border-none cursor-pointer transition-colors hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
          (!projectPath.trim() || !prompt.trim() || creating) && 'opacity-50',
        )}
      >
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  );
}
