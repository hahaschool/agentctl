import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentProfileRoutes } from './agent-profiles.js';

const PROFILE_ID = 'profile-1';
const INSTANCE_ID = 'instance-1';

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    name: 'Ops Agent',
    runtimeType: 'claude-code',
    modelId: 'claude-3-7-sonnet',
    providerId: 'anthropic',
    capabilities: ['review'],
    toolScopes: ['repo:read'],
    maxTokensPerTask: 4096,
    maxCostPerHour: 2.5,
    createdAt: '2026-03-19T04:00:00.000Z',
    ...overrides,
  };
}

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    profileId: PROFILE_ID,
    machineId: 'machine-1',
    worktreeId: 'wt-1',
    runtimeSessionId: 'session-1',
    status: 'idle',
    heartbeatAt: '2026-03-19T04:01:00.000Z',
    startedAt: '2026-03-19T04:00:00.000Z',
    ...overrides,
  };
}

function createStoreMock() {
  return {
    listProfiles: vi.fn(),
    createProfile: vi.fn(),
    getProfile: vi.fn(),
    deleteProfile: vi.fn(),
    listInstancesByProfile: vi.fn(),
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
  };
}

async function buildApp(
  store: ReturnType<typeof createStoreMock>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(agentProfileRoutes, {
    prefix: '/api/agent-profiles',
    agentProfileStore: store as never,
  });
  await app.ready();
  return app;
}

