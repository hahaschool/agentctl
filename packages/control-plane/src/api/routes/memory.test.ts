import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Mem0Client } from '../../memory/mem0-client.js';
import { createServer } from '../server.js';

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

const SAMPLE_MEMORY = {
  id: 'mem-001',
  memory: 'User prefers TypeScript over JavaScript',
  userId: 'user-1',
  agentId: 'agent-1',
  metadata: { source: 'conversation' },
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
};

function createMockMem0Client(overrides: Partial<Mem0Client> = {}): Mem0Client {
  return {
    health: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue({ results: [SAMPLE_MEMORY] }),
    add: vi.fn().mockResolvedValue({ results: [SAMPLE_MEMORY] }),
    getAll: vi.fn().mockResolvedValue({ results: [SAMPLE_MEMORY] }),
    get: vi.fn().mockResolvedValue(SAMPLE_MEMORY),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Mem0Client;
}

describe('Memory routes — /api/memory', () => {
  let app: FastifyInstance;
  let mockClient: Mem0Client;

  beforeAll(async () => {
    mockClient = createMockMem0Client();
    app = await createServer({ logger, mem0Client: mockClient });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /api/memory/search
  // -------------------------------------------------------------------------

  describe('POST /api/memory/search', () => {
    it('returns search results for a valid query', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {
          query: 'TypeScript preferences',
          agentId: 'agent-1',
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.results).toBeDefined();
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBe(1);
      expect(body.results[0].id).toBe('mem-001');
      expect(mockClient.search).toHaveBeenCalledWith({
        query: 'TypeScript preferences',
        agentId: 'agent-1',
        limit: 10,
      });
    });

    it('returns 400 when query is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toContain('query');
    });

    it('returns 400 when query is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: { query: '' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toContain('query');
    });

    it('returns 400 when query is not a string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: { query: 42 },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toContain('query');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/memory/add
  // -------------------------------------------------------------------------

  describe('POST /api/memory/add', () => {
    it('adds a memory and returns results', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/add',
        payload: {
          messages: [
            { role: 'user', content: 'I prefer TypeScript' },
            { role: 'assistant', content: 'Noted, I will use TypeScript.' },
          ],
          agentId: 'agent-1',
          metadata: { source: 'test' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.results).toBeDefined();
      expect(Array.isArray(body.results)).toBe(true);
      expect(mockClient.add).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: 'I prefer TypeScript' },
          { role: 'assistant', content: 'Noted, I will use TypeScript.' },
        ],
        agentId: 'agent-1',
        metadata: { source: 'test' },
      });
    });

    it('returns 400 when messages is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/add',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toContain('messages');
    });

    it('returns 400 when messages is an empty array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/add',
        payload: { messages: [] },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toContain('messages');
    });

    it('returns 400 when messages is not an array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/add',
        payload: { messages: 'not-an-array' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toContain('messages');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/memory/
  // -------------------------------------------------------------------------

  describe('GET /api/memory/', () => {
    it('returns all memories', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/memory/',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.results).toBeDefined();
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBe(1);
      expect(body.results[0].memory).toBe('User prefers TypeScript over JavaScript');
      expect(mockClient.getAll).toHaveBeenCalled();
    });

    it('passes userId and agentId query params to client', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/memory/?userId=user-1&agentId=agent-1',
      });

      expect(response.statusCode).toBe(200);
      expect(mockClient.getAll).toHaveBeenCalledWith('user-1', 'agent-1');
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/memory/:id
  // -------------------------------------------------------------------------

  describe('DELETE /api/memory/:id', () => {
    it('deletes a memory by ID and returns ok', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/memory/mem-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.memoryId).toBe('mem-001');
      expect(mockClient.delete).toHaveBeenCalledWith('mem-001');
    });

    it('calls delete with the correct URL-encoded ID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/memory/mem%2F002',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.memoryId).toBe('mem/002');
      expect(mockClient.delete).toHaveBeenCalledWith('mem/002');
    });
  });
});
