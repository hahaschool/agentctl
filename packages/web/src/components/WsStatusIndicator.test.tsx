import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WsConnectionStatus } from '../hooks/use-websocket';

// ---------------------------------------------------------------------------
// Mock @/lib/utils — simple cn that joins truthy class args
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { WsStatusIndicator } from './WsStatusIndicator';

// ===========================================================================
// WsStatusIndicator
// ===========================================================================
describe('WsStatusIndicator', () => {
  // -------------------------------------------------------------------------
  // Status label rendering
  // -------------------------------------------------------------------------
  it('renders "Connected" label for connected status', () => {
    render(<WsStatusIndicator status="connected" />);
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('renders "Connecting" label for connecting status', () => {
    render(<WsStatusIndicator status="connecting" />);
    expect(screen.getByText('Connecting')).toBeDefined();
  });

  it('renders "Disconnected" label for disconnected status', () => {
    render(<WsStatusIndicator status="disconnected" />);
    expect(screen.getByText('Disconnected')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Tooltip title attribute
  // -------------------------------------------------------------------------
  it('sets title to "WebSocket: Connected" when connected', () => {
    render(<WsStatusIndicator status="connected" />);
    expect(screen.getByTitle('WebSocket: Connected')).toBeDefined();
  });

  it('sets title to "WebSocket: Connecting" when connecting', () => {
    render(<WsStatusIndicator status="connecting" />);
    expect(screen.getByTitle('WebSocket: Connecting')).toBeDefined();
  });

  it('sets title to "WebSocket: Disconnected" when disconnected', () => {
    render(<WsStatusIndicator status="disconnected" />);
    expect(screen.getByTitle('WebSocket: Disconnected')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Color classes per status
  // -------------------------------------------------------------------------
  it('applies green text class for connected status', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('text-green-500');
  });

  it('applies yellow text class for connecting status', () => {
    const { container } = render(<WsStatusIndicator status="connecting" />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('text-yellow-500');
  });

  it('applies muted text class for disconnected status', () => {
    const { container } = render(<WsStatusIndicator status="disconnected" />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('text-muted-foreground');
  });

  // -------------------------------------------------------------------------
  // Dot indicator color
  // -------------------------------------------------------------------------
  it('renders green dot for connected status', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const dot = container.querySelector('.bg-green-500');
    expect(dot).not.toBeNull();
  });

  it('renders yellow dot for connecting status', () => {
    const { container } = render(<WsStatusIndicator status="connecting" />);
    const dot = container.querySelector('.bg-yellow-500');
    expect(dot).not.toBeNull();
  });

  it('renders muted dot for disconnected status', () => {
    const { container } = render(<WsStatusIndicator status="disconnected" />);
    const dot = container.querySelector('.bg-muted-foreground');
    expect(dot).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Pulse animation only for connecting
  // -------------------------------------------------------------------------
  it('applies animate-pulse class only for connecting status', () => {
    const { container } = render(<WsStatusIndicator status="connecting" />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeNull();
  });

  it('does not apply animate-pulse for connected status', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeNull();
  });

  it('does not apply animate-pulse for disconnected status', () => {
    const { container } = render(<WsStatusIndicator status="disconnected" />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Compact mode
  // -------------------------------------------------------------------------
  it('hides the label text in compact mode', () => {
    render(<WsStatusIndicator status="connected" compact />);
    expect(screen.queryByText('Connected')).toBeNull();
  });

  it('still shows the dot indicator in compact mode', () => {
    const { container } = render(<WsStatusIndicator status="connected" compact />);
    const dot = container.querySelector('.bg-green-500');
    expect(dot).not.toBeNull();
  });

  it('still sets the title attribute in compact mode', () => {
    render(<WsStatusIndicator status="connected" compact />);
    expect(screen.getByTitle('WebSocket: Connected')).toBeDefined();
  });

  it('uses smaller text size in compact mode', () => {
    const { container } = render(<WsStatusIndicator status="connected" compact />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('text-[10px]');
    expect(outer.className).not.toContain('text-[11px]');
  });

  it('uses larger text size in non-compact mode', () => {
    const { container } = render(<WsStatusIndicator status="connected" />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('text-[11px]');
    expect(outer.className).not.toContain('text-[10px]');
  });

  // -------------------------------------------------------------------------
  // All three statuses produce distinct configurations
  // -------------------------------------------------------------------------
  it('renders distinct visual states for each status', () => {
    const statuses: WsConnectionStatus[] = ['connected', 'connecting', 'disconnected'];
    const titles = statuses.map((status) => {
      const { container } = render(<WsStatusIndicator status={status} />);
      const outer = container.firstElementChild as HTMLElement;
      return outer.getAttribute('title');
    });
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBe(3);
  });
});
