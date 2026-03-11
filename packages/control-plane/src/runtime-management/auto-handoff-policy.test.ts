import type { AutoHandoffPolicy } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTO_HANDOFF_POLICY,
  resolveAutoHandoffPolicy,
} from './auto-handoff-policy.js';

describe('resolveAutoHandoffPolicy', () => {
  it('returns the default policy when no overrides are present', () => {
    expect(resolveAutoHandoffPolicy({})).toEqual(DEFAULT_AUTO_HANDOFF_POLICY);
  });

  it('prefers the agent-level override over the default policy', () => {
    const override: AutoHandoffPolicy = {
      enabled: true,
      mode: 'execute',
      maxAutomaticHandoffsPerRun: 3,
      cooldownMs: 5_000,
      taskAffinity: {
        enabled: true,
        rules: [
          {
            id: 'python-to-codex',
            match: 'python-heavy',
            targetRuntime: 'codex',
            reason: 'Prefer Codex for Python-heavy work.',
            priority: 200,
          },
        ],
      },
    };

    const resolved = resolveAutoHandoffPolicy({
      agentConfig: { autoHandoff: override },
      defaultPolicy: {
        ...DEFAULT_AUTO_HANDOFF_POLICY,
        mode: 'dry-run',
      },
    });

    expect(resolved).toEqual(override);
  });

  it('falls back to managed-session metadata when the agent config has no override', () => {
    const sessionOverride: AutoHandoffPolicy = {
      enabled: true,
      mode: 'dry-run',
      maxAutomaticHandoffsPerRun: 1,
      cooldownMs: 30_000,
      taskAffinity: {
        enabled: true,
        rules: [
          {
            id: 'frontend-to-claude',
            match: 'frontend-heavy',
            targetRuntime: 'claude-code',
            reason: 'Prefer Claude Code for broad frontend context.',
            priority: 50,
          },
        ],
      },
    };

    const resolved = resolveAutoHandoffPolicy({
      managedSessionMetadata: { autoHandoff: sessionOverride },
      defaultPolicy: {
        ...DEFAULT_AUTO_HANDOFF_POLICY,
        enabled: false,
      },
    });

    expect(resolved).toEqual(sessionOverride);
  });
});
