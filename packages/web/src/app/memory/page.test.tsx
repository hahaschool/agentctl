import { describe, expect, it, vi } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

import Page from './page';

describe('memory root route', () => {
  it('redirects to the browser shell', () => {
    Page();

    expect(mockRedirect).toHaveBeenCalledWith('/memory/browser');
  });
});
