import type { AgentConfig } from './agent.js';

/** Snapshot of what task-worker.ts dispatched to the worker. Read-only audit record. */
export type DispatchConfigSnapshot = {
  model: string | null;
  permissionMode: AgentConfig['permissionMode'] | null;
  allowedTools: string[] | null;
  mcpServers: Record<string, McpServerConfigRedacted> | null;
  systemPrompt: string | null;
  defaultPrompt: string | null;
  instructionsStrategy: AgentConfig['instructionsStrategy'] | null;
  mcpServerCount: number;
  accountProvider: string | null;
};

/** MCP server config with sensitive values redacted. */
export type McpServerConfigRedacted = {
  command: string;
  args?: string[];
  envKeys?: string[];
};
