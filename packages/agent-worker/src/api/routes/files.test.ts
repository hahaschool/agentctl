import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../test-helpers.js';
import { fileRoutes } from './files.js';

// ---------------------------------------------------------------------------
// Mock node:fs — we never hit the real filesystem
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  fstatSync: vi.fn(),
  constants: { O_RDONLY: 0, O_NOFOLLOW: 0x20000 },
}));

// We need os.homedir() to return a stable path for validatePath()
vi.mock('node:os', () => ({
  homedir: () => '/Users/testuser',
}));

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';

type RegisteredRoute = {
  method: string | string[];
  url: string;
  config?: {
    rateLimit?: {
      max?: number;
      timeWindow?: number;
    };
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Fastify app with just the file routes registered.
 * Includes a simple error handler that maps WorkerError codes to HTTP status.
 */
async function buildApp(): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });

  // Replicate the error handler from server.ts so WorkerErrors get proper HTTP codes
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof WorkerError) {
      let statusCode = 500;
      if (err.code.endsWith('_NOT_FOUND')) statusCode = 404;
      else if (err.code.startsWith('INVALID_')) statusCode = 400;
      return reply.status(statusCode).send({
        error: err.code,
        message: err.message,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
  });

  await app.register(fileRoutes, {
    prefix: '/api/files',
    logger: createSilentLogger(),
  });

  return app;
}

function captureRoute(
  routes: RegisteredRoute[],
  method: string,
  url: string,
): RegisteredRoute | undefined {
  return routes.find((route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const normalizedUrl = route.url === '/' ? route.url : route.url.replace(/\/$/, '');
    return methods.includes(method) && normalizedUrl === url;
  });
}

