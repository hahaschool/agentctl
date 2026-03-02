import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock fns are available before vi.mock hoists
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    mockExecFile: vi.fn(),
    mockFsAccess: vi.fn(),
    mockFsReadFile: vi.fn(),
    mockFsWriteFile: vi.fn(),
    mockFsUnlink: vi.fn(),
    mockOsPlatform: vi.fn(),
    mockOsHostname: vi.fn(),
    mockOsArch: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execFile: mocks.mockExecFile,
}));

vi.mock('node:fs/promises', () => ({
  access: mocks.mockFsAccess,
  readFile: mocks.mockFsReadFile,
  writeFile: mocks.mockFsWriteFile,
  unlink: mocks.mockFsUnlink,
}));

vi.mock('node:os', () => ({
  platform: () => mocks.mockOsPlatform(),
  hostname: () => mocks.mockOsHostname(),
  arch: () => mocks.mockOsArch(),
}));

// Destructure for convenient access in tests (after vi.mock hoisting is resolved)
const {
  mockExecFile,
  mockFsAccess,
  mockFsReadFile,
  mockFsWriteFile,
  mockFsUnlink,
  mockOsPlatform,
  mockOsHostname,
  mockOsArch,
} = mocks;

import type { ProvisionConfig, ProvisionResult } from './provision-target.js';
import {
  commandExists,
  configureSudoDocker,
  copyComposeFile,
  createDeployUser,
  createTargetDirectory,
  DEFAULT_COMPOSE_FILE,
  DEFAULT_DEPLOY_USER,
  DEFAULT_ENV_TEMPLATE,
  DEFAULT_TARGET_DIR,
  detectOS,
  EXIT_PERMISSION_ERROR,
  EXIT_PROVISION_FAILED,
  EXIT_SUCCESS,
  EXIT_UNSUPPORTED_OS,
  exitCodeFromResult,
  generateEnvContent,
  generateEnvFile,
  getDockerComposeVersion,
  getDockerVersion,
  getTailscaleVersion,
  installDocker,
  installDockerCompose,
  installTailscale,
  main,
  ProvisionError,
  parseArgs,
  run,
  runProvision,
  setupDeployUserSsh,
  userExists,
  validateComposeFile,
  validateInstallations,
} from './provision-target.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ProvisionConfig> = {}): ProvisionConfig {
  return {
    targetDir: '/opt/agentctl',
    deployUser: 'deploy',
    dryRun: false,
    composeFile: '/path/to/docker-compose.prod.yml',
    envTemplate: '/path/to/.env.example',
    ...overrides,
  };
}

/**
 * Configure mockExecFile to resolve with given stdout for matching commands,
 * or reject for unrecognized commands.
 */
function setupExecFile(handlers: Record<string, string | Error>): void {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, result?: { stdout: string }) => void,
    ) => {
      // Build a lookup key from command + first arg (enough to disambiguate most calls)
      const key = `${cmd} ${(args ?? []).join(' ')}`;

      // Check each handler pattern
      for (const [pattern, result] of Object.entries(handlers)) {
        if (key.includes(pattern)) {
          if (result instanceof Error) {
            cb(result);
            return;
          }
          cb(null, { stdout: result });
          return;
        }
      }

      // Default: command not found
      cb(new Error(`mock: command not configured: ${key}`));
    },
  );
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockOsPlatform.mockReturnValue('linux');
  mockOsHostname.mockReturnValue('test-machine');
  mockOsArch.mockReturnValue('x64');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// ProvisionError
// ===========================================================================

describe('ProvisionError', () => {
  it('stores code, message, and context', () => {
    const err = new ProvisionError('TEST_CODE', 'test message', { key: 'value' });
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.context).toEqual({ key: 'value' });
    expect(err.name).toBe('ProvisionError');
  });

  it('works without context', () => {
    const err = new ProvisionError('NO_CTX', 'no context');
    expect(err.context).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const err = new ProvisionError('ERR', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProvisionError);
  });
});

// ===========================================================================
// parseArgs
// ===========================================================================

describe('parseArgs', () => {
  it('returns defaults when no args provided', () => {
    const config = parseArgs(['node', 'script.ts']);
    expect(config.dryRun).toBe(false);
    expect(config.targetDir).toBe(DEFAULT_TARGET_DIR);
    expect(config.deployUser).toBe(DEFAULT_DEPLOY_USER);
    expect(config.composeFile).toBe(DEFAULT_COMPOSE_FILE);
    expect(config.envTemplate).toBe(DEFAULT_ENV_TEMPLATE);
  });

  it('parses --dry-run flag', () => {
    const config = parseArgs(['node', 'script.ts', '--dry-run']);
    expect(config.dryRun).toBe(true);
  });

  it('parses --target-dir with value', () => {
    const config = parseArgs(['node', 'script.ts', '--target-dir', '/custom/path']);
    expect(config.targetDir).toBe('/custom/path');
  });

  it('parses --deploy-user with value', () => {
    const config = parseArgs(['node', 'script.ts', '--deploy-user', 'myuser']);
    expect(config.deployUser).toBe('myuser');
  });

  it('parses --compose-file with value', () => {
    const config = parseArgs(['node', 'script.ts', '--compose-file', '/my/compose.yml']);
    expect(config.composeFile).toBe('/my/compose.yml');
  });

  it('parses --env-template with value', () => {
    const config = parseArgs(['node', 'script.ts', '--env-template', '/my/.env.tpl']);
    expect(config.envTemplate).toBe('/my/.env.tpl');
  });

  it('parses all options together', () => {
    const config = parseArgs([
      'node',
      'script.ts',
      '--dry-run',
      '--target-dir',
      '/custom',
      '--deploy-user',
      'ops',
      '--compose-file',
      '/c.yml',
      '--env-template',
      '/e.tpl',
    ]);
    expect(config.dryRun).toBe(true);
    expect(config.targetDir).toBe('/custom');
    expect(config.deployUser).toBe('ops');
    expect(config.composeFile).toBe('/c.yml');
    expect(config.envTemplate).toBe('/e.tpl');
  });

  it('throws on --target-dir without value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--target-dir'])).toThrow(ProvisionError);
    expect(() => parseArgs(['node', 'script.ts', '--target-dir'])).toThrow(
      '--target-dir requires a path value',
    );
  });

  it('throws on --target-dir with another flag as value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--target-dir', '--dry-run'])).toThrow(
      ProvisionError,
    );
  });

  it('throws on --deploy-user without value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--deploy-user'])).toThrow(ProvisionError);
    expect(() => parseArgs(['node', 'script.ts', '--deploy-user'])).toThrow(
      '--deploy-user requires a username value',
    );
  });

  it('throws on --compose-file without value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--compose-file'])).toThrow(ProvisionError);
  });

  it('throws on --env-template without value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--env-template'])).toThrow(ProvisionError);
  });

  it('throws on unknown argument', () => {
    expect(() => parseArgs(['node', 'script.ts', '--bogus'])).toThrow(ProvisionError);
    expect(() => parseArgs(['node', 'script.ts', '--bogus'])).toThrow('Unknown argument: --bogus');
  });

  it('throws HELP_REQUESTED on --help', () => {
    try {
      parseArgs(['node', 'script.ts', '--help']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionError);
      expect((err as ProvisionError).code).toBe('HELP_REQUESTED');
    }
  });

  it('throws HELP_REQUESTED on -h', () => {
    try {
      parseArgs(['node', 'script.ts', '-h']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionError);
      expect((err as ProvisionError).code).toBe('HELP_REQUESTED');
    }
  });
});

