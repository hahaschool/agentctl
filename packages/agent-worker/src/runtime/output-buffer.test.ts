import { describe, it, expect, vi } from 'vitest';

import type { AgentEvent } from '@agentctl/shared';

import { OutputBuffer } from './output-buffer.js';

function makeEvent(content: string): AgentEvent {
  return { event: 'output', data: { type: 'text', content } };
}

describe('OutputBuffer', () => {
  it('push() adds events to buffer', () => {
    const buffer = new OutputBuffer();

    buffer.push(makeEvent('hello'));
    buffer.push(makeEvent('world'));

    expect(buffer.size).toBe(2);
  });

  it('getRecent() returns last N events', () => {
    const buffer = new OutputBuffer();

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.push(makeEvent('c'));

    const recent = buffer.getRecent(2);

    expect(recent).toHaveLength(2);
    expect(recent[0]).toEqual(makeEvent('b'));
    expect(recent[1]).toEqual(makeEvent('c'));
  });

  it('getRecent() with count > buffer size returns all events', () => {
    const buffer = new OutputBuffer();

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));

    const recent = buffer.getRecent(100);

    expect(recent).toHaveLength(2);
    expect(recent[0]).toEqual(makeEvent('a'));
    expect(recent[1]).toEqual(makeEvent('b'));
  });

  it('subscribe()/unsubscribe() pattern works', () => {
    const buffer = new OutputBuffer();
    const subscriber = vi.fn();

    buffer.subscribe(subscriber);
    buffer.push(makeEvent('first'));

    expect(subscriber).toHaveBeenCalledTimes(1);

    buffer.unsubscribe(subscriber);
    buffer.push(makeEvent('second'));

    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('subscriber receives pushed events', () => {
    const buffer = new OutputBuffer();
    const subscriber = vi.fn();

    buffer.subscribe(subscriber);

    const event = makeEvent('data');
    buffer.push(event);

    expect(subscriber).toHaveBeenCalledWith(event);
  });

  it('ring buffer wraps around when maxSize exceeded', () => {
    const buffer = new OutputBuffer(3);

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.push(makeEvent('c'));
    buffer.push(makeEvent('d'));
    buffer.push(makeEvent('e'));

    // Size should be capped at maxSize
    expect(buffer.size).toBe(3);

    // Only the most recent 3 events should remain
    const recent = buffer.getRecent(3);

    expect(recent).toHaveLength(3);
    expect(recent[0]).toEqual(makeEvent('c'));
    expect(recent[1]).toEqual(makeEvent('d'));
    expect(recent[2]).toEqual(makeEvent('e'));
  });
});
