import { describe, expect, it } from 'vitest';
import type { SessionContentMessage } from '@/lib/api';
import { computeTimelineMarkers } from './TimelineMarkers';

function msg(overrides: Partial<SessionContentMessage> = {}): SessionContentMessage {
  return { type: 'assistant', content: 'text', ...overrides };
}

describe('computeTimelineMarkers', () => {
  it('returns empty array for empty messages', () => {
    expect(computeTimelineMarkers([])).toEqual([]);
  });

  it('returns empty array for single message', () => {
    expect(computeTimelineMarkers([msg()])).toEqual([]);
  });

  it('inserts time-gap marker when >30 min between messages', () => {
    const messages = [
      msg({ timestamp: '2026-03-09T10:00:00Z' }),
      msg({ timestamp: '2026-03-09T10:01:00Z' }),
      msg({ timestamp: '2026-03-09T11:00:00Z' }),
    ];
    const markers = computeTimelineMarkers(messages);
    expect(markers).toContainEqual(expect.objectContaining({ afterIndex: 1, type: 'time-gap' }));
  });

  it('does not insert time-gap for <30 min gap', () => {
    const messages = [
      msg({ timestamp: '2026-03-09T10:00:00Z' }),
      msg({ timestamp: '2026-03-09T10:29:00Z' }),
    ];
    const markers = computeTimelineMarkers(messages);
    expect(markers.filter((m) => m.type === 'time-gap')).toEqual([]);
  });

  it('formats hours for gaps >=60 min', () => {
    const messages = [
      msg({ timestamp: '2026-03-09T10:00:00Z' }),
      msg({ timestamp: '2026-03-09T12:00:00Z' }),
    ];
    const markers = computeTimelineMarkers(messages);
    const gap = markers.find((m) => m.type === 'time-gap');
    expect(gap?.label).toBe('2h gap');
  });

  it('formats minutes for gaps <60 min', () => {
    const messages = [
      msg({ timestamp: '2026-03-09T10:00:00Z' }),
      msg({ timestamp: '2026-03-09T10:45:00Z' }),
    ];
    const markers = computeTimelineMarkers(messages);
    const gap = markers.find((m) => m.type === 'time-gap');
    expect(gap?.label).toBe('45m gap');
  });

  it('inserts human-turn marker at each new human message after non-human', () => {
    const messages = [
      msg({ type: 'human' }),
      msg({ type: 'assistant' }),
      msg({ type: 'tool_use' }),
      msg({ type: 'tool_result' }),
      msg({ type: 'human' }),
    ];
    const markers = computeTimelineMarkers(messages);
    expect(markers).toContainEqual(
      expect.objectContaining({ afterIndex: 3, type: 'human-turn', label: 'Turn 2' }),
    );
  });

  it('does not insert human-turn for consecutive human messages', () => {
    const messages = [msg({ type: 'human' }), msg({ type: 'human' })];
    const markers = computeTimelineMarkers(messages);
    expect(markers.filter((m) => m.type === 'human-turn')).toEqual([]);
  });

  it('handles messages without timestamps gracefully', () => {
    const messages = [msg({ type: 'human' }), msg({ type: 'assistant' }), msg({ type: 'human' })];
    const markers = computeTimelineMarkers(messages);
    // No time-gap markers but should have human-turn
    expect(markers.filter((m) => m.type === 'time-gap')).toEqual([]);
    expect(markers.filter((m) => m.type === 'human-turn').length).toBe(1);
  });

  it('can produce both types of markers between the same messages', () => {
    const messages = [
      msg({ type: 'assistant', timestamp: '2026-03-09T10:00:00Z' }),
      msg({ type: 'human', timestamp: '2026-03-09T11:00:00Z' }),
    ];
    const markers = computeTimelineMarkers(messages);
    expect(markers.filter((m) => m.type === 'time-gap').length).toBe(1);
    expect(markers.filter((m) => m.type === 'human-turn').length).toBe(1);
  });
});
