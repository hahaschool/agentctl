/**
 * Shared test helpers for agent-worker tests.
 *
 * Eliminates duplicated mock logger factories across hook, runtime, and IPC tests.
 */
import type { Logger } from 'pino';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

/** Create a silent pino-compatible logger mock with vi.fn() spies. */
export function createMockLogger(): Logger {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  } as unknown as Logger;
  return logger;
}
