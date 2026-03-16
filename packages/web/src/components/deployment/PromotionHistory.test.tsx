import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DeploymentPromotionRecord } from '@/lib/api';

import { PromotionHistory } from './PromotionHistory';

function makeRecord(overrides: Partial<DeploymentPromotionRecord> = {}): DeploymentPromotionRecord {
  return {
    id: 'promo-1',
    sourceTier: 'dev-1',
    targetTier: 'beta',
    status: 'success',
    checks: [
      { name: 'build', status: 'pass', message: 'Build succeeded' },
      { name: 'health', status: 'pass' },
    ],
    gitSha: '1234567890abcdef',
    startedAt: '2026-03-16T08:00:00.000Z',
    completedAt: '2026-03-16T08:01:30.000Z',
    durationMs: 90_000,
    triggeredBy: 'web',
    ...overrides,
  };
}

describe('PromotionHistory', () => {
  it('renders the designed empty state when there are no promotion records', () => {
    render(<PromotionHistory records={[]} />);

    expect(screen.getByText('No promotions yet')).toBeDefined();
    expect(
      screen.getByText('Run a beta promotion from a dev tier to see recent history here.'),
    ).toBeDefined();
  });

  it('renders records and expands details on click', () => {
    render(<PromotionHistory records={[makeRecord()]} />);

    expect(screen.getByText('dev-1 → beta')).toBeDefined();
    expect(screen.queryByText('Build succeeded')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /dev-1 → beta/i }));

    expect(screen.getByText('Build succeeded')).toBeDefined();
    expect(screen.getByText('sha: 12345678')).toBeDefined();
  });
});
