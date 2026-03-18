import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHotkeys } from './use-hotkeys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireKeydown(
  key: string,
  target: Partial<EventTarget & { tagName?: string }> = document.body,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  Object.defineProperty(event, 'target', { value: target, writable: false });
  document.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(document, 'addEventListener');
  vi.spyOn(document, 'removeEventListener');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Listener registration / cleanup
// ---------------------------------------------------------------------------

describe('useHotkeys — event listener registration', () => {
  it('registers a keydown listener on the document on mount', () => {
    renderHook(() => useHotkeys({ r: vi.fn() }));

    expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('removes the keydown listener when the component unmounts', () => {
    const { unmount } = renderHook(() => useHotkeys({ r: vi.fn() }));

    unmount();

    expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('removes the same function reference that was added', () => {
    const addCalls: ((event: KeyboardEvent) => void)[] = [];
    const removeCalls: ((event: KeyboardEvent) => void)[] = [];

    vi.spyOn(document, 'addEventListener').mockImplementation((type, fn) => {
      if (type === 'keydown') addCalls.push(fn as (event: KeyboardEvent) => void);
    });
    vi.spyOn(document, 'removeEventListener').mockImplementation((type, fn) => {
      if (type === 'keydown') removeCalls.push(fn as (event: KeyboardEvent) => void);
    });

    const { unmount } = renderHook(() => useHotkeys({ r: vi.fn() }));
    unmount();

    expect(addCalls).toHaveLength(1);
    expect(removeCalls).toHaveLength(1);
    expect(addCalls[0]).toBe(removeCalls[0]);
  });
});

// ---------------------------------------------------------------------------
// Matching keys
// ---------------------------------------------------------------------------

describe('useHotkeys — key matching', () => {
  it('calls the handler when a matching key is pressed', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ r: handler }));

    fireKeydown('r');

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call the handler for non-matching keys', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ r: handler }));

    fireKeydown('s');
    fireKeydown('Enter');
    fireKeydown('ArrowDown');

    expect(handler).not.toHaveBeenCalled();
  });

  it('maps "/" key to "slash" and calls the handler', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ slash: handler }));

    fireKeydown('/');

    expect(handler).toHaveBeenCalledOnce();
  });

  it('maps "?" key to "shift+?" and calls the handler', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ 'shift+?': handler }));

    fireKeydown('?');

    expect(handler).toHaveBeenCalledOnce();
  });

  it('matches Ctrl+key via "mod+<key>"', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ 'mod+k': handler }));

    fireKeydown('k', document.body, { ctrlKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('matches Cmd+key via "mod+<key>"', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ 'mod+k': handler }));

    fireKeydown('k', document.body, { metaKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('matches Ctrl+key via "ctrl+<key>"', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ 'ctrl+n': handler }));

    fireKeydown('n', document.body, { ctrlKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('matches Cmd+key via "cmd+<key>"', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ 'cmd+n': handler }));

    fireKeydown('n', document.body, { metaKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('passes the KeyboardEvent to the handler', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ Escape: handler }));

    fireKeydown('Escape');

    const received = handler.mock.calls[0]?.[0];
    expect(received).toBeInstanceOf(KeyboardEvent);
    expect((received as KeyboardEvent).key).toBe('Escape');
  });

  it('calls the correct handler among multiple registered keys', () => {
    const rHandler = vi.fn();
    const escHandler = vi.fn();
    renderHook(() => useHotkeys({ r: rHandler, Escape: escHandler }));

    fireKeydown('Escape');

    expect(escHandler).toHaveBeenCalledOnce();
    expect(rHandler).not.toHaveBeenCalled();
  });

  it('handles multiple different key presses independently', () => {
    const rHandler = vi.fn();
    const escHandler = vi.fn();
    renderHook(() => useHotkeys({ r: rHandler, Escape: escHandler }));

    fireKeydown('r');
    fireKeydown('Escape');

    expect(rHandler).toHaveBeenCalledOnce();
    expect(escHandler).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Form field suppression
// ---------------------------------------------------------------------------

describe('useHotkeys — form field suppression', () => {
  it('ignores key presses when focus is inside an INPUT element', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ r: handler }));

    fireKeydown('r', { tagName: 'INPUT' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores key presses when focus is inside a TEXTAREA element', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ r: handler }));

    fireKeydown('r', { tagName: 'TEXTAREA' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores key presses when focus is inside a SELECT element', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ r: handler }));

    fireKeydown('r', { tagName: 'SELECT' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('fires the handler when focus is on a non-form element like DIV', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ r: handler }));

    fireKeydown('r', { tagName: 'DIV' });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('fires the handler in INPUT when enableOnFormTags=true', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys({ 'mod+s': handler }, { enableOnFormTags: true }));

    fireKeydown('s', { tagName: 'INPUT' }, { ctrlKey: true });

    expect(handler).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Cleanup after unmount
// ---------------------------------------------------------------------------

describe('useHotkeys — cleanup after unmount', () => {
  it('does not call the handler after the component has unmounted', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkeys({ r: handler }));

    unmount();
    fireKeydown('r');

    expect(handler).not.toHaveBeenCalled();
  });
});