function makeStat(
  overrides: Partial<{
    isDirectory: boolean;
    isFile: boolean;
    size: number;
    mtime: Date;
  }> = {},
): ReturnType<typeof statSync> {
  return {
    isDirectory: () => overrides.isDirectory ?? false,
    isFile: () => overrides.isFile ?? true,
    size: overrides.size ?? 100,
    mtime: overrides.mtime ?? new Date('2026-03-06T12:00:00Z'),
  } as unknown as ReturnType<typeof statSync>;
}

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('File routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // GET /api/files — list directory
  // =========================================================================

  describe('GET /api/files (list directory)', () => {
    it('registers explicit rate-limit config on each file route', async () => {
      const routes: RegisteredRoute[] = [];
      const Fastify = await import('fastify');
      const routeApp = Fastify.default({ logger: false });
      routeApp.addHook('onRoute', (route) => {
        routes.push({
          method: route.method as string | string[],
          url: route.url,
          config: route.config as RegisteredRoute['config'],
        });
      });
      await routeApp.register(fileRoutes, {
        prefix: '/api/files',
        logger: createSilentLogger(),
      });

      try {
        expect(captureRoute(routes, 'GET', '/api/files')?.config?.rateLimit).toMatchObject({
          max: 60,
          timeWindow: 60_000,
        });
        expect(captureRoute(routes, 'GET', '/api/files/content')?.config?.rateLimit).toMatchObject({
          max: 60,
          timeWindow: 60_000,
        });
        expect(captureRoute(routes, 'PUT', '/api/files/content')?.config?.rateLimit).toMatchObject({
          max: 30,
          timeWindow: 60_000,
        });
      } finally {
        await routeApp.close();
      }
    });

    it('returns 429 when repeated directory listing requests exceed the configured limit', async () => {
      process.env.FILE_LIST_RATE_LIMIT_MAX = '1';
      process.env.FILE_LIST_RATE_LIMIT_WINDOW_MS = '60000';

      const dirPath = '/Users/testuser/project';

      await app.close();
      app = await buildApp();

      vi.mocked(statSync).mockImplementation((p) => {
        if (p === dirPath) return makeStat({ isDirectory: true });
        return makeStat({ isFile: true, size: 128 });
      });
      vi.mocked(readdirSync).mockReturnValue([makeDirent('src', true)] as unknown as ReturnType<
        typeof readdirSync
      >);

      try {
        const first = await app.inject({
          method: 'GET',
          url: '/api/files?path=/Users/testuser/project',
        });
        const second = await app.inject({
          method: 'GET',
          url: '/api/files?path=/Users/testuser/project',
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(429);
        expect(second.json()).toEqual({
          error: 'Too many directory listing requests. Try again later.',
          code: 'RATE_LIMITED',
        });
      } finally {
        delete process.env.FILE_LIST_RATE_LIMIT_MAX;
        delete process.env.FILE_LIST_RATE_LIMIT_WINDOW_MS;
      }
    });

    it('returns directory entries sorted dirs-first then alphabetically', async () => {
      const dirPath = '/Users/testuser/project';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((p) => {
        if (p === dirPath) return makeStat({ isDirectory: true });
        // child stats
        const name = String(p).split('/').pop();
        if (name === 'src') return makeStat({ isDirectory: true, size: 4096 });
        return makeStat({ isFile: true, size: 256 });
      });
      vi.mocked(readdirSync).mockReturnValue([
        makeDirent('README.md', false),
        makeDirent('src', true),
        makeDirent('package.json', false),
      ] as unknown as ReturnType<typeof readdirSync>);

      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/Users/testuser/project',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.path).toBe(dirPath);
      expect(body.entries).toHaveLength(3);
      // directories first
      expect(body.entries[0].name).toBe('src');
      expect(body.entries[0].type).toBe('directory');
      // then files alphabetically
      expect(body.entries[1].name).toBe('package.json');
      expect(body.entries[2].name).toBe('README.md');
    });

    it('filters out denied segments (.ssh, .env, etc.) from child entries', async () => {
      const dirPath = '/Users/testuser/home';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((p) => {
        if (p === dirPath) return makeStat({ isDirectory: true });
        return makeStat({ isFile: true, size: 50 });
      });
      vi.mocked(readdirSync).mockReturnValue([
        makeDirent('.ssh', true),
        makeDirent('.env', false),
        makeDirent('code', true),
      ] as unknown as ReturnType<typeof readdirSync>);

      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/Users/testuser/home',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // .ssh and .env should be filtered out
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].name).toBe('code');
    });

    it('returns 400 when path is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PATH');
    });

    it('returns 400 when path contains denied segment', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/Users/testuser/.ssh/keys',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PATH');
      expect(body.message).toContain('.ssh');
    });

    it('returns 400 when path is outside allowed directories', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/etc/passwd',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PATH');
      expect(body.message).toContain('outside allowed');
    });

    it('returns 404 when directory does not exist (ENOENT)', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      vi.mocked(statSync).mockImplementation(() => {
        throw err;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/Users/testuser/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('PATH_NOT_FOUND');
    });

    it('returns 400 when path is not a directory', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue(makeStat({ isDirectory: false }));

      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/Users/testuser/somefile.txt',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PATH');
      expect(body.message).toContain('not a directory');
    });

    it('gracefully handles child stat failures', async () => {
      const dirPath = '/Users/testuser/project';
      let callCount = 0;
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockImplementation((p) => {
        if (p === dirPath) return makeStat({ isDirectory: true });
        callCount++;
        if (callCount === 1) throw new Error('permission denied');
        return makeStat({ isFile: true, size: 50 });
      });
      vi.mocked(readdirSync).mockReturnValue([
        makeDirent('locked.txt', false),
        makeDirent('ok.txt', false),
      ] as unknown as ReturnType<typeof readdirSync>);

      const res = await app.inject({
        method: 'GET',
        url: '/api/files?path=/Users/testuser/project',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries).toHaveLength(2);
      // First entry had stat failure, so no size/modified
      expect(body.entries[0].size).toBeUndefined();
      // Second entry has stats
      expect(body.entries[1].size).toBe(50);
    });
  });

  // =========================================================================
  // GET /api/files/content — read file
  // =========================================================================

  describe('GET /api/files/content (read file)', () => {
    it('returns 429 when repeated file reads exceed the configured limit', async () => {
      process.env.FILE_CONTENT_RATE_LIMIT_MAX = '1';
      process.env.FILE_CONTENT_RATE_LIMIT_WINDOW_MS = '60000';

      const filePath = '/Users/testuser/project/index.ts';
      const fileContent = 'console.log("hello");';
      const fd = 42;

      await app.close();
      app = await buildApp();

      vi.mocked(openSync).mockReturnValue(fd);
      vi.mocked(statSync).mockReturnValue(makeStat({ isFile: true, size: fileContent.length }));
      vi.mocked(readSync).mockImplementation((_fd, buf: Buffer) => {
        buf.write(fileContent);
        return fileContent.length;
      });

      try {
        const first = await app.inject({
          method: 'GET',
          url: `/api/files/content?path=${encodeURIComponent(filePath)}`,
        });
        const second = await app.inject({
          method: 'GET',
          url: `/api/files/content?path=${encodeURIComponent(filePath)}`,
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(429);
        expect(second.json()).toEqual({
          error: 'Too many file content requests. Try again later.',
          code: 'RATE_LIMITED',
        });
      } finally {
        delete process.env.FILE_CONTENT_RATE_LIMIT_MAX;
        delete process.env.FILE_CONTENT_RATE_LIMIT_WINDOW_MS;
      }
    });

    it('returns file content with path and size', async () => {
      const filePath = '/Users/testuser/project/index.ts';
      const fileContent = 'console.log("hello");';
      const fd = 42;
      vi.mocked(openSync).mockReturnValue(fd);
      vi.mocked(statSync).mockReturnValue(makeStat({ isFile: true, size: fileContent.length }));
      vi.mocked(readSync).mockImplementation((_fd, buf: Buffer) => {
        buf.write(fileContent);
        return fileContent.length;
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/files/content?path=${encodeURIComponent(filePath)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.content).toBe(fileContent);
      expect(body.path).toBe(filePath);
      expect(body.size).toBe(fileContent.length);
      expect(closeSync).toHaveBeenCalledWith(fd);
    });

    it('returns 400 when path is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files/content',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
    });

    it('returns 404 when file does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      vi.mocked(openSync).mockImplementation(() => {
        throw err;
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/files/content?path=/Users/testuser/missing.txt',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PATH_NOT_FOUND');
    });

    it('returns 400 when path is a directory', async () => {
      const fd = 10;
      vi.mocked(openSync).mockReturnValue(fd);
      vi.mocked(statSync).mockReturnValue(makeStat({ isDirectory: true }));

      const res = await app.inject({
        method: 'GET',
        url: '/api/files/content?path=/Users/testuser/project',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PATH');
      expect(body.message).toContain('directory');
      expect(closeSync).toHaveBeenCalledWith(fd);
    });

    it('returns 400 when file exceeds maximum size', async () => {
      const fd = 11;
      vi.mocked(openSync).mockReturnValue(fd);
      vi.mocked(statSync).mockReturnValue(makeStat({ isFile: true, size: 2_000_000 }));

      const res = await app.inject({
        method: 'GET',
        url: '/api/files/content?path=/Users/testuser/huge.bin',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('INVALID_PATH');
      expect(body.message).toContain('maximum size');
      expect(closeSync).toHaveBeenCalledWith(fd);
    });

    it('returns 400 for denied path segments', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/files/content?path=/Users/testuser/.gnupg/key.gpg',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
      expect(res.json().message).toContain('.gnupg');
      expect(openSync).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PUT /api/files/content — write file
  // =========================================================================

  describe('PUT /api/files/content (write file)', () => {
    it('returns 429 when repeated file writes exceed the configured limit', async () => {
      process.env.FILE_WRITE_RATE_LIMIT_MAX = '1';
      process.env.FILE_WRITE_RATE_LIMIT_WINDOW_MS = '60000';

      const filePath = '/Users/testuser/project/output.txt';

      await app.close();
      app = await buildApp();

      try {
        const first = await app.inject({
          method: 'PUT',
          url: '/api/files/content',
          payload: { path: filePath, content: 'first write' },
        });
        const second = await app.inject({
          method: 'PUT',
          url: '/api/files/content',
          payload: { path: filePath, content: 'second write' },
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(429);
        expect(second.json()).toEqual({
          error: 'Too many file write requests. Try again later.',
          code: 'RATE_LIMITED',
        });
      } finally {
        delete process.env.FILE_WRITE_RATE_LIMIT_MAX;
        delete process.env.FILE_WRITE_RATE_LIMIT_WINDOW_MS;
      }
    });

    it('writes file content and returns success', async () => {
      const filePath = '/Users/testuser/project/output.txt';
      vi.mocked(existsSync).mockReturnValue(true);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: filePath, content: 'new content here' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.path).toBe(filePath);
      expect(writeFileSync).toHaveBeenCalledWith(filePath, 'new content here', 'utf-8');
    });

    it('creates parent directories when they do not exist', async () => {
      const filePath = '/Users/testuser/project/deep/nested/file.txt';
      // existsSync: first call for parent dir check returns false
      vi.mocked(existsSync).mockReturnValue(false);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: filePath, content: 'data' },
      });

      expect(res.statusCode).toBe(200);
      expect(mkdirSync).toHaveBeenCalledWith('/Users/testuser/project/deep/nested', {
        recursive: true,
      });
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('returns 400 when path is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { content: 'data' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
    });

    it('returns 400 when content field is missing', async () => {
      const filePath = '/Users/testuser/project/file.txt';
      vi.mocked(existsSync).mockReturnValue(true);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: filePath },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
      expect(res.json().message).toContain('content');
    });

    it('returns 400 for denied path segments in write path', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: '/Users/testuser/.aws/credentials', content: 'secret' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
      expect(res.json().message).toContain('.aws');
    });

    it('returns 400 when the write path is outside allowed directories', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: '/etc/passwd', content: 'root:x:0:0' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
      expect(res.json().message).toContain('outside allowed');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('allows writing empty content', async () => {
      const filePath = '/Users/testuser/project/empty.txt';
      vi.mocked(existsSync).mockReturnValue(true);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: filePath, content: '' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(writeFileSync).toHaveBeenCalledWith(filePath, '', 'utf-8');
    });

    it('accepts paths under /tmp', async () => {
      const filePath = '/tmp/agentctl-test/output.txt';
      vi.mocked(existsSync).mockReturnValue(true);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/files/content',
        payload: { path: filePath, content: 'temp data' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });
});
