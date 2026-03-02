#!/usr/bin/env npx tsx

/**
 * Target machine provisioning script for AgentCTL fleet.
 *
 * Prepares a target machine for Docker-based deployment:
 *   1. Creates a `deploy` system user with limited permissions
 *   2. Installs Docker, Docker Compose, and Tailscale
 *   3. Copies docker-compose.prod.yml and generates .env on target
 *
 * Designed to run over SSH or locally on the target machine.
 * All shell commands go through execFile for safety (no shell injection).
 *
 * Exit codes:
 *   0 = success (or dry-run pass)
 *   1 = provisioning failed
 *   2 = unsupported OS
 *   3 = permission error
 *
 * Usage:
 *   pnpm tsx scripts/provision-target.ts [--dry-run] [--target-dir /opt/agentctl] \
 *     [--deploy-user deploy] [--compose-file infra/docker/docker-compose.prod.yml] \
 *     [--env-template .env.example]
 *
 * Environment:
 *   MACHINE_ID   — Unique machine identifier (defaults to hostname)
 */

import { execFile as execFileCb } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_TARGET_DIR = '/opt/agentctl';
export const DEFAULT_DEPLOY_USER = 'deploy';
export const DEFAULT_COMPOSE_FILE = path.join(
  PROJECT_ROOT,
  'infra',
  'docker',
  'docker-compose.prod.yml',
);
export const DEFAULT_ENV_TEMPLATE = path.join(PROJECT_ROOT, '.env.example');

export const EXIT_SUCCESS = 0;
export const EXIT_PROVISION_FAILED = 1;
export const EXIT_UNSUPPORTED_OS = 2;
export const EXIT_PERMISSION_ERROR = 3;

const ENV_FILE_MODE = 0o600;
const COMPOSE_FILE_MODE = 0o644;
const DIR_MODE = 0o755;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ProvisionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProvisionError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvisionConfig = {
  targetDir: string;
  deployUser: string;
  dryRun: boolean;
  composeFile: string;
  envTemplate: string;
};

export type ProvisionResult = {
  success: boolean;
  steps: StepResult[];
  dryRun: boolean;
};

export type StepResult = {
  name: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
};

export type DetectedOS = 'ubuntu' | 'debian' | 'macos';

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

export const execFileAsync = promisify(execFileCb);

/**
 * Run a command via execFile and return stdout. Throws ProvisionError on failure.
 */
export async function run(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf-8',
      env: options?.env ?? process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProvisionError(
      'COMMAND_FAILED',
      `Command "${command} ${args.join(' ')}" failed: ${message}`,
      {
        command,
        args,
      },
    );
  }
}