// ===========================================================================
// run (shell helper)
// ===========================================================================

describe('run', () => {
  it('returns trimmed stdout on success', async () => {
    setupExecFile({ 'echo hello': '  hello world  \n' });
    const result = await run('echo', ['hello']);
    expect(result).toBe('hello world');
  });

  it('throws ProvisionError on failure', async () => {
    setupExecFile({ false: new Error('exit code 1') });
    await expect(run('false', [])).rejects.toThrow(ProvisionError);
    await expect(run('false', [])).rejects.toThrow('Command "false " failed');
  });

  it('includes command and args in error context', async () => {
    setupExecFile({ 'badcmd --flag': new Error('not found') });
    try {
      await run('badcmd', ['--flag']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisionError);
      expect((err as ProvisionError).code).toBe('COMMAND_FAILED');
      expect((err as ProvisionError).context?.command).toBe('badcmd');
      expect((err as ProvisionError).context?.args).toEqual(['--flag']);
    }
  });
});

// ===========================================================================
// commandExists
// ===========================================================================

describe('commandExists', () => {
  it('returns true when command is found', async () => {
    setupExecFile({ 'which docker': '/usr/bin/docker' });
    expect(await commandExists('docker')).toBe(true);
  });

  it('returns false when command is not found', async () => {
    setupExecFile({ 'which nonexistent': new Error('not found') });
    expect(await commandExists('nonexistent')).toBe(false);
  });
});

// ===========================================================================
// detectOS
// ===========================================================================

describe('detectOS', () => {
  it('returns macos on darwin platform', async () => {
    mockOsPlatform.mockReturnValue('darwin');
    const os = await detectOS();
    expect(os).toBe('macos');
  });

  it('returns ubuntu when /etc/os-release has ID=ubuntu', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID=ubuntu\nVERSION_ID="22.04"\n');
    const os = await detectOS();
    expect(os).toBe('ubuntu');
  });

  it('returns debian when /etc/os-release has ID=debian', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID=debian\nVERSION_ID="12"\n');
    const os = await detectOS();
    expect(os).toBe('debian');
  });

  it('handles quoted ID values', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID="ubuntu"\n');
    const os = await detectOS();
    expect(os).toBe('ubuntu');
  });

  it('falls back to ID_LIKE for derivatives', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID=pop\nID_LIKE="ubuntu debian"\n');
    const os = await detectOS();
    expect(os).toBe('ubuntu');
  });

  it('detects debian derivative via ID_LIKE', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID=raspbian\nID_LIKE="debian"\n');
    const os = await detectOS();
    expect(os).toBe('debian');
  });

  it('throws UNSUPPORTED_OS for unknown linux distros', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID=alpine\n');
    await expect(detectOS()).rejects.toThrow(ProvisionError);
    await expect(detectOS()).rejects.toThrow('Unsupported operating system');
  });

  it('throws UNSUPPORTED_OS for windows', async () => {
    mockOsPlatform.mockReturnValue('win32');
    await expect(detectOS()).rejects.toThrow(ProvisionError);
  });

  it('throws UNSUPPORTED_OS when /etc/os-release is unreadable', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(detectOS()).rejects.toThrow(ProvisionError);
  });

  it('includes platform and arch in error context', async () => {
    mockOsPlatform.mockReturnValue('freebsd');
    mockOsArch.mockReturnValue('arm64');
    try {
      await detectOS();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ProvisionError).context?.platform).toBe('freebsd');
      expect((err as ProvisionError).context?.arch).toBe('arm64');
    }
  });
});

// ===========================================================================
// userExists
// ===========================================================================

describe('userExists', () => {
  it('returns true when user exists', async () => {
    setupExecFile({ 'id deploy': 'uid=1001(deploy) gid=1001(deploy)' });
    expect(await userExists('deploy')).toBe(true);
  });

  it('returns false when user does not exist', async () => {
    setupExecFile({ 'id nonexist': new Error('no such user') });
    expect(await userExists('nonexist')).toBe(false);
  });
});

// ===========================================================================
// createDeployUser
// ===========================================================================

