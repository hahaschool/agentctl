// ---------------------------------------------------------------------------
// Agent Config Validator — validates agent registration and configuration
// ---------------------------------------------------------------------------

import type { LoopConfig, LoopMode, ScheduleConfig } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of an agent registration payload. Uses the fields that the control
 * plane needs to accept when a new agent registers or updates its config.
 *
 * This is intentionally a separate type from the shared `Agent` — the
 * validator works with partial, untrusted input from external sources.
 */
export type AgentRegistrationConfig = {
  id: string;
  name: string;
  machineId: string;
  tailscaleIp: string;
  port: number;
  capabilities: string[];
  maxConcurrentTasks: number;
};

export type ValidationError = {
  field: string;
  message: string;
  code: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_MACHINE_ID_LENGTH = 128;
const MAX_CAPABILITIES = 20;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const MAX_CONCURRENT_TASKS = 100;
const MAX_PROMPT_TEMPLATE_LENGTH = 10000;
const MAX_LOOP_ITERATIONS = 10000;
const MAX_COST_LIMIT_USD = 1000;
const MAX_DURATION_MS = 86400000; // 24 hours
const MIN_ITERATION_DELAY_MS = 500;

const VALID_LOOP_MODES: ReadonlySet<LoopMode> = new Set<LoopMode>([
  'result-feedback',
  'fixed-prompt',
  'callback',
]);

const VALID_SESSION_MODES: ReadonlySet<string> = new Set(['fresh', 'resume']);

/** Pattern: alphanumeric characters and hyphens only. */
const ID_PATTERN = /^[a-zA-Z0-9-]+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that an IP address is in the Tailscale CGNAT range 100.64.0.0/10.
 * The range spans 100.64.0.0 through 100.127.255.255.
 */
export function isValidTailscaleIp(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255 || !Number.isInteger(o))) {
    return false;
  }

  const [first, second] = octets;
  // 100.64.0.0/10 -> first octet must be 100, second octet 64-127
  return first === 100 && second >= 64 && second <= 127;
}

/**
 * Validate that a string is a valid cron expression (5 or 6 fields).
 * Each field may contain digits, `*`, `/`, `-`, and commas.
 */
export function isValidCronExpression(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === '') {
    return false;
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length < 5 || fields.length > 6) {
    return false;
  }

  // Each field must contain only valid cron characters: 0-9, *, /, -, comma
  const fieldPattern = /^[0-9*/,-]+$/;
  return fields.every((field) => fieldPattern.test(field));
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate an agent registration/update configuration.
 * Collects all validation errors rather than failing on the first one.
 */
