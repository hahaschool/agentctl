'use client';

import type { AgentSkillOverride, ManagedRuntime, ManagedSkill } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { type ChangeEvent, useCallback, useMemo, useState } from 'react';

import type { DiscoveredSkill } from '../lib/api';
import { skillDiscoverQuery } from '../lib/queries';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkillRow = {
  id: string;
  name: string;
  description: string;
  source: 'global' | 'project' | 'custom';
  enabled: boolean;
  path?: string;
  userInvokable?: boolean;
};

export type SkillPickerProps = {
  machineId: string;
  runtime: ManagedRuntime;
  projectPath?: string;
  currentOverrides: AgentSkillOverride;
  onChange: (overrides: AgentSkillOverride) => void;
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceBadge(source: SkillRow['source']): {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
} {
  switch (source) {
    case 'global':
      return { label: 'global', variant: 'secondary' };
    case 'project':
      return { label: 'project', variant: 'default' };
    case 'custom':
      return { label: 'custom', variant: 'destructive' };
  }
}

function buildSkillRows(discovered: DiscoveredSkill[], overrides: AgentSkillOverride): SkillRow[] {
  const rows: SkillRow[] = [];
  const seen = new Set<string>();

  // Discovered skills: all included by default unless excluded
  for (const skill of discovered) {
    seen.add(skill.id);
    rows.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      enabled: !overrides.excluded.includes(skill.id),
      path: skill.path,
      userInvokable: skill.userInvokable,
    });
  }

  // Custom skills from overrides
  for (const custom of overrides.custom) {
    if (!seen.has(custom.id)) {
      seen.add(custom.id);
      rows.push({
        id: custom.id,
        name: custom.name ?? custom.id,
        description: '',
        source: 'custom',
        enabled: custom.enabled,
        path: custom.path,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Custom Skill Form
// ---------------------------------------------------------------------------

type CustomSkillFormState = {
  id: string;
  path: string;
};

function createEmptyCustomSkillForm(): CustomSkillFormState {
  return { id: '', path: '' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillPicker({
  machineId,
  runtime,
  projectPath,
  currentOverrides,
  onChange,
  disabled = false,
}: SkillPickerProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState<CustomSkillFormState>(createEmptyCustomSkillForm);

  const discoverQuery = useQuery({
    ...skillDiscoverQuery(machineId, runtime, projectPath),
    enabled: !!machineId && isExpanded,
  });

  const discovered = discoverQuery.data?.discovered ?? [];

  const skillRows = useMemo(
    () => buildSkillRows(discovered, currentOverrides),
    [discovered, currentOverrides],
  );

  const enabledCount = skillRows.filter((r) => r.enabled).length;

  // Group by source
  const globalSkills = skillRows.filter((r) => r.source === 'global');
  const projectSkills = skillRows.filter((r) => r.source === 'project');
  const customSkills = skillRows.filter((r) => r.source === 'custom');

  const handleToggle = useCallback(
    (row: SkillRow) => {
      if (row.source === 'custom') {
        return;
      }

      const isCurrentlyExcluded = currentOverrides.excluded.includes(row.id);
      const nextExcluded = isCurrentlyExcluded
        ? currentOverrides.excluded.filter((id) => id !== row.id)
        : [...currentOverrides.excluded, row.id];

      onChange({
        ...currentOverrides,
        excluded: nextExcluded,
      });
    },
    [currentOverrides, onChange],
  );

  const handleAddCustom = useCallback(() => {
    const id = customForm.id.trim();
    const path = customForm.path.trim();
    if (!id || !path) return;

    const newCustom: ManagedSkill = {
      id,
      path,
      enabled: true,
      name: id,
    };

    onChange({
      ...currentOverrides,
      custom: [...currentOverrides.custom, newCustom],
    });
    setCustomForm(createEmptyCustomSkillForm());
    setShowCustomForm(false);
  }, [customForm, currentOverrides, onChange]);

  const handleRemoveCustom = useCallback(
    (id: string) => {
      onChange({
        ...currentOverrides,
        custom: currentOverrides.custom.filter((c) => c.id !== id),
      });
    },
    [currentOverrides, onChange],
  );

  const renderSkillRow = (row: SkillRow): React.JSX.Element => {
    const badge = sourceBadge(row.source);

    return (
      <div
        key={row.id}
        className={`flex items-center gap-2 rounded-md border p-2 transition-colors ${
          row.enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20 opacity-70'
        }`}
      >
        <input
          type="checkbox"
          checked={row.enabled}
          onChange={() => handleToggle(row)}
          disabled={disabled || row.source === 'custom'}
          className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
          aria-label={`Toggle ${row.name}`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-xs font-medium truncate ${
                !row.enabled ? 'line-through text-muted-foreground' : ''
              }`}
            >
              {row.name}
            </span>
            <Badge variant={badge.variant} className="text-[9px] px-1 py-0 h-4">
              {badge.label}
            </Badge>
            {row.userInvokable && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                invokable
              </Badge>
            )}
            {!row.enabled && row.source !== 'custom' && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                excluded
              </Badge>
            )}
          </div>
          {row.description && (
            <p className="text-[10px] text-muted-foreground truncate">{row.description}</p>
          )}
        </div>

        {row.source === 'custom' && (
          <button
            type="button"
            onClick={() => handleRemoveCustom(row.id)}
            disabled={disabled}
            className="text-xs text-destructive hover:text-destructive/80 transition-colors shrink-0"
          >
            x
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-xs">{isExpanded ? '\u25BE' : '\u25B8'}</span>
        Skills
        {enabledCount > 0 && (
          <span className="text-[10px] text-primary">({enabledCount} enabled)</span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2 pl-4 border-l-2 border-border">
          {/* Loading */}
          {discoverQuery.isLoading && (
            <p className="text-[11px] text-muted-foreground animate-pulse">
              Scanning for skills...
            </p>
          )}

          {/* Error */}
          {discoverQuery.isError && (
            <p className="text-[11px] text-destructive">
              Discovery failed: {discoverQuery.error?.message ?? 'Unknown error'}
            </p>
          )}

          {/* Grouped skill lists */}
          {globalSkills.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Global
              </p>
              {globalSkills.map(renderSkillRow)}
            </div>
          )}

          {projectSkills.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Project
              </p>
              {projectSkills.map(renderSkillRow)}
            </div>
          )}

          {customSkills.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Custom
              </p>
              {customSkills.map(renderSkillRow)}
            </div>
          )}

          {/* No skills */}
          {!discoverQuery.isLoading && skillRows.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No skills discovered. Add a custom skill below.
            </p>
          )}

          {/* Custom skill form */}
          {showCustomForm && (
            <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">Custom Skill</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="custom-skill-id">
                    ID
                  </label>
                  <Input
                    id="custom-skill-id"
                    placeholder="e.g. my-skill"
                    value={customForm.id}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setCustomForm({ ...customForm, id: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="custom-skill-path">
                    Path
                  </label>
                  <Input
                    id="custom-skill-path"
                    placeholder="e.g. /path/to/SKILL.md"
                    value={customForm.path}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setCustomForm({ ...customForm, path: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleAddCustom}
                  disabled={disabled || !customForm.id.trim() || !customForm.path.trim()}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCustomForm(false);
                    setCustomForm(createEmptyCustomSkillForm());
                  }}
                  disabled={disabled}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {!showCustomForm && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowCustomForm(true)}
                disabled={disabled}
              >
                + Custom Skill
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void discoverQuery.refetch();
              }}
              disabled={disabled || discoverQuery.isLoading}
            >
              Refresh
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Discovered skills are inherited from machine config. Uncheck to exclude.
          </p>
        </div>
      )}
    </div>
  );
}
