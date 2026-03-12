import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EnforceNetworkPolicyOptions,
  enforceNetworkPolicy,
  generateDockerNetworkArgs,
} from './network-enforcement.js';

// ── Mock child_process and os ───────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const mockExecFile = vi.mocked(execFile);
const mockPlatform = vi.mocked(platform);

// ── Helpers ─────────────────────────────────────────────────────────

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as EnforceNetworkPolicyOptions['logger'];
}

function makeOptions(
  overrides?: Partial<EnforceNetworkPolicyOptions>,
): EnforceNetworkPolicyOptions {
  return {
    mode: 'none',
    isDocker: false,
    logger: createSilentLogger(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('enforceNetworkPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Docker enforcement', () => {
    it('returns docker-network mechanism with --network=none for mode "none"', async () => {
      const result = await enforceNetworkPolicy(makeOptions({ isDocker: true, mode: 'none' }));

      expect(result.applied).toBe(true);
      expect(result.mechanism).toBe('docker-network');
      expect(result.mode).toBe('none');
      expect(result.details).toContain('--network=none');
    });

    it('returns docker-network mechanism for allowlist mode', async () => {
      const result = await enforceNetworkPolicy(makeOptions({ isDocker: true, mode: 'allowlist' }));

      expect(result.applied).toBe(true);
      expect(result.mechanism).toBe('docker-network');
      expect(result.mode).toBe('allowlist');
    });
  });

  describe('macOS enforcement', () => {
    it('delegates to Seatbelt on macOS', async () => {
      mockPlatform.mockReturnValue('darwin');

      const result = await enforceNetworkPolicy(makeOptions({ mode: 'none' }));

      expect(result.applied).toBe(true);
      expect(result.mechanism).toBe('macos-pf');
      expect(result.details).toContain('Seatbelt');
    });
  });

  describe('Linux enforcement', () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
    });

    it('applies iptables DROP rule for mode "none"', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as (err: Error | null, stdout: string) => void)(null, '');
        return undefined as never;
      });

      const result = await enforceNetworkPolicy(makeOptions({ mode: 'none' }));

      expect(result.applied).toBe(true);
      expect(result.mechanism).toBe('iptables');
      expect(result.mode).toBe('none');
    });

    it('reports failure when iptables command fails', async () => {
      mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        (callback as (err: Error | null, stdout: string) => void)(
          new Error('iptables: Permission denied'),
          '',
        );
        return undefined as never;
      });

      const result = await enforceNetworkPolicy(makeOptions({ mode: 'none' }));

      expect(result.applied).toBe(false);
      expect(result.mechanism).toBe('iptables');
      expect(result.details).toContain('Permission denied');
    });
  });
});

describe('generateDockerNetworkArgs', () => {
  it('returns --network=none for mode "none"', () => {
    expect(generateDockerNetworkArgs('none')).toEqual(['--network=none']);
  });

  it('returns egress network args for mode "egress-only"', () => {
    const args = generateDockerNetworkArgs('egress-only');
    expect(args).toContain('--network=agentctl-egress');
    expect(args).toContain('--cap-drop=ALL');
  });

  it('returns filtered network args for mode "allowlist"', () => {
    const args = generateDockerNetworkArgs('allowlist');
    expect(args).toContain('--network=agentctl-filtered');
    expect(args).toContain('--cap-drop=ALL');
  });
});
