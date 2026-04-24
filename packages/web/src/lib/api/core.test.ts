import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request } from './core';

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeNoContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: 'No Content',
    json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
  } as unknown as Response;
}

describe('ApiError', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores structured details when provided', () => {
    const err = new ApiError(409, 'JOB_ALREADY_RUNNING', 'job running', undefined, {
      existingJobId: 'job-1',
      existingMachine: 'machine-1',
    });

    expect(err.details).toEqual({
      existingJobId: 'job-1',
      existingMachine: 'machine-1',
    });
  });

  it('parses response details into ApiError.details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse(
        {
          error: 'JOB_ALREADY_RUNNING',
          message: 'job running',
          details: { existingJobId: 'job-1' },
        },
        false,
        409,
      ),
    );

    await expect(request('/api/anything')).rejects.toMatchObject({
      code: 'JOB_ALREADY_RUNNING',
      details: { existingJobId: 'job-1' },
    });
  });

  it('keeps parsing legacy hint values', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse(
        {
          error: 'OLD_CODE',
          message: 'old message',
          hint: 'old hint',
        },
        false,
        400,
      ),
    );

    await expect(request('/api/anything')).rejects.toMatchObject({
      code: 'OLD_CODE',
      hint: 'old hint',
    });
  });

  it('does not parse JSON for 204 responses', async () => {
    const response = makeNoContentResponse();
    vi.mocked(fetch).mockResolvedValue(response);

    await expect(request('/api/no-content')).resolves.toBeUndefined();
    expect(response.json).not.toHaveBeenCalled();
  });
});
