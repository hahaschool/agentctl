import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';

const { resolvePendingPermissionDecisionMock } = vi.hoisted(() => ({
  resolvePendingPermissionDecisionMock: vi.fn(),
}));

vi.mock('../../runtime/sdk-runner.js', () => ({
  resolvePendingPermissionDecision: resolvePendingPermissionDecisionMock,
}));

import { permissionResponseRoutes } from './permission-response.js';

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(permissionResponseRoutes, {
    prefix: '/api/agents',
    logger: createSilentLogger(),
  });
  return app;
}

describe('permissionResponseRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when requestId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/permission-response',
      payload: { decision: 'approved' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PERMISSION_RESPONSE');
    expect(resolvePendingPermissionDecisionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when decision is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/permission-response',
      payload: { requestId: 'req-1', decision: 'maybe' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PERMISSION_RESPONSE');
    expect(resolvePendingPermissionDecisionMock).not.toHaveBeenCalled();
  });

  it('returns 404 when pending request does not exist', async () => {
    resolvePendingPermissionDecisionMock.mockReturnValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/permission-response',
      payload: { requestId: 'req-1', decision: 'denied' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('PERMISSION_REQUEST_NOT_FOUND');
    expect(resolvePendingPermissionDecisionMock).toHaveBeenCalledWith(
      { requestId: 'req-1', decision: 'denied' },
      'agent-1',
    );
  });

  it('returns 200 when decision resolves a pending request', async () => {
    resolvePendingPermissionDecisionMock.mockReturnValue(true);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/permission-response',
      payload: { requestId: 'req-1', decision: 'approved' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(resolvePendingPermissionDecisionMock).toHaveBeenCalledWith(
      { requestId: 'req-1', decision: 'approved' },
      'agent-1',
    );
  });
});