export function validateAgentConfig(config: Partial<AgentRegistrationConfig>): ValidationResult {
  const errors: ValidationError[] = [];

  // --- id ---
  if (config.id === undefined || config.id === null) {
    errors.push({ field: 'id', message: 'Agent id is required', code: 'REQUIRED' });
  } else if (typeof config.id !== 'string' || config.id.trim() === '') {
    errors.push({
      field: 'id',
      message: 'Agent id must be a non-empty string',
      code: 'INVALID_TYPE',
    });
  } else {
    if (config.id.length > MAX_ID_LENGTH) {
      errors.push({
        field: 'id',
        message: `Agent id must be at most ${MAX_ID_LENGTH} characters`,
        code: 'MAX_LENGTH',
      });
    }
    if (!ID_PATTERN.test(config.id)) {
      errors.push({
        field: 'id',
        message: 'Agent id must contain only alphanumeric characters and hyphens',
        code: 'INVALID_FORMAT',
      });
    }
  }

  // --- name ---
  if (config.name === undefined || config.name === null) {
    errors.push({ field: 'name', message: 'Agent name is required', code: 'REQUIRED' });
  } else if (typeof config.name !== 'string' || config.name.trim() === '') {
    errors.push({
      field: 'name',
      message: 'Agent name must be a non-empty string',
      code: 'INVALID_TYPE',
    });
  } else if (config.name.length > MAX_NAME_LENGTH) {
    errors.push({
      field: 'name',
      message: `Agent name must be at most ${MAX_NAME_LENGTH} characters`,
      code: 'MAX_LENGTH',
    });
  }

  // --- machineId ---
  if (config.machineId === undefined || config.machineId === null) {
    errors.push({ field: 'machineId', message: 'Machine id is required', code: 'REQUIRED' });
  } else if (typeof config.machineId !== 'string' || config.machineId.trim() === '') {
    errors.push({
      field: 'machineId',
      message: 'Machine id must be a non-empty string',
      code: 'INVALID_TYPE',
    });
  } else if (config.machineId.length > MAX_MACHINE_ID_LENGTH) {
    errors.push({
      field: 'machineId',
      message: `Machine id must be at most ${MAX_MACHINE_ID_LENGTH} characters`,
      code: 'MAX_LENGTH',
    });
  }

  // --- tailscaleIp ---
  if (config.tailscaleIp === undefined || config.tailscaleIp === null) {
    errors.push({ field: 'tailscaleIp', message: 'Tailscale IP is required', code: 'REQUIRED' });
  } else if (typeof config.tailscaleIp !== 'string' || config.tailscaleIp.trim() === '') {
    errors.push({
      field: 'tailscaleIp',
      message: 'Tailscale IP must be a non-empty string',
      code: 'INVALID_TYPE',
    });
  } else if (!isValidTailscaleIp(config.tailscaleIp)) {
    errors.push({
      field: 'tailscaleIp',
      message: 'Tailscale IP must be in CGNAT range 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)',
      code: 'INVALID_RANGE',
    });
  }

  // --- port ---
  if (config.port === undefined || config.port === null) {
    errors.push({ field: 'port', message: 'Port is required', code: 'REQUIRED' });
  } else if (typeof config.port !== 'number' || !Number.isInteger(config.port)) {
    errors.push({ field: 'port', message: 'Port must be an integer', code: 'INVALID_TYPE' });
  } else if (config.port < MIN_PORT || config.port > MAX_PORT) {
    errors.push({
      field: 'port',
      message: `Port must be between ${MIN_PORT} and ${MAX_PORT}`,
      code: 'OUT_OF_RANGE',
    });
  }

  // --- capabilities ---
  if (config.capabilities === undefined || config.capabilities === null) {
    errors.push({
      field: 'capabilities',
      message: 'Capabilities are required',
      code: 'REQUIRED',
    });
  } else if (!Array.isArray(config.capabilities)) {
    errors.push({
      field: 'capabilities',
      message: 'Capabilities must be an array',
      code: 'INVALID_TYPE',
    });
  } else {
    if (config.capabilities.length > MAX_CAPABILITIES) {
      errors.push({
        field: 'capabilities',
        message: `Capabilities must have at most ${MAX_CAPABILITIES} items`,
        code: 'MAX_LENGTH',
      });
    }
    for (let i = 0; i < config.capabilities.length; i++) {
      const cap = config.capabilities[i];
      if (typeof cap !== 'string' || cap.trim() === '') {
        errors.push({
          field: `capabilities[${i}]`,
          message: 'Each capability must be a non-empty string',
          code: 'INVALID_TYPE',
        });
      }
    }
  }

  // --- maxConcurrentTasks ---
  if (config.maxConcurrentTasks === undefined || config.maxConcurrentTasks === null) {
    errors.push({
      field: 'maxConcurrentTasks',
      message: 'Max concurrent tasks is required',
      code: 'REQUIRED',
    });
  } else if (
    typeof config.maxConcurrentTasks !== 'number' ||
    !Number.isInteger(config.maxConcurrentTasks)
  ) {
    errors.push({
      field: 'maxConcurrentTasks',
      message: 'Max concurrent tasks must be an integer',
      code: 'INVALID_TYPE',
    });
  } else if (config.maxConcurrentTasks < 1 || config.maxConcurrentTasks > MAX_CONCURRENT_TASKS) {
    errors.push({
      field: 'maxConcurrentTasks',
      message: `Max concurrent tasks must be between 1 and ${MAX_CONCURRENT_TASKS}`,
      code: 'OUT_OF_RANGE',
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a schedule configuration for cron/heartbeat agents.
 */
export function validateScheduleConfig(config: ScheduleConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // --- sessionMode ---
  if (!config.sessionMode) {
    errors.push({
      field: 'sessionMode',
      message: 'Session mode is required',
      code: 'REQUIRED',
    });
  } else if (!VALID_SESSION_MODES.has(config.sessionMode)) {
    errors.push({
      field: 'sessionMode',
      message: "Session mode must be 'fresh' or 'resume'",
      code: 'INVALID_VALUE',
    });
  }

  // --- promptTemplate ---
  if (config.promptTemplate === undefined || config.promptTemplate === null) {
    errors.push({
      field: 'promptTemplate',
      message: 'Prompt template is required',
      code: 'REQUIRED',
    });
  } else if (typeof config.promptTemplate !== 'string' || config.promptTemplate.trim() === '') {
    errors.push({
      field: 'promptTemplate',
      message: 'Prompt template must be a non-empty string',
      code: 'INVALID_TYPE',
    });
  } else if (config.promptTemplate.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    errors.push({
      field: 'promptTemplate',
      message: `Prompt template must be at most ${MAX_PROMPT_TEMPLATE_LENGTH} characters`,
      code: 'MAX_LENGTH',
    });
  }

  // --- pattern (cron expression) ---
  if (config.pattern !== undefined && config.pattern !== null) {
    if (typeof config.pattern !== 'string' || config.pattern.trim() === '') {
      errors.push({
        field: 'pattern',
        message: 'Cron pattern must be a non-empty string when provided',
        code: 'INVALID_TYPE',
      });
    } else if (!isValidCronExpression(config.pattern)) {
      errors.push({
        field: 'pattern',
        message: 'Cron pattern must be a valid cron expression with 5 or 6 fields',
        code: 'INVALID_FORMAT',
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a loop configuration for iterative agent sessions.
 */
export function validateLoopConfig(config: LoopConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // --- mode ---
  if (!config.mode) {
    errors.push({ field: 'mode', message: 'Loop mode is required', code: 'REQUIRED' });
  } else if (!VALID_LOOP_MODES.has(config.mode as LoopMode)) {
    errors.push({
      field: 'mode',
      message: "Loop mode must be one of 'result-feedback', 'fixed-prompt', 'callback'",
      code: 'INVALID_VALUE',
    });
  }

  // --- At least one limit required ---
  const hasMaxIterations = config.maxIterations !== undefined && config.maxIterations !== null;
  const hasCostLimit = config.costLimitUsd !== undefined && config.costLimitUsd !== null;
  const hasMaxDuration = config.maxDurationMs !== undefined && config.maxDurationMs !== null;

  if (!hasMaxIterations && !hasCostLimit && !hasMaxDuration) {
    errors.push({
      field: 'limits',
      message: 'At least one limit is required: maxIterations, costLimitUsd, or maxDurationMs',
      code: 'MISSING_LIMIT',
    });
  }

  // --- maxIterations ---
  if (hasMaxIterations) {
    if (typeof config.maxIterations !== 'number' || !Number.isInteger(config.maxIterations)) {
      errors.push({
        field: 'maxIterations',
        message: 'Max iterations must be a positive integer',
        code: 'INVALID_TYPE',
      });
    } else if (config.maxIterations < 1 || config.maxIterations > MAX_LOOP_ITERATIONS) {
      errors.push({
        field: 'maxIterations',
        message: `Max iterations must be between 1 and ${MAX_LOOP_ITERATIONS}`,
        code: 'OUT_OF_RANGE',
      });
    }
  }

  // --- costLimitUsd ---
  if (hasCostLimit) {
    if (typeof config.costLimitUsd !== 'number') {
      errors.push({
        field: 'costLimitUsd',
        message: 'Cost limit must be a positive number',
        code: 'INVALID_TYPE',
      });
    } else if (config.costLimitUsd <= 0 || config.costLimitUsd > MAX_COST_LIMIT_USD) {
      errors.push({
        field: 'costLimitUsd',
        message: `Cost limit must be between 0 (exclusive) and ${MAX_COST_LIMIT_USD}`,
        code: 'OUT_OF_RANGE',
      });
    }
  }

  // --- maxDurationMs ---
  if (hasMaxDuration) {
    if (typeof config.maxDurationMs !== 'number' || !Number.isInteger(config.maxDurationMs)) {
      errors.push({
        field: 'maxDurationMs',
        message: 'Max duration must be a positive integer',
        code: 'INVALID_TYPE',
      });
    } else if (config.maxDurationMs < 1 || config.maxDurationMs > MAX_DURATION_MS) {
      errors.push({
        field: 'maxDurationMs',
        message: `Max duration must be between 1 and ${MAX_DURATION_MS} (24 hours)`,
        code: 'OUT_OF_RANGE',
      });
    }
  }

  // --- iterationDelayMs ---
  if (config.iterationDelayMs !== undefined && config.iterationDelayMs !== null) {
    if (typeof config.iterationDelayMs !== 'number' || !Number.isInteger(config.iterationDelayMs)) {
      errors.push({
        field: 'iterationDelayMs',
        message: 'Iteration delay must be an integer',
        code: 'INVALID_TYPE',
      });
    } else if (config.iterationDelayMs < MIN_ITERATION_DELAY_MS) {
      errors.push({
        field: 'iterationDelayMs',
        message: `Iteration delay must be at least ${MIN_ITERATION_DELAY_MS}ms`,
        code: 'OUT_OF_RANGE',
      });
    }
  }

  // --- fixedPrompt (required when mode is 'fixed-prompt') ---
  if (config.mode === 'fixed-prompt') {
    if (
      !config.fixedPrompt ||
      (typeof config.fixedPrompt === 'string' && config.fixedPrompt.trim() === '')
    ) {
      errors.push({
        field: 'fixedPrompt',
        message: "Prompt is required when mode is 'fixed-prompt'",
        code: 'REQUIRED',
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