describe('createDeployUser', () => {
  it('skips if user already exists', async () => {
    setupExecFile({ 'id deploy': 'uid=1001(deploy)' });
    const result = await createDeployUser(makeConfig(), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('already exists');
  });

  it('skips in dry-run mode when user does not exist', async () => {
    setupExecFile({ 'id deploy': new Error('no such user') });
    const result = await createDeployUser(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('creates user on Linux with useradd', async () => {
    setupExecFile({
      'id deploy': new Error('no such user'),
      'sudo useradd': '',
    });
    const result = await createDeployUser(makeConfig(), 'ubuntu');
    expect(result.status).toBe('success');
    expect(result.message).toContain('Created user');
    // Verify useradd was called
    const calls = mockExecFile.mock.calls;
    const useraddCall = calls.find(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[]).includes('useradd'),
    );
    expect(useraddCall).toBeDefined();
    const useraddArgs = useraddCall?.[1] as string[];
    expect(useraddArgs).toContain('--system');
    expect(useraddArgs).toContain('--create-home');
    expect(useraddArgs).toContain('deploy');
  });

  it('creates user on macOS with dscl', async () => {
    setupExecFile({
      'id deploy': new Error('no such user'),
      'sudo dscl': '',
      'dscl . -list': 'root 0\nadmin 501\n',
      'sudo mkdir': '',
      'sudo chown': '',
    });
    const result = await createDeployUser(makeConfig(), 'macos');
    expect(result.status).toBe('success');
  });

  it('uses correct step name', async () => {
    setupExecFile({ 'id deploy': 'uid=1001(deploy)' });
    const result = await createDeployUser(makeConfig(), 'ubuntu');
    expect(result.name).toBe('create-deploy-user');
  });
});

// ===========================================================================
// setupDeployUserSsh
// ===========================================================================

describe('setupDeployUserSsh', () => {
  it('skips in dry-run mode', async () => {
    const result = await setupDeployUserSsh(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('creates .ssh directory on Linux', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'sudo test': new Error('file not found'),
      'sudo touch': '',
      'sudo chown': '',
    });
    const result = await setupDeployUserSsh(makeConfig(), 'ubuntu');
    expect(result.status).toBe('success');
    expect(result.message).toContain('/home/deploy/.ssh');
  });

  it('uses /Users/ path on macOS', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'sudo test': new Error('file not found'),
      'sudo touch': '',
      'sudo chown': '',
    });
    const result = await setupDeployUserSsh(makeConfig(), 'macos');
    expect(result.status).toBe('success');
    expect(result.message).toContain('/Users/deploy/.ssh');
  });

  it('uses staff group on macOS', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'sudo test': new Error('file not found'),
      'sudo touch': '',
      'sudo chown': '',
    });
    await setupDeployUserSsh(makeConfig(), 'macos');
    const chownCall = mockExecFile.mock.calls.find(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[]).includes('chown'),
    );
    expect(chownCall).toBeDefined();
    const chownArgs = chownCall?.[1] as string[];
    expect(chownArgs.some((a: string) => a.includes('staff'))).toBe(true);
  });

  it('does not re-create authorized_keys if it exists', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'sudo test -f': '',
      'sudo chown': '',
    });
    const result = await setupDeployUserSsh(makeConfig(), 'ubuntu');
    expect(result.status).toBe('success');
    // touch should NOT have been called
    const touchCalls = mockExecFile.mock.calls.filter(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[]).includes('touch'),
    );
    expect(touchCalls.length).toBe(0);
  });

  it('uses correct step name', async () => {
    const result = await setupDeployUserSsh(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.name).toBe('setup-deploy-ssh');
  });
});

// ===========================================================================
// configureSudoDocker
// ===========================================================================

describe('configureSudoDocker', () => {
  it('skips in dry-run on Linux', async () => {
    const result = await configureSudoDocker(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
    expect(result.message).toContain('sudoers');
  });

  it('skips in dry-run on macOS', async () => {
    const result = await configureSudoDocker(makeConfig({ dryRun: true }), 'macos');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
    expect(result.message).toContain('docker group');
  });

  it('writes sudoers file on Linux', async () => {
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'sudo visudo': '',
      'sudo cp': '',
      'sudo chmod': '',
      'sudo usermod': '',
    });
    const result = await configureSudoDocker(makeConfig(), 'ubuntu');
    expect(result.status).toBe('success');
    expect(result.message).toContain('Sudoers configured');
    // Verify visudo was called for validation
    const visudoCall = mockExecFile.mock.calls.find(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[])[0] === 'visudo',
    );
    expect(visudoCall).toBeDefined();
  });

  it('adds user to docker group on macOS', async () => {
    setupExecFile({
      'sudo dseditgroup': '',
    });
    const result = await configureSudoDocker(makeConfig(), 'macos');
    expect(result.status).toBe('success');
    expect(result.message).toContain('macOS');
  });

  it('handles missing docker group on macOS gracefully', async () => {
    setupExecFile({
      'sudo dseditgroup': new Error('group not found'),
    });
    const result = await configureSudoDocker(makeConfig(), 'macos');
    expect(result.status).toBe('success');
  });

  it('cleans up temp file even on error', async () => {
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'sudo visudo': new Error('syntax error'),
    });
    await expect(configureSudoDocker(makeConfig(), 'debian')).rejects.toThrow();
    expect(mockFsUnlink).toHaveBeenCalled();
  });

  it('uses correct step name', async () => {
    const result = await configureSudoDocker(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.name).toBe('configure-sudo-docker');
  });
});

// ===========================================================================
// Version check helpers
// ===========================================================================

describe('getDockerVersion', () => {
  it('returns version string when Docker is installed', async () => {
    setupExecFile({ 'docker --version': 'Docker version 24.0.7, build afdd53b' });
    const version = await getDockerVersion();
    expect(version).toBe('Docker version 24.0.7, build afdd53b');
  });

  it('returns null when Docker is not installed', async () => {
    setupExecFile({ 'docker --version': new Error('not found') });
    const version = await getDockerVersion();
    expect(version).toBeNull();
  });
});

describe('getDockerComposeVersion', () => {
  it('returns version string when Compose is installed', async () => {
    setupExecFile({ 'docker compose version': 'Docker Compose version v2.23.0' });
    const version = await getDockerComposeVersion();
    expect(version).toBe('Docker Compose version v2.23.0');
  });

  it('returns null when Compose is not installed', async () => {
    setupExecFile({ 'docker compose version': new Error('not found') });
    const version = await getDockerComposeVersion();
    expect(version).toBeNull();
  });
});

describe('getTailscaleVersion', () => {
  it('returns first line of version output', async () => {
    setupExecFile({ 'tailscale --version': '1.54.0\n  go1.21.5\n' });
    const version = await getTailscaleVersion();
    expect(version).toBe('1.54.0');
  });

  it('returns null when Tailscale is not installed', async () => {
    setupExecFile({ 'tailscale --version': new Error('not found') });
    const version = await getTailscaleVersion();
    expect(version).toBeNull();
  });
});

