'use client';

import type { DispatchConfigSnapshot, McpServerConfigRedacted } from '@agentctl/shared';
import { Info, Server, Settings, Shield, Terminal } from 'lucide-react';
import type React from 'react';

import { useQuery } from '@tanstack/react-query';

import { sessionDispatchConfigQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

type SessionConfigTabProps = {
  sessionId: string;
};

export function SessionConfigTab({ sessionId }: SessionConfigTabProps): React.JSX.Element {
  const { data, isLoading, error } = useQuery(sessionDispatchConfigQuery(sessionId));

  if (isLoading) {
    return <ConfigSkeleton />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive p-4">
        Failed to load dispatch config: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  if (!data || data.runCount === 0) {
    return (
      <EmptyState message="No dispatch record — this session has no associated agent run." />
    );
  }

  if (!data.config) {
    return (
      <EmptyState message="Config not captured for this run (pre-feature data)." />
    );
  }

  return (
    <div className="space-y-5">
      {data.runCount > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-accent/10 rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>Showing config from latest dispatch (1 of {data.runCount} runs).</span>
        </div>
      )}
      <GeneralSection config={data.config} />
      <McpServersSection servers={data.config.mcpServers} count={data.config.mcpServerCount} />
      <ToolRestrictionsSection allowedTools={data.config.allowedTools} />
      <PromptsSection
        defaultPrompt={data.config.defaultPrompt}
        systemPrompt={data.config.systemPrompt}
      />
    </div>
  );
}

function GeneralSection({ config }: { config: DispatchConfigSnapshot }): React.JSX.Element {
  return (
    <ConfigSection title="General" icon={Settings}>
      <ConfigRow label="Model" value={config.model ?? '(not set)'} />
      <ConfigRow label="Permission" value={config.permissionMode ?? '(not set)'} />
      <ConfigRow label="Provider" value={config.accountProvider ?? '(not set)'} />
      <ConfigRow label="Strategy" value={config.instructionsStrategy ?? '(not set)'} />
    </ConfigSection>
  );
}

function McpServersSection({
  servers,
  count,
}: {
  servers: Record<string, McpServerConfigRedacted> | null;
  count: number;
}): React.JSX.Element {
  if (!servers || count === 0) {
    return (
      <ConfigSection title="MCP Servers (0)" icon={Server}>
        <p className="text-xs text-muted-foreground">No MCP servers configured.</p>
      </ConfigSection>
    );
  }

  return (
    <ConfigSection title={`MCP Servers (${count})`} icon={Server}>
      <div className="space-y-3">
        {Object.entries(servers).map(([name, srv]) => (
          <div key={name} className="text-xs">
            <div className="font-medium text-foreground">{name}</div>
            <div className="font-mono text-muted-foreground mt-0.5">
              {srv.command} {srv.args?.join(' ')}
            </div>
            {srv.envKeys && srv.envKeys.length > 0 && (
              <div className="text-muted-foreground mt-0.5">
                env: {srv.envKeys.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </ConfigSection>
  );
}

function ToolRestrictionsSection({
  allowedTools,
}: {
  allowedTools: string[] | null;
}): React.JSX.Element {
  return (
    <ConfigSection title="Tool Restrictions" icon={Shield}>
      <ConfigRow
        label="Allowed"
        value={
          allowedTools && allowedTools.length > 0
            ? allowedTools.join(', ')
            : '(all — no restrictions)'
        }
      />
    </ConfigSection>
  );
}

function PromptsSection({
  defaultPrompt,
  systemPrompt,
}: {
  defaultPrompt: string | null;
  systemPrompt: string | null;
}): React.JSX.Element {
  return (
    <ConfigSection title="Prompts" icon={Terminal}>
      <ConfigRow label="Default" value={defaultPrompt ?? '(not set)'} />
      <ConfigRow label="System" value={systemPrompt ?? '(not set)'} />
    </ConfigSection>
  );
}

// --- Shared primitives ---

function ConfigSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 border-b border-border/50">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-1.5">{children}</div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const isUnset = value === '(not set)' || value === '(all — no restrictions)';
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={cn('font-mono', isUnset ? 'text-muted-foreground/60' : 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}

function ConfigSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="border border-border/30 rounded-lg overflow-hidden">
          <div className="h-8 bg-accent/10" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-muted/30 rounded w-2/3" />
            <div className="h-3 bg-muted/30 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Settings className="w-8 h-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
