'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { type ChangeEvent, useCallback, useMemo, useState } from 'react';

import type { DiscoveredMcpServer, McpServerConfig, McpServerTemplate } from '../lib/api';
import { mcpDiscoverQuery, mcpTemplatesQuery } from '../lib/queries';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpServerPicked = {
  name: string;
  config: McpServerConfig;
  source: 'project' | 'machine' | 'global' | 'template' | 'custom';
  enabled: boolean;
};

type McpServerPickerProps = {
  machineId: string;
  projectPath?: string;
  /** Currently selected MCP servers (from agent config). */
  value: Record<string, McpServerConfig>;
  /** Called when the selection changes. */
  onChange: (servers: Record<string, McpServerConfig>) => void;
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceBadge(source: McpServerPicked['source']): {
  label: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
} {
  switch (source) {
    case 'project':
      return { label: 'project', variant: 'default' };
    case 'global':
      return { label: 'global', variant: 'secondary' };
    case 'machine':
      return { label: 'machine', variant: 'secondary' };
    case 'template':
      return { label: 'template', variant: 'outline' };
    case 'custom':
      return { label: 'custom', variant: 'destructive' };
  }
}

function discoveredToPickedList(
  discovered: DiscoveredMcpServer[],
  templates: McpServerTemplate[],
  currentValue: Record<string, McpServerConfig>,
): McpServerPicked[] {
  const results: McpServerPicked[] = [];
  const seen = new Set<string>();

  // Add discovered servers
  for (const server of discovered) {
    seen.add(server.name);
    results.push({
      name: server.name,
      config: server.config,
      source: server.source,
      enabled: server.name in currentValue,
    });
  }

  // Add templates that weren't already discovered
  for (const tmpl of templates) {
    if (!seen.has(tmpl.id)) {
      seen.add(tmpl.id);
      results.push({
        name: tmpl.id,
        config: {
          command: tmpl.command,
          ...(tmpl.args ? { args: tmpl.args } : {}),
          ...(tmpl.env ? { env: tmpl.env } : {}),
        },
        source: 'template',
        enabled: tmpl.id in currentValue,
      });
    }
  }

  // Add custom servers from current value that aren't discovered or templates
  for (const [name, config] of Object.entries(currentValue)) {
    if (!seen.has(name)) {
      seen.add(name);
      results.push({
        name,
        config,
        source: 'custom',
        enabled: true,
      });
    }
  }

  return results;
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
  projectPath,
  value,
  onChange,
  disabled = false,
}: McpServerPickerProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState<CustomServerFormState>(createEmptyCustomForm);

  const discoverQuery = useQuery({
    ...mcpDiscoverQuery(machineId, projectPath),
    enabled: !!machineId && isExpanded,
  });

  const templatesQuery = useQuery({
    ...mcpTemplatesQuery(),
    enabled: isExpanded,
  });

  const discovered = discoverQuery.data?.discovered ?? [];
  const templates = templatesQuery.data?.templates ?? [];

  const pickedList = useMemo(
    () => discoveredToPickedList(discovered, templates, value),
    [discovered, templates, value],
  );

  const enabledCount = Object.keys(value).length;

  const handleToggle = useCallback(
    (server: McpServerPicked) => {
      const next = { ...value };
      if (server.enabled) {
        // Disable: remove from value
        delete next[server.name];
      } else {
        // Enable: add to value
        next[server.name] = server.config;
      }
      onChange(next);
    },
    [value, onChange],
  );

  const handleAddCustom = useCallback(() => {
    const name = customForm.name.trim();
    const command = customForm.command.trim();
    if (!name || !command) return;

    const args = customForm.args
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    const next = { ...value };
    next[name] = {
      command,
      ...(args.length > 0 ? { args } : {}),
    };
    onChange(next);
    setCustomForm(createEmptyCustomForm());
    setShowCustomForm(false);
  }, [customForm, value, onChange]);

  const handleRemoveCustom = useCallback(
    (name: string) => {
      const next = { ...value };
      delete next[name];
      onChange(next);
    },
    [value, onChange],
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
          <span className="text-[10px] text-primary">({enabledCount} configured)</span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2 pl-4 border-l-2 border-border">
          {/* Loading state */}
          {(discoverQuery.isLoading || templatesQuery.isLoading) && (
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
          {pickedList.length > 0 && (
            <div className="space-y-1.5">
              {pickedList.map((server) => {
                const badge = sourceBadge(server.source);
                const isEnabled = server.name in value;

                return (
                  <div
                    key={server.name}
                    className={`flex items-center gap-2 rounded-md border p-2 transition-colors ${
                      isEnabled
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-muted/20 opacity-70'
                    }`}
                  >
                    {/* Toggle checkbox */}
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => handleToggle(server)}
                      disabled={disabled}
                      className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                    />

                    {/* Server info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate font-mono">
                          {server.name}
                        </span>
                        <Badge variant={badge.variant} className="text-[9px] px-1 py-0 h-4">
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {server.config.command}
                        {server.config.args ? ` ${server.config.args.join(' ')}` : ''}
                      </p>
                    </div>

                    {/* Remove button for custom servers */}
                    {server.source === 'custom' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCustom(server.name)}
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
          {!discoverQuery.isLoading && !templatesQuery.isLoading && pickedList.length === 0 && (
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
            Enabled servers are written to <code className="font-mono">.mcp.json</code> before agent
            startup. Auto-detected from project and global Claude configs.
          </p>
        </div>
      )}
    </div>
  );
}
