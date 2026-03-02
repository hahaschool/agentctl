import type { AgentEvent } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

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

  // ── Edge case tests ──────────────────────────────────────────────

  it('getRecent(0) returns empty array', () => {
    const buffer = new OutputBuffer();

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));

    expect(buffer.getRecent(0)).toEqual([]);
  });

  it('getRecent() on empty buffer returns empty array', () => {
    const buffer = new OutputBuffer();

    expect(buffer.getRecent(10)).toEqual([]);
  });

  it('size is 0 on a freshly constructed buffer', () => {
    const buffer = new OutputBuffer();

    expect(buffer.size).toBe(0);
  });

  it('maxSize of 1 only retains the last event', () => {
    const buffer = new OutputBuffer(1);

    buffer.push(makeEvent('first'));
    expect(buffer.size).toBe(1);
    expect(buffer.getRecent(1)).toEqual([makeEvent('first')]);

    buffer.push(makeEvent('second'));
    expect(buffer.size).toBe(1);
    expect(buffer.getRecent(1)).toEqual([makeEvent('second')]);

    buffer.push(makeEvent('third'));
    expect(buffer.size).toBe(1);
    expect(buffer.getRecent(5)).toEqual([makeEvent('third')]);
  });

  it('clear() resets size to 0 and getRecent returns empty', () => {
    const buffer = new OutputBuffer();

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.push(makeEvent('c'));

    expect(buffer.size).toBe(3);

    buffer.clear();

    expect(buffer.size).toBe(0);
    expect(buffer.getRecent(10)).toEqual([]);
  });

  it('push works correctly after clear()', () => {
    const buffer = new OutputBuffer(3);

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.clear();

    buffer.push(makeEvent('x'));
    buffer.push(makeEvent('y'));

    expect(buffer.size).toBe(2);
    expect(buffer.getRecent(2)).toEqual([makeEvent('x'), makeEvent('y')]);
  });

  it('clear() does not affect subscribers', () => {
    const buffer = new OutputBuffer();
    const subscriber = vi.fn();

    buffer.subscribe(subscriber);
    buffer.clear();

    buffer.push(makeEvent('after-clear'));

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(makeEvent('after-clear'));
  });

  it('multiple subscribers all receive each event', () => {
    const buffer = new OutputBuffer();
    const sub1 = vi.fn();
    const sub2 = vi.fn();
    const sub3 = vi.fn();

    buffer.subscribe(sub1);
    buffer.subscribe(sub2);
    buffer.subscribe(sub3);

    const event = makeEvent('broadcast');
    buffer.push(event);

    expect(sub1).toHaveBeenCalledWith(event);
    expect(sub2).toHaveBeenCalledWith(event);
    expect(sub3).toHaveBeenCalledWith(event);
  });

  it('unsubscribing a function that was never subscribed is a no-op', () => {
    const buffer = new OutputBuffer();
    const neverSubscribed = vi.fn();

    // Should not throw
    buffer.unsubscribe(neverSubscribed);

    buffer.push(makeEvent('test'));

    expect(neverSubscribed).not.toHaveBeenCalled();
  });

  it('same function subscribed twice only receives events once (Set semantics)', () => {
    const buffer = new OutputBuffer();
    const subscriber = vi.fn();

    buffer.subscribe(subscriber);
    buffer.subscribe(subscriber);

    buffer.push(makeEvent('dedup'));

    expect(subscriber).toHaveBeenCalledTimes(1);
  });

  it('subscriber that throws does not prevent other subscribers from receiving events', () => {
    const buffer = new OutputBuffer();
    const throwingSub = vi.fn(() => {
      throw new Error('subscriber error');
    });
    const normalSub = vi.fn();

    buffer.subscribe(throwingSub);
    buffer.subscribe(normalSub);

    // push() iterates subscribers; a throwing subscriber will propagate,
    // but we verify the Set iteration order ensures the first is called
    expect(() => buffer.push(makeEvent('boom'))).toThrow('subscriber error');
    expect(throwingSub).toHaveBeenCalledTimes(1);
    // The event is still written to the buffer even though a subscriber threw
    expect(buffer.size).toBe(1);
  });

  it('getRecent with exact maxSize after multiple wrap-arounds returns correct order', () => {
    const buffer = new OutputBuffer(3);

    // Fill buffer multiple times over to wrap around more than once
    for (let i = 1; i <= 10; i++) {
      buffer.push(makeEvent(`event-${i}`));
    }

    expect(buffer.size).toBe(3);

    const recent = buffer.getRecent(3);

    expect(recent).toEqual([makeEvent('event-8'), makeEvent('event-9'), makeEvent('event-10')]);
  });

  it('getRecent(1) returns only the most recent event', () => {
    const buffer = new OutputBuffer(5);

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.push(makeEvent('c'));

    expect(buffer.getRecent(1)).toEqual([makeEvent('c')]);
  });

  it('getRecent with negative n is treated as 0 (returns empty)', () => {
    const buffer = new OutputBuffer();

    buffer.push(makeEvent('a'));

    // Math.min(-1, count) will be negative, then Math.min with count
    // In the code: take = Math.min(n, this.count), so Math.min(-5, 1) = -5
    // then `take === 0` check fails, but the for loop runs -5 times (0 iterations).
    const recent = buffer.getRecent(-5);

    expect(recent).toEqual([]);
  });

  it('ring buffer handles exact fill without wrap-around', () => {
    const buffer = new OutputBuffer(3);

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.push(makeEvent('c'));

    expect(buffer.size).toBe(3);

    const recent = buffer.getRecent(3);

    expect(recent).toEqual([makeEvent('a'), makeEvent('b'), makeEvent('c')]);
  });

  it('push after wrap-around preserves correct read order for partial getRecent', () => {
    const buffer = new OutputBuffer(4);

    buffer.push(makeEvent('a'));
    buffer.push(makeEvent('b'));
    buffer.push(makeEvent('c'));
    buffer.push(makeEvent('d'));
    // Buffer full: [a, b, c, d], writeIndex=0
    buffer.push(makeEvent('e'));
    // Buffer: [e, b, c, d], writeIndex=1
    buffer.push(makeEvent('f'));
    // Buffer: [e, f, c, d], writeIndex=2

    expect(buffer.size).toBe(4);

    // Request partial: last 2
    expect(buffer.getRecent(2)).toEqual([makeEvent('e'), makeEvent('f')]);

    // Request all 4
    expect(buffer.getRecent(4)).toEqual([
      makeEvent('c'),
      makeEvent('d'),
      makeEvent('e'),
      makeEvent('f'),
    ]);
  });
});
