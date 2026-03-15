import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/path-security.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/path-security.js')>(
    '../../utils/path-security.js',
  );
  return {
    ...actual,
    safeReadFileAtomic: vi.fn(),
  };
});

import { safeReadFileAtomic } from '../../utils/path-security.js';
import { discoverCodexMcpServers } from './codex-mcp-discovery.js';

const mockSafeReadFileAtomic = vi.mocked(safeReadFileAtomic);

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
    mockSafeReadFileAtomic.mockReturnValue({ content: toml, size: toml.length });

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
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockSafeReadFileAtomic.mockImplementation(() => {
      throw err;
    });

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('returns empty array for TOML without mcp_servers section', async () => {
    const toml = `
model = "gpt-5"
reasoning_effort = "high"
`;
    mockSafeReadFileAtomic.mockReturnValue({ content: toml, size: toml.length });

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('handles malformed TOML gracefully', async () => {
    mockSafeReadFileAtomic.mockReturnValue({
      content: 'invalid [[[toml content',
      size: 'invalid [[[toml content'.length,
    });

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('discovers from project path with project source', async () => {
    const toml = `
[mcp_servers.db]
command = "npx"
args = ["-y", "pg-server"]
`;
    mockSafeReadFileAtomic.mockReturnValue({ content: toml, size: toml.length });

    const result = await discoverCodexMcpServers('/project', 'project');

    expect(result[0].source).toBe('project');
    expect(result[0].configFile).toContain('.codex/config.toml');
  });

  it('normalizes the base path before reading config.toml', async () => {
    const toml = `
[mcp_servers.fs]
command = "npx"
`;
    mockSafeReadFileAtomic.mockReturnValue({ content: toml, size: toml.length });

    await discoverCodexMcpServers('/home/user/work/../project');

    expect(mockSafeReadFileAtomic).toHaveBeenCalledWith(
      '/home/user/project/.codex/config.toml',
      '/home/user/project',
      1024 * 1024,
    );
  });

  it('returns empty and avoids fs access for denied base paths', async () => {
    const result = await discoverCodexMcpServers('/home/user/.ssh/project');

    expect(result).toEqual([]);
    expect(mockSafeReadFileAtomic).not.toHaveBeenCalled();
  });
});
