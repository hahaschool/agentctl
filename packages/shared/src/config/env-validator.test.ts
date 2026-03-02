import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvVar } from './env-validator.js';
import {
  EnvValidationError,
  isNumericString,
  isValidLogLevel,
  validateEnv,
} from './env-validator.js';

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh env object for each test so mutations don't leak
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns values from process.env', () => {
    process.env.MY_VAR = 'hello';

    const vars: EnvVar[] = [{ name: 'MY_VAR', description: 'A test variable' }];

    const result = validateEnv(vars);
    expect(result.MY_VAR).toBe('hello');
  });

  it('applies default when env var is not set', () => {
    delete process.env.MY_VAR;

    const vars: EnvVar[] = [
      { name: 'MY_VAR', default: 'fallback', description: 'A test variable' },
    ];

    const result = validateEnv(vars);
    expect(result.MY_VAR).toBe('fallback');
  });

  it('applies default when env var is empty string', () => {
    process.env.MY_VAR = '';

    const vars: EnvVar[] = [
      { name: 'MY_VAR', default: 'fallback', description: 'A test variable' },
    ];

    const result = validateEnv(vars);
    expect(result.MY_VAR).toBe('fallback');
  });

  it('prefers env value over default', () => {
    process.env.MY_VAR = 'explicit';

    const vars: EnvVar[] = [
      { name: 'MY_VAR', default: 'fallback', description: 'A test variable' },
    ];

    const result = validateEnv(vars);
    expect(result.MY_VAR).toBe('explicit');
  });

  it('throws EnvValidationError when required var is missing', () => {
    delete process.env.REQUIRED_VAR;

    const vars: EnvVar[] = [{ name: 'REQUIRED_VAR', required: true, description: 'Must be set' }];

    expect(() => validateEnv(vars)).toThrow(EnvValidationError);
  });

  it('includes all missing required vars in a single error', () => {
    delete process.env.VAR_A;
    delete process.env.VAR_B;

    const vars: EnvVar[] = [
      { name: 'VAR_A', required: true, description: 'First required var' },
      { name: 'VAR_B', required: true, description: 'Second required var' },
    ];

    try {
      validateEnv(vars);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const validationErr = err as EnvValidationError;
      expect(validationErr.code).toBe('ENV_VALIDATION_FAILED');
      expect(validationErr.message).toContain('VAR_A');
      expect(validationErr.message).toContain('VAR_B');
      expect(validationErr.message).toContain('2 problems');
    }
  });

  it('does not throw when required var has a default', () => {
    delete process.env.MY_VAR;

    const vars: EnvVar[] = [
      {
        name: 'MY_VAR',
        required: true,
        default: 'safe-default',
        description: 'Has a fallback',
      },
    ];

    const result = validateEnv(vars);
    expect(result.MY_VAR).toBe('safe-default');
  });

  it('logs a warning for missing optional vars', () => {
    delete process.env.OPTIONAL_VAR;

    const mockLogger = { warn: vi.fn() };

    const vars: EnvVar[] = [{ name: 'OPTIONAL_VAR', description: 'Not critical' }];

    const result = validateEnv(vars, mockLogger);
    expect(result.OPTIONAL_VAR).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('OPTIONAL_VAR'));
  });

  it('does not log a warning when a default fills in the optional var', () => {
    delete process.env.OPTIONAL_VAR;

    const mockLogger = { warn: vi.fn() };

    const vars: EnvVar[] = [
      {
        name: 'OPTIONAL_VAR',
        default: 'filled',
        description: 'Has default',
      },
    ];

    validateEnv(vars, mockLogger);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('runs custom validation and passes on valid value', () => {
    process.env.PORT = '8080';

    const vars: EnvVar[] = [
      {
        name: 'PORT',
        validate: (v) => /^\d+$/.test(v),
        description: 'Must be numeric',
      },
    ];

    const result = validateEnv(vars);
    expect(result.PORT).toBe('8080');
  });

  it('throws when custom validation fails', () => {
    process.env.PORT = 'not-a-number';

    const vars: EnvVar[] = [
      {
        name: 'PORT',
        validate: (v) => /^\d+$/.test(v),
        description: 'Must be numeric',
      },
    ];

    try {
      validateEnv(vars);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const validationErr = err as EnvValidationError;
      expect(validationErr.message).toContain('PORT');
      expect(validationErr.message).toContain('not-a-number');
    }
  });

  it('validates default values through custom validation', () => {
    delete process.env.PORT;

    const vars: EnvVar[] = [
      {
        name: 'PORT',
        default: '8080',
        validate: (v) => /^\d+$/.test(v),
        description: 'Must be numeric',
      },
    ];

    const result = validateEnv(vars);
    expect(result.PORT).toBe('8080');
  });

  it('skips validation for missing optional vars without defaults', () => {
    delete process.env.OPTIONAL;

    const validateFn = vi.fn(() => true);

    const vars: EnvVar[] = [
      {
        name: 'OPTIONAL',
        validate: validateFn,
        description: 'Optional with validator',
      },
    ];

    validateEnv(vars);
    expect(validateFn).not.toHaveBeenCalled();
  });

  it('collects both missing-required and validation errors in one throw', () => {
    delete process.env.REQUIRED_VAR;
    process.env.BAD_PORT = 'abc';

    const vars: EnvVar[] = [
      { name: 'REQUIRED_VAR', required: true, description: 'Must be set' },
      {
        name: 'BAD_PORT',
        validate: (v) => /^\d+$/.test(v),
        description: 'Must be numeric',
      },
    ];

    try {
      validateEnv(vars);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const validationErr = err as EnvValidationError;
      expect(validationErr.message).toContain('REQUIRED_VAR');
      expect(validationErr.message).toContain('BAD_PORT');
      expect(validationErr.message).toContain('2 problems');
    }
  });

  it('returns all vars when everything is valid', () => {
    process.env.HOST = 'localhost';
    process.env.PORT = '3000';
    delete process.env.OPTIONAL;

    const vars: EnvVar[] = [
      { name: 'HOST', required: true, description: 'Host' },
      {
        name: 'PORT',
        default: '8080',
        validate: (v) => /^\d+$/.test(v),
        description: 'Port',
      },
      { name: 'OPTIONAL', description: 'Not required' },
    ];

    const result = validateEnv(vars);
    expect(result.HOST).toBe('localhost');
    expect(result.PORT).toBe('3000');
    expect(result.OPTIONAL).toBeUndefined();
  });

  it('includes actionable guidance in error messages', () => {
    delete process.env.REDIS_URL;

    const vars: EnvVar[] = [
      { name: 'REDIS_URL', required: true, description: 'Redis connection URL' },
    ];

    try {
      validateEnv(vars);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      const validationErr = err as EnvValidationError;
      expect(validationErr.message).toContain('.env');
      expect(validationErr.message).toContain('restart');
    }
  });
});

