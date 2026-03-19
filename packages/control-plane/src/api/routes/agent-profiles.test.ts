import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentProfileStore } from '../../collaboration/agent-profile-store.js';
import { agentProfileRoutes } from './agent-profiles.js';

// ── Mock factories ─────────────────────────────────────────────────────────

const PROFILE_ID = '11111111-1111-4111-a111-111111111111';
const INSTANCE_ID = '22222222-2222-4222-a222-222222222222';
const NOW = new Date().toISOString();

function makeProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    name: 'Test Profile',
    runtimeType: 'claude-code',
    modelId: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    capabilities: ['code', 'bash'],
    toolScopes: ['read', 'write'],
    maxTokensPerTask: null,
    maxCostPerHour: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INSTANCE_ID,
    profileId: PROFILE_ID,
    machineId: 'machine-1',
    worktreeId: 'worktree-1',
    runtimeSessionId: null,
    status: 'idle',
    heartbeatAt: NOW,
    startedAt: NOW,
    ...overrides,
  };
}

// ── Mock AgentProfileStore ─────────────────────────────────────────────────

function createMockStore(): AgentProfileStore {
  return {
    listProfiles: vi.fn().mockResolvedValue([]),
    createProfile: vi.fn().mockResolvedValue(makeProfile()),
    getProfile: vi.fn().mockResolvedValue(makeProfile()),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    listInstancesByProfile: vi.fn().mockResolvedValue([]),
    createInstance: vi.fn().mockResolvedValue(makeInstance()),
    updateInstance: vi.fn().mockResolvedValue(makeInstance()),
    deleteInstance: vi.fn().mockResolvedValue(undefined),
    getInstance: vi.fn().mockResolvedValue(makeInstance()),
    countInstances: vi.fn().mockResolvedValue(0),
  } as unknown as AgentProfileStore;
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('agent-profiles routes', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    store = createMockStore();

    app = Fastify({ logger: false });
    await app.register(agentProfileRoutes, {
      prefix: '/api/agent-profiles',
      agentProfileStore: store,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /api/agent-profiles', () => {
    it('returns an empty array when no profiles exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/agent-profiles' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns all profiles', async () => {
      const profiles = [makeProfile(), makeProfile({ id: 'other-id', name: 'Other' })];
      vi.mocked(store.listProfiles).mockResolvedValueOnce(profiles as never);

      const res = await app.inject({ method: 'GET', url: '/api/agent-profiles' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });
  });

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /api/agent-profiles', () => {
    const validBody = {
      name: 'My Agent',
      runtimeType: 'claude-code',
      modelId: 'claude-sonnet-4-6',
      providerId: 'anthropic',
    };

    it('creates a profile and returns 201', async () => {
      const created = makeProfile({ name: 'My Agent' });
      vi.mocked(store.createProfile).mockResolvedValueOnce(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('My Agent');
      expect(res.json().runtimeType).toBe('claude-code');
    });

    it('passes optional fields to the store', async () => {
      const payload = {
        ...validBody,
        capabilities: ['bash'],
        toolScopes: ['read'],
        maxTokensPerTask: 50000,
        maxCostPerHour: 1.5,
      };
      const created = makeProfile({ ...payload });
      vi.mocked(store.createProfile).mockResolvedValueOnce(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload,
      });

      expect(res.statusCode).toBe(201);
      expect(store.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: ['bash'],
          toolScopes: ['read'],
          maxTokensPerTask: 50000,
          maxCostPerHour: 1.5,
        }),
      );
    });

    it('trims whitespace from name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, name: '  trimmed  ' },
      });

      expect(res.statusCode).toBe(201);
      expect(store.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'trimmed' }),
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('returns 400 when name is whitespace only', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, name: '   ' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('returns 400 when runtimeType is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, runtimeType: 'bad-runtime' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_RUNTIME_TYPE');
    });

    it('returns 400 when runtimeType is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, runtimeType: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_RUNTIME_TYPE');
    });

    it('returns 400 when modelId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, modelId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_MODEL_ID');
    });

    it('returns 400 when providerId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: { ...validBody, providerId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PROVIDER_ID');
    });

    it('accepts all valid runtimeType values', async () => {
      const runtimeTypes = ['claude-code', 'codex', 'openclaw', 'nanoclaw'];

      for (const runtimeType of runtimeTypes) {
        vi.mocked(store.createProfile).mockResolvedValueOnce(makeProfile({ runtimeType }) as never);

        const res = await app.inject({
          method: 'POST',
          url: '/api/agent-profiles',
          payload: { ...validBody, runtimeType },
        });

        expect(res.statusCode, `runtimeType "${runtimeType}" should be valid`).toBe(201);
      }
    });
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /api/agent-profiles/:id', () => {
    it('returns the profile when found', async () => {
      const profile = makeProfile();
      vi.mocked(store.getProfile).mockResolvedValueOnce(profile as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/agent-profiles/${PROFILE_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(PROFILE_ID);
    });

    it('returns 404 when profile does not exist', async () => {
      vi.mocked(store.getProfile).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/agent-profiles/${PROFILE_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PROFILE_NOT_FOUND');
    });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  describe('DELETE /api/agent-profiles/:id', () => {
    it('deletes the profile and returns { ok: true }', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/agent-profiles/${PROFILE_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it('returns 404 when profile does not exist', async () => {
      const { ControlPlaneError } = await import('@agentctl/shared');
      vi.mocked(store.deleteProfile).mockRejectedValueOnce(
        new ControlPlaneError('PROFILE_NOT_FOUND', 'Profile not found', { id: PROFILE_ID }),
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/agent-profiles/${PROFILE_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PROFILE_NOT_FOUND');
    });

    it('rethrows unexpected errors', async () => {
      vi.mocked(store.deleteProfile).mockRejectedValueOnce(new Error('unexpected DB failure'));

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/agent-profiles/${PROFILE_ID}`,
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /:id/instances ────────────────────────────────────────────────────

  describe('GET /api/agent-profiles/:id/instances', () => {
    it('returns instances for the profile', async () => {
      const instances = [makeInstance(), makeInstance({ id: 'inst-2' })];
      vi.mocked(store.getProfile).mockResolvedValueOnce(makeProfile() as never);
      vi.mocked(store.listInstancesByProfile).mockResolvedValueOnce(instances as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns 404 when profile does not exist', async () => {
      vi.mocked(store.getProfile).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PROFILE_NOT_FOUND');
    });

    it('returns empty array when profile has no instances', async () => {
      vi.mocked(store.getProfile).mockResolvedValueOnce(makeProfile() as never);
      vi.mocked(store.listInstancesByProfile).mockResolvedValueOnce([] as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── POST /:id/instances ───────────────────────────────────────────────────

  describe('POST /api/agent-profiles/:id/instances', () => {
    it('creates an instance with default status and returns 201', async () => {
      const instance = makeInstance();
      vi.mocked(store.getProfile).mockResolvedValueOnce(makeProfile() as never);
      vi.mocked(store.createInstance).mockResolvedValueOnce(instance as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
        payload: { machineId: 'machine-1' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().profileId).toBe(PROFILE_ID);
    });

    it('creates an instance with all optional fields', async () => {
      const instance = makeInstance({
        machineId: 'machine-2',
        worktreeId: 'worktree-2',
        runtimeSessionId: 'session-abc',
        status: 'running',
      });
      vi.mocked(store.getProfile).mockResolvedValueOnce(makeProfile() as never);
      vi.mocked(store.createInstance).mockResolvedValueOnce(instance as never);

      const payload = {
        machineId: 'machine-2',
        worktreeId: 'worktree-2',
        runtimeSessionId: 'session-abc',
        status: 'running',
      };

      const res = await app.inject({
        method: 'POST',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
        payload,
      });

      expect(res.statusCode).toBe(201);
      expect(store.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: PROFILE_ID,
          machineId: 'machine-2',
          worktreeId: 'worktree-2',
          runtimeSessionId: 'session-abc',
          status: 'running',
        }),
      );
    });

    it('returns 404 when profile does not exist', async () => {
      vi.mocked(store.getProfile).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PROFILE_NOT_FOUND');
    });

    it('returns 400 when status is invalid', async () => {
      vi.mocked(store.getProfile).mockResolvedValueOnce(makeProfile() as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/agent-profiles/${PROFILE_ID}/instances`,
        payload: { status: 'unknown-status' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_STATUS');
    });

    it('accepts all valid status values', async () => {
      const statuses = ['idle', 'running', 'paused', 'crashed'];

      for (const status of statuses) {
        vi.mocked(store.getProfile).mockResolvedValueOnce(makeProfile() as never);
        vi.mocked(store.createInstance).mockResolvedValueOnce(makeInstance({ status }) as never);

        const res = await app.inject({
          method: 'POST',
          url: `/api/agent-profiles/${PROFILE_ID}/instances`,
          payload: { status },
        });

        expect(res.statusCode, `status "${status}" should be valid`).toBe(201);
      }
    });
  });

  // ── PATCH /:id/instances/:instanceId ──────────────────────────────────────

  describe('PATCH /api/agent-profiles/:id/instances/:instanceId', () => {
    const patchUrl = `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`;

    it('updates the instance status and returns it', async () => {
      const updated = makeInstance({ status: 'running' });
      vi.mocked(store.updateInstance).mockResolvedValueOnce(updated as never);

      const res = await app.inject({
        method: 'PATCH',
        url: patchUrl,
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('running');
    });

    it('updates machineId, worktreeId, and runtimeSessionId', async () => {
      const updated = makeInstance({
        machineId: 'new-machine',
        worktreeId: 'new-worktree',
        runtimeSessionId: 'new-session',
      });
      vi.mocked(store.updateInstance).mockResolvedValueOnce(updated as never);

      const payload = {
        machineId: 'new-machine',
        worktreeId: 'new-worktree',
        runtimeSessionId: 'new-session',
      };

      const res = await app.inject({
        method: 'PATCH',
        url: patchUrl,
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(store.updateInstance).toHaveBeenCalledWith(INSTANCE_ID, payload);
    });

    it('returns 400 when status is invalid', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: patchUrl,
        payload: { status: 'invalid-status' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_STATUS');
    });

    it('returns 404 when instance does not exist', async () => {
      const { ControlPlaneError } = await import('@agentctl/shared');
      vi.mocked(store.updateInstance).mockRejectedValueOnce(
        new ControlPlaneError('INSTANCE_NOT_FOUND', 'Instance not found', { id: INSTANCE_ID }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: patchUrl,
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('INSTANCE_NOT_FOUND');
    });

    it('rethrows unexpected errors', async () => {
      vi.mocked(store.updateInstance).mockRejectedValueOnce(new Error('unexpected DB failure'));

      const res = await app.inject({
        method: 'PATCH',
        url: patchUrl,
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── DELETE /:id/instances/:instanceId ─────────────────────────────────────

  describe('DELETE /api/agent-profiles/:id/instances/:instanceId', () => {
    const deleteUrl = `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`;

    it('deletes the instance and returns { ok: true }', async () => {
      const res = await app.inject({ method: 'DELETE', url: deleteUrl });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(store.deleteInstance).toHaveBeenCalledWith(INSTANCE_ID);
    });

    it('returns 404 when instance does not exist', async () => {
      const { ControlPlaneError } = await import('@agentctl/shared');
      vi.mocked(store.deleteInstance).mockRejectedValueOnce(
        new ControlPlaneError('INSTANCE_NOT_FOUND', 'Instance not found', { id: INSTANCE_ID }),
      );

      const res = await app.inject({ method: 'DELETE', url: deleteUrl });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('INSTANCE_NOT_FOUND');
    });

    it('rethrows unexpected errors', async () => {
      vi.mocked(store.deleteInstance).mockRejectedValueOnce(new Error('unexpected DB failure'));

      const res = await app.inject({ method: 'DELETE', url: deleteUrl });

      expect(res.statusCode).toBe(500);
    });
  });
});
