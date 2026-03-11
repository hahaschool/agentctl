/**
 * Shared test helpers for control-plane route tests.
 *
 * Eliminates duplicated mock factories that were copy-pasted across
 * files.test.ts, git.test.ts, terminal.test.ts, sessions.test.ts, and others.
 */
import type { Logger } from 'pino';
import { vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

/** Create a silent pino-compatible logger mock for tests. */
export function createMockLogger(): Logger {
  const logger = {
    child: () => logger,
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  } as unknown as Logger;
  return logger;
}

// ---------------------------------------------------------------------------
// Machine factory
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

export function makeMachine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'machine-1',
    hostname: 'test-host',
    tailscaleIp: '100.64.0.1',
    os: 'linux',
    arch: 'x64',
    status: 'online',
    lastHeartbeat: NOW,
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DbAgentRegistry mock
// ---------------------------------------------------------------------------

export function createMockDbRegistry(overrides: Partial<DbAgentRegistry> = {}): DbAgentRegistry {
  return {
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

// ---------------------------------------------------------------------------
// Full DbAgentRegistry mock (for createServer-based tests)
// ---------------------------------------------------------------------------

/**
 * Full mock of DbAgentRegistry with all methods stubbed.
 * Use this for tests that call createServer() and need all registry methods.
 * For proxy-only tests that only need getMachine, use createMockDbRegistry.
 */
export function createFullMockDbRegistry(
  overrides: Partial<DbAgentRegistry> = {},
): DbAgentRegistry {
  return {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    findOnlineMachine: vi.fn().mockResolvedValue(null),
    getMachine: vi.fn(),
    createAgent: vi.fn().mockResolvedValue('agent-new'),
    getAgent: vi.fn().mockResolvedValue(undefined),
    updateAgentStatus: vi.fn(),
    updateAgent: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    listAgentsPaginated: vi.fn().mockResolvedValue({ agents: [], total: 0 }),
    createRun: vi.fn().mockResolvedValue('run-001'),
    completeRun: vi.fn(),
    getRun: vi.fn().mockResolvedValue(undefined),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    insertActions: vi.fn().mockResolvedValue(3),
    queryActions: vi.fn().mockResolvedValue({ actions: [], total: 0, hasMore: false }),
    getAuditSummary: vi.fn().mockResolvedValue({
      totalActions: 0,
      topTools: [],
      topAgents: [],
      errorCount: 0,
    }),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

// ---------------------------------------------------------------------------
// Fetch mocks
// ---------------------------------------------------------------------------

export function mockFetchOk(body: Record<string, unknown> = {}): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

export function mockFetchError(status = 500): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: 'WORKER_ERROR', message: 'Something went wrong' }),
    statusText: 'Internal Server Error',
  });
}

export function mockFetchThrow(message = 'Connection refused'): void {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// Fetch save/restore
// ---------------------------------------------------------------------------

/** Save the original global fetch — call in beforeAll. */
export function saveOriginalFetch(): typeof globalThis.fetch {
  return globalThis.fetch;
}

/** Restore original fetch — call in afterAll/afterEach. */
export function restoreFetch(original: typeof globalThis.fetch): void {
  globalThis.fetch = original;
}
