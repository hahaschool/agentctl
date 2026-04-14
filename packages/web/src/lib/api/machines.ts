// ---------------------------------------------------------------------------
// Machines — file browsing, git status, terminal, MCP/skill discovery,
// capability sync, agent config preview, fleet worker nodes.
// ---------------------------------------------------------------------------

import type {
  ConfigPreviewResponse,
  DiscoveredMcpServer,
  DiscoveredSkill,
  FleetOverview,
  McpServerTemplate,
  WorkerNode,
} from '@agentctl/shared';

import { request } from './core';

export type GitFileStatus = {
  clean: boolean;
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
};

export type GitLastCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
};

export type GitWorktreeEntry = {
  path: string;
  branch: string | null;
  isMain: boolean;
};

export type GitStatusResponse = {
  branch: string;
  worktree: string;
  isWorktree: boolean;
  bareRepo: string | null;
  status: GitFileStatus;
  lastCommit: GitLastCommit | null;
  worktrees: GitWorktreeEntry[];
};

export type FileEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
};

export type FileListResponse = {
  entries: FileEntry[];
  path: string;
};

export type FileContentResponse = {
  content: string;
  path: string;
  size: number;
};

export type TerminalInfo = {
  id: string;
  pid: number;
  command: string;
  cols: number;
  rows: number;
  createdAt: string;
};

export type McpDiscoverResponse = {
  discovered: DiscoveredMcpServer[];
  sources: Array<{ path: string; count: number }>;
};

export type SkillDiscoverResponse = {
  ok: boolean;
  discovered: DiscoveredSkill[];
  cached: boolean;
};

export type McpTemplatesResponse = {
  ok: boolean;
  templates: McpServerTemplate[];
  count: number;
};

export const machinesApi = {
  // File browsing
  listFiles: (machineId: string, path: string) => {
    const qs = new URLSearchParams({ path });
    return request<FileListResponse>(`/api/machines/${encodeURIComponent(machineId)}/files?${qs}`);
  },
  readFile: (machineId: string, path: string) => {
    const qs = new URLSearchParams({ path });
    return request<FileContentResponse>(
      `/api/machines/${encodeURIComponent(machineId)}/files/content?${qs}`,
    );
  },
  writeFile: (machineId: string, path: string, content: string) =>
    request<{ success: boolean; path: string }>(
      `/api/machines/${encodeURIComponent(machineId)}/files/content`,
      {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      },
    ),

  // Git status
  getGitStatus: (machineId: string, path: string) => {
    const qs = new URLSearchParams({ path });
    return request<GitStatusResponse>(
      `/api/machines/${encodeURIComponent(machineId)}/git/status?${qs}`,
    );
  },

  // Terminal
  listTerminals: (machineId: string) =>
    request<TerminalInfo[]>(`/api/machines/${encodeURIComponent(machineId)}/terminal`),

  spawnTerminal: (
    machineId: string,
    opts?: {
      id?: string;
      command?: string;
      args?: string[];
      cols?: number;
      rows?: number;
      cwd?: string;
    },
  ) =>
    request<TerminalInfo>(`/api/machines/${encodeURIComponent(machineId)}/terminal`, {
      method: 'POST',
      body: JSON.stringify({ id: opts?.id ?? crypto.randomUUID(), ...opts }),
    }),

  killTerminal: (machineId: string, termId: string) =>
    request<void>(
      `/api/machines/${encodeURIComponent(machineId)}/terminal/${encodeURIComponent(termId)}`,
      { method: 'DELETE' },
    ),

  resizeTerminal: (machineId: string, termId: string, cols: number, rows: number) =>
    request<void>(
      `/api/machines/${encodeURIComponent(machineId)}/terminal/${encodeURIComponent(termId)}/resize`,
      { method: 'POST', body: JSON.stringify({ cols, rows }) },
    ),

  // MCP discovery & templates
  discoverMcpServers: (machineId: string, runtime: string, projectPath?: string) => {
    const qs = new URLSearchParams({ machineId, runtime });
    if (projectPath) qs.set('projectPath', projectPath);
    return request<McpDiscoverResponse>(`/api/mcp/discover?${qs.toString()}`);
  },

  getMcpTemplates: () => request<McpTemplatesResponse>('/api/mcp/templates'),

  // Skill discovery
  discoverSkills: (machineId: string, runtime: string, projectPath?: string) => {
    const qs = new URLSearchParams({ machineId, runtime });
    if (projectPath) qs.set('projectPath', projectPath);
    return request<SkillDiscoverResponse>(`/api/skills/discover?${qs.toString()}`);
  },

  // Agent config preview (dry-run rendering of managed runtime config)
  getAgentConfigPreview: (agentId: string) =>
    request<ConfigPreviewResponse>(`/api/agents/${encodeURIComponent(agentId)}/config-preview`),

  // Machine capability sync (triggers fresh MCP + skill discovery on the worker)
  syncCapabilities: (machineId: string, runtime?: string, projectPath?: string) =>
    request<{
      machineId: string;
      runtime: string;
      mcpDiscovered: number;
      skillsDiscovered: number;
      warnings: string[];
    }>(`/api/machines/${encodeURIComponent(machineId)}/sync-capabilities`, {
      method: 'POST',
      body: JSON.stringify({
        ...(runtime ? { runtime } : {}),
        ...(projectPath ? { projectPath } : {}),
      }),
    }),

  // Fleet worker nodes
  listWorkerNodes: () => request<WorkerNode[]>('/api/fleet/nodes'),

  getFleetOverview: () => request<FleetOverview>('/api/fleet/nodes/overview'),
};
