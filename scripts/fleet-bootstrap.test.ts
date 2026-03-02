import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

import type {
  BootstrapConfig,
  BootstrapResult,
  MachineBootstrapResult,
  MachineEntry,
  RawMachineEntry,
  SshExecResult,
} from './fleet-bootstrap.js';
import {
  bootstrapMachine,
  buildSshOptions,
  DEFAULT_INVENTORY_PATH,
  EXIT_BOOTSTRAP_FAILED,
  EXIT_INVALID_ARGS,
  EXIT_INVENTORY_ERROR,
  EXIT_SUCCESS,
  exitCodeFromResult,
  FleetBootstrapError,
  loadInventory,
  main,
  normalizeRole,
  parseArgs,
  parseMachineInventory,
  parseMinimalYaml,
  parseYaml,
  roleToSetupArg,
  runBootstrap,
  runWithConcurrency,
  SETUP_SCRIPT_PATH,
  sshTarget,
  validateMachineEntry,
  validateTailscaleIp,
} from './fleet-bootstrap.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMachine(overrides: Partial<MachineEntry> = {}): MachineEntry {
  return {
    host: 'test-machine',
    role: 'worker',
    tailscale_ip: '100.64.0.10',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BootstrapConfig> = {}): BootstrapConfig {
  return {
    inventoryPath: '/test/machines.yml',
    concurrency: 2,
    dryRun: false,
    sshTimeoutMs: 30_000,
    ...overrides,
  };
}

function makeSshResult(overrides: Partial<SshExecResult> = {}): SshExecResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    ...overrides,
  };
}

function makeSuccessResult(overrides: Partial<BootstrapResult> = {}): BootstrapResult {
  return {
    success: true,
    machines: [],
    totalDurationMs: 0,
    ...overrides,
  };
}

const SAMPLE_YAML = `
defaults:
  deploy_user: deploy
  health_check_path: /health

machines:
  - id: control-plane-1
    role: control-plane
    tailscale_ip: 100.64.0.1
    hostname: cp-primary
  - id: worker-ec2-1
    role: agent-worker
    tailscale_ip: 100.64.0.2
    hostname: ec2-us-east
  - id: worker-mac-mini-1
    role: agent-worker
    tailscale_ip: 100.64.0.3
    hostname: mac-mini-home
`;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// FleetBootstrapError
// =============================================================================

describe('FleetBootstrapError', () => {
  it('sets name, code, message, and context', () => {
    const error = new FleetBootstrapError('TEST_CODE', 'test message', { key: 'value' });
    expect(error.name).toBe('FleetBootstrapError');
    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('test message');
    expect(error.context).toEqual({ key: 'value' });
  });

  it('works without context', () => {
    const error = new FleetBootstrapError('NO_CTX', 'no context');
    expect(error.context).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
  });

  it('is an instance of Error', () => {
    const error = new FleetBootstrapError('CODE', 'msg');
    expect(error).toBeInstanceOf(Error);
  });
});

// =============================================================================
// parseArgs
// =============================================================================

