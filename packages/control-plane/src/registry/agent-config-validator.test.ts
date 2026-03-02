import type { LoopConfig, ScheduleConfig } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import {
  type AgentRegistrationConfig,
  isValidCronExpression,
  isValidTailscaleIp,
  type ValidationResult,
  validateAgentConfig,
  validateLoopConfig,
  validateScheduleConfig,
} from './agent-config-validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validAgentConfig(
  overrides: Partial<AgentRegistrationConfig> = {},
): AgentRegistrationConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    machineId: 'machine-1',
    tailscaleIp: '100.64.0.1',
    port: 8080,
    capabilities: ['code', 'bash'],
    maxConcurrentTasks: 5,
    ...overrides,
  };
}

function validSchedule(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    sessionMode: 'fresh',
    promptTemplate: 'Run daily check for {{agentId}} on {{date}}',
    pattern: '0 9 * * *',
    ...overrides,
  };
}

function validLoop(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    mode: 'result-feedback',
    maxIterations: 10,
    costLimitUsd: 5.0,
    maxDurationMs: 600000,
    iterationDelayMs: 1000,
    ...overrides,
  };
}

function errorCodes(result: ValidationResult): string[] {
  return result.errors.map((e) => e.code);
}

function errorFields(result: ValidationResult): string[] {
  return result.errors.map((e) => e.field);
}

// ---------------------------------------------------------------------------
// isValidTailscaleIp
// ---------------------------------------------------------------------------