// ===========================================================================
// installDocker
// ===========================================================================

describe('installDocker', () => {
  it('skips when Docker is already installed', async () => {
    setupExecFile({ 'docker --version': 'Docker version 24.0.7' });
    const result = await installDocker(makeConfig(), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('already installed');
  });

  it('reports dry-run when Docker is missing', async () => {
    setupExecFile({ 'docker --version': new Error('not found') });
    const result = await installDocker(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('installs Docker on macOS via brew', async () => {
    const callTracker: string[] = [];
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        const key = `${cmd} ${(args ?? []).join(' ')}`;
        callTracker.push(key);
        if (
          key.includes('docker --version') &&
          callTracker.filter((k) => k.includes('docker --version')).length === 1
        ) {
          cb(new Error('not found'));
          return;
        }
        if (key.includes('docker --version')) {
          cb(null, { stdout: 'Docker version 24.0.7' });
          return;
        }
        if (key.includes('which brew')) {
          cb(null, { stdout: '/opt/homebrew/bin/brew' });
          return;
        }
        if (key.includes('brew install')) {
          cb(null, { stdout: '' });
          return;
        }
        cb(new Error(`unexpected: ${key}`));
      },
    );
    const result = await installDocker(makeConfig(), 'macos');
    expect(result.status).toBe('success');
    expect(callTracker.some((k) => k.includes('brew install'))).toBe(true);
  });

  it('throws when Homebrew is missing on macOS', async () => {
    setupExecFile({
      'docker --version': new Error('not found'),
      'which brew': new Error('not found'),
    });
    await expect(installDocker(makeConfig(), 'macos')).rejects.toThrow(ProvisionError);
    await expect(installDocker(makeConfig(), 'macos')).rejects.toThrow('Homebrew is required');
  });

  it('throws when version check fails after install', async () => {
    const callCount = { docker: 0 };
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        const key = `${cmd} ${(args ?? []).join(' ')}`;
        if (key.includes('docker --version')) {
          callCount.docker++;
          // Always fail version check (simulating broken install)
          cb(new Error('not found'));
          return;
        }
        // All other commands succeed
        cb(null, { stdout: '' });
      },
    );
    await expect(installDocker(makeConfig(), 'ubuntu')).rejects.toThrow('version check failed');
  });

  it('uses correct step name', async () => {
    setupExecFile({ 'docker --version': 'Docker version 24.0.7' });
    const result = await installDocker(makeConfig(), 'ubuntu');
    expect(result.name).toBe('install-docker');
  });
});

// ===========================================================================
// installDockerCompose
// ===========================================================================

describe('installDockerCompose', () => {
  it('skips when Compose is already installed', async () => {
    setupExecFile({ 'docker compose version': 'Docker Compose version v2.23.0' });
    const result = await installDockerCompose(makeConfig(), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('already installed');
  });

  it('reports dry-run when Compose is missing', async () => {
    setupExecFile({ 'docker compose version': new Error('not found') });
    const result = await installDockerCompose(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('installs Compose on macOS via brew', async () => {
    const callTracker: string[] = [];
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        const key = `${cmd} ${(args ?? []).join(' ')}`;
        callTracker.push(key);
        if (
          key.includes('docker compose version') &&
          callTracker.filter((k) => k.includes('docker compose version')).length === 1
        ) {
          cb(new Error('not found'));
          return;
        }
        if (key.includes('docker compose version')) {
          cb(null, { stdout: 'Docker Compose version v2.23.0' });
          return;
        }
        cb(null, { stdout: '' });
      },
    );
    const result = await installDockerCompose(makeConfig(), 'macos');
    expect(result.status).toBe('success');
  });

  it('uses correct step name', async () => {
    setupExecFile({ 'docker compose version': 'Compose v2' });
    const result = await installDockerCompose(makeConfig(), 'ubuntu');
    expect(result.name).toBe('install-docker-compose');
  });
});

// ===========================================================================
// installTailscale
// ===========================================================================

describe('installTailscale', () => {
  it('skips when Tailscale is already installed', async () => {
    setupExecFile({ 'tailscale --version': '1.54.0\n  go1.21' });
    const result = await installTailscale(makeConfig(), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('already installed');
  });

  it('reports dry-run when Tailscale is missing', async () => {
    setupExecFile({ 'tailscale --version': new Error('not found') });
    const result = await installTailscale(makeConfig({ dryRun: true }), 'ubuntu');
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('installs Tailscale via official script', async () => {
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    const callTracker: string[] = [];
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        const key = `${cmd} ${(args ?? []).join(' ')}`;
        callTracker.push(key);
        if (
          key.includes('tailscale --version') &&
          callTracker.filter((k) => k.includes('tailscale --version')).length === 1
        ) {
          cb(new Error('not found'));
          return;
        }
        if (key.includes('tailscale --version')) {
          cb(null, { stdout: '1.54.0' });
          return;
        }
        if (key.includes('curl')) {
          cb(null, { stdout: '#!/bin/bash\necho install' });
          return;
        }
        cb(null, { stdout: '' });
      },
    );
    const result = await installTailscale(makeConfig(), 'ubuntu');
    expect(result.status).toBe('success');
    expect(result.message).toContain('1.54.0');
  });

  it('cleans up install script even on error', async () => {
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    const callCount = { tailscale: 0 };
    mockExecFile.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, result?: { stdout: string }) => void,
      ) => {
        const key = `${cmd} ${(args ?? []).join(' ')}`;
        if (key.includes('tailscale --version')) {
          callCount.tailscale++;
          cb(new Error('not found'));
          return;
        }
        if (key.includes('curl')) {
          cb(null, { stdout: '#!/bin/bash' });
          return;
        }
        if (key.includes('sudo bash')) {
          cb(new Error('install failed'));
          return;
        }
        cb(null, { stdout: '' });
      },
    );
    await expect(installTailscale(makeConfig(), 'ubuntu')).rejects.toThrow();
    expect(mockFsUnlink).toHaveBeenCalled();
  });

  it('uses correct step name', async () => {
    setupExecFile({ 'tailscale --version': '1.54.0' });
    const result = await installTailscale(makeConfig(), 'ubuntu');
    expect(result.name).toBe('install-tailscale');
  });
});

