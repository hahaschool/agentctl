import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';

const CLAUDE_MEM_DB_PATH = join(homedir(), '.claude-mem', 'claude-mem.db');

// Per-route rate limit config (stricter than the global limit for memory queries)
const CLAUDE_MEM_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
    },
  },
};

function openDb(): Database.Database | null {
  if (!existsSync(CLAUDE_MEM_DB_PATH)) return null;
  return new Database(CLAUDE_MEM_DB_PATH, { readonly: true });
}

export const claudeMemRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // Search observations by text query
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: { q?: string; project?: string; type?: string; limit?: string };
  }>(
    '/search',
    {
      schema: { tags: ['memory'], summary: 'Search claude-mem observations' },
      ...CLAUDE_MEM_RATE_LIMIT,
    },
    async (request, reply) => {
      const { q, project, type, limit } = request.query;
      if (!q) {
        return reply
          .code(400)
          .send({ error: 'MISSING_QUERY', message: 'Missing required query parameter: q' });
      }

      const db = openDb();
      if (!db) {
        return reply
          .code(503)
          .send({ error: 'MEMORY_UNAVAILABLE', message: 'claude-mem database not found' });
      }

      try {
        const maxResults = Math.min(Number(limit) || 20, 100);
        const conditions: string[] = ['(title LIKE ? OR facts LIKE ? OR narrative LIKE ?)'];
        const pattern = `%${q}%`;
        const params: unknown[] = [pattern, pattern, pattern];

        if (project) {
          conditions.push('project LIKE ?');
          params.push(`%${project}%`);
        }
        if (type) {
          conditions.push('type = ?');
          params.push(type);
        }

        const sql = `SELECT id, type, title, subtitle, facts, files_modified, created_at
                     FROM observations
                     WHERE ${conditions.join(' AND ')}
                     ORDER BY created_at_epoch DESC
                     LIMIT ?`;
        params.push(maxResults);

        const rows = db.prepare(sql).all(...params);
        return { observations: rows };
      } finally {
        db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Get single observation by ID
  // ---------------------------------------------------------------------------

  app.get<{
    Params: { id: string };
  }>(
    '/observations/:id',
    { schema: { tags: ['memory'], summary: 'Get observation by ID' }, ...CLAUDE_MEM_RATE_LIMIT },
    async (request, reply) => {
      const { id } = request.params;
      const db = openDb();
      if (!db) {
        return reply
          .code(503)
          .send({ error: 'MEMORY_UNAVAILABLE', message: 'claude-mem database not found' });
      }

      try {
        const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(Number(id));
        if (!row) {
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Observation not found' });
        }
        return { observation: row };
      } finally {
        db.close();
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Timeline: observations for a session
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: { sessionId?: string; limit?: string };
  }>(
    '/timeline',
    {
      schema: { tags: ['memory'], summary: 'Get observation timeline for a session' },
      ...CLAUDE_MEM_RATE_LIMIT,
    },
    async (request, reply) => {
      const { sessionId, limit } = request.query;
      if (!sessionId) {
        return reply.code(400).send({
          error: 'MISSING_SESSION_ID',
          message: 'Missing required query parameter: sessionId',
        });
      }

      const db = openDb();
      if (!db) {
        return reply
          .code(503)
          .send({ error: 'MEMORY_UNAVAILABLE', message: 'claude-mem database not found' });
      }

      try {
        const maxResults = Math.min(Number(limit) || 50, 200);

        // Try to find observations linked to this session via sdk_sessions table.
        // Fall back to empty if table doesn't exist (claude-mem schema varies).
        let rows: unknown[] = [];
        try {
          rows = db
            .prepare(
              `SELECT o.id, o.type, o.title, o.facts, o.files_modified, o.created_at
               FROM observations o
               JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
               WHERE s.content_session_id = ?
               ORDER BY o.created_at_epoch ASC
               LIMIT ?`,
            )
            .all(sessionId, maxResults);
        } catch {
          // sdk_sessions table may not exist in all versions
          rows = [];
        }
        return { observations: rows };
      } finally {
        db.close();
      }
    },
  );
};
