import { ControlPlaneError } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import type { DispatcherMachineCapabilities, SessionRequest } from './layer-router.js';
import { selectLayer } from './layer-router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    type: 'interactive',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/home/user/project',
    ...overrides,
  };
}

function makeCapabilities(
  overrides: Partial<DispatcherMachineCapabilities> = {},
): DispatcherMachineCapabilities {
  return {
    hasOAuthLogin: true,
    plan: 'team',
    hasApiKey: false,
    hasTmux: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectLayer', () => {
  // -------------------------------------------------------------------------
  // Interactive requests -> cli-p
  // -------------------------------------------------------------------------

  describe('interactive requests', () => {
    it('selects cli-p for interactive request on Team plan with OAuth', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive' }),
        makeCapabilities({ plan: 'team', hasOAuthLogin: true }),
      );

      expect(result.layer).toBe('cli-p');
      expect(result.reason).toContain('Interactive');
      expect(result.reason).toContain('subscription billing');
    });

    it('selects cli-p for interactive request on Max plan without preferRemoteControl', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive', preferRemoteControl: false }),
        makeCapabilities({ plan: 'max', hasOAuthLogin: true }),
      );

      expect(result.layer).toBe('cli-p');
      expect(result.reason).toContain('Interactive');
    });

    it('selects cli-p for interactive request on Max plan when preferRemoteControl is undefined', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive' }),
        makeCapabilities({ plan: 'max', hasOAuthLogin: true }),
      );

      expect(result.layer).toBe('cli-p');
    });

    it('falls back to sdk for interactive request without OAuth but with API key', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive' }),
        makeCapabilities({
          hasOAuthLogin: false,
          hasApiKey: true,
          plan: 'api-only',
        }),
      );

      expect(result.layer).toBe('sdk');
      expect(result.reason).toContain('falling back');
      expect(result.reason).toContain('API billing');
    });
  });

  // -------------------------------------------------------------------------
  // Autonomous requests -> sdk
  // -------------------------------------------------------------------------

  describe('autonomous requests', () => {
    it('selects sdk for autonomous request with API key', () => {
      const result = selectLayer(
        makeRequest({ type: 'autonomous' }),
        makeCapabilities({ hasApiKey: true }),
      );

      expect(result.layer).toBe('sdk');
      expect(result.reason).toContain('Autonomous/scheduled');
      expect(result.reason).toContain('API billing');
    });

    it('falls back to cli-p for autonomous request without API key but with OAuth', () => {
      const result = selectLayer(
        makeRequest({ type: 'autonomous' }),
        makeCapabilities({ hasOAuthLogin: true, hasApiKey: false }),
      );

      expect(result.layer).toBe('cli-p');
      expect(result.reason).toContain('falling back');
      expect(result.reason).toContain('CLI -p');
    });
  });

  // -------------------------------------------------------------------------
  // Scheduled requests -> sdk
  // -------------------------------------------------------------------------

  describe('scheduled requests', () => {
    it('selects sdk for scheduled request with API key', () => {
      const result = selectLayer(
        makeRequest({ type: 'scheduled' }),
        makeCapabilities({ hasApiKey: true }),
      );

      expect(result.layer).toBe('sdk');
      expect(result.reason).toContain('Autonomous/scheduled');
      expect(result.reason).toContain('API billing');
    });

    it('falls back to cli-p for scheduled request without API key but with OAuth', () => {
      const result = selectLayer(
        makeRequest({ type: 'scheduled' }),
        makeCapabilities({ hasOAuthLogin: true, hasApiKey: false }),
      );

      expect(result.layer).toBe('cli-p');
      expect(result.reason).toContain('falling back');
    });
  });

  // -------------------------------------------------------------------------
  // Remote control
  // -------------------------------------------------------------------------

  describe('remote-control', () => {
    it('selects remote-control when Max plan and preferRemoteControl is true', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive', preferRemoteControl: true }),
        makeCapabilities({ plan: 'max', hasOAuthLogin: true }),
      );

      expect(result.layer).toBe('remote-control');
      expect(result.reason).toContain('Max plan');
      expect(result.reason).toContain('remote-control');
    });

    it('does not select remote-control for Team plan even with preferRemoteControl', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive', preferRemoteControl: true }),
        makeCapabilities({ plan: 'team', hasOAuthLogin: true }),
      );

      // Should fall through to cli-p since Team plan does not support RC
      expect(result.layer).toBe('cli-p');
    });

    it('selects remote-control for autonomous request on Max with preferRemoteControl', () => {
      const result = selectLayer(
        makeRequest({ type: 'autonomous', preferRemoteControl: true }),
        makeCapabilities({ plan: 'max', hasOAuthLogin: true, hasApiKey: true }),
      );

      // preferRemoteControl + Max takes priority over type-based routing
      expect(result.layer).toBe('remote-control');
    });
  });

  // -------------------------------------------------------------------------
  // tmux fallback
  // -------------------------------------------------------------------------

  describe('tmux fallback', () => {
    it('selects tmux when no OAuth and no API key but tmux is available', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive' }),
        makeCapabilities({
          hasOAuthLogin: false,
          hasApiKey: false,
          hasTmux: true,
          plan: 'unknown',
        }),
      );

      expect(result.layer).toBe('tmux');
      expect(result.reason).toContain('falling back to tmux');
    });

    it('selects tmux for autonomous request with no OAuth and no API key', () => {
      const result = selectLayer(
        makeRequest({ type: 'autonomous' }),
        makeCapabilities({
          hasOAuthLogin: false,
          hasApiKey: false,
          hasTmux: true,
          plan: 'unknown',
        }),
      );

      expect(result.layer).toBe('tmux');
    });
  });

  // -------------------------------------------------------------------------
  // No viable layer -> error
  // -------------------------------------------------------------------------

  describe('no viable layer', () => {
    it('throws ControlPlaneError when no layer is viable', () => {
      expect(() =>
        selectLayer(
          makeRequest({ type: 'interactive', machineId: 'bare-metal-1' }),
          makeCapabilities({
            hasOAuthLogin: false,
            hasApiKey: false,
            hasTmux: false,
            plan: 'unknown',
          }),
        ),
      ).toThrow(ControlPlaneError);
    });

    it('includes error code NO_VIABLE_LAYER', () => {
      try {
        selectLayer(
          makeRequest({ type: 'interactive', machineId: 'bare-metal-1' }),
          makeCapabilities({
            hasOAuthLogin: false,
            hasApiKey: false,
            hasTmux: false,
            plan: 'unknown',
          }),
        );
        // Should not reach here
        expect.unreachable('Expected ControlPlaneError to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ControlPlaneError);
        const cpError = error as ControlPlaneError;
        expect(cpError.code).toBe('NO_VIABLE_LAYER');
        expect(cpError.context).toMatchObject({
          machineId: 'bare-metal-1',
          requestType: 'interactive',
        });
      }
    });

    it('includes machine ID and capabilities in the error message', () => {
      expect(() =>
        selectLayer(
          makeRequest({ type: 'autonomous', machineId: 'machine-x' }),
          makeCapabilities({
            hasOAuthLogin: false,
            hasApiKey: false,
            hasTmux: false,
            plan: 'api-only',
          }),
        ),
      ).toThrow(/machine-x/);
    });
  });

  // -------------------------------------------------------------------------
  // Priority ordering edge cases
  // -------------------------------------------------------------------------

  describe('priority ordering', () => {
    it('preferRemoteControl on Max takes priority over interactive -> cli-p', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive', preferRemoteControl: true }),
        makeCapabilities({
          plan: 'max',
          hasOAuthLogin: true,
          hasApiKey: true,
          hasTmux: true,
        }),
      );

      expect(result.layer).toBe('remote-control');
    });

    it('interactive + OAuth takes priority over sdk even when API key exists', () => {
      const result = selectLayer(
        makeRequest({ type: 'interactive' }),
        makeCapabilities({
          plan: 'team',
          hasOAuthLogin: true,
          hasApiKey: true,
          hasTmux: true,
        }),
      );

      expect(result.layer).toBe('cli-p');
    });

    it('autonomous + API key takes priority over cli-p even when OAuth exists', () => {
      const result = selectLayer(
        makeRequest({ type: 'autonomous' }),
        makeCapabilities({
          plan: 'team',
          hasOAuthLogin: true,
          hasApiKey: true,
          hasTmux: true,
        }),
      );

      expect(result.layer).toBe('sdk');
    });

    it('passes through optional fields from the request', () => {
      const result = selectLayer(
        makeRequest({
          type: 'interactive',
          prompt: 'build feature X',
          model: 'claude-sonnet-4-20250514',
        }),
        makeCapabilities({ plan: 'team', hasOAuthLogin: true }),
      );

      // Optional fields should not affect layer selection
      expect(result.layer).toBe('cli-p');
    });
  });
});
