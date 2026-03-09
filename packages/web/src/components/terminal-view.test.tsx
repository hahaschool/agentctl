import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock xterm Terminal class
const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockLoadAddon = vi.fn();
const mockDispose = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    write: mockWrite,
    open: mockOpen,
    loadAddon: mockLoadAddon,
    dispose: mockDispose,
  })),
}));

// Mock FitAddon
const mockFit = vi.fn();

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: mockFit,
  })),
}));

// Mock the CSS import
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView } from './TerminalView';

describe('TerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the container div', () => {
    const { container } = render(<TerminalView rawOutput={[]} />);
    expect(container.firstChild).toBeDefined();
  });

  it('shows "No terminal output" when rawOutput is empty and not active', () => {
    render(<TerminalView rawOutput={[]} isActive={false} />);
    expect(screen.getByText('No terminal output')).toBeDefined();
  });

  it('shows "Waiting for terminal output..." when rawOutput is empty and active', () => {
    render(<TerminalView rawOutput={[]} isActive={true} />);
    expect(screen.getByText('Waiting for terminal output...')).toBeDefined();
  });

  it('does not show empty state overlay when rawOutput has data', () => {
    render(<TerminalView rawOutput={['hello']} isActive={true} />);
    expect(screen.queryByText('Waiting for terminal output...')).toBeNull();
    expect(screen.queryByText('No terminal output')).toBeNull();
  });

  it('shows "Live" indicator when active and rawOutput has data', () => {
    render(<TerminalView rawOutput={['some output']} isActive={true} />);
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('does not show "Live" indicator when not active', () => {
    render(<TerminalView rawOutput={['some output']} isActive={false} />);
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('does not show "Live" indicator when active but rawOutput is empty', () => {
    render(<TerminalView rawOutput={[]} isActive={true} />);
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('applies custom className to outer wrapper', () => {
    const { container } = render(<TerminalView rawOutput={[]} className="my-custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('my-custom-class');
  });

  it('applies animate-pulse to empty state text when active', () => {
    render(<TerminalView rawOutput={[]} isActive={true} />);
    const el = screen.getByText('Waiting for terminal output...');
    expect(el.className).toContain('animate-pulse');
  });

  it('does not apply animate-pulse to empty state text when inactive', () => {
    render(<TerminalView rawOutput={[]} isActive={false} />);
    const el = screen.getByText('No terminal output');
    expect(el.className).not.toContain('animate-pulse');
  });

  it('has the terminal container with bg-[#0a0a0a] class', () => {
    const { container } = render(<TerminalView rawOutput={[]} />);
    const termDiv = container.querySelector('.bg-\\[\\#0a0a0a\\]');
    expect(termDiv).toBeDefined();
    expect(termDiv).not.toBeNull();
  });

  it('defaults isActive to undefined (no live indicator, no pulse)', () => {
    render(<TerminalView rawOutput={[]} />);
    const el = screen.getByText('No terminal output');
    expect(el.className).not.toContain('animate-pulse');
    expect(screen.queryByText('Live')).toBeNull();
  });
});
