import { ControlPlaneError } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionLayer = 'cli-p' | 'sdk' | 'remote-control' | 'tmux';

export type SessionRequest = {
  type: 'interactive' | 'autonomous' | 'scheduled';
  machineId: string;
  agentId: string;
  projectPath: string;
  prompt?: string;
  model?: string;
  preferRemoteControl?: boolean;
};

export type DispatcherMachineCapabilities = {
  hasOAuthLogin: boolean;
  plan: 'max' | 'team' | 'api-only' | 'unknown';
  hasApiKey: boolean;
  hasTmux: boolean;
};

export type LayerSelection = {
  layer: SessionLayer;
  reason: string;
};

// ---------------------------------------------------------------------------
// selectLayer
// ---------------------------------------------------------------------------

/**
 * Selects the appropriate session layer for a new session based on the
 * request type and the target machine's capabilities.
 *
 * Priority order:
 * 1. Max plan + preferRemoteControl  -> remote-control
 * 2. Interactive + OAuth             -> cli-p
 * 3. Autonomous/scheduled + API key  -> sdk
 * 4. Autonomous/scheduled + OAuth    -> cli-p (fallback)
 * 5. Interactive + API key           -> sdk (fallback)
 * 6. tmux available                  -> tmux
 * 7. Nothing viable                  -> throw
 */
export function selectLayer(
  request: SessionRequest,
  capabilities: DispatcherMachineCapabilities,
): LayerSelection {
  // Rule 3: Max plan + preferRemoteControl -> remote-control
  if (request.preferRemoteControl && capabilities.plan === 'max') {
    return {
      layer: 'remote-control',
      reason: 'Max plan with explicit remote-control preference; using built-in RC relay',
    };
  }

  // Rule 1: Interactive requests on OAuth-authenticated machines -> cli-p
  if (request.type === 'interactive' && capabilities.hasOAuthLogin) {
    return {
      layer: 'cli-p',
      reason:
        'Interactive request on OAuth-authenticated machine; using CLI -p mode (subscription billing)',
    };
  }

  // Rule 2: Autonomous/scheduled requests with API key -> sdk
  if ((request.type === 'autonomous' || request.type === 'scheduled') && capabilities.hasApiKey) {
    return {
      layer: 'sdk',
      reason: 'Autonomous/scheduled request with API key available; using Agent SDK (API billing)',
    };
  }

  // Fallback: Autonomous/scheduled without API key but with OAuth -> cli-p
  if (
    (request.type === 'autonomous' || request.type === 'scheduled') &&
    capabilities.hasOAuthLogin
  ) {
    return {
      layer: 'cli-p',
      reason:
        'Autonomous/scheduled request without API key; falling back to CLI -p mode (subscription billing)',
    };
  }

  // Fallback: Interactive without OAuth but with API key -> sdk
  if (request.type === 'interactive' && capabilities.hasApiKey) {
    return {
      layer: 'sdk',
      reason: 'Interactive request without OAuth login; falling back to Agent SDK (API billing)',
    };
  }

  // Rule 4: tmux fallback
  if (capabilities.hasTmux) {
    return {
      layer: 'tmux',
      reason: 'No OAuth login or API key available; falling back to tmux session control',
    };
  }

  // Rule 5: No viable layer
  throw new ControlPlaneError(
    'NO_VIABLE_LAYER',
    `No viable session layer for machine ${request.machineId}: ` +
      `OAuth=${capabilities.hasOAuthLogin}, ` +
      `API key=${capabilities.hasApiKey}, ` +
      `tmux=${capabilities.hasTmux}, ` +
      `plan=${capabilities.plan}`,
    {
      machineId: request.machineId,
      agentId: request.agentId,
      requestType: request.type,
      capabilities,
    },
  );
}
