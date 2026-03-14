import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeSelector } from './RuntimeSelector';

describe('RuntimeSelector', () => {
  it('renders both runtime options in radio variant', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} variant="radio" />);

    expect(screen.getByText('Claude Code')).toBeDefined();
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('calls onChange when selecting a different runtime', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} variant="radio" />);

    fireEvent.click(screen.getByText('Codex'));
    expect(onChange).toHaveBeenCalledWith('codex');
  });

  it('highlights the currently selected runtime', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="codex" onChange={onChange} variant="radio" />);

    const codexButton = screen.getByText('Codex').closest('button');
    expect(codexButton?.getAttribute('aria-checked')).toBe('true');

    const claudeButton = screen.getByText('Claude Code').closest('button');
    expect(claudeButton?.getAttribute('aria-checked')).toBe('false');
  });

  it('disables all options when disabled prop is true', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} variant="radio" disabled />);

    fireEvent.click(screen.getByText('Codex'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders dropdown variant with current value displayed', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="codex" onChange={onChange} variant="dropdown" />);

    // Dropdown trigger should show the current value label
    expect(screen.getByText('Codex')).toBeDefined();
  });

  it('defaults to radio variant when not specified', () => {
    const onChange = vi.fn();
    render(<RuntimeSelector value="claude-code" onChange={onChange} />);

    // Radio variant uses buttons with role="radio"
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(2);
  });
});
