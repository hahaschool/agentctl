import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { render, screen, fireEvent } from '@testing-library/react';

import type { MemoryObservation } from '@agentctl/shared';

import { MemoryPanel, matchObservationToMessages } from './MemoryPanel';

function makeObs(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: 1,
    type: 'decision',
    title: 'Test observation',
    created_at: '2026-03-09T10:00:00Z',
    ...overrides,
  };
}

describe('matchObservationToMessages', () => {
  const messages = [
    { type: 'human', content: 'Fix the auth middleware in packages/web/src/auth.ts' },
    { type: 'assistant', content: 'Updated the JWT validation logic' },
    { type: 'human', content: 'Now work on the database schema' },
    { type: 'assistant', content: 'Created migration for users table' },
  ];

  it('matches observation files to messages mentioning those files', () => {
    const obs = makeObs({
      title: 'Fix auth middleware',
      files_modified: '["packages/web/src/auth.ts"]',
    });
    const indices = matchObservationToMessages(obs, messages);
    expect(indices).toContain(0); // mentions auth.ts
  });

  it('matches observation facts keywords to message content', () => {
    const obs = makeObs({
      title: 'Fix JWT issue',
      facts: '["JWT validation was missing expiry check"]',
    });
    const indices = matchObservationToMessages(obs, messages);
    expect(indices).toContain(1); // "validation" keyword matches
  });

  it('matches title keywords to message content', () => {
    const obs = makeObs({
      title: 'Database schema migration',
    });
    const indices = matchObservationToMessages(obs, messages);
    expect(indices).toContain(2); // "database" in title matches
    expect(indices).toContain(3); // "migration" in title matches
  });

  it('returns empty for unrelated observation', () => {
    const obs = makeObs({
      title: 'Add Kubernetes deployment',
      files_modified: '["infra/k8s/deployment.yaml"]',
      facts: '["Added helm chart for production"]',
    });
    const indices = matchObservationToMessages(obs, messages);
    expect(indices).toEqual([]);
  });

  it('returns empty for empty messages', () => {
    const obs = makeObs({ title: 'Something' });
    expect(matchObservationToMessages(obs, [])).toEqual([]);
  });

  it('handles invalid JSON in files_modified gracefully', () => {
    const obs = makeObs({
      title: 'Test',
      files_modified: 'not-json',
    });
    // Should not throw
    const indices = matchObservationToMessages(obs, messages);
    expect(Array.isArray(indices)).toBe(true);
  });

  it('handles invalid JSON in facts gracefully', () => {
    const obs = makeObs({
      title: 'Test',
      facts: '{broken',
    });
    const indices = matchObservationToMessages(obs, messages);
    expect(Array.isArray(indices)).toBe(true);
  });

  it('returns sorted indices', () => {
    const obs = makeObs({
      title: 'auth database migration validation',
    });
    const indices = matchObservationToMessages(obs, messages);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]!);
    }
  });
});

describe('MemoryPanel', () => {
  it('shows loading state', () => {
    render(
      <MemoryPanel observations={[]} isLoading={true} onSelectObservation={() => {}} />,
    );
    expect(screen.getByText('Searching memories...')).toBeDefined();
  });

  it('shows empty state', () => {
    render(
      <MemoryPanel observations={[]} isLoading={false} onSelectObservation={() => {}} />,
    );
    expect(screen.getByText('No matching memories found.')).toBeDefined();
  });

  it('renders observation cards', () => {
    const observations = [
      makeObs({ id: 1, type: 'decision', title: 'Use PostgreSQL' }),
      makeObs({ id: 2, type: 'bugfix', title: 'Fix auth flow' }),
    ];
    render(
      <MemoryPanel
        observations={observations}
        isLoading={false}
        onSelectObservation={() => {}}
      />,
    );
    expect(screen.getByText('Use PostgreSQL')).toBeDefined();
    expect(screen.getByText('Fix auth flow')).toBeDefined();
  });

  it('calls onSelectObservation when card clicked', () => {
    const onSelect = vi.fn();
    const obs = makeObs({ id: 1, title: 'Test Obs' });
    render(
      <MemoryPanel observations={[obs]} isLoading={false} onSelectObservation={onSelect} />,
    );
    fireEvent.click(screen.getByText('Test Obs'));
    expect(onSelect).toHaveBeenCalledWith(obs);
  });

  it('highlights selected observation', () => {
    const obs = makeObs({ id: 42, title: 'Selected Obs' });
    const { container } = render(
      <MemoryPanel
        observations={[obs]}
        isLoading={false}
        onSelectObservation={() => {}}
        selectedObservationId={42}
      />,
    );
    const button = container.querySelector('button');
    expect(button?.className).toContain('ring-2');
  });
});