/**
 * Check if a command exists on the system PATH.
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command], { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

export async function detectOS(): Promise<DetectedOS> {
  const platform = os.platform();

  if (platform === 'darwin') {
    return 'macos';
  }

  if (platform === 'linux') {
    try {
      const osRelease = await fs.readFile('/etc/os-release', 'utf-8');
      const idLine = osRelease.split('\n').find((line) => line.startsWith('ID='));
      const id = idLine?.split('=')[1]?.replace(/"/g, '').trim().toLowerCase();

      if (id === 'ubuntu') {
        return 'ubuntu';
      }
      if (id === 'debian') {
        return 'debian';
      }

      // Check ID_LIKE for derivatives
      const idLikeLine = osRelease.split('\n').find((line) => line.startsWith('ID_LIKE='));
      const idLike = idLikeLine?.split('=')[1]?.replace(/"/g, '').trim().toLowerCase() ?? '';

      if (idLike.includes('ubuntu')) {
        return 'ubuntu';
      }
      if (idLike.includes('debian')) {
        return 'debian';
      }
    } catch {
      // /etc/os-release not readable — fall through to unsupported
    }
  }

  throw new ProvisionError('UNSUPPORTED_OS', `Unsupported operating system: ${platform}`, {
    platform,
    arch: os.arch(),
  });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): ProvisionConfig {
  const args = argv.slice(2);
  let dryRun = false;
  let targetDir = DEFAULT_TARGET_DIR;
  let deployUser = DEFAULT_DEPLOY_USER;
  let composeFile = DEFAULT_COMPOSE_FILE;
  let envTemplate = DEFAULT_ENV_TEMPLATE;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--target-dir') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new ProvisionError('INVALID_ARGS', '--target-dir requires a path value');
      }
      targetDir = next;
      i++;
    } else if (arg === '--deploy-user') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new ProvisionError('INVALID_ARGS', '--deploy-user requires a username value');
      }
      deployUser = next;
      i++;
    } else if (arg === '--compose-file') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new ProvisionError('INVALID_ARGS', '--compose-file requires a path value');
      }
      composeFile = next;
      i++;
    } else if (arg === '--env-template') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new ProvisionError('INVALID_ARGS', '--env-template requires a path value');
      }
      envTemplate = next;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      // Not an error, but we don't parse further
      throw new ProvisionError('HELP_REQUESTED', 'Help requested');
    } else {
      throw new ProvisionError('INVALID_ARGS', `Unknown argument: ${arg}`);
    }
  }

  return { dryRun, targetDir, deployUser, composeFile, envTemplate };
}

// ---------------------------------------------------------------------------
// Step 1: Deploy user
// ---------------------------------------------------------------------------

export async function userExists(username: string): Promise<boolean> {
  try {
    await execFileAsync('id', [username], { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export async function createDeployUser(
  config: ProvisionConfig,
  detectedOS: DetectedOS,
): Promise<StepResult> {
  const { deployUser, dryRun } = config;
  const stepName = 'create-deploy-user';

  // Check if user already exists
  const exists = await userExists(deployUser);
  if (exists) {
    return {
      name: stepName,
      status: 'skipped',
      message: `User "${deployUser}" already exists`,
    };
  }

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would create user "${deployUser}"`,
    };
  }

  if (detectedOS === 'macos') {
    // macOS: use sysadminctl or dscl
    await run('sudo', ['dscl', '.', '-create', `/Users/${deployUser}`]);
    await run('sudo', ['dscl', '.', '-create', `/Users/${deployUser}`, 'UserShell', '/bin/bash']);
    await run('sudo', ['dscl', '.', '-create', `/Users/${deployUser}`, 'RealName', 'Deploy User']);
    // Find next available UID (above 500 for non-system users)
    const maxUid = await run('dscl', ['.', '-list', '/Users', 'UniqueID']);
    const uids = maxUid
      .split('\n')
      .map((line) => Number.parseInt(line.split(/\s+/).pop() ?? '0', 10))
      .filter((n) => !Number.isNaN(n));
    const nextUid = Math.max(...uids, 500) + 1;
    await run('sudo', [
      'dscl',
      '.',
      '-create',
      `/Users/${deployUser}`,
      'UniqueID',
      String(nextUid),
    ]);
    await run('sudo', ['dscl', '.', '-create', `/Users/${deployUser}`, 'PrimaryGroupID', '20']);
    await run('sudo', ['mkdir', '-p', `/Users/${deployUser}`]);
    await run('sudo', ['chown', '-R', `${deployUser}:staff`, `/Users/${deployUser}`]);
  } else {
    // Linux (Ubuntu/Debian)
    await run('sudo', [
      'useradd',
      '--system',
      '--create-home',
      '--shell',
      '/bin/bash',
      '--comment',
      'AgentCTL Deploy User',
      deployUser,
    ]);
  }

  return {
    name: stepName,
    status: 'success',
    message: `Created user "${deployUser}"`,
  };
}

export async function setupDeployUserSsh(
  config: ProvisionConfig,
  detectedOS: DetectedOS,
): Promise<StepResult> {
  const { deployUser, dryRun } = config;
  const stepName = 'setup-deploy-ssh';

  const homeDir = detectedOS === 'macos' ? `/Users/${deployUser}` : `/home/${deployUser}`;
  const sshDir = path.join(homeDir, '.ssh');

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would create ${sshDir} and authorized_keys`,
    };
  }

  // Create .ssh directory
  await run('sudo', ['mkdir', '-p', sshDir]);
  await run('sudo', ['chmod', '700', sshDir]);

  // Create authorized_keys file if it does not exist
  const authorizedKeysPath = path.join(sshDir, 'authorized_keys');
  try {
    await run('sudo', ['test', '-f', authorizedKeysPath]);
  } catch {
    await run('sudo', ['touch', authorizedKeysPath]);
  }
  await run('sudo', ['chmod', '600', authorizedKeysPath]);

  // Ensure ownership
  const group = detectedOS === 'macos' ? 'staff' : deployUser;
  await run('sudo', ['chown', '-R', `${deployUser}:${group}`, sshDir]);

  return {
    name: stepName,
    status: 'success',
    message: `SSH directory configured at ${sshDir}`,
  };
}

export async function configureSudoDocker(
  config: ProvisionConfig,
  detectedOS: DetectedOS,
): Promise<StepResult> {
  const { deployUser, dryRun } = config;
  const stepName = 'configure-sudo-docker';

  if (detectedOS === 'macos') {
    // macOS: Docker Desktop runs as the current user, no sudoers needed.
    // Add user to the docker group if it exists.
    if (dryRun) {
      return {
        name: stepName,
        status: 'skipped',
        message: '[dry-run] Would add deploy user to docker group (macOS)',
      };
    }

    try {
      await run('sudo', ['dseditgroup', '-o', 'edit', '-a', deployUser, '-t', 'user', 'docker']);
    } catch {
      // docker group may not exist on macOS; that's acceptable
    }

    return {
      name: stepName,
      status: 'success',
      message: 'macOS Docker group configured (Docker Desktop manages access)',
    };
  }

  // Linux: sudoers drop-in for docker commands only
  const sudoersContent = [
    `# AgentCTL deploy user — Docker-only sudo permissions`,
    `${deployUser} ALL=(root) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose, /usr/local/bin/docker-compose`,
    '',
  ].join('\n');

  const sudoersPath = `/etc/sudoers.d/agentctl-${deployUser}`;

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would write sudoers file to ${sudoersPath}`,
    };
  }

  // Write via a temp file + visudo check
  const tmpSudoers = `/tmp/agentctl-sudoers-${Date.now()}`;
  await fs.writeFile(tmpSudoers, sudoersContent, { mode: 0o440 });

  try {
    // Validate with visudo
    await run('sudo', ['visudo', '-c', '-f', tmpSudoers]);
    // Move into place
    await run('sudo', ['cp', tmpSudoers, sudoersPath]);
    await run('sudo', ['chmod', '440', sudoersPath]);
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tmpSudoers);
    } catch {
      // best-effort cleanup
    }
  }

  // Also add user to docker group for non-sudo docker access
  try {
    await run('sudo', ['usermod', '-aG', 'docker', deployUser]);
  } catch {
    // docker group may not exist yet if Docker hasn't been installed
  }

  return {
    name: stepName,
    status: 'success',
    message: `Sudoers configured at ${sudoersPath}; user added to docker group`,
  };
}

// ---------------------------------------------------------------------------
// Step 2: Install Docker, Compose, Tailscale
// ---------------------------------------------------------------------------

export async function getDockerVersion(): Promise<string | null> {
  try {
    const output = await run('docker', ['--version']);
    return output;
  } catch {
    return null;
  }
}

export async function getDockerComposeVersion(): Promise<string | null> {
  try {
    const output = await run('docker', ['compose', 'version']);
    return output;
  } catch {
    return null;
  }
}

export async function getTailscaleVersion(): Promise<string | null> {
  try {
    const output = await run('tailscale', ['--version']);
    // tailscale --version outputs multiple lines; first line is the version
    return output.split('\n')[0] ?? output;
  } catch {
    return null;
  }
}

export async function installDocker(
  config: ProvisionConfig,
  detectedOS: DetectedOS,
): Promise<StepResult> {
  const { dryRun } = config;
  const stepName = 'install-docker';

  const existing = await getDockerVersion();
  if (existing) {
    return {
      name: stepName,
      status: 'skipped',
      message: `Docker already installed: ${existing}`,
    };
  }

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would install Docker on ${detectedOS}`,
    };
  }

  if (detectedOS === 'macos') {
    // macOS: install via Homebrew
    const brewExists = await commandExists('brew');
    if (!brewExists) {
      throw new ProvisionError(
        'MISSING_DEPENDENCY',
        'Homebrew is required to install Docker on macOS. Install from https://brew.sh',
      );
    }
    await run('brew', ['install', '--cask', 'docker']);
  } else {
    // Ubuntu/Debian: official Docker install script
    // First, install prerequisites
    await run('sudo', ['apt-get', 'update', '-qq']);
    await run('sudo', [
      'apt-get',
      'install',
      '-y',
      '-qq',
      'ca-certificates',
      'curl',
      'gnupg',
      'lsb-release',
    ]);

    // Add Docker GPG key and repository
    await run('sudo', ['mkdir', '-p', '/etc/apt/keyrings']);

    // Download the GPG key
    const gpgKey = await run('curl', ['-fsSL', 'https://download.docker.com/linux/ubuntu/gpg']);
    const tmpKeyFile = `/tmp/docker-gpg-${Date.now()}.key`;
    await fs.writeFile(tmpKeyFile, gpgKey);
    try {
      await run('sudo', ['gpg', '--dearmor', '-o', '/etc/apt/keyrings/docker.gpg', tmpKeyFile]);
    } finally {
      try {
        await fs.unlink(tmpKeyFile);
      } catch {
        // best-effort
      }
    }

    // Determine distro for repo URL (use ubuntu for ubuntu derivatives, debian otherwise)
    const distro = detectedOS === 'ubuntu' ? 'ubuntu' : 'debian';
    const codename = await run('lsb_release', ['-cs']);

    const repoLine = `deb [arch=${os.arch() === 'x64' ? 'amd64' : os.arch()} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} ${codename} stable`;
    const tmpRepoFile = `/tmp/docker-repo-${Date.now()}`;
    await fs.writeFile(tmpRepoFile, `${repoLine}\n`);
    await run('sudo', ['cp', tmpRepoFile, '/etc/apt/sources.list.d/docker.list']);
    try {
      await fs.unlink(tmpRepoFile);
    } catch {
      // best-effort
    }

    // Install Docker Engine + Compose plugin
    await run('sudo', ['apt-get', 'update', '-qq']);
    await run('sudo', [
      'apt-get',
      'install',
      '-y',
      '-qq',
      'docker-ce',
      'docker-ce-cli',
      'containerd.io',
      'docker-compose-plugin',
    ]);

    // Enable and start Docker
    await run('sudo', ['systemctl', 'enable', 'docker']);
    await run('sudo', ['systemctl', 'start', 'docker']);
  }

  // Verify installation
  const version = await getDockerVersion();
  if (!version) {
    throw new ProvisionError(
      'INSTALL_FAILED',
      'Docker installation completed but version check failed',
    );
  }

  return {
    name: stepName,
    status: 'success',
    message: `Docker installed: ${version}`,
  };
}

export async function installDockerCompose(
  config: ProvisionConfig,
  detectedOS: DetectedOS,
): Promise<StepResult> {
  const { dryRun } = config;
  const stepName = 'install-docker-compose';

  const existing = await getDockerComposeVersion();
  if (existing) {
    return {
      name: stepName,
      status: 'skipped',
      message: `Docker Compose already installed: ${existing}`,
    };
  }

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would install Docker Compose on ${detectedOS}`,
    };
  }

  if (detectedOS === 'macos') {
    // Docker Desktop for Mac includes Compose — if Docker was just installed, Compose should be there.
    // If for some reason it's missing, install via brew.
    await run('brew', ['install', 'docker-compose']);
  } else {
    // On Linux, docker-compose-plugin should have been installed with Docker.
    // If the standalone version is needed:
    await run('sudo', ['apt-get', 'install', '-y', '-qq', 'docker-compose-plugin']);
  }

  const version = await getDockerComposeVersion();
  if (!version) {
    throw new ProvisionError(
      'INSTALL_FAILED',
      'Docker Compose installation completed but version check failed',
    );
  }

  return {
    name: stepName,
    status: 'success',
    message: `Docker Compose installed: ${version}`,
  };
}

export async function installTailscale(
  config: ProvisionConfig,
  _detectedOS: DetectedOS,
): Promise<StepResult> {
  const { dryRun } = config;
  const stepName = 'install-tailscale';

  const existing = await getTailscaleVersion();
  if (existing) {
    return {
      name: stepName,
      status: 'skipped',
      message: `Tailscale already installed: ${existing}`,
    };
  }

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: '[dry-run] Would install Tailscale via official install script',
    };
  }

  // Tailscale provides a cross-platform install script
  const installScript = await run('curl', ['-fsSL', 'https://tailscale.com/install.sh']);
  const tmpScript = `/tmp/tailscale-install-${Date.now()}.sh`;
  await fs.writeFile(tmpScript, installScript, { mode: 0o755 });
  try {
    await run('sudo', ['bash', tmpScript]);
  } finally {
    try {
      await fs.unlink(tmpScript);
    } catch {
      // best-effort
    }
  }

  const version = await getTailscaleVersion();
  if (!version) {
    throw new ProvisionError(
      'INSTALL_FAILED',
      'Tailscale installation completed but version check failed',
    );
  }

  return {
    name: stepName,
    status: 'success',
    message: `Tailscale installed: ${version}`,
  };
}

export async function validateInstallations(): Promise<StepResult> {
  const stepName = 'validate-installations';
  const results: string[] = [];
  const missing: string[] = [];

  const dockerVersion = await getDockerVersion();
  if (dockerVersion) {
    results.push(`Docker: ${dockerVersion}`);
  } else {
    missing.push('Docker');
  }

  const composeVersion = await getDockerComposeVersion();
  if (composeVersion) {
    results.push(`Compose: ${composeVersion}`);
  } else {
    missing.push('Docker Compose');
  }

  const tailscaleVersion = await getTailscaleVersion();
  if (tailscaleVersion) {
    results.push(`Tailscale: ${tailscaleVersion}`);
  } else {
    missing.push('Tailscale');
  }

  if (missing.length > 0) {
    return {
      name: stepName,
      status: 'failed',
      message: `Missing: ${missing.join(', ')}. Installed: ${results.join('; ')}`,
    };
  }

  return {
    name: stepName,
    status: 'success',
    message: results.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Step 3: Store compose file + .env on target
// ---------------------------------------------------------------------------

export async function createTargetDirectory(config: ProvisionConfig): Promise<StepResult> {
  const { targetDir, deployUser, dryRun } = config;
  const stepName = 'create-target-directory';

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would create directory ${targetDir}`,
    };
  }

  await run('sudo', ['mkdir', '-p', targetDir]);
  await run('sudo', ['chmod', String(DIR_MODE.toString(8)), targetDir]);

  // Determine if user exists before chowning
  const exists = await userExists(deployUser);
  if (exists) {
    await run('sudo', ['chown', deployUser, targetDir]);
  }

  return {
    name: stepName,
    status: 'success',
    message: `Created directory ${targetDir}`,
  };
}

export async function copyComposeFile(config: ProvisionConfig): Promise<StepResult> {
  const { targetDir, composeFile, dryRun } = config;
  const stepName = 'copy-compose-file';

  // Validate source exists
  try {
    await fs.access(composeFile);
  } catch {
    throw new ProvisionError('FILE_NOT_FOUND', `Compose file not found: ${composeFile}`, {
      composeFile,
    });
  }

  const destPath = path.join(targetDir, 'docker-compose.prod.yml');

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would copy ${composeFile} to ${destPath}`,
    };
  }

  // Read source, write to temp, then sudo copy to target
  const content = await fs.readFile(composeFile, 'utf-8');
  const tmpFile = `/tmp/agentctl-compose-${Date.now()}.yml`;
  await fs.writeFile(tmpFile, content, { mode: COMPOSE_FILE_MODE });
  try {
    await run('sudo', ['cp', tmpFile, destPath]);
    await run('sudo', ['chmod', '644', destPath]);
  } finally {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // best-effort
    }
  }

  return {
    name: stepName,
    status: 'success',
    message: `Compose file copied to ${destPath}`,
  };
}

export async function validateComposeFile(config: ProvisionConfig): Promise<StepResult> {
  const { targetDir, dryRun } = config;
  const stepName = 'validate-compose-file';
  const composePath = path.join(targetDir, 'docker-compose.prod.yml');

  if (dryRun) {
    // Validate the source file instead during dry-run
    const { composeFile } = config;
    try {
      await run('docker', ['compose', '-f', composeFile, 'config', '--quiet']);
      return {
        name: stepName,
        status: 'success',
        message: `[dry-run] Source compose file syntax is valid: ${composeFile}`,
      };
    } catch {
      return {
        name: stepName,
        status: 'failed',
        message: `[dry-run] Compose file has syntax errors: ${composeFile}`,
      };
    }
  }

  try {
    await run('docker', ['compose', '-f', composePath, 'config', '--quiet']);
  } catch {
    return {
      name: stepName,
      status: 'failed',
      message: `Compose file has syntax errors: ${composePath}`,
    };
  }

  return {
    name: stepName,
    status: 'success',
    message: `Compose file is valid: ${composePath}`,
  };
}

/**
 * Generate .env from template, substituting machine-specific values.
 */
