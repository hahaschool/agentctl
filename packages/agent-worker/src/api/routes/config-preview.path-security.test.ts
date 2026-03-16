import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../../test-helpers.js';

describe('GET /api/config/preview path security', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../utils/path-security.js');
  });

  it('uses shared path-security helpers to read project instructions', async () => {
    const safeExistsSync = vi.fn(() => '/safe/project/CLAUDE.md');
    const safeReadFile = vi.fn(async () => '# Project CLAUDE instructions\n');

    vi.doMock('../../utils/path-security.js', async () => {
      const actual = await vi.importActual<typeof import('../../utils/path-security.js')>(
        '../../utils/path-security.js',
      );

      return {
        ...actual,
        safeExistsSync,
        safeReadFile,
      };
    });

    const { configPreviewRoutes } = await import('./config-preview.js');
    const app = Fastify({ logger: false });
    await app.register(configPreviewRoutes, {
      prefix: '/api/config',
      logger: createMockLogger(),
    });
    await app.ready();

    try {
      const qs = new URLSearchParams({
        runtime: 'claude-code',
        instructionsStrategy: 'project',
        projectPath: '/unsafe/project',
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
      expect(safeExistsSync).toHaveBeenCalledWith('/unsafe/project/CLAUDE.md', '/unsafe/project');
      expect(safeReadFile).toHaveBeenCalledWith('/safe/project/CLAUDE.md', '/unsafe/project');
    } finally {
      await app.close();
    }
  });
});