describe('parseArgs', () => {
  it('returns defaults when no arguments are given', () => {
    const config = parseArgs(['node', 'script.ts']);
    expect(config.inventoryPath).toBe(DEFAULT_INVENTORY_PATH);
    expect(config.concurrency).toBe(3);
    expect(config.dryRun).toBe(false);
    expect(config.sshTimeoutMs).toBe(30_000);
    expect(config.roleFilter).toBeUndefined();
  });

  it('parses --dry-run flag', () => {
    const config = parseArgs(['node', 'script.ts', '--dry-run']);
    expect(config.dryRun).toBe(true);
  });

  it('parses --role worker', () => {
    const config = parseArgs(['node', 'script.ts', '--role', 'worker']);
    expect(config.roleFilter).toBe('worker');
  });

  it('parses --role control-plane', () => {
    const config = parseArgs(['node', 'script.ts', '--role', 'control-plane']);
    expect(config.roleFilter).toBe('control-plane');
  });

  it('sets roleFilter to undefined for --role all', () => {
    const config = parseArgs(['node', 'script.ts', '--role', 'all']);
    expect(config.roleFilter).toBeUndefined();
  });

  it('throws on invalid --role value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--role', 'invalid'])).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws on missing --role value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--role'])).toThrow(FleetBootstrapError);
  });

  it('parses --concurrency', () => {
    const config = parseArgs(['node', 'script.ts', '--concurrency', '5']);
    expect(config.concurrency).toBe(5);
  });

  it('throws on non-numeric --concurrency', () => {
    expect(() => parseArgs(['node', 'script.ts', '--concurrency', 'abc'])).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws on zero --concurrency', () => {
    expect(() => parseArgs(['node', 'script.ts', '--concurrency', '0'])).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws on negative --concurrency', () => {
    expect(() => parseArgs(['node', 'script.ts', '--concurrency', '-1'])).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws on missing --concurrency value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--concurrency'])).toThrow(FleetBootstrapError);
  });

  it('parses --ssh-timeout', () => {
    const config = parseArgs(['node', 'script.ts', '--ssh-timeout', '60000']);
    expect(config.sshTimeoutMs).toBe(60_000);
  });

  it('throws on non-numeric --ssh-timeout', () => {
    expect(() => parseArgs(['node', 'script.ts', '--ssh-timeout', 'abc'])).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws on zero --ssh-timeout', () => {
    expect(() => parseArgs(['node', 'script.ts', '--ssh-timeout', '0'])).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws on missing --ssh-timeout value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--ssh-timeout'])).toThrow(FleetBootstrapError);
  });

  it('parses --inventory', () => {
    const config = parseArgs(['node', 'script.ts', '--inventory', '/custom/path.yml']);
    expect(config.inventoryPath).toContain('path.yml');
  });

  it('throws on missing --inventory value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--inventory'])).toThrow(FleetBootstrapError);
  });

  it('parses all options together', () => {
    const config = parseArgs([
      'node',
      'script.ts',
      '--dry-run',
      '--role',
      'worker',
      '--concurrency',
      '10',
      '--ssh-timeout',
      '5000',
      '--inventory',
      '/my/inventory.yml',
    ]);
    expect(config.dryRun).toBe(true);
    expect(config.roleFilter).toBe('worker');
    expect(config.concurrency).toBe(10);
    expect(config.sshTimeoutMs).toBe(5000);
    expect(config.inventoryPath).toContain('inventory.yml');
  });

  it('ignores unknown arguments', () => {
    const config = parseArgs(['node', 'script.ts', '--unknown', 'value']);
    expect(config.dryRun).toBe(false);
    expect(config.concurrency).toBe(3);
  });

  it('includes INVALID_ARGS error code on role error', () => {
    try {
      parseArgs(['node', 'script.ts', '--role', 'bad']);
    } catch (e) {
      expect(e).toBeInstanceOf(FleetBootstrapError);
      expect((e as FleetBootstrapError).code).toBe('INVALID_ARGS');
    }
  });
});

// =============================================================================
// parseMinimalYaml
// =============================================================================

describe('parseMinimalYaml', () => {
  it('parses the sample machines.yml structure', () => {
    const result = parseMinimalYaml(SAMPLE_YAML);
    expect(result.defaults).toBeDefined();
    expect(Array.isArray(result.machines)).toBe(true);
    expect((result.machines as unknown[]).length).toBe(3);
  });

  it('parses top-level scalar values', () => {
    const result = parseMinimalYaml('name: test\nversion: 1');
    expect(result.name).toBe('test');
    expect(result.version).toBe(1);
  });

  it('parses boolean values', () => {
    const result = parseMinimalYaml('enabled: true\ndisabled: false');
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
  });

  it('parses inline arrays', () => {
    const yaml = `machines:
  - id: test
    services: [control-plane, worker]`;
    const result = parseMinimalYaml(yaml);
    const machines = result.machines as Record<string, unknown>[];
    expect(machines[0]?.services).toEqual(['control-plane', 'worker']);
  });

  it('handles comments and empty lines', () => {
    const yaml = `# comment
name: test

# another comment
value: 42`;
    const result = parseMinimalYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.value).toBe(42);
  });

  it('handles quoted strings', () => {
    const yaml = 'name: "hello world"';
    const result = parseMinimalYaml(yaml);
    expect(result.name).toBe('hello world');
  });

  it('handles single-quoted strings', () => {
    const yaml = "name: 'hello world'";
    const result = parseMinimalYaml(yaml);
    expect(result.name).toBe('hello world');
  });

  it('parses machine entries with all fields', () => {
    const yaml = `machines:
  - id: cp-1
    role: control-plane
    tailscale_ip: 100.64.0.1
    hostname: cp-primary`;
    const result = parseMinimalYaml(yaml);
    const machines = result.machines as Record<string, unknown>[];
    expect(machines).toHaveLength(1);
    expect(machines[0]?.id).toBe('cp-1');
    expect(machines[0]?.role).toBe('control-plane');
    expect(machines[0]?.tailscale_ip).toBe('100.64.0.1');
    expect(machines[0]?.hostname).toBe('cp-primary');
  });

  it('parses multiple array items', () => {
    const yaml = `items:
  - name: first
    value: 1
  - name: second
    value: 2
  - name: third
    value: 3`;
    const result = parseMinimalYaml(yaml);
    const items = result.items as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    expect(items[0]?.name).toBe('first');
    expect(items[2]?.name).toBe('third');
  });

  it('returns empty object for empty input', () => {
    const result = parseMinimalYaml('');
    expect(result).toEqual({});
  });

  it('parses nested sub-objects under top-level keys', () => {
    const yaml = `defaults:
  deploy_user: deploy
  health_check_timeout: 30`;
    const result = parseMinimalYaml(yaml);
    const defaults = result.defaults as Record<string, unknown>;
    expect(defaults.deploy_user).toBe('deploy');
    expect(defaults.health_check_timeout).toBe(30);
  });
});