export function generateEnvContent(template: string, machineId: string): string {
  let result = template;

  // Replace MACHINE_ID placeholder with the actual machine ID
  result = result.replace(/^MACHINE_ID=.*$/m, `MACHINE_ID=${machineId}`);

  // Set NODE_ENV to production for target machines
  result = result.replace(/^NODE_ENV=.*$/m, 'NODE_ENV=production');

  return result;
}

export async function generateEnvFile(config: ProvisionConfig): Promise<StepResult> {
  const { targetDir, envTemplate, dryRun } = config;
  const stepName = 'generate-env-file';

  // Validate template exists
  try {
    await fs.access(envTemplate);
  } catch {
    throw new ProvisionError('FILE_NOT_FOUND', `Environment template not found: ${envTemplate}`, {
      envTemplate,
    });
  }

  const machineId = process.env.MACHINE_ID ?? os.hostname();
  const destPath = path.join(targetDir, '.env');

  if (dryRun) {
    return {
      name: stepName,
      status: 'skipped',
      message: `[dry-run] Would generate ${destPath} from ${envTemplate} with MACHINE_ID=${machineId}`,
    };
  }

  const template = await fs.readFile(envTemplate, 'utf-8');
  const envContent = generateEnvContent(template, machineId);

  // Write via temp file + sudo copy for proper ownership
  const tmpFile = `/tmp/agentctl-env-${Date.now()}`;
  await fs.writeFile(tmpFile, envContent, { mode: ENV_FILE_MODE });
  try {
    await run('sudo', ['cp', tmpFile, destPath]);
    await run('sudo', ['chmod', '600', destPath]);
  } finally {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // best-effort
    }
  }

  return {
    name: stepName,
    status: 'success',
    message: `Environment file generated at ${destPath} (MACHINE_ID=${machineId})`,
  };
}