describe('isNumericString', () => {
  it('returns true for valid numeric strings', () => {
    expect(isNumericString('0')).toBe(true);
    expect(isNumericString('8080')).toBe(true);
    expect(isNumericString('65535')).toBe(true);
  });

  it('returns false for non-numeric strings', () => {
    expect(isNumericString('')).toBe(false);
    expect(isNumericString('abc')).toBe(false);
    expect(isNumericString('80.80')).toBe(false);
    expect(isNumericString('-1')).toBe(false);
    expect(isNumericString('8080abc')).toBe(false);
  });
});

describe('isValidLogLevel', () => {
  it('returns true for valid pino log levels', () => {
    expect(isValidLogLevel('fatal')).toBe(true);
    expect(isValidLogLevel('error')).toBe(true);
    expect(isValidLogLevel('warn')).toBe(true);
    expect(isValidLogLevel('info')).toBe(true);
    expect(isValidLogLevel('debug')).toBe(true);
    expect(isValidLogLevel('trace')).toBe(true);
    expect(isValidLogLevel('silent')).toBe(true);
  });

  it('returns false for invalid log levels', () => {
    expect(isValidLogLevel('')).toBe(false);
    expect(isValidLogLevel('verbose')).toBe(false);
    expect(isValidLogLevel('INFO')).toBe(false);
    expect(isValidLogLevel('warning')).toBe(false);
  });
});
