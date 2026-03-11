import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'mock-font' }),
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/Sidebar', () => ({
  Sidebar: () => null,
}));

vi.mock('./providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => children,
}));

import { viewport } from './layout';

describe('app layout viewport', () => {
  it('does not disable user scaling', () => {
    expect('userScalable' in viewport).toBe(false);
  });
});