// ===========================================================================
// validateInstallations
// ===========================================================================

describe('validateInstallations', () => {
  it('returns success when all tools are installed', async () => {
    setupExecFile({
      'docker --version': 'Docker version 24.0.7',
      'docker compose version': 'Compose v2.23.0',
      'tailscale --version': '1.54.0',
    });
    const result = await validateInstallations();
    expect(result.status).toBe('success');
    expect(result.message).toContain('Docker');
    expect(result.message).toContain('Compose');
    expect(result.message).toContain('Tailscale');
  });

  it('returns failed when Docker is missing', async () => {
    setupExecFile({
      'docker --version': new Error('not found'),
      'docker compose version': 'Compose v2.23.0',
      'tailscale --version': '1.54.0',
    });
    const result = await validateInstallations();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Missing: Docker');
  });

  it('returns failed when Docker Compose is missing', async () => {
    setupExecFile({
      'docker --version': 'Docker 24.0.7',
      'docker compose version': new Error('not found'),
      'tailscale --version': '1.54.0',
    });
    const result = await validateInstallations();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Missing: Docker Compose');
  });

  it('returns failed when Tailscale is missing', async () => {
    setupExecFile({
      'docker --version': 'Docker 24.0.7',
      'docker compose version': 'Compose v2.23.0',
      'tailscale --version': new Error('not found'),
    });
    const result = await validateInstallations();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Missing: Tailscale');
  });

  it('lists all missing tools when multiple are absent', async () => {
    setupExecFile({
      'docker --version': new Error('not found'),
      'docker compose version': new Error('not found'),
      'tailscale --version': new Error('not found'),
    });
    const result = await validateInstallations();
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Docker');
    expect(result.message).toContain('Docker Compose');
    expect(result.message).toContain('Tailscale');
  });

  it('uses correct step name', async () => {
    setupExecFile({
      'docker --version': 'Docker 24',
      'docker compose version': 'Compose 2',
      'tailscale --version': '1.54',
    });
    const result = await validateInstallations();
    expect(result.name).toBe('validate-installations');
  });
});

// ===========================================================================
// createTargetDirectory
// ===========================================================================

describe('createTargetDirectory', () => {
  it('creates directory with correct permissions', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'id deploy': 'uid=1001(deploy)',
      'sudo chown': '',
    });
    const result = await createTargetDirectory(makeConfig());
    expect(result.status).toBe('success');
    expect(result.message).toContain('/opt/agentctl');
  });

  it('skips in dry-run', async () => {
    const result = await createTargetDirectory(makeConfig({ dryRun: true }));
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('uses custom target directory', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'id deploy': 'uid=1001(deploy)',
      'sudo chown': '',
    });
    const result = await createTargetDirectory(makeConfig({ targetDir: '/custom/dir' }));
    expect(result.status).toBe('success');
    expect(result.message).toContain('/custom/dir');
  });

  it('skips chown when deploy user does not exist', async () => {
    setupExecFile({
      'sudo mkdir': '',
      'sudo chmod': '',
      'id deploy': new Error('no such user'),
    });
    const result = await createTargetDirectory(makeConfig());
    expect(result.status).toBe('success');
    // chown should not have been called
    const chownCalls = mockExecFile.mock.calls.filter(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[]).includes('chown'),
    );
    expect(chownCalls.length).toBe(0);
  });

  it('uses correct step name', async () => {
    const result = await createTargetDirectory(makeConfig({ dryRun: true }));
    expect(result.name).toBe('create-target-directory');
  });
});

// ===========================================================================
// copyComposeFile
// ===========================================================================

describe('copyComposeFile', () => {
  it('copies file to target directory', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('services:\n  web:\n    image: nginx\n');
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'sudo cp': '',
      'sudo chmod': '',
    });
    const result = await copyComposeFile(makeConfig());
    expect(result.status).toBe('success');
    expect(result.message).toContain('docker-compose.prod.yml');
  });

  it('skips in dry-run', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    const result = await copyComposeFile(makeConfig({ dryRun: true }));
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('throws when source file is missing', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(copyComposeFile(makeConfig())).rejects.toThrow(ProvisionError);
    await expect(copyComposeFile(makeConfig())).rejects.toThrow('Compose file not found');
  });

  it('includes composeFile in error context', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    try {
      await copyComposeFile(makeConfig({ composeFile: '/no/such/file.yml' }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ProvisionError).context?.composeFile).toBe('/no/such/file.yml');
    }
  });

  it('cleans up temp file after copy', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('services: {}');
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'sudo cp': '',
      'sudo chmod': '',
    });
    await copyComposeFile(makeConfig());
    expect(mockFsUnlink).toHaveBeenCalled();
  });

  it('uses correct step name', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    const result = await copyComposeFile(makeConfig({ dryRun: true }));
    expect(result.name).toBe('copy-compose-file');
  });
});

// ===========================================================================
// validateComposeFile
// ===========================================================================

describe('validateComposeFile', () => {
  it('returns success when compose file is valid', async () => {
    setupExecFile({ 'docker compose -f': '' });
    const result = await validateComposeFile(makeConfig());
    expect(result.status).toBe('success');
  });

  it('returns failed when compose file has errors', async () => {
    setupExecFile({ 'docker compose -f': new Error('invalid yaml') });
    const result = await validateComposeFile(makeConfig());
    expect(result.status).toBe('failed');
    expect(result.message).toContain('syntax errors');
  });

  it('validates source file in dry-run', async () => {
    setupExecFile({ 'docker compose -f': '' });
    const result = await validateComposeFile(makeConfig({ dryRun: true }));
    expect(result.status).toBe('success');
    expect(result.message).toContain('dry-run');
  });

  it('reports failure for source file in dry-run', async () => {
    setupExecFile({ 'docker compose -f': new Error('bad yaml') });
    const result = await validateComposeFile(makeConfig({ dryRun: true }));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('dry-run');
  });

  it('uses correct step name', async () => {
    setupExecFile({ 'docker compose -f': '' });
    const result = await validateComposeFile(makeConfig());
    expect(result.name).toBe('validate-compose-file');
  });
});