describe('agentProfileRoutes', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof createStoreMock>;

  beforeEach(async () => {
    store = createStoreMock();
    app = await buildApp(store);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET / returns profiles', async () => {
    store.listProfiles.mockResolvedValue([makeProfile()]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/agent-profiles',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([makeProfile()]);
    expect(store.listProfiles).toHaveBeenCalledTimes(1);
  });

  it('POST / creates a profile with trimmed name and null numeric defaults', async () => {
    store.createProfile.mockResolvedValue(makeProfile({ name: 'Platform Agent' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-profiles',
      payload: {
        name: '  Platform Agent  ',
        runtimeType: 'codex',
        modelId: 'gpt-5.4',
        providerId: 'openai',
        capabilities: ['edit'],
        toolScopes: ['repo:write'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(store.createProfile).toHaveBeenCalledWith({
      name: 'Platform Agent',
      runtimeType: 'codex',
      modelId: 'gpt-5.4',
      providerId: 'openai',
      capabilities: ['edit'],
      toolScopes: ['repo:write'],
      maxTokensPerTask: null,
      maxCostPerHour: null,
    });
    expect(response.json()).toEqual(makeProfile({ name: 'Platform Agent' }));
  });

  it('POST / returns 400 for invalid profile payloads', async () => {
    const cases = [
      {
        payload: {
          name: '',
          runtimeType: 'claude-code',
          modelId: 'model',
          providerId: 'provider',
        },
        error: 'INVALID_NAME',
      },
      {
        payload: {
          name: 'Valid',
          runtimeType: 'invalid-runtime',
          modelId: 'model',
          providerId: 'provider',
        },
        error: 'INVALID_RUNTIME_TYPE',
      },
      {
        payload: {
          name: 'Valid',
          runtimeType: 'claude-code',
          modelId: '',
          providerId: 'provider',
        },
        error: 'INVALID_MODEL_ID',
      },
      {
        payload: {
          name: 'Valid',
          runtimeType: 'claude-code',
          modelId: 'model',
          providerId: '',
        },
        error: 'INVALID_PROVIDER_ID',
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agent-profiles',
        payload: testCase.payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: testCase.error });
    }

    expect(store.createProfile).not.toHaveBeenCalled();
  });

  it('GET /:id returns 404 when the profile is missing', async () => {
    store.getProfile.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'GET',
      url: `/api/agent-profiles/${PROFILE_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'PROFILE_NOT_FOUND' });
  });

  it('GET /:id returns a profile when it exists', async () => {
    store.getProfile.mockResolvedValue(makeProfile({ name: 'Review Agent' }));

    const response = await app.inject({
      method: 'GET',
      url: `/api/agent-profiles/${PROFILE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(makeProfile({ name: 'Review Agent' }));
  });

  it('DELETE /:id deletes an existing profile', async () => {
    store.deleteProfile.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agent-profiles/${PROFILE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(store.deleteProfile).toHaveBeenCalledWith(PROFILE_ID);
  });

  it('DELETE /:id maps PROFILE_NOT_FOUND errors to 404', async () => {
    store.deleteProfile.mockRejectedValue(
      new ControlPlaneError('PROFILE_NOT_FOUND', `Agent profile '${PROFILE_ID}' not found`),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agent-profiles/${PROFILE_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'PROFILE_NOT_FOUND' });
  });

  it('GET /:id/instances lists instances for an existing profile', async () => {
    store.getProfile.mockResolvedValue(makeProfile());
    store.listInstancesByProfile.mockResolvedValue([makeInstance()]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/agent-profiles/${PROFILE_ID}/instances`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([makeInstance()]);
    expect(store.listInstancesByProfile).toHaveBeenCalledWith(PROFILE_ID);
  });

  it('GET /:id/instances returns 404 when the profile is missing', async () => {
    store.getProfile.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'GET',
      url: `/api/agent-profiles/${PROFILE_ID}/instances`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'PROFILE_NOT_FOUND' });
  });

  it('POST /:id/instances creates an instance for an existing profile', async () => {
    store.getProfile.mockResolvedValue(makeProfile());
    store.createInstance.mockResolvedValue(makeInstance({ status: 'running' }));

    const response = await app.inject({
      method: 'POST',
      url: `/api/agent-profiles/${PROFILE_ID}/instances`,
      payload: {
        machineId: 'machine-2',
        worktreeId: 'wt-2',
        runtimeSessionId: 'session-2',
        status: 'running',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(store.createInstance).toHaveBeenCalledWith({
      profileId: PROFILE_ID,
      machineId: 'machine-2',
      worktreeId: 'wt-2',
      runtimeSessionId: 'session-2',
      status: 'running',
    });
    expect(response.json()).toEqual(makeInstance({ status: 'running' }));
  });

  it('POST /:id/instances rejects invalid status values', async () => {
    store.getProfile.mockResolvedValue(makeProfile());

    const response = await app.inject({
      method: 'POST',
      url: `/api/agent-profiles/${PROFILE_ID}/instances`,
      payload: { status: 'sleeping' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_STATUS' });
    expect(store.createInstance).not.toHaveBeenCalled();
  });

  it('POST /:id/instances returns 404 when the profile is missing', async () => {
    store.getProfile.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: `/api/agent-profiles/${PROFILE_ID}/instances`,
      payload: { status: 'idle' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'PROFILE_NOT_FOUND' });
    expect(store.createInstance).not.toHaveBeenCalled();
  });

  it('PATCH /:id/instances/:instanceId updates an instance', async () => {
    store.updateInstance.mockResolvedValue(
      makeInstance({ status: 'paused', machineId: 'machine-9' }),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`,
      payload: {
        status: 'paused',
        machineId: 'machine-9',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(store.updateInstance).toHaveBeenCalledWith(INSTANCE_ID, {
      status: 'paused',
      machineId: 'machine-9',
    });
    expect(response.json()).toEqual(makeInstance({ status: 'paused', machineId: 'machine-9' }));
  });

  it('PATCH /:id/instances/:instanceId returns 400 for invalid status', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`,
      payload: { status: 'unknown' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_STATUS' });
    expect(store.updateInstance).not.toHaveBeenCalled();
  });

  it('PATCH /:id/instances/:instanceId maps INSTANCE_NOT_FOUND errors to 404', async () => {
    store.updateInstance.mockRejectedValue(
      new ControlPlaneError('INSTANCE_NOT_FOUND', `Agent instance '${INSTANCE_ID}' not found`),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`,
      payload: { status: 'paused' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'INSTANCE_NOT_FOUND' });
  });

  it('DELETE /:id/instances/:instanceId maps INSTANCE_NOT_FOUND errors to 404', async () => {
    store.deleteInstance.mockRejectedValue(
      new ControlPlaneError('INSTANCE_NOT_FOUND', `Agent instance '${INSTANCE_ID}' not found`),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'INSTANCE_NOT_FOUND' });
  });

  it('DELETE /:id/instances/:instanceId deletes an existing instance', async () => {
    store.deleteInstance.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agent-profiles/${PROFILE_ID}/instances/${INSTANCE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(store.deleteInstance).toHaveBeenCalledWith(INSTANCE_ID);
  });
});
