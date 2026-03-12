import { execFile } from 'node:child_process';
import { platform } from 'node:os';

import type { NetworkEnforcementMode, NetworkEnforcementResult } from '@agentctl/shared';
import type { Logger } from 'pino';

// ── Constants ───────────────────────────────────────────────────────

const ENFORCEMENT_TIMEOUT_MS = 10_000;

// ── Helpers ─────────────────────────────────────────────────────────

function execCommand(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: ENFORCEMENT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

// ── Linux enforcement via iptables / network namespaces ─────────────

async function enforceLinuxNone(logger: Logger): Promise<NetworkEnforcementResult> {
  try {
    // For containerized agents, --network=none is applied at Docker level.
    // For direct host execution, we rely on iptables owner matching
    // (requires root or CAP_NET_ADMIN).
    await execCommand('iptables', [
      '-A',
      'OUTPUT',
      '-m',
      'owner',
      '--uid-owner',
      String(process.getuid?.() ?? 0),
      '-j',
      'DROP',
    ]);

    return {
      applied: true,
      mode: 'none',
      mechanism: 'iptables',
      details: 'All outbound network access blocked via iptables OUTPUT DROP rule',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Failed to apply iptables network-none policy');

    return {
      applied: false,
      mode: 'none',
      mechanism: 'iptables',
      details: `Failed to apply iptables rule: ${message}. Agent may not be network-isolated.`,
    };
  }
}

async function enforceLinuxEgressOnly(logger: Logger): Promise<NetworkEnforcementResult> {
  try {
    // Block inbound connections while allowing outbound.
    // Drop NEW inbound connections; allow ESTABLISHED/RELATED (responses).
    await execCommand('iptables', [
      '-A',
      'INPUT',
      '-m',
      'state',
      '--state',
      'NEW',
      '-m',
      'owner',
      '--uid-owner',
      String(process.getuid?.() ?? 0),
      '-j',
      'DROP',
    ]);

    return {
      applied: true,
      mode: 'egress-only',
      mechanism: 'iptables',
      details: 'Inbound connections blocked; outbound allowed via iptables state filtering',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Failed to apply iptables egress-only policy');

    return {
      applied: false,
      mode: 'egress-only',
      mechanism: 'iptables',
      details: `Failed to apply iptables rule: ${message}`,
    };
  }
}

// ── Docker enforcement ──────────────────────────────────────────────

function generateDockerNetworkArgs(mode: NetworkEnforcementMode): string[] {
  switch (mode) {
    case 'none':
      return ['--network=none'];
    case 'egress-only':
      // Use a custom bridge network that allows egress but blocks inbound.
      return ['--network=agentctl-egress', '--cap-drop=ALL'];
    case 'allowlist':
      return ['--network=agentctl-filtered', '--cap-drop=ALL'];
    default:
      return ['--cap-drop=ALL'];
  }
}

// ── Public API ──────────────────────────────────────────────────────

export type EnforceNetworkPolicyOptions = {
  /** The network restriction mode to apply. */
  mode: NetworkEnforcementMode;
  /** Whether the agent is running inside a Docker container. */
  isDocker: boolean;
  /** Optional list of allowed domains (only used in 'allowlist' mode). */
  allowedDomains?: readonly string[];
  /** Logger for debug output. */
  logger: Logger;
};

/**
 * Apply an OS-level or container-level network restriction policy.
 *
 * - `'none'`       — Block all network access
 * - `'egress-only'`— Allow outbound connections, block inbound
 * - `'allowlist'`  — Only allow connections to specified domains
 *
 * For Docker environments, this returns the Docker CLI args to apply.
 * For direct host execution on Linux, it uses iptables rules.
 * On macOS, network enforcement relies on the Seatbelt sandbox profile
 * applied by Claude Code (network restriction is built into the profile).
 */
export async function enforceNetworkPolicy(
  options: EnforceNetworkPolicyOptions,
): Promise<NetworkEnforcementResult> {
  const { mode, isDocker, logger } = options;
  const os = platform();

  // Docker environments: use Docker network flags
  if (isDocker) {
    const args = generateDockerNetworkArgs(mode);
    logger.info({ mode, dockerArgs: args }, 'Docker network enforcement configured');

    return {
      applied: true,
      mode,
      mechanism: 'docker-network',
      details: `Docker network policy applied: ${args.join(' ')}`,
    };
  }

  // Linux direct execution: use iptables
  if (os === 'linux') {
    switch (mode) {
      case 'none':
        return enforceLinuxNone(logger);
      case 'egress-only':
        return enforceLinuxEgressOnly(logger);
      case 'allowlist':
        // Allowlist mode on Linux requires more complex iptables rules.
        // For now, we apply egress-only and rely on the application-level
        // NetworkPolicyEnforcer for domain filtering.
        logger.info(
          'Allowlist mode on Linux: applying egress-only at OS level, domain filtering at application level',
        );
        return enforceLinuxEgressOnly(logger);
      default:
        return {
          applied: false,
          mode,
          mechanism: 'none',
          details: `Unknown network enforcement mode: ${mode}`,
        };
    }
  }

  // macOS: Seatbelt handles network restriction
  if (os === 'darwin') {
    logger.info({ mode }, 'macOS network enforcement delegated to Seatbelt sandbox profile');

    return {
      applied: true,
      mode,
      mechanism: 'macos-pf',
      details:
        'Network enforcement delegated to macOS Seatbelt sandbox profile (built into Claude Code)',
    };
  }

  // Unsupported platform
  logger.warn({ os, mode }, 'Network enforcement not supported on this platform');
  return {
    applied: false,
    mode,
    mechanism: 'none',
    details: `Network enforcement not supported on platform: ${os}`,
  };
}

export { generateDockerNetworkArgs };