// ===========================================================================
// generateEnvContent
// ===========================================================================

describe('generateEnvContent', () => {
  const template = [
    '# AgentCTL',
    'PORT=8080',
    'MACHINE_ID=machine-my-mac',
    'NODE_ENV=development',
    'DATABASE_URL=postgresql://localhost:5432/agentctl',
  ].join('\n');

  it('replaces MACHINE_ID with provided value', () => {
    const result = generateEnvContent(template, 'worker-ec2-1');
    expect(result).toContain('MACHINE_ID=worker-ec2-1');
    expect(result).not.toContain('MACHINE_ID=machine-my-mac');
  });

  it('sets NODE_ENV to production', () => {
    const result = generateEnvContent(template, 'test');
    expect(result).toContain('NODE_ENV=production');
    expect(result).not.toContain('NODE_ENV=development');
  });

  it('preserves other values', () => {
    const result = generateEnvContent(template, 'test');
    expect(result).toContain('PORT=8080');
    expect(result).toContain('DATABASE_URL=postgresql://localhost:5432/agentctl');
  });

  it('preserves comments', () => {
    const result = generateEnvContent(template, 'test');
    expect(result).toContain('# AgentCTL');
  });

  it('handles empty MACHINE_ID', () => {
    const tpl = 'MACHINE_ID=\n';
    const result = generateEnvContent(tpl, 'my-machine');
    expect(result).toContain('MACHINE_ID=my-machine');
  });
});

// ===========================================================================
// generateEnvFile
// ===========================================================================

describe('generateEnvFile', () => {
  it('generates .env from template', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('MACHINE_ID=placeholder\nNODE_ENV=development\n');
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'sudo cp': '',
      'sudo chmod': '',
    });
    const result = await generateEnvFile(makeConfig());
    expect(result.status).toBe('success');
    expect(result.message).toContain('.env');
    expect(result.message).toContain('MACHINE_ID=');
  });

  it('skips in dry-run', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    const result = await generateEnvFile(makeConfig({ dryRun: true }));
    expect(result.status).toBe('skipped');
    expect(result.message).toContain('dry-run');
  });

  it('throws when template is missing', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(generateEnvFile(makeConfig())).rejects.toThrow(ProvisionError);
    await expect(generateEnvFile(makeConfig())).rejects.toThrow('Environment template not found');
  });

  it('uses MACHINE_ID from env var when set', async () => {
    const originalEnv = process.env.MACHINE_ID;
    process.env.MACHINE_ID = 'env-machine-id';
    try {
      mockFsAccess.mockResolvedValue(undefined);
      mockFsReadFile.mockResolvedValue('MACHINE_ID=placeholder\nNODE_ENV=development\n');
      mockFsWriteFile.mockResolvedValue(undefined);
      mockFsUnlink.mockResolvedValue(undefined);
      setupExecFile({
        'sudo cp': '',
        'sudo chmod': '',
      });
      const result = await generateEnvFile(makeConfig());
      expect(result.message).toContain('MACHINE_ID=env-machine-id');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.MACHINE_ID;
      } else {
        process.env.MACHINE_ID = originalEnv;
      }
    }
  });

  it('falls back to hostname when MACHINE_ID is not set', async () => {
    const originalEnv = process.env.MACHINE_ID;
    delete process.env.MACHINE_ID;
    mockOsHostname.mockReturnValue('my-host');
    try {
      mockFsAccess.mockResolvedValue(undefined);
      mockFsReadFile.mockResolvedValue('MACHINE_ID=placeholder\nNODE_ENV=development\n');
      mockFsWriteFile.mockResolvedValue(undefined);
      mockFsUnlink.mockResolvedValue(undefined);
      setupExecFile({
        'sudo cp': '',
        'sudo chmod': '',
      });
      const result = await generateEnvFile(makeConfig());
      expect(result.message).toContain('MACHINE_ID=my-host');
    } finally {
      if (originalEnv !== undefined) {
        process.env.MACHINE_ID = originalEnv;
      }
    }
  });

  it('uses correct step name', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    const result = await generateEnvFile(makeConfig({ dryRun: true }));
    expect(result.name).toBe('generate-env-file');
  });
});

// ===========================================================================
// runProvision (integration)
// ===========================================================================