// =============================================================================
// parseYaml
// =============================================================================

describe('parseYaml', () => {
  it('falls back to minimal parser when js-yaml is not available', async () => {
    const result = await parseYaml(SAMPLE_YAML);
    expect(result).toBeDefined();
    const doc = result as Record<string, unknown>;
    expect(Array.isArray(doc.machines)).toBe(true);
  });
});

// =============================================================================
// loadInventory
// =============================================================================

describe('loadInventory', () => {
  it('reads and parses a YAML inventory file', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);
    const entries = await loadInventory('/test/machines.yml');
    expect(entries).toHaveLength(3);
    expect(readFile).toHaveBeenCalledWith('/test/machines.yml', 'utf-8');
  });

  it('throws INVENTORY_NOT_FOUND when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));
    await expect(loadInventory('/nonexistent.yml')).rejects.toThrow(FleetBootstrapError);
    try {
      await loadInventory('/nonexistent.yml');
    } catch (e) {
      expect((e as FleetBootstrapError).code).toBe('INVENTORY_NOT_FOUND');
    }
  });

  it('throws INVENTORY_INVALID when machines key is missing', async () => {
    vi.mocked(readFile).mockResolvedValue('name: test\nversion: 1');
    await expect(loadInventory('/test.yml')).rejects.toThrow(FleetBootstrapError);
    try {
      await loadInventory('/test.yml');
    } catch (e) {
      expect((e as FleetBootstrapError).code).toBe('INVENTORY_INVALID');
    }
  });

  it('throws INVENTORY_INVALID for non-object YAML', async () => {
    vi.mocked(readFile).mockResolvedValue('just a string');
    await expect(loadInventory('/test.yml')).rejects.toThrow(FleetBootstrapError);
  });
});

// =============================================================================
// validateTailscaleIp
// =============================================================================

describe('validateTailscaleIp', () => {
  it('accepts valid CGNAT IPs', () => {
    expect(() => validateTailscaleIp('100.64.0.1', 'host1')).not.toThrow();
    expect(() => validateTailscaleIp('100.127.255.255', 'host2')).not.toThrow();
    expect(() => validateTailscaleIp('100.100.50.25', 'host3')).not.toThrow();
  });

  it('rejects IP outside CGNAT range — first octet', () => {
    expect(() => validateTailscaleIp('192.168.1.1', 'host')).toThrow(FleetBootstrapError);
  });

  it('rejects IP outside CGNAT range — second octet too low', () => {
    expect(() => validateTailscaleIp('100.63.0.1', 'host')).toThrow(FleetBootstrapError);
  });

  it('rejects IP outside CGNAT range — second octet too high', () => {
    expect(() => validateTailscaleIp('100.128.0.1', 'host')).toThrow(FleetBootstrapError);
  });

  it('rejects malformed IP — too few octets', () => {
    expect(() => validateTailscaleIp('100.64.1', 'host')).toThrow(FleetBootstrapError);
  });

  it('rejects malformed IP — too many octets', () => {
    expect(() => validateTailscaleIp('100.64.0.1.5', 'host')).toThrow(FleetBootstrapError);
  });

  it('rejects malformed IP — non-numeric octets', () => {
    expect(() => validateTailscaleIp('100.64.abc.1', 'host')).toThrow(FleetBootstrapError);
  });

  it('rejects malformed IP — octet out of range', () => {
    expect(() => validateTailscaleIp('100.64.256.1', 'host')).toThrow(FleetBootstrapError);
  });

  it('includes host in error context', () => {
    try {
      validateTailscaleIp('1.2.3.4', 'my-machine');
    } catch (e) {
      expect((e as FleetBootstrapError).context?.host).toBe('my-machine');
    }
  });
});

// =============================================================================
// normalizeRole
// =============================================================================

describe('normalizeRole', () => {
  it('returns control-plane for "control-plane"', () => {
    expect(normalizeRole('control-plane')).toBe('control-plane');
  });

  it('returns control-plane for "control"', () => {
    expect(normalizeRole('control')).toBe('control-plane');
  });

  it('returns worker for "worker"', () => {
    expect(normalizeRole('worker')).toBe('worker');
  });

  it('returns worker for "agent-worker"', () => {
    expect(normalizeRole('agent-worker')).toBe('worker');
  });

  it('throws for unknown role', () => {
    expect(() => normalizeRole('invalid')).toThrow(FleetBootstrapError);
  });

  it('includes INVALID_ROLE error code', () => {
    try {
      normalizeRole('unknown');
    } catch (e) {
      expect((e as FleetBootstrapError).code).toBe('INVALID_ROLE');
    }
  });
});

