/**
 * Zero-dependency environment variable validator.
 *
 * Checks required vars, applies defaults, runs custom validation,
 * and produces clear, actionable error messages at startup.
 */

export type EnvVar = {
  /** Environment variable name (e.g. "REDIS_URL") */
  name: string;
  /** When true, startup will fail if this var is missing and no default is set */
  required?: boolean;
  /** Default value applied when the var is not set in the environment */
  default?: string;
  /** Custom validation function -- return true if valid, false if invalid */
  validate?: (value: string) => boolean;
  /** Human-readable description shown in error messages */
  description: string;
};

export type ValidatedEnv = Record<string, string | undefined>;

type EnvLogger = {
  warn: (msg: string) => void;
};

/**
 * Validate a list of environment variable definitions against `process.env`.
 *
 * For each variable:
 *  1. Read the value from `process.env`
 *  2. If missing and a default is provided, use the default
 *  3. If still missing and required, record the error
 *  4. If still missing and optional, log a warning
 *  5. If a value exists and a `validate` function is provided, run it
 *
 * After processing all variables, if any required vars are missing or
 * any values fail validation, throw a single error with a clear multi-line
 * message listing every problem.
 *
 * @returns A record mapping variable names to their resolved values
 */
export function validateEnv(vars: EnvVar[], logger?: EnvLogger): ValidatedEnv {
  const result: ValidatedEnv = {};
  const errors: string[] = [];

  for (const varDef of vars) {
    let value = process.env[varDef.name];

    // Apply default when the value is missing or empty
    if ((value === undefined || value === '') && varDef.default !== undefined) {
      value = varDef.default;
    }

    // Check required vars
    if ((value === undefined || value === '') && varDef.required) {
      errors.push(`  - ${varDef.name}: ${varDef.description} (required)`);
      result[varDef.name] = undefined;
      continue;
    }

    // Warn about missing optional vars
    if (value === undefined || value === '') {
      if (logger) {
        logger.warn(`Environment variable ${varDef.name} is not set — ${varDef.description}`);
      }
      result[varDef.name] = undefined;
      continue;
    }

    // Run custom validation
    if (varDef.validate && !varDef.validate(value)) {
      errors.push(`  - ${varDef.name}: invalid value "${value}" — ${varDef.description}`);
      result[varDef.name] = value;
      continue;
    }

    result[varDef.name] = value;
  }

  if (errors.length > 0) {
    const message = [
      `Environment validation failed (${errors.length} problem${errors.length > 1 ? 's' : ''}):`,
      '',
      ...errors,
      '',
      'Set the missing variables in your .env file or environment and restart.',
    ].join('\n');

    throw new EnvValidationError('ENV_VALIDATION_FAILED', message, {
      problems: errors,
    });
  }

  return result;
}

/** Typed error thrown when environment validation fails. */
export class EnvValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

// ── Validation helpers ────────────────────────────────────────────────

const VALID_LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

/** Returns true if the value is a valid numeric string */
export function isNumericString(value: string): boolean {
  return /^\d+$/.test(value) && Number.isFinite(Number(value));
}

/** Returns true if the value is a valid pino log level */
export function isValidLogLevel(value: string): boolean {
  return VALID_LOG_LEVELS.has(value);
}
