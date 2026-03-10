import { describe, expect, it, vi } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

import Page from './page';

describe('runtime sessions compatibility route', () => {
  it('redirects to the unified runtime-filtered sessions view', () => {
    Page();

    expect(mockRedirect).toHaveBeenCalledWith('/sessions?type=runtime');
  });
});