// =============================================================================
// validateMachineEntry
// =============================================================================

describe('validateMachineEntry', () => {
  it('validates a complete entry', () => {
    const entry = validateMachineEntry(
      { id: 'host1', role: 'worker', tailscale_ip: '100.64.0.1' },
      0,
    );
    expect(entry.host).toBe('host1');
    expect(entry.role).toBe('worker');
    expect(entry.tailscale_ip).toBe('100.64.0.1');
  });

  it('uses id as host if host field is missing', () => {
    const entry = validateMachineEntry(
      { id: 'my-id', role: 'worker', tailscale_ip: '100.64.0.1' },
      0,
    );
    expect(entry.host).toBe('my-id');
  });

  it('uses hostname as host if id and host are missing', () => {
    const entry = validateMachineEntry(
      { hostname: 'my-hostname', role: 'worker', tailscale_ip: '100.64.0.1' },
      0,
    );
    expect(entry.host).toBe('my-hostname');
  });

  it('throws when host/id/hostname are all missing', () => {
    expect(() => validateMachineEntry({ role: 'worker', tailscale_ip: '100.64.0.1' }, 0)).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws when role is missing', () => {
    expect(() => validateMachineEntry({ id: 'host', tailscale_ip: '100.64.0.1' }, 0)).toThrow(
      FleetBootstrapError,
    );
  });

  it('throws when tailscale_ip is missing', () => {
    expect(() => validateMachineEntry({ id: 'host', role: 'worker' }, 0)).toThrow(
      FleetBootstrapError,
    );
  });

  it('normalizes agent-worker role to worker', () => {
    const entry = validateMachineEntry(
      { id: 'host1', role: 'agent-worker', tailscale_ip: '100.64.0.1' },
      0,
    );
    expect(entry.role).toBe('worker');
  });

  it('normalizes control role to control-plane', () => {
    const entry = validateMachineEntry(
      { id: 'host1', role: 'control', tailscale_ip: '100.64.0.1' },
      0,
    );
    expect(entry.role).toBe('control-plane');
  });

  it('preserves optional ssh_user', () => {
    const entry = validateMachineEntry(
      { id: 'host1', role: 'worker', tailscale_ip: '100.64.0.1', ssh_user: 'admin' },
      0,
    );
    expect(entry.ssh_user).toBe('admin');
  });

  it('preserves optional labels', () => {
    const entry = validateMachineEntry(
      { id: 'host1', role: 'worker', tailscale_ip: '100.64.0.1', labels: { env: 'prod' } },
      0,
    );
    expect(entry.labels).toEqual({ env: 'prod' });
  });

  it('includes index in error for missing host', () => {
    try {
      validateMachineEntry({ role: 'worker', tailscale_ip: '100.64.0.1' }, 5);
    } catch (e) {
      expect((e as FleetBootstrapError).context?.index).toBe(5);
    }
  });
});

// =============================================================================
// parseMachineInventory
// =============================================================================

describe('parseMachineInventory', () => {
  const rawEntries: RawMachineEntry[] = [
    { id: 'cp-1', role: 'control-plane', tailscale_ip: '100.64.0.1' },
    { id: 'w-1', role: 'agent-worker', tailscale_ip: '100.64.0.2' },
    { id: 'w-2', role: 'worker', tailscale_ip: '100.64.0.3' },
  ];

  it('parses all machines when no filter is applied', () => {
    const machines = parseMachineInventory(rawEntries);
    expect(machines).toHaveLength(3);
  });

  it('filters by control-plane role', () => {
    const machines = parseMachineInventory(rawEntries, 'control-plane');
    expect(machines).toHaveLength(1);
    expect(machines[0]?.host).toBe('cp-1');
  });

  it('filters by worker role', () => {
    const machines = parseMachineInventory(rawEntries, 'worker');
    expect(machines).toHaveLength(2);
  });

  it('returns empty array when filter matches nothing', () => {
    const machines = parseMachineInventory(
      [{ id: 'cp-1', role: 'control-plane', tailscale_ip: '100.64.0.1' }],
      'worker',
    );
    expect(machines).toHaveLength(0);
  });

  it('throws on duplicate hosts', () => {
    const dupes: RawMachineEntry[] = [
      { id: 'host-1', role: 'worker', tailscale_ip: '100.64.0.1' },
      { id: 'host-1', role: 'worker', tailscale_ip: '100.64.0.2' },
    ];
    expect(() => parseMachineInventory(dupes)).toThrow(FleetBootstrapError);
    try {
      parseMachineInventory(dupes);
    } catch (e) {
      expect((e as FleetBootstrapError).code).toBe('DUPLICATE_HOST');
    }
  });

  it('throws on duplicate IPs', () => {
    const dupes: RawMachineEntry[] = [
      { id: 'host-1', role: 'worker', tailscale_ip: '100.64.0.1' },
      { id: 'host-2', role: 'worker', tailscale_ip: '100.64.0.1' },
    ];
    expect(() => parseMachineInventory(dupes)).toThrow(FleetBootstrapError);
    try {
      parseMachineInventory(dupes);
    } catch (e) {
      expect((e as FleetBootstrapError).code).toBe('DUPLICATE_IP');
    }
  });

  it('validates each entry in order', () => {
    const badEntries: RawMachineEntry[] = [
      { id: 'good', role: 'worker', tailscale_ip: '100.64.0.1' },
      { role: 'worker', tailscale_ip: '100.64.0.2' }, // missing host
    ];
    expect(() => parseMachineInventory(badEntries)).toThrow(FleetBootstrapError);
  });

  it('returns empty array for empty input', () => {
    const machines = parseMachineInventory([]);
    expect(machines).toHaveLength(0);
  });
});

