import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock external dependencies so barrel imports don't trigger real connections
// ---------------------------------------------------------------------------

vi.mock('pg', () => {
  const Pool = vi.fn(() => ({
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  }));
  return { default: { Pool }, Pool };
});

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    query: {},
  })),
}));

// ---------------------------------------------------------------------------
// db barrel (packages/control-plane/src/db/index.ts)
// ---------------------------------------------------------------------------

describe('db barrel exports', () => {
  it('re-exports createDb', async () => {
    const dbIndex = await import('./index.js');
    expect(dbIndex.createDb).toBeDefined();
    expect(typeof dbIndex.createDb).toBe('function');
  });

  it('re-exports schema tables', async () => {
    const dbIndex = await import('./index.js');

    // Schema tables defined in schema.ts
    expect(dbIndex.machines).toBeDefined();
    expect(dbIndex.agents).toBeDefined();
    expect(dbIndex.agentRuns).toBeDefined();
    expect(dbIndex.agentActions).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// registry barrel (packages/control-plane/src/registry/index.ts)
// ---------------------------------------------------------------------------

describe('registry barrel exports', () => {
  it('re-exports AgentRegistry class', async () => {
    const registryIndex = await import('../registry/index.js');
    expect(registryIndex.AgentRegistry).toBeDefined();
    expect(typeof registryIndex.AgentRegistry).toBe('function');
  });

  it('re-exports DbAgentRegistry class', async () => {
    const registryIndex = await import('../registry/index.js');
    expect(registryIndex.DbAgentRegistry).toBeDefined();
    expect(typeof registryIndex.DbAgentRegistry).toBe('function');
  });

  it('AgentRegistry is instantiable', async () => {
    const { AgentRegistry } = await import('../registry/index.js');
    const instance = new AgentRegistry();
    expect(instance).toBeInstanceOf(AgentRegistry);
  });
});

// ---------------------------------------------------------------------------
// memory barrel (packages/control-plane/src/memory/index.ts)
// ---------------------------------------------------------------------------

describe('memory barrel exports', () => {
  it('re-exports Mem0Client class', async () => {
    const memoryIndex = await import('../memory/index.js');
    expect(memoryIndex.Mem0Client).toBeDefined();
    expect(typeof memoryIndex.Mem0Client).toBe('function');
  });

  it('re-exports MemoryInjector class', async () => {
    const memoryIndex = await import('../memory/index.js');
    expect(memoryIndex.MemoryInjector).toBeDefined();
    expect(typeof memoryIndex.MemoryInjector).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// router barrel (packages/control-plane/src/router/index.ts)
// ---------------------------------------------------------------------------

describe('router barrel exports', () => {
  it('re-exports LiteLLMClient class', async () => {
    const routerIndex = await import('../router/index.js');
    expect(routerIndex.LiteLLMClient).toBeDefined();
    expect(typeof routerIndex.LiteLLMClient).toBe('function');
  });

  it('re-exports RouterConfig class', async () => {
    const routerIndex = await import('../router/index.js');
    expect(routerIndex.RouterConfig).toBeDefined();
    expect(typeof routerIndex.RouterConfig).toBe('function');
  });
});
