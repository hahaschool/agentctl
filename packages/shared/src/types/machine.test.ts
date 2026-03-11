import { describe, expect, it } from 'vitest';

import type { Machine } from './machine.js';

describe('machine types', () => {
  it('supports execution environment capability snapshots', () => {
    const machine: Machine = {
      id: 'machine-1',
      hostname: 'mac-mini',
      tailscaleIp: '100.64.0.1',
      os: 'darwin',
      arch: 'arm64',
      status: 'online',
      lastHeartbeat: new Date('2026-03-11T10:00:00.000Z'),
      capabilities: {
        gpu: false,
        docker: true,
        maxConcurrentAgents: 4,
        defaultExecutionEnvironment: 'direct',
        executionEnvironments: [
          {
            id: 'direct',
            available: true,
            isDefault: true,
            isolation: 'host',
            reasonUnavailable: null,
            metadata: { worktreeReuse: true },
          },
          {
            id: 'docker',
            available: false,
            isDefault: false,
            isolation: 'container',
            reasonUnavailable: 'Docker daemon is not running',
            metadata: { runtime: 'docker' },
          },
        ],
      },
      createdAt: new Date('2026-03-11T09:00:00.000Z'),
    };

    expect(machine.capabilities.executionEnvironments?.[0]?.id).toBe('direct');
    expect(machine.capabilities.defaultExecutionEnvironment).toBe('direct');
    expect(machine.capabilities.executionEnvironments?.[1]?.reasonUnavailable).toContain('Docker');
  });
});
