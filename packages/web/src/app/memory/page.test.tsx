import { render } from '@testing-library/react';
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
    render(<Page />);

    expect(mockRedirect).toHaveBeenCalledWith('/memory/browser');
  });
});