// =============================================================================
// buildSshOptions
// =============================================================================

describe('buildSshOptions', () => {
  it('includes StrictHostKeyChecking=no', () => {
    const opts = buildSshOptions(makeMachine(), 30_000, 'deploy');
    expect(opts).toContain('StrictHostKeyChecking=no');
  });

  it('includes ConnectTimeout derived from milliseconds', () => {
    const opts = buildSshOptions(makeMachine(), 15_000, 'deploy');
    expect(opts).toContain('ConnectTimeout=15');
  });

  it('rounds timeout up to the next second', () => {
    const opts = buildSshOptions(makeMachine(), 15_500, 'deploy');
    expect(opts).toContain('ConnectTimeout=16');
  });

  it('includes BatchMode=yes', () => {
    const opts = buildSshOptions(makeMachine(), 30_000, 'deploy');
    expect(opts).toContain('BatchMode=yes');
  });

  it('includes LogLevel=ERROR', () => {
    const opts = buildSshOptions(makeMachine(), 30_000, 'deploy');
    expect(opts).toContain('LogLevel=ERROR');
  });
});

// =============================================================================
// sshTarget
// =============================================================================

describe('sshTarget', () => {
  it('uses machine ssh_user when available', () => {
    const target = sshTarget(makeMachine({ ssh_user: 'admin' }), 'deploy');
    expect(target).toBe('admin@100.64.0.10');
  });

  it('falls back to default user when ssh_user is not set', () => {
    const target = sshTarget(makeMachine(), 'deploy');
    expect(target).toBe('deploy@100.64.0.10');
  });

  it('uses tailscale_ip for the host portion', () => {
    const target = sshTarget(makeMachine({ tailscale_ip: '100.64.1.2' }), 'deploy');
    expect(target).toBe('deploy@100.64.1.2');
  });
});

// =============================================================================
// roleToSetupArg
// =============================================================================

describe('roleToSetupArg', () => {
  it('maps control-plane to "control"', () => {
    expect(roleToSetupArg('control-plane')).toBe('control');
  });

  it('maps worker to "worker"', () => {
    expect(roleToSetupArg('worker')).toBe('worker');
  });
});

// =============================================================================
// bootstrapMachine
// =============================================================================