describe('runProvision', () => {
  it('returns failed result when OS is unsupported', async () => {
    mockOsPlatform.mockReturnValue('win32');
    const result = await runProvision(makeConfig());
    expect(result.success).toBe(false);
    expect(result.steps.some((s) => s.status === 'failed' && s.name === 'detect-os')).toBe(true);
  });

  it('sets dryRun flag in result', async () => {
    mockOsPlatform.mockReturnValue('win32');
    const result = await runProvision(makeConfig({ dryRun: true }));
    expect(result.dryRun).toBe(true);
  });

  it('reports detect-os success for valid OS', async () => {
    mockOsPlatform.mockReturnValue('darwin');
    // Make remaining steps fail gracefully
    setupExecFile({
      'id deploy': 'uid=1001(deploy)',
    });
    // The rest of the steps will fail, but detect-os should succeed
    const result = await runProvision(makeConfig({ dryRun: true }));
    const detectStep = result.steps.find((s) => s.name === 'detect-os');
    expect(detectStep?.status).toBe('success');
    expect(detectStep?.message).toContain('macos');
  });

  it('stops on deploy-user-setup failure', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockResolvedValue('ID=ubuntu\n');
    // Make createDeployUser throw
    setupExecFile({
      'id deploy': new Error('no such user'),
      'sudo useradd': new Error('permission denied'),
    });
    const result = await runProvision(makeConfig());
    expect(result.success).toBe(false);
    const failedStep = result.steps.find((s) => s.status === 'failed');
    expect(failedStep).toBeDefined();
  });

  it('completes dry-run successfully for valid config', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockImplementation((p: string) => {
      if (p === '/etc/os-release') {
        return Promise.resolve('ID=ubuntu\n');
      }
      return Promise.resolve('MACHINE_ID=placeholder\nNODE_ENV=development\n');
    });
    mockFsAccess.mockResolvedValue(undefined);
    setupExecFile({
      'id deploy': new Error('no such user'),
      'docker --version': new Error('not found'),
      'docker compose version': new Error('not found'),
      'docker compose -f': '',
      'tailscale --version': new Error('not found'),
    });
    const result = await runProvision(makeConfig({ dryRun: true }));
    expect(result.dryRun).toBe(true);
    // All steps should be either success or skipped (none failed)
    const failedSteps = result.steps.filter((s) => s.status === 'failed');
    expect(failedSteps).toHaveLength(0);
  });

  it('includes all phase steps on full success', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockImplementation((p: string) => {
      if (p === '/etc/os-release') {
        return Promise.resolve('ID=ubuntu\n');
      }
      return Promise.resolve('MACHINE_ID=placeholder\nNODE_ENV=development\n');
    });
    mockFsAccess.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'id deploy': 'uid=1001(deploy)',
      'sudo mkdir': '',
      'sudo chmod': '',
      'sudo test': '',
      'sudo chown': '',
      'sudo visudo': '',
      'sudo cp': '',
      'sudo usermod': '',
      'docker --version': 'Docker 24',
      'docker compose version': 'Compose v2',
      'docker compose -f': '',
      'tailscale --version': '1.54',
    });
    const result = await runProvision(makeConfig());
    expect(result.success).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(8);
    // Should have detect-os, create-deploy-user, setup-deploy-ssh, configure-sudo-docker,
    // install-docker, install-docker-compose, install-tailscale, validate-installations,
    // create-target-directory, copy-compose-file, validate-compose-file, generate-env-file
    const stepNames = result.steps.map((s) => s.name);
    expect(stepNames).toContain('detect-os');
    expect(stepNames).toContain('create-deploy-user');
    expect(stepNames).toContain('setup-deploy-ssh');
    expect(stepNames).toContain('configure-sudo-docker');
  });

  it('marks result as failed when validation step fails', async () => {
    mockOsPlatform.mockReturnValue('linux');
    mockFsReadFile.mockImplementation((p: string) => {
      if (p === '/etc/os-release') {
        return Promise.resolve('ID=ubuntu\n');
      }
      return Promise.resolve('MACHINE_ID=placeholder\nNODE_ENV=development\n');
    });
    mockFsAccess.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'id deploy': 'uid=1001(deploy)',
      'sudo mkdir': '',
      'sudo chmod': '',
      'sudo test': '',
      'sudo chown': '',
      'sudo visudo': '',
      'sudo cp': '',
      'sudo usermod': '',
      'docker --version': 'Docker 24',
      'docker compose version': new Error('not found'),
      'docker compose -f': '',
      'tailscale --version': '1.54',
    });
    const result = await runProvision(makeConfig());
    // validateInstallations should report Compose missing
    expect(result.success).toBe(false);
  });
});

// ===========================================================================
// exitCodeFromResult
// ===========================================================================

describe('exitCodeFromResult', () => {
  it('returns EXIT_SUCCESS for successful result', () => {
    const result: ProvisionResult = { success: true, steps: [], dryRun: false };
    expect(exitCodeFromResult(result)).toBe(EXIT_SUCCESS);
  });

  it('returns EXIT_SUCCESS for successful dry-run', () => {
    const result: ProvisionResult = { success: true, steps: [], dryRun: true };
    expect(exitCodeFromResult(result)).toBe(EXIT_SUCCESS);
  });

  it('returns EXIT_UNSUPPORTED_OS when detect-os failed', () => {
    const result: ProvisionResult = {
      success: false,
      dryRun: false,
      steps: [{ name: 'detect-os', status: 'failed', message: 'Unsupported OS' }],
    };
    expect(exitCodeFromResult(result)).toBe(EXIT_UNSUPPORTED_OS);
  });

  it('returns EXIT_PERMISSION_ERROR for permission failures', () => {
    const result: ProvisionResult = {
      success: false,
      dryRun: false,
      steps: [{ name: 'create-deploy-user', status: 'failed', message: 'permission denied' }],
    };
    expect(exitCodeFromResult(result)).toBe(EXIT_PERMISSION_ERROR);
  });

  it('returns EXIT_PERMISSION_ERROR for EACCES errors', () => {
    const result: ProvisionResult = {
      success: false,
      dryRun: false,
      steps: [{ name: 'store-files', status: 'failed', message: 'EACCES: permission denied' }],
    };
    expect(exitCodeFromResult(result)).toBe(EXIT_PERMISSION_ERROR);
  });

  it('returns EXIT_PROVISION_FAILED for other failures', () => {
    const result: ProvisionResult = {
      success: false,
      dryRun: false,
      steps: [{ name: 'install-docker', status: 'failed', message: 'network error' }],
    };
    expect(exitCodeFromResult(result)).toBe(EXIT_PROVISION_FAILED);
  });

  it('returns EXIT_PROVISION_FAILED when no steps are present', () => {
    const result: ProvisionResult = { success: false, steps: [], dryRun: false };
    expect(exitCodeFromResult(result)).toBe(EXIT_PROVISION_FAILED);
  });
});

// ===========================================================================
// main (CLI entry point)
// ===========================================================================

