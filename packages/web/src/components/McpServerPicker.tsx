'use client';

import type { AgentMcpOverride, CustomMcpServer, ManagedRuntime } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { type ChangeEvent, useCallback, useMemo, useState } from 'react';

import type { DiscoveredMcpServer } from '../lib/api';
import { mcpDiscoverQuery, mcpTemplatesQuery } from '../lib/queries';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpServerRow = {
  name: string;
  command: string;
  args?: string[];
  source: 'project' | 'machine' | 'global' | 'template' | 'custom';
  /** Whether this server is active (not excluded). */
  enabled: boolean;
  /** Config file where it was discovered. */
  configFile?: string;
};

export type McpServerPickerProps = {
  machineId: string;
  runtime: ManagedRuntime;
  projectPath?: string;
  /** Current override state for this agent. */
  currentOverrides: AgentMcpOverride;
  /** Called when overrides change. */
  onChange: (overrides: AgentMcpOverride) => void;
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceBadge(source: McpServerRow['source']): {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
} {
  switch (source) {
    case 'project':
      return { label: 'project', variant: 'default' };
    case 'global':
      return { label: 'machine default', variant: 'secondary' };
    case 'machine':
      return { label: 'machine default', variant: 'secondary' };
    case 'template':
      return { label: 'template', variant: 'outline' };
    case 'custom':
      return { label: 'custom', variant: 'destructive' };
  }
}

function buildServerRows(
  discovered: DiscoveredMcpServer[],
  overrides: AgentMcpOverride,
): McpServerRow[] {
  const rows: McpServerRow[] = [];
  const seen = new Set<string>();

  // Discovered servers: all included by default unless excluded
  for (const server of discovered) {
    seen.add(server.name);
    rows.push({
      name: server.name,
      command: server.config.command,
      args: server.config.args,
      source: server.source,
      enabled: !overrides.excluded.includes(server.name),
      configFile: server.configFile,
    });
  }

  // Custom servers from overrides
  for (const custom of overrides.custom) {
    if (!seen.has(custom.name)) {
      seen.add(custom.name);
      rows.push({
        name: custom.name,
        command: custom.command,
        args: custom.args,
        source: 'custom',
        enabled: true,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Custom Server Form (inline)
// ---------------------------------------------------------------------------

type CustomServerFormState = {
  name: string;
  command: string;
  args: string;
};

function createEmptyCustomForm(): CustomServerFormState {
  return { name: '', command: '', args: '' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpServerPicker({
  machineId,
  runtime,
  projectPath,
  currentOverrides,
  onChange,
  disabled = false,
}: McpServerPickerProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState<CustomServerFormState>(createEmptyCustomForm);

  const discoverQuery = useQuery({
    ...mcpDiscoverQuery(machineId, runtime, projectPath),
    enabled: !!machineId && isExpanded,
  });

  const templatesQueryResult = useQuery({
    ...mcpTemplatesQuery(),
    enabled: isExpanded,
  });

  const discovered = discoverQuery.data?.discovered ?? [];

  const serverRows = useMemo(
    () => buildServerRows(discovered, currentOverrides),
    [discovered, currentOverrides],
  );

  const enabledCount = serverRows.filter((r) => r.enabled).length;

  const handleToggle = useCallback(
    (row: McpServerRow) => {
      if (row.source === 'custom') {
        // Custom servers are removed by the remove button, not toggled
        return;
      }

      // Toggle discovered server exclusion
      const isCurrentlyExcluded = currentOverrides.excluded.includes(row.name);
      const nextExcluded = isCurrentlyExcluded
        ? currentOverrides.excluded.filter((n) => n !== row.name)
        : [...currentOverrides.excluded, row.name];

      onChange({
        ...currentOverrides,
        excluded: nextExcluded,
      });
    },
    [currentOverrides, onChange],
  );

  const handleAddCustom = useCallback(() => {
    const name = customForm.name.trim();
    const command = customForm.command.trim();
    if (!name || !command) return;

    const args = customForm.args
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const newCustom: CustomMcpServer = {
      name,
      command,
      ...(args.length > 0 ? { args } : {}),
    };

    onChange({
      ...currentOverrides,
      custom: [...currentOverrides.custom, newCustom],
    });
    setCustomForm(createEmptyCustomForm());
    setShowCustomForm(false);
  }, [customForm, currentOverrides, onChange]);

  const handleRemoveCustom = useCallback(
    (name: string) => {
      onChange({
        ...currentOverrides,
        custom: currentOverrides.custom.filter((c) => c.name !== name),
      });
    },
    [currentOverrides, onChange],
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-xs">{isExpanded ? '\u25BE' : '\u25B8'}</span>
        MCP Servers
        {enabledCount > 0 && (
          <span className="text-[10px] text-primary">({enabledCount} enabled)</span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2 pl-4 border-l-2 border-border">
          {/* Loading state */}
          {(discoverQuery.isLoading || templatesQueryResult.isLoading) && (
            <p className="text-[11px] text-muted-foreground animate-pulse">
              Scanning for MCP servers...
            </p>
          )}

          {/* Error state */}
          {discoverQuery.isError && (
            <p className="text-[11px] text-destructive">
              Discovery failed: {discoverQuery.error?.message ?? 'Unknown error'}
            </p>
          )}

          {/* Server list */}
          {serverRows.length > 0 && (
            <div className="space-y-1.5">
              {serverRows.map((row) => {
                const badge = sourceBadge(row.source);

                return (
                  <div
                    key={row.name}
                    className={`flex items-center gap-2 rounded-md border p-2 transition-colors ${
                      row.enabled
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-muted/20 opacity-70'
                    }`}
                  >
                    {/* Toggle checkbox */}
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={() => handleToggle(row)}
                      disabled={disabled || row.source === 'custom'}
                      className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                      aria-label={`Toggle ${row.name}`}
                    />

                    {/* Server info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs font-medium truncate font-mono ${
                            !row.enabled ? 'line-through text-muted-foreground' : ''
                          }`}
                        >
                          {row.name}
                        </span>
                        <Badge variant={badge.variant} className="text-[9px] px-1 py-0 h-4">
                          {badge.label}
                        </Badge>
                        {!row.enabled && row.source !== 'custom' && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                            excluded
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {row.command}
                        {row.args ? ` ${row.args.join(' ')}` : ''}
                      </p>
                    </div>

                    {/* Remove button for custom servers */}
                    {row.source === 'custom' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCustom(row.name)}
                        disabled={disabled}
                        className="text-xs text-destructive hover:text-destructive/80 transition-colors shrink-0"
                      >
                        x
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* No servers discovered */}
          {!discoverQuery.isLoading &&
            !templatesQueryResult.isLoading &&
            serverRows.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No MCP servers discovered. Add a custom server below.
              </p>
            )}

          {/* Custom server form */}
          {showCustomForm && (
            <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">Custom MCP Server</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="custom-mcp-name">
                    Name (key)
                  </label>
                  <Input
                    id="custom-mcp-name"
                    placeholder="e.g. my-server"
                    value={customForm.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setCustomForm({ ...customForm, name: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor="custom-mcp-cmd">
                    Command
                  </label>
                  <Input
                    id="custom-mcp-cmd"
                    placeholder="e.g. npx"
                    value={customForm.command}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setCustomForm({ ...customForm, command: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground" htmlFor="custom-mcp-args">
                  Args (comma-separated)
                </label>
                <Input
                  id="custom-mcp-args"
                  placeholder="e.g. -y, @mcp/server-thing, /path"
                  value={customForm.args}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setCustomForm({ ...customForm, args: e.target.value })
                  }
                  disabled={disabled}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleAddCustom}
                  disabled={disabled || !customForm.name.trim() || !customForm.command.trim()}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCustomForm(false);
                    setCustomForm(createEmptyCustomForm());
                  }}
                  disabled={disabled}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {!showCustomForm && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowCustomForm(true)}
                disabled={disabled}
              >
                + Custom Server
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
            Discovered servers are inherited from machine config. Uncheck to exclude.
          </p>
        </div>
      )}
    </div>
  );
}
