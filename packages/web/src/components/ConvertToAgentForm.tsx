'use client';

import type React from 'react';

import { FORK_AGENT_TYPES } from '@/lib/model-options';

type ConvertToAgentFormProps = {
  convertName: string;
  onNameChange: (name: string) => void;
  convertType: string;
  onTypeChange: (type: string) => void;
  machineId: string;
  projectPath: string | null;
  model: string | null;
  isPending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
};

export function ConvertToAgentForm({
  convertName,
  onNameChange,
  convertType,
  onTypeChange,
  machineId,
  projectPath,
  model,
  isPending,
  onSubmit,
  onCancel,
}: ConvertToAgentFormProps): React.JSX.Element {
  return (
    <div className="px-5 py-4 border-b border-border bg-emerald-950/15">
      <div className="text-xs font-semibold text-emerald-400 mb-3 tracking-tight">
        Create Agent from Session
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
        <div>
          <label
            htmlFor="convert-agent-name"
            className="text-[11px] text-muted-foreground block mb-1"
          >
            Agent Name
          </label>
          <input
            id="convert-agent-name"
            type="text"
            value={convertName}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs outline-none transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40"
            placeholder="my-agent"
          />
        </div>
        <div>
          <label
            htmlFor="convert-agent-type"
            className="text-[11px] text-muted-foreground block mb-1"
          >
            Agent Type
          </label>
          <select
            id="convert-agent-type"
            value={convertType}
            onChange={(e) => onTypeChange(e.target.value)}
            className="w-full px-2.5 py-2 bg-muted text-foreground border border-border rounded-md text-xs outline-none transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40"
          >
            {FORK_AGENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.desc}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground mb-3 space-y-0.5">
        <div>
          Machine: <span className="text-foreground font-mono">{machineId}</span>
        </div>
        {projectPath && (
          <div>
            Project: <span className="text-foreground font-mono">{projectPath}</span>
          </div>
        )}
        {model && (
          <div>
            Model: <span className="text-foreground">{model}</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="h-8 px-3.5 bg-emerald-700 text-white rounded-md text-xs font-medium cursor-pointer transition-all duration-200 hover:bg-emerald-600 disabled:opacity-50"
        >
          {isPending ? 'Creating...' : 'Create Agent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3.5 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer transition-all duration-200 hover:bg-accent hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
