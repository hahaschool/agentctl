import type { SpaceEvent } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { matchesFilter } from './event-gateway.js';

function makeEvent(overrides: Partial<SpaceEvent> = {}): SpaceEvent {
  return {
    id: 'evt-1',
    spaceId: 'space-1',
    threadId: 'thread-1',
    sequenceNum: 1,
    type: 'message',
    senderType: 'agent',
    senderId: 'agent-1',
    payload: {},
    visibility: 'public',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('matchesFilter', () => {
  it('returns true when no filter is provided', () => {
    expect(matchesFilter(makeEvent())).toBe(true);
  });

  it('returns true when filter is empty', () => {
    expect(matchesFilter(makeEvent(), {})).toBe(true);
  });

  it('allows public events when minVisibility is public', () => {
    expect(matchesFilter(makeEvent({ visibility: 'public' }), { minVisibility: 'public' })).toBe(
      true,
    );
  });

  it('allows internal events when minVisibility is internal', () => {
    expect(
      matchesFilter(makeEvent({ visibility: 'internal' }), { minVisibility: 'internal' }),
    ).toBe(true);
  });

  it('filters out silent events when minVisibility is internal', () => {
    expect(matchesFilter(makeEvent({ visibility: 'silent' }), { minVisibility: 'internal' })).toBe(
      false,
    );
  });

  it('filters out internal events when minVisibility is public', () => {
    expect(matchesFilter(makeEvent({ visibility: 'internal' }), { minVisibility: 'public' })).toBe(
      false,
    );
  });

  it('filters out silent events when minVisibility is public', () => {
    expect(matchesFilter(makeEvent({ visibility: 'silent' }), { minVisibility: 'public' })).toBe(
      false,
    );
  });
});