describe('bootstrapMachine', () => {
  const mockExecSsh =
    vi.fn<(m: MachineEntry, cmd: string, t: number, u?: string) => Promise<SshExecResult>>();
  const mockExecScp =
    vi.fn<
      (l: string, r: string, m: MachineEntry, t: number, u?: string) => Promise<SshExecResult>
    >();
  const mockHealthCheck =
    vi.fn<(m: MachineEntry, t: number, u?: string) => Promise<SshExecResult>>();

  const deps = {
    execSsh: mockExecSsh,
    execScp: mockExecScp,
    healthCheck: mockHealthCheck,
  };

  beforeEach(() => {
    mockExecSsh.mockResolvedValue(makeSshResult());
    mockExecScp.mockResolvedValue(makeSshResult());
    mockHealthCheck.mockResolvedValue(makeSshResult({ stdout: '200' }));
  });

  it('returns success when all steps pass', async () => {
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.status).toBe('success');
    expect(result.host).toBe('test-machine');
    expect(result.error).toBeUndefined();
  });

  it('calls scp to copy setup-machine.sh', async () => {
    await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(mockExecScp).toHaveBeenCalledWith(
      SETUP_SCRIPT_PATH,
      '/tmp/setup-machine.sh',
      expect.objectContaining({ host: 'test-machine' }),
      30_000,
    );
  });

  it('calls ssh to chmod the script', async () => {
    await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(mockExecSsh).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'test-machine' }),
      'chmod +x /tmp/setup-machine.sh',
      30_000,
    );
  });

  it('calls ssh to execute setup-machine.sh with correct role and host', async () => {
    await bootstrapMachine(
      makeMachine({ role: 'control-plane', host: 'cp-1' }),
      makeConfig(),
      deps,
    );
    expect(mockExecSsh).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'cp-1' }),
      '/tmp/setup-machine.sh control cp-1',
      30_000,
    );
  });

  it('calls ssh to execute setup-machine.sh with worker role', async () => {
    await bootstrapMachine(makeMachine({ role: 'worker', host: 'w-1' }), makeConfig(), deps);
    expect(mockExecSsh).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'w-1' }),
      '/tmp/setup-machine.sh worker w-1',
      30_000,
    );
  });

  it('calls healthCheck after setup', async () => {
    await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(mockHealthCheck).toHaveBeenCalled();
  });

  it('returns failed when scp fails', async () => {
    mockExecScp.mockResolvedValue(makeSshResult({ exitCode: 1, stderr: 'Connection refused' }));
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Connection refused');
  });

  it('returns failed when chmod fails', async () => {
    mockExecSsh.mockResolvedValueOnce(makeSshResult({ exitCode: 1, stderr: 'Permission denied' }));
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Permission denied');
  });

  it('returns failed when setup-machine.sh fails', async () => {
    // chmod succeeds, then setup-machine.sh fails
    mockExecSsh.mockResolvedValueOnce(makeSshResult());
    mockExecSsh.mockResolvedValueOnce(makeSshResult({ exitCode: 1, stderr: 'apt failed' }));
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('apt failed');
  });

  it('records steps for successful bootstrap', async () => {
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.some((s) => s.includes('Copying'))).toBe(true);
    expect(result.steps.some((s) => s.includes('setup-machine.sh completed'))).toBe(true);
    expect(result.steps.some((s) => s.includes('Health check'))).toBe(true);
  });

  it('records steps up to the failure point', async () => {
    mockExecScp.mockResolvedValue(makeSshResult({ exitCode: 1, stderr: 'fail' }));
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.steps.some((s) => s.includes('FAILED'))).toBe(true);
  });

  it('reports non-fatal health check failure', async () => {
    mockHealthCheck.mockResolvedValue(makeSshResult({ stdout: '503' }));
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.status).toBe('success');
    expect(result.steps.some((s) => s.includes('503'))).toBe(true);
  });

  it('measures duration', async () => {
    const result = await bootstrapMachine(makeMachine(), makeConfig(), deps);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // Dry-run tests
  it('returns skipped status in dry-run mode', async () => {
    const result = await bootstrapMachine(makeMachine(), makeConfig({ dryRun: true }), deps);
    expect(result.status).toBe('skipped');
  });

  it('does not call ssh or scp in dry-run mode', async () => {
    await bootstrapMachine(makeMachine(), makeConfig({ dryRun: true }), deps);
    expect(mockExecSsh).not.toHaveBeenCalled();
    expect(mockExecScp).not.toHaveBeenCalled();
    expect(mockHealthCheck).not.toHaveBeenCalled();
  });

  it('includes dry-run info in steps', async () => {
    const result = await bootstrapMachine(makeMachine(), makeConfig({ dryRun: true }), deps);
    expect(result.steps.every((s) => s.includes('[dry-run]'))).toBe(true);
  });

  it('dry-run steps include expected commands', async () => {
    const result = await bootstrapMachine(
      makeMachine({ host: 'my-host' }),
      makeConfig({ dryRun: true }),
      deps,
    );
    expect(result.steps.some((s) => s.includes('setup-machine.sh'))).toBe(true);
    expect(result.steps.some((s) => s.includes('my-host'))).toBe(true);
  });
});

// =============================================================================
// runWithConcurrency
// =============================================================================

