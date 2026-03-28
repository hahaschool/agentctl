import { describe, expect, it } from 'vitest';

import { redactMcpServers } from './redact-mcp.js';

describe('redactMcpServers', () => {
  it('extracts basename from command paths', () => {
    const result = redactMcpServers({
      slack: {
        command: '/Users/hahaschool/.codex/vendor_imports/slack-mcp-server/bin/slack-mcp-server',
        args: ['--transport', 'stdio'],
      },
    });
    expect(result.slack.command).toBe('slack-mcp-server');
  });

  it('stores only env key names, never values', () => {
    const result = redactMcpServers({
      slack: {
        command: 'slack-mcp',
        env: {
          SLACK_MCP_XOXP_TOKEN: 'xoxp-secret-value-here',
          SLACK_MCP_XOXB_TOKEN: 'xoxb-another-secret',
        },
      },
    });
    expect(result.slack.envKeys).toEqual(['SLACK_MCP_XOXP_TOKEN', 'SLACK_MCP_XOXB_TOKEN']);
    expect(result.slack).not.toHaveProperty('env');
  });

  it('redacts args that look like tokens (sk- prefix)', () => {
    const result = redactMcpServers({
      test: { command: 'node', args: ['--auth', 'sk-ant-secret-key-here'] },
    });
    expect(result.test.args).toEqual(['--auth', '[REDACTED]']);
  });

  it('redacts value after --token flag', () => {
    const result = redactMcpServers({
      test: { command: 'npx', args: ['server', '--token', 'my-secret-token'] },
    });
    expect(result.test.args).toEqual(['server', '--token', '[REDACTED]']);
  });

  it('redacts --key=value inline format', () => {
    const result = redactMcpServers({
      test: { command: 'npx', args: ['--api-key=sk-proj-abc123'] },
    });
    expect(result.test.args).toEqual(['--api-key=[REDACTED]']);
  });

  it('redacts KEY=value inline env format in args', () => {
    const result = redactMcpServers({
      test: { command: 'npx', args: ['API_KEY=secret123'] },
    });
    expect(result.test.args).toEqual(['API_KEY=[REDACTED]']);
  });

  it('preserves normal args', () => {
    const result = redactMcpServers({
      test: { command: 'uv', args: ['run', '--with', 'mcp-clickhouse', '--python', '3.10'] },
    });
    expect(result.test.args).toEqual(['run', '--with', 'mcp-clickhouse', '--python', '3.10']);
  });

  it('handles servers with no args or env', () => {
    const result = redactMcpServers({
      simple: { command: 'node' },
    });
    expect(result.simple).toEqual({ command: 'node', args: undefined, envKeys: undefined });
  });

  it('processes multiple servers', () => {
    const result = redactMcpServers({
      a: { command: '/usr/bin/node', args: ['server.js'] },
      b: { command: 'python', args: ['-m', 'server'], env: { KEY: 'val' } },
    });
    expect(Object.keys(result)).toEqual(['a', 'b']);
    expect(result.a.command).toBe('node');
    expect(result.b.envKeys).toEqual(['KEY']);
  });
});