describe('isValidTailscaleIp', () => {
  it('accepts IP at lower boundary (100.64.0.0)', () => {
    expect(isValidTailscaleIp('100.64.0.0')).toBe(true);
  });

  it('accepts IP at upper boundary (100.127.255.255)', () => {
    expect(isValidTailscaleIp('100.127.255.255')).toBe(true);
  });

  it('accepts IP in the middle of range (100.100.50.25)', () => {
    expect(isValidTailscaleIp('100.100.50.25')).toBe(true);
  });

  it('rejects IP with second octet below 64 (100.63.0.1)', () => {
    expect(isValidTailscaleIp('100.63.0.1')).toBe(false);
  });

  it('rejects IP with second octet above 127 (100.128.0.1)', () => {
    expect(isValidTailscaleIp('100.128.0.1')).toBe(false);
  });

  it('rejects private IP (192.168.1.1)', () => {
    expect(isValidTailscaleIp('192.168.1.1')).toBe(false);
  });

  it('rejects malformed IP with too few octets', () => {
    expect(isValidTailscaleIp('100.64.0')).toBe(false);
  });

  it('rejects malformed IP with non-numeric octets', () => {
    expect(isValidTailscaleIp('100.64.abc.1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidTailscaleIp('')).toBe(false);
  });

  it('rejects IP with octet above 255', () => {
    expect(isValidTailscaleIp('100.64.256.1')).toBe(false);
  });

  it('rejects IP with negative octet', () => {
    expect(isValidTailscaleIp('100.64.-1.1')).toBe(false);
  });

  it('rejects IP with decimal octets', () => {
    expect(isValidTailscaleIp('100.64.0.1.5')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidCronExpression
// ---------------------------------------------------------------------------

describe('isValidCronExpression', () => {
  it('accepts standard 5-field cron (every minute)', () => {
    expect(isValidCronExpression('* * * * *')).toBe(true);
  });

  it('accepts 6-field cron with seconds', () => {
    expect(isValidCronExpression('0 0 9 * * *')).toBe(true);
  });

  it('accepts cron with specific values', () => {
    expect(isValidCronExpression('30 9 1 1 *')).toBe(true);
  });

  it('accepts cron with ranges', () => {
    expect(isValidCronExpression('0-30 9-17 * * 1-5')).toBe(true);
  });

  it('accepts cron with steps', () => {
    expect(isValidCronExpression('*/5 * * * *')).toBe(true);
  });

  it('accepts cron with commas', () => {
    expect(isValidCronExpression('0 9,12,18 * * *')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidCronExpression('')).toBe(false);
  });

  it('rejects cron with too few fields (4)', () => {
    expect(isValidCronExpression('* * * *')).toBe(false);
  });

  it('rejects cron with too many fields (7)', () => {
    expect(isValidCronExpression('* * * * * * *')).toBe(false);
  });

  it('rejects cron with invalid characters', () => {
    expect(isValidCronExpression('* * * * MON')).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    expect(isValidCronExpression('   ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAgentConfig
// ---------------------------------------------------------------------------

describe('validateAgentConfig', () => {
  it('accepts a fully valid agent config', () => {
    const result = validateAgentConfig(validAgentConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // --- id ---

  describe('id validation', () => {
    it('rejects missing id', () => {
      const result = validateAgentConfig(validAgentConfig({ id: undefined as unknown as string }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('id');
    });

    it('rejects empty id', () => {
      const result = validateAgentConfig(validAgentConfig({ id: '' }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_TYPE');
    });

    it('rejects whitespace-only id', () => {
      const result = validateAgentConfig(validAgentConfig({ id: '   ' }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('id');
    });

    it('rejects id exceeding 128 characters', () => {
      const result = validateAgentConfig(validAgentConfig({ id: 'a'.repeat(129) }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('MAX_LENGTH');
    });

    it('accepts id at exactly 128 characters', () => {
      const result = validateAgentConfig(validAgentConfig({ id: 'a'.repeat(128) }));
      expect(result.valid).toBe(true);
    });

    it('rejects id with special characters', () => {
      const result = validateAgentConfig(validAgentConfig({ id: 'agent_1@test' }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_FORMAT');
    });

    it('accepts id with alphanumeric and hyphens', () => {
      const result = validateAgentConfig(validAgentConfig({ id: 'agent-1-abc-DEF-123' }));
      expect(result.valid).toBe(true);
    });
  });

  // --- name ---

  describe('name validation', () => {
    it('rejects missing name', () => {
      const result = validateAgentConfig(
        validAgentConfig({ name: undefined as unknown as string }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('name');
    });

    it('rejects empty name', () => {
      const result = validateAgentConfig(validAgentConfig({ name: '' }));
      expect(result.valid).toBe(false);
    });

    it('rejects name exceeding 256 characters', () => {
      const result = validateAgentConfig(validAgentConfig({ name: 'x'.repeat(257) }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('MAX_LENGTH');
    });

    it('accepts name at exactly 256 characters', () => {
      const result = validateAgentConfig(validAgentConfig({ name: 'x'.repeat(256) }));
      expect(result.valid).toBe(true);
    });
  });

  // --- machineId ---

  describe('machineId validation', () => {
    it('rejects missing machineId', () => {
      const result = validateAgentConfig(
        validAgentConfig({ machineId: undefined as unknown as string }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('machineId');
    });

    it('rejects machineId exceeding 128 characters', () => {
      const result = validateAgentConfig(validAgentConfig({ machineId: 'm'.repeat(129) }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('MAX_LENGTH');
    });
  });

  // --- tailscaleIp ---

  describe('tailscaleIp validation', () => {
    it('rejects missing tailscaleIp', () => {
      const result = validateAgentConfig(
        validAgentConfig({ tailscaleIp: undefined as unknown as string }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('tailscaleIp');
    });

    it('rejects non-CGNAT IP', () => {
      const result = validateAgentConfig(validAgentConfig({ tailscaleIp: '10.0.0.1' }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_RANGE');
    });

    it('accepts valid Tailscale IP (100.64.1.1)', () => {
      const result = validateAgentConfig(validAgentConfig({ tailscaleIp: '100.64.1.1' }));
      expect(result.valid).toBe(true);
    });
  });

  // --- port ---

  describe('port validation', () => {
    it('rejects missing port', () => {
      const result = validateAgentConfig(
        validAgentConfig({ port: undefined as unknown as number }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('port');
    });

    it('rejects port below 1024', () => {
      const result = validateAgentConfig(validAgentConfig({ port: 80 }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('OUT_OF_RANGE');
    });

    it('rejects port above 65535', () => {
      const result = validateAgentConfig(validAgentConfig({ port: 70000 }));
      expect(result.valid).toBe(false);
    });

    it('accepts port at lower boundary (1024)', () => {
      const result = validateAgentConfig(validAgentConfig({ port: 1024 }));
      expect(result.valid).toBe(true);
    });

    it('accepts port at upper boundary (65535)', () => {
      const result = validateAgentConfig(validAgentConfig({ port: 65535 }));
      expect(result.valid).toBe(true);
    });

    it('rejects non-integer port', () => {
      const result = validateAgentConfig(validAgentConfig({ port: 8080.5 }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_TYPE');
    });
  });

  // --- capabilities ---

  describe('capabilities validation', () => {
    it('rejects missing capabilities', () => {
      const result = validateAgentConfig(
        validAgentConfig({ capabilities: undefined as unknown as string[] }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('capabilities');
    });

    it('accepts empty capabilities array', () => {
      const result = validateAgentConfig(validAgentConfig({ capabilities: [] }));
      expect(result.valid).toBe(true);
    });

    it('rejects capabilities with more than 20 items', () => {
      const caps = Array.from({ length: 21 }, (_, i) => `cap-${i}`);
      const result = validateAgentConfig(validAgentConfig({ capabilities: caps }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('MAX_LENGTH');
    });

    it('accepts capabilities with exactly 20 items', () => {
      const caps = Array.from({ length: 20 }, (_, i) => `cap-${i}`);
      const result = validateAgentConfig(validAgentConfig({ capabilities: caps }));
      expect(result.valid).toBe(true);
    });

    it('rejects capabilities containing empty strings', () => {
      const result = validateAgentConfig(validAgentConfig({ capabilities: ['code', ''] }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('capabilities[1]');
    });

    it('rejects non-array capabilities', () => {
      const result = validateAgentConfig(
        validAgentConfig({ capabilities: 'code' as unknown as string[] }),
      );
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_TYPE');
    });
  });

  // --- maxConcurrentTasks ---

  describe('maxConcurrentTasks validation', () => {
    it('rejects missing maxConcurrentTasks', () => {
      const result = validateAgentConfig(
        validAgentConfig({ maxConcurrentTasks: undefined as unknown as number }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('maxConcurrentTasks');
    });

    it('rejects maxConcurrentTasks of 0', () => {
      const result = validateAgentConfig(validAgentConfig({ maxConcurrentTasks: 0 }));
      expect(result.valid).toBe(false);
    });

    it('rejects maxConcurrentTasks above 100', () => {
      const result = validateAgentConfig(validAgentConfig({ maxConcurrentTasks: 101 }));
      expect(result.valid).toBe(false);
    });

    it('accepts maxConcurrentTasks at lower boundary (1)', () => {
      const result = validateAgentConfig(validAgentConfig({ maxConcurrentTasks: 1 }));
      expect(result.valid).toBe(true);
    });

    it('accepts maxConcurrentTasks at upper boundary (100)', () => {
      const result = validateAgentConfig(validAgentConfig({ maxConcurrentTasks: 100 }));
      expect(result.valid).toBe(true);
    });

    it('rejects non-integer maxConcurrentTasks', () => {
      const result = validateAgentConfig(validAgentConfig({ maxConcurrentTasks: 5.5 }));
      expect(result.valid).toBe(false);
    });
  });

  // --- multiple errors ---

  describe('multiple errors', () => {
    it('collects all errors from an empty config', () => {
      const result = validateAgentConfig({});
      expect(result.valid).toBe(false);
      // Should report errors for all 7 required fields
      expect(result.errors.length).toBeGreaterThanOrEqual(7);
      expect(errorFields(result)).toContain('id');
      expect(errorFields(result)).toContain('name');
      expect(errorFields(result)).toContain('machineId');
      expect(errorFields(result)).toContain('tailscaleIp');
      expect(errorFields(result)).toContain('port');
      expect(errorFields(result)).toContain('capabilities');
      expect(errorFields(result)).toContain('maxConcurrentTasks');
    });

    it('reports both max-length and format errors for id', () => {
      const longInvalidId = `${'a'.repeat(128)}_!`;
      const result = validateAgentConfig(validAgentConfig({ id: longInvalidId }));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(errorCodes(result)).toContain('MAX_LENGTH');
      expect(errorCodes(result)).toContain('INVALID_FORMAT');
    });
  });
});

// ---------------------------------------------------------------------------
// validateScheduleConfig
// ---------------------------------------------------------------------------

describe('validateScheduleConfig', () => {
  it('accepts a fully valid schedule config', () => {
    const result = validateScheduleConfig(validSchedule());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // --- sessionMode ---

  describe('sessionMode validation', () => {
    it('accepts fresh mode', () => {
      const result = validateScheduleConfig(validSchedule({ sessionMode: 'fresh' }));
      expect(result.valid).toBe(true);
    });

    it('accepts resume mode', () => {
      const result = validateScheduleConfig(validSchedule({ sessionMode: 'resume' }));
      expect(result.valid).toBe(true);
    });

    it('rejects invalid session mode', () => {
      const result = validateScheduleConfig(validSchedule({ sessionMode: 'invalid' as 'fresh' }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('sessionMode');
      expect(errorCodes(result)).toContain('INVALID_VALUE');
    });

    it('rejects missing session mode', () => {
      const result = validateScheduleConfig(validSchedule({ sessionMode: '' as 'fresh' }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('sessionMode');
    });
  });

  // --- promptTemplate ---

  describe('promptTemplate validation', () => {
    it('rejects empty prompt template', () => {
      const result = validateScheduleConfig(validSchedule({ promptTemplate: '' }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('promptTemplate');
    });

    it('rejects whitespace-only prompt template', () => {
      const result = validateScheduleConfig(validSchedule({ promptTemplate: '   ' }));
      expect(result.valid).toBe(false);
    });

    it('rejects prompt template exceeding 10000 characters', () => {
      const result = validateScheduleConfig(validSchedule({ promptTemplate: 'x'.repeat(10001) }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('MAX_LENGTH');
    });

    it('accepts prompt template at exactly 10000 characters', () => {
      const result = validateScheduleConfig(validSchedule({ promptTemplate: 'x'.repeat(10000) }));
      expect(result.valid).toBe(true);
    });
  });

  // --- pattern ---

  describe('pattern validation', () => {
    it('accepts valid 5-field cron', () => {
      const result = validateScheduleConfig(validSchedule({ pattern: '0 9 * * *' }));
      expect(result.valid).toBe(true);
    });

    it('accepts valid 6-field cron', () => {
      const result = validateScheduleConfig(validSchedule({ pattern: '0 0 9 * * *' }));
      expect(result.valid).toBe(true);
    });

    it('rejects invalid cron pattern', () => {
      const result = validateScheduleConfig(validSchedule({ pattern: 'not-a-cron' }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_FORMAT');
    });

    it('accepts config without pattern (optional field)', () => {
      const config = validSchedule();
      delete (config as Record<string, unknown>).pattern;
      const result = validateScheduleConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  // --- multiple errors ---

  describe('multiple errors', () => {
    it('reports errors for both sessionMode and promptTemplate', () => {
      const result = validateScheduleConfig({
        sessionMode: 'invalid' as 'fresh',
        promptTemplate: '',
        pattern: '0 9 * * *',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(errorFields(result)).toContain('sessionMode');
      expect(errorFields(result)).toContain('promptTemplate');
    });
  });
});

// ---------------------------------------------------------------------------
// validateLoopConfig
// ---------------------------------------------------------------------------

describe('validateLoopConfig', () => {
  it('accepts a fully valid loop config', () => {
    const result = validateLoopConfig(validLoop());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // --- mode ---

  describe('mode validation', () => {
    it('accepts result-feedback mode', () => {
      const result = validateLoopConfig(validLoop({ mode: 'result-feedback' }));
      expect(result.valid).toBe(true);
    });

    it('accepts fixed-prompt mode with fixedPrompt', () => {
      const result = validateLoopConfig(
        validLoop({ mode: 'fixed-prompt', fixedPrompt: 'do something' }),
      );
      expect(result.valid).toBe(true);
    });

    it('accepts callback mode', () => {
      const result = validateLoopConfig(validLoop({ mode: 'callback' }));
      expect(result.valid).toBe(true);
    });

    it('rejects invalid mode', () => {
      const result = validateLoopConfig(validLoop({ mode: 'invalid' as 'callback' }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('mode');
      expect(errorCodes(result)).toContain('INVALID_VALUE');
    });
  });

  // --- limits ---

  describe('limits validation', () => {
    it('requires at least one limit', () => {
      const config: LoopConfig = {
        mode: 'result-feedback',
        maxIterations: undefined,
        costLimitUsd: undefined,
        maxDurationMs: undefined,
      };
      const result = validateLoopConfig(config);
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('limits');
      expect(errorCodes(result)).toContain('MISSING_LIMIT');
    });

    it('accepts config with only maxIterations', () => {
      const result = validateLoopConfig({
        mode: 'result-feedback',
        maxIterations: 100,
      });
      expect(result.valid).toBe(true);
    });

    it('accepts config with only costLimitUsd', () => {
      const result = validateLoopConfig({
        mode: 'result-feedback',
        costLimitUsd: 10.0,
      });
      expect(result.valid).toBe(true);
    });

    it('accepts config with only maxDurationMs', () => {
      const result = validateLoopConfig({
        mode: 'result-feedback',
        maxDurationMs: 60000,
      });
      expect(result.valid).toBe(true);
    });
  });

  // --- maxIterations ---

  describe('maxIterations validation', () => {
    it('rejects maxIterations of 0', () => {
      const result = validateLoopConfig(validLoop({ maxIterations: 0 }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('maxIterations');
    });

    it('rejects negative maxIterations', () => {
      const result = validateLoopConfig(validLoop({ maxIterations: -1 }));
      expect(result.valid).toBe(false);
    });

    it('rejects maxIterations above 10000', () => {
      const result = validateLoopConfig(validLoop({ maxIterations: 10001 }));
      expect(result.valid).toBe(false);
    });

    it('accepts maxIterations at upper boundary (10000)', () => {
      const result = validateLoopConfig(validLoop({ maxIterations: 10000 }));
      expect(result.valid).toBe(true);
    });

    it('accepts maxIterations of 1', () => {
      const result = validateLoopConfig(validLoop({ maxIterations: 1 }));
      expect(result.valid).toBe(true);
    });

    it('rejects non-integer maxIterations', () => {
      const result = validateLoopConfig(validLoop({ maxIterations: 5.5 }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_TYPE');
    });
  });

  // --- costLimitUsd ---

  describe('costLimitUsd validation', () => {
    it('rejects costLimitUsd of 0', () => {
      const result = validateLoopConfig(validLoop({ costLimitUsd: 0 }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('costLimitUsd');
    });

    it('rejects negative costLimitUsd', () => {
      const result = validateLoopConfig(validLoop({ costLimitUsd: -5 }));
      expect(result.valid).toBe(false);
    });

    it('rejects costLimitUsd above 1000', () => {
      const result = validateLoopConfig(validLoop({ costLimitUsd: 1001 }));
      expect(result.valid).toBe(false);
    });

    it('accepts costLimitUsd at upper boundary (1000)', () => {
      const result = validateLoopConfig(validLoop({ costLimitUsd: 1000 }));
      expect(result.valid).toBe(true);
    });

    it('accepts fractional costLimitUsd (0.01)', () => {
      const result = validateLoopConfig(validLoop({ costLimitUsd: 0.01 }));
      expect(result.valid).toBe(true);
    });
  });

  // --- maxDurationMs ---

  describe('maxDurationMs validation', () => {
    it('rejects maxDurationMs of 0', () => {
      const result = validateLoopConfig(validLoop({ maxDurationMs: 0 }));
      expect(result.valid).toBe(false);
    });

    it('rejects maxDurationMs above 86400000', () => {
      const result = validateLoopConfig(validLoop({ maxDurationMs: 86400001 }));
      expect(result.valid).toBe(false);
    });

    it('accepts maxDurationMs at upper boundary (86400000)', () => {
      const result = validateLoopConfig(validLoop({ maxDurationMs: 86400000 }));
      expect(result.valid).toBe(true);
    });

    it('accepts maxDurationMs of 1', () => {
      const result = validateLoopConfig(validLoop({ maxDurationMs: 1 }));
      expect(result.valid).toBe(true);
    });

    it('rejects non-integer maxDurationMs', () => {
      const result = validateLoopConfig(validLoop({ maxDurationMs: 5000.5 }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_TYPE');
    });
  });

  // --- iterationDelayMs ---

  describe('iterationDelayMs validation', () => {
    it('rejects iterationDelayMs below 500', () => {
      const result = validateLoopConfig(validLoop({ iterationDelayMs: 499 }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('iterationDelayMs');
    });

    it('accepts iterationDelayMs at lower boundary (500)', () => {
      const result = validateLoopConfig(validLoop({ iterationDelayMs: 500 }));
      expect(result.valid).toBe(true);
    });

    it('accepts omitted iterationDelayMs (optional)', () => {
      const config = validLoop();
      delete (config as Record<string, unknown>).iterationDelayMs;
      const result = validateLoopConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects non-integer iterationDelayMs', () => {
      const result = validateLoopConfig(validLoop({ iterationDelayMs: 500.5 }));
      expect(result.valid).toBe(false);
      expect(errorCodes(result)).toContain('INVALID_TYPE');
    });
  });

  // --- fixedPrompt (required for fixed-prompt mode) ---

  describe('fixedPrompt validation', () => {
    it('requires fixedPrompt when mode is fixed-prompt', () => {
      const result = validateLoopConfig(
        validLoop({ mode: 'fixed-prompt', fixedPrompt: undefined }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('fixedPrompt');
      expect(errorCodes(result)).toContain('REQUIRED');
    });

    it('rejects empty fixedPrompt when mode is fixed-prompt', () => {
      const result = validateLoopConfig(validLoop({ mode: 'fixed-prompt', fixedPrompt: '' }));
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('fixedPrompt');
    });

    it('rejects whitespace-only fixedPrompt when mode is fixed-prompt', () => {
      const result = validateLoopConfig(validLoop({ mode: 'fixed-prompt', fixedPrompt: '   ' }));
      expect(result.valid).toBe(false);
    });

    it('does not require fixedPrompt for result-feedback mode', () => {
      const result = validateLoopConfig(
        validLoop({ mode: 'result-feedback', fixedPrompt: undefined }),
      );
      expect(result.valid).toBe(true);
    });

    it('does not require fixedPrompt for callback mode', () => {
      const result = validateLoopConfig(validLoop({ mode: 'callback', fixedPrompt: undefined }));
      expect(result.valid).toBe(true);
    });
  });

  // --- multiple errors ---

  describe('multiple errors', () => {
    it('reports multiple errors simultaneously', () => {
      const result = validateLoopConfig({
        mode: 'invalid' as 'callback',
        maxIterations: -1,
        costLimitUsd: -5,
        iterationDelayMs: 100,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
      expect(errorFields(result)).toContain('mode');
      expect(errorFields(result)).toContain('maxIterations');
      expect(errorFields(result)).toContain('costLimitUsd');
      expect(errorFields(result)).toContain('iterationDelayMs');
    });
  });
});