// ---------------------------------------------------------------------------
// Main runner (testable, does not call process.exit)
// ---------------------------------------------------------------------------

export async function runProvision(config: ProvisionConfig): Promise<ProvisionResult> {
  const result: ProvisionResult = {
    success: false,
    steps: [],
    dryRun: config.dryRun,
  };

  // Detect OS
  let detectedOS: DetectedOS;
  try {
    detectedOS = await detectOS();
  } catch (error: unknown) {
    if (error instanceof ProvisionError) {
      result.steps.push({
        name: 'detect-os',
        status: 'failed',
        message: error.message,
      });
    }
    return result;
  }

  result.steps.push({
    name: 'detect-os',
    status: 'success',
    message: `Detected OS: ${detectedOS}`,
  });

  // Phase 1: Deploy user
  try {
    const createUserResult = await createDeployUser(config, detectedOS);
    result.steps.push(createUserResult);

    const sshResult = await setupDeployUserSsh(config, detectedOS);
    result.steps.push(sshResult);

    const sudoResult = await configureSudoDocker(config, detectedOS);
    result.steps.push(sudoResult);
  } catch (error: unknown) {
    const message = error instanceof ProvisionError ? error.message : String(error);
    result.steps.push({
      name: 'deploy-user-setup',
      status: 'failed',
      message,
    });
    return result;
  }

  // Phase 2: Install software
  try {
    const dockerResult = await installDocker(config, detectedOS);
    result.steps.push(dockerResult);

    const composeResult = await installDockerCompose(config, detectedOS);
    result.steps.push(composeResult);

    const tailscaleResult = await installTailscale(config, detectedOS);
    result.steps.push(tailscaleResult);

    if (!config.dryRun) {
      const validationResult = await validateInstallations();
      result.steps.push(validationResult);
      if (validationResult.status === 'failed') {
        return result;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof ProvisionError ? error.message : String(error);
    result.steps.push({
      name: 'install-software',
      status: 'failed',
      message,
    });
    return result;
  }

  // Phase 3: Store files on target
  try {
    const dirResult = await createTargetDirectory(config);
    result.steps.push(dirResult);

    const copyResult = await copyComposeFile(config);
    result.steps.push(copyResult);

    const validateResult = await validateComposeFile(config);
    result.steps.push(validateResult);

    const envResult = await generateEnvFile(config);
    result.steps.push(envResult);
  } catch (error: unknown) {
    const message = error instanceof ProvisionError ? error.message : String(error);
    result.steps.push({
      name: 'store-files',
      status: 'failed',
      message,
    });
    return result;
  }

  // Check if any step failed
  const hasFailed = result.steps.some((s) => s.status === 'failed');
  result.success = !hasFailed;

  return result;
}

// ---------------------------------------------------------------------------
// Determine exit code from result
// ---------------------------------------------------------------------------

export function exitCodeFromResult(result: ProvisionResult): number {
  if (result.success) {
    return EXIT_SUCCESS;
  }
  const failedStep = result.steps.find((s) => s.status === 'failed');
  if (failedStep?.name === 'detect-os') {
    return EXIT_UNSUPPORTED_OS;
  }
  if (
    failedStep?.message.includes('permission') ||
    failedStep?.message.includes('Permission') ||
    failedStep?.message.includes('EACCES')
  ) {
    return EXIT_PERMISSION_ERROR;
  }
  return EXIT_PROVISION_FAILED;
}

// ---------------------------------------------------------------------------
// Main (CLI entry point)
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv): Promise<ProvisionResult> {
  const config = parseArgs(argv);

  console.error('[provision-target] Starting provisioning...');
  console.error(`  Target directory: ${config.targetDir}`);
  console.error(`  Deploy user:     ${config.deployUser}`);
  console.error(`  Compose file:    ${config.composeFile}`);
  console.error(`  Env template:    ${config.envTemplate}`);

  if (config.dryRun) {
    console.error('[provision-target] DRY RUN — no changes will be made');
  }

  const result = await runProvision(config);

  // Output structured JSON to stdout for CI consumption
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    const completedCount = result.steps.filter((s) => s.status === 'success').length;
    const skippedCount = result.steps.filter((s) => s.status === 'skipped').length;
    if (config.dryRun) {
      console.error(
        `[provision-target] Dry run complete. ${completedCount} step(s) would run, ${skippedCount} skipped.`,
      );
    } else {
      console.error(
        `[provision-target] Provisioning complete. ${completedCount} step(s) succeeded, ${skippedCount} skipped.`,
      );
    }
  } else {
    const failedSteps = result.steps.filter((s) => s.status === 'failed');
    for (const step of failedSteps) {
      console.error(`[provision-target] FAILED: [${step.name}] ${step.message}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Run when executed directly
// ---------------------------------------------------------------------------

const isDirectExecution =
  process.argv[1]?.endsWith('provision-target.ts') ||
  process.argv[1]?.endsWith('provision-target.js');

if (isDirectExecution) {
  main()
    .then((result) => {
      process.exit(exitCodeFromResult(result));
    })
    .catch((error: unknown) => {
      if (error instanceof ProvisionError) {
        if (error.code === 'HELP_REQUESTED') {
          console.error('Usage: pnpm tsx scripts/provision-target.ts [OPTIONS]');
          console.error('');
          console.error('Options:');
          console.error('  --dry-run              Check without executing');
          console.error('  --target-dir PATH      Deployment directory (default: /opt/agentctl)');
          console.error('  --deploy-user USER     System user to create (default: deploy)');
          console.error('  --compose-file PATH    Docker Compose file path');
          console.error('  --env-template PATH    Environment template file path');
          console.error('  --help, -h             Show this help message');
          process.exit(EXIT_SUCCESS);
        }
        console.error(`[provision-target] Error [${error.code}]: ${error.message}`);
        if (error.context) {
          console.error('Context:', JSON.stringify(error.context, null, 2));
        }
      } else {
        console.error('[provision-target] Fatal error:', error);
      }
      process.exit(EXIT_PROVISION_FAILED);
    });
}
