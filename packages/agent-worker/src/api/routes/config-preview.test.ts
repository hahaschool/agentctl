import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMockLogger } from '../../test-helpers.js';
import { configPreviewRoutes } from './config-preview.js';

function buildManagedConfig() {
  return {
    version: 1,
    hash: 'preview',
    instructions: {
      userGlobal: 'Use managed defaults',
      projectTemplate: 'Follow repository conventions',
    },
    mcpServers: [],
    skills: [],
    sandbox: 'workspace-write',
    approvalPolicy: 'on-failure',
    environmentPolicy: {
      inherit: ['HOME', 'PATH', 'SHELL'],
      set: {},
    },
    runtimeOverrides: {
      claudeCode: {},
      codex: {},
    },
  };
}

describe('GET /api/config/preview', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(configPreviewRoutes, {
      prefix: '/api/config',
      logger: createMockLogger(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reads project CLAUDE.md and marks it as project for project strategy', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'agentctl-config-preview-'));
    writeFileSync(path.join(projectPath, 'CLAUDE.md'), '# Project CLAUDE instructions\n', 'utf-8');

    try {
      const qs = new URLSearchParams({
        runtime: 'claude-code',
        instructionsStrategy: 'project',
        projectPath,
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/config/preview?${qs.toString()}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        files: Array<{ path: string; status: string; content: string }>;
      };
      const claudeMd = body.files.find((file) => file.path === 'CLAUDE.md');

      expect(claudeMd).toEqual({
        path: 'CLAUDE.md',
        scope: 'workspace',
        content: '# Project CLAUDE instructions\n',
        status: 'project',
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('returns a placeholder CLAUDE.md entry when the project file is missing', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'agentctl-config-preview-missing-'));

    try {
      const qs = new URLSearchParams({
        runtime: 'claude-code',
        instructionsStrategy: 'project',
        projectPath,
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/config/preview?${qs.toString()}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        files: Array<{ path: string; status: string; content: string }>;
      };
      const claudeMd = body.files.find((file) => file.path === 'CLAUDE.md');

      expect(claudeMd).toEqual({
        path: 'CLAUDE.md',
        scope: 'workspace',
        content: '(No CLAUDE.md found in project directory)',
        status: 'project',
      });
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('marks merged workspace CLAUDE.md as merged for merge strategy', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'agentctl-config-preview-merge-'));
    writeFileSync(
      path.join(projectPath, 'CLAUDE.md'),
      '# Existing project instructions\n',
      'utf-8',
    );

    try {
      const qs = new URLSearchParams({
        runtime: 'claude-code',
        instructionsStrategy: 'merge',
        projectPath,
        configJson: JSON.stringify(buildManagedConfig()),
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/config/preview?${qs.toString()}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        files: Array<{ path: string; status: string; content: string }>;
      };
      const claudeMd = body.files.find((file) => file.path === 'CLAUDE.md');

      expect(claudeMd?.status).toBe('merged');
      expect(claudeMd?.content).toContain('# Existing project instructions');
      expect(claudeMd?.content).toContain('<!-- agentctl:managed-instructions:start -->');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