describe('runWithConcurrency', () => {
  it('processes all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('maintains order of results', async () => {
    const items = ['a', 'b', 'c'];
    const results = await runWithConcurrency(items, 10, async (s) => s.toUpperCase());
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('limits concurrent execution', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await runWithConcurrency(items, 2, async (n) => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentConcurrent--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('handles empty input array', async () => {
    const results = await runWithConcurrency([], 5, async (n) => n);
    expect(results).toEqual([]);
  });

  it('handles concurrency larger than item count', async () => {
    const items = [1, 2];
    const results = await runWithConcurrency(items, 100, async (n) => n * 10);
    expect(results).toEqual([10, 20]);
  });

  it('handles concurrency of 1 (sequential)', async () => {
    const order: number[] = [];
    const items = [1, 2, 3];
    await runWithConcurrency(items, 1, async (n) => {
      order.push(n);
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates errors from the worker function', async () => {
    const items = [1, 2, 3];
    await expect(
      runWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

// =============================================================================
// runBootstrap
// =============================================================================

describe('runBootstrap', () => {
  const mockLoadInventory = vi.fn<(path: string) => Promise<RawMachineEntry[]>>();
  const mockBootstrapMachine =
    vi.fn<(m: MachineEntry, c: BootstrapConfig) => Promise<MachineBootstrapResult>>();

  const deps = {
    loadInventory: mockLoadInventory,
    bootstrapMachine: mockBootstrapMachine,
  };

  beforeEach(() => {
    mockLoadInventory.mockResolvedValue([
      { id: 'cp-1', role: 'control-plane', tailscale_ip: '100.64.0.1' },
      { id: 'w-1', role: 'agent-worker', tailscale_ip: '100.64.0.2' },
    ]);
    mockBootstrapMachine.mockResolvedValue({
      host: 'test',
      status: 'success',
      steps: ['done'],
      durationMs: 100,
    });
  });

  it('returns success when all machines succeed', async () => {
    const result = await runBootstrap(makeConfig(), deps);
    expect(result.success).toBe(true);
    expect(result.machines).toHaveLength(2);
  });

  it('returns failure when any machine fails', async () => {
    mockBootstrapMachine
      .mockResolvedValueOnce({
        host: 'cp-1',
        status: 'success',
        steps: ['done'],
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        host: 'w-1',
        status: 'failed',
        steps: ['failed'],
        error: 'SSH timeout',
        durationMs: 200,
      });

    const result = await runBootstrap(makeConfig(), deps);
    expect(result.success).toBe(false);
  });

  it('passes config to bootstrapMachine', async () => {
    const config = makeConfig({ sshTimeoutMs: 60_000 });
    await runBootstrap(config, deps);
    expect(mockBootstrapMachine).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sshTimeoutMs: 60_000 }),
    );
  });

  it('filters machines by role', async () => {
    const config = makeConfig({ roleFilter: 'control-plane' });
    const result = await runBootstrap(config, deps);
    expect(result.machines).toHaveLength(1);
    expect(mockBootstrapMachine).toHaveBeenCalledTimes(1);
  });

  it('returns empty machines when filter matches nothing', async () => {
    mockLoadInventory.mockResolvedValue([
      { id: 'cp-1', role: 'control-plane', tailscale_ip: '100.64.0.1' },
    ]);
    const config = makeConfig({ roleFilter: 'worker' });
    const result = await runBootstrap(config, deps);
    expect(result.success).toBe(true);
    expect(result.machines).toHaveLength(0);
  });

  it('measures total duration', async () => {
    const result = await runBootstrap(makeConfig(), deps);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates inventory load errors', async () => {
    mockLoadInventory.mockRejectedValue(
      new FleetBootstrapError('INVENTORY_NOT_FOUND', 'file not found'),
    );
    await expect(runBootstrap(makeConfig(), deps)).rejects.toThrow(FleetBootstrapError);
  });

  it('bootstraps machines with specified concurrency', async () => {
    mockLoadInventory.mockResolvedValue([
      { id: 'w-1', role: 'worker', tailscale_ip: '100.64.0.1' },
      { id: 'w-2', role: 'worker', tailscale_ip: '100.64.0.2' },
      { id: 'w-3', role: 'worker', tailscale_ip: '100.64.0.3' },
      { id: 'w-4', role: 'worker', tailscale_ip: '100.64.0.4' },
    ]);

    const config = makeConfig({ concurrency: 2 });
    const result = await runBootstrap(config, deps);
    expect(result.machines).toHaveLength(4);
  });

  it('handles mixed success and failure results', async () => {
    mockBootstrapMachine
      .mockResolvedValueOnce({ host: 'cp-1', status: 'success', steps: [], durationMs: 0 })
      .mockResolvedValueOnce({
        host: 'w-1',
        status: 'failed',
        steps: [],
        error: 'err',
        durationMs: 0,
      });

    const result = await runBootstrap(makeConfig(), deps);
    expect(result.success).toBe(false);
    expect(result.machines.filter((m) => m.status === 'success')).toHaveLength(1);
    expect(result.machines.filter((m) => m.status === 'failed')).toHaveLength(1);
  });

  it('handles all machines skipped in dry-run', async () => {
    mockBootstrapMachine.mockResolvedValue({
      host: 'test',
      status: 'skipped',
      steps: ['[dry-run]'],
      durationMs: 0,
    });

    const result = await runBootstrap(makeConfig({ dryRun: true }), deps);
    expect(result.success).toBe(true);
    expect(result.machines.every((m) => m.status === 'skipped')).toBe(true);
  });
});

// =============================================================================
// exitCodeFromResult
// =============================================================================

describe('exitCodeFromResult', () => {
  it('returns EXIT_SUCCESS for successful result', () => {
    expect(exitCodeFromResult(makeSuccessResult())).toBe(EXIT_SUCCESS);
  });

  it('returns EXIT_BOOTSTRAP_FAILED for failed result', () => {
    expect(exitCodeFromResult(makeSuccessResult({ success: false }))).toBe(EXIT_BOOTSTRAP_FAILED);
  });

  it('returns EXIT_SUCCESS when machines is empty but success is true', () => {
    expect(exitCodeFromResult(makeSuccessResult({ machines: [] }))).toBe(EXIT_SUCCESS);
  });
});

// =============================================================================
// Constants
// =============================================================================

describe('constants', () => {
  it('EXIT_SUCCESS is 0', () => {
    expect(EXIT_SUCCESS).toBe(0);
  });

  it('EXIT_BOOTSTRAP_FAILED is 1', () => {
    expect(EXIT_BOOTSTRAP_FAILED).toBe(1);
  });

  it('EXIT_INVENTORY_ERROR is 2', () => {
    expect(EXIT_INVENTORY_ERROR).toBe(2);
  });

  it('EXIT_INVALID_ARGS is 3', () => {
    expect(EXIT_INVALID_ARGS).toBe(3);
  });

  it('DEFAULT_INVENTORY_PATH ends with machines.yml', () => {
    expect(DEFAULT_INVENTORY_PATH).toContain('machines.yml');
  });

  it('SETUP_SCRIPT_PATH ends with setup-machine.sh', () => {
    expect(SETUP_SCRIPT_PATH).toContain('setup-machine.sh');
  });
});

// =============================================================================
// main (integration-level)
// =============================================================================

describe('main', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('outputs structured JSON to stdout', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);

    // We need to mock the actual SSH calls to prevent real execution.
    // Since main() uses the real bootstrapMachine which uses real exec*,
    // and we mock child_process at the top level, this will work.
    // But the real function calls execFile which is mocked.
    // For simplicity, just verify it runs with dry-run.
    const result = await main(['node', 'script.ts', '--dry-run']);
    expect(result.success).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalled();
    const jsonOutput = consoleLogSpy.mock.calls[0]?.[0];
    expect(() => JSON.parse(jsonOutput as string)).not.toThrow();
  });

  it('logs inventory path to stderr', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);
    await main(['node', 'script.ts', '--dry-run']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[fleet-bootstrap] Inventory:'),
    );
  });

  it('logs dry-run message to stderr', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);
    await main(['node', 'script.ts', '--dry-run']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
  });

  it('logs role filter to stderr when specified', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);
    await main(['node', 'script.ts', '--dry-run', '--role', 'worker']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Role filter: worker'));
  });

  it('reports machine count in dry-run summary', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);
    const result = await main(['node', 'script.ts', '--dry-run']);
    expect(result.machines).toHaveLength(3);
  });

  it('handles inventory file not found error', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    await expect(main(['node', 'script.ts', '--inventory', '/nonexistent.yml'])).rejects.toThrow(
      FleetBootstrapError,
    );
  });
});