describe('main', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('outputs JSON to stdout', async () => {
    mockOsPlatform.mockReturnValue('win32');
    const result = await main(['node', 'script.ts', '--dry-run']);
    expect(result.dryRun).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls[0][0];
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('logs provisioning header to stderr', async () => {
    mockOsPlatform.mockReturnValue('win32');
    await main(['node', 'script.ts']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[provision-target] Starting provisioning'),
    );
  });

  it('logs dry-run notice to stderr', async () => {
    mockOsPlatform.mockReturnValue('win32');
    await main(['node', 'script.ts', '--dry-run']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
  });

  it('logs failure details to stderr on failure', async () => {
    mockOsPlatform.mockReturnValue('win32');
    await main(['node', 'script.ts']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
  });

  it('passes CLI args correctly', async () => {
    mockOsPlatform.mockReturnValue('win32');
    const result = await main([
      'node',
      'script.ts',
      '--target-dir',
      '/custom',
      '--deploy-user',
      'myuser',
    ]);
    // The result should reflect the config (even though OS detection fails early)
    expect(result.success).toBe(false);
  });

  it('throws ProvisionError for invalid args', async () => {
    await expect(main(['node', 'script.ts', '--bogus'])).rejects.toThrow(ProvisionError);
  });

  it('throws ProvisionError for --help', async () => {
    await expect(main(['node', 'script.ts', '--help'])).rejects.toThrow(ProvisionError);
  });
});

// ===========================================================================
// Idempotency
// ===========================================================================

describe('idempotency', () => {
  it('skips user creation when user already exists', async () => {
    setupExecFile({ 'id deploy': 'uid=1001(deploy)' });
    const r1 = await createDeployUser(makeConfig(), 'ubuntu');
    const r2 = await createDeployUser(makeConfig(), 'ubuntu');
    expect(r1.status).toBe('skipped');
    expect(r2.status).toBe('skipped');
  });

  it('skips Docker install when already present', async () => {
    setupExecFile({ 'docker --version': 'Docker 24' });
    const r1 = await installDocker(makeConfig(), 'ubuntu');
    const r2 = await installDocker(makeConfig(), 'ubuntu');
    expect(r1.status).toBe('skipped');
    expect(r2.status).toBe('skipped');
  });

  it('skips Compose install when already present', async () => {
    setupExecFile({ 'docker compose version': 'Compose v2' });
    const r1 = await installDockerCompose(makeConfig(), 'ubuntu');
    const r2 = await installDockerCompose(makeConfig(), 'ubuntu');
    expect(r1.status).toBe('skipped');
    expect(r2.status).toBe('skipped');
  });

  it('skips Tailscale install when already present', async () => {
    setupExecFile({ 'tailscale --version': '1.54' });
    const r1 = await installTailscale(makeConfig(), 'ubuntu');
    const r2 = await installTailscale(makeConfig(), 'ubuntu');
    expect(r1.status).toBe('skipped');
    expect(r2.status).toBe('skipped');
  });
});

// ===========================================================================
// Dry-run mode consistency
// ===========================================================================

describe('dry-run mode', () => {
  it('does not call execFile for user creation in dry-run', async () => {
    setupExecFile({ 'id deploy': new Error('no such user') });
    await createDeployUser(makeConfig({ dryRun: true }), 'ubuntu');
    // Should only call id, not useradd
    const useraaddCalls = mockExecFile.mock.calls.filter(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[]).includes('useradd'),
    );
    expect(useraaddCalls.length).toBe(0);
  });

  it('does not write files in dry-run', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    await copyComposeFile(makeConfig({ dryRun: true }));
    expect(mockFsWriteFile).not.toHaveBeenCalled();
  });

  it('does not call mkdir in dry-run', async () => {
    await createTargetDirectory(makeConfig({ dryRun: true }));
    const mkdirCalls = mockExecFile.mock.calls.filter((c: unknown[]) =>
      (c[1] as string[])?.includes('mkdir'),
    );
    expect(mkdirCalls.length).toBe(0);
  });

  it('does not install Docker in dry-run', async () => {
    setupExecFile({ 'docker --version': new Error('not found') });
    await installDocker(makeConfig({ dryRun: true }), 'ubuntu');
    const aptCalls = mockExecFile.mock.calls.filter(
      (c: unknown[]) => c[0] === 'sudo' && (c[1] as string[]).includes('apt-get'),
    );
    expect(aptCalls.length).toBe(0);
  });

  it('does not install Tailscale in dry-run', async () => {
    setupExecFile({ 'tailscale --version': new Error('not found') });
    await installTailscale(makeConfig({ dryRun: true }), 'ubuntu');
    const curlCalls = mockExecFile.mock.calls.filter((c: unknown[]) => c[0] === 'curl');
    expect(curlCalls.length).toBe(0);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('edge cases', () => {
  it('handles empty compose file', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsReadFile.mockResolvedValue('');
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    setupExecFile({
      'sudo cp': '',
      'sudo chmod': '',
    });
    const result = await copyComposeFile(makeConfig());
    expect(result.status).toBe('success');
  });

  it('handles special characters in deploy username', () => {
    // Should not throw for valid usernames
    const config = parseArgs(['node', 'script.ts', '--deploy-user', 'deploy-user']);
    expect(config.deployUser).toBe('deploy-user');
  });

  it('handles paths with spaces in target-dir', () => {
    const config = parseArgs(['node', 'script.ts', '--target-dir', '/opt/my path']);
    expect(config.targetDir).toBe('/opt/my path');
  });

  it('generateEnvContent handles template without MACHINE_ID', () => {
    const tpl = 'PORT=8080\nNODE_ENV=development\n';
    const result = generateEnvContent(tpl, 'my-machine');
    // Should still set NODE_ENV
    expect(result).toContain('NODE_ENV=production');
    // MACHINE_ID line was not present, so it should not appear
    expect(result).not.toContain('MACHINE_ID=');
  });

  it('generateEnvContent handles template without NODE_ENV', () => {
    const tpl = 'PORT=8080\nMACHINE_ID=old\n';
    const result = generateEnvContent(tpl, 'new-machine');
    expect(result).toContain('MACHINE_ID=new-machine');
    // NODE_ENV was not present, so it should not appear
    expect(result).not.toContain('NODE_ENV=');
  });
});

// ===========================================================================
// Constants
// ===========================================================================

describe('constants', () => {
  it('DEFAULT_TARGET_DIR is /opt/agentctl', () => {
    expect(DEFAULT_TARGET_DIR).toBe('/opt/agentctl');
  });

  it('DEFAULT_DEPLOY_USER is deploy', () => {
    expect(DEFAULT_DEPLOY_USER).toBe('deploy');
  });

  it('exit codes are distinct', () => {
    const codes = [EXIT_SUCCESS, EXIT_PROVISION_FAILED, EXIT_UNSUPPORTED_OS, EXIT_PERMISSION_ERROR];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('EXIT_SUCCESS is 0', () => {
    expect(EXIT_SUCCESS).toBe(0);
  });
});
