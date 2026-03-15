import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverCodexMcpServers } from './codex-mcp-discovery.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

import { access, readFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

describe('discoverCodexMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid TOML with mcp_servers section', async () => {
    const toml = `
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]

[mcp_servers.filesystem.env]
ROOT = "/workspace"

[mcp_servers.memory]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-memory"]
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    const result = await discoverCodexMcpServers('/home/user');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('filesystem');
    expect(result[0].config.command).toBe('npx');
    expect(result[0].config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
    expect(result[0].config.env).toEqual({ ROOT: '/workspace' });
    expect(result[0].source).toBe('global');
    expect(result[0].configFile).toContain('.codex/config.toml');

    expect(result[1].name).toBe('memory');
    expect(result[1].config.env).toEqual({});
  });

  it('returns empty array when config.toml does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('returns empty array for TOML without mcp_servers section', async () => {
    const toml = `
model = "gpt-5"
reasoning_effort = "high"
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('handles malformed TOML gracefully', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('invalid [[[toml content');

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('discovers from project path with project source', async () => {
    const toml = `
[mcp_servers.db]
command = "npx"
args = ["-y", "pg-server"]
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    const result = await discoverCodexMcpServers('/project', 'project');

    expect(result[0].source).toBe('project');
    expect(result[0].configFile).toContain('.codex/config.toml');
  });

  it('normalizes the base path before reading config.toml', async () => {
    const toml = `
[mcp_servers.fs]
command = "npx"
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    await discoverCodexMcpServers('/home/user/work/../project');

    expect(mockAccess).toHaveBeenCalledWith('/home/user/project/.codex/config.toml');
    expect(mockReadFile).toHaveBeenCalledWith('/home/user/project/.codex/config.toml', 'utf-8');
  });

  it('returns empty and avoids fs access for denied base paths', async () => {
    const result = await discoverCodexMcpServers('/home/user/.ssh/project');

    expect(result).toEqual([]);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