// =============================================================================
// Integration: end-to-end dry-run with real inventory parsing
// =============================================================================

describe('integration: dry-run with inventory', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('parses the actual inventory format and produces expected dry-run results', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);

    const result = await main(['node', 'script.ts', '--dry-run']);

    expect(result.success).toBe(true);
    expect(result.machines).toHaveLength(3);
    expect(result.machines.every((m) => m.status === 'skipped')).toBe(true);
    expect(result.machines[0]?.host).toBe('control-plane-1');
    expect(result.machines[1]?.host).toBe('worker-ec2-1');
    expect(result.machines[2]?.host).toBe('worker-mac-mini-1');
  });

  it('filters to control-plane only in dry-run', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);

    const result = await main(['node', 'script.ts', '--dry-run', '--role', 'control-plane']);

    expect(result.success).toBe(true);
    expect(result.machines).toHaveLength(1);
    expect(result.machines[0]?.host).toBe('control-plane-1');
  });

  it('filters to worker only in dry-run', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);

    const result = await main(['node', 'script.ts', '--dry-run', '--role', 'worker']);

    expect(result.success).toBe(true);
    expect(result.machines).toHaveLength(2);
  });

  it('respects concurrency setting in config output', async () => {
    vi.mocked(readFile).mockResolvedValue(SAMPLE_YAML);

    await main(['node', 'script.ts', '--dry-run', '--concurrency', '7']);

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Concurrency: 7'));
  });
});
