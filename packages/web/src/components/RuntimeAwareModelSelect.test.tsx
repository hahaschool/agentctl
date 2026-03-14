import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeAwareModelSelect } from './RuntimeAwareModelSelect';

// Mock the Toast module to avoid side-effects in tests
vi.mock('@/components/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
  useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn(), toast: vi.fn() }),
}));

describe('RuntimeAwareModelSelect', () => {
  it('shows Claude models when runtime is claude-code', () => {
    const onChange = vi.fn();
    render(<RuntimeAwareModelSelect runtime="claude-code" value="" onChange={onChange} />);

    // The trigger should show "Default" for empty value
    expect(screen.getByText('Default')).toBeDefined();
  });

  it('shows Codex models when runtime is codex', () => {
    const onChange = vi.fn();
    render(<RuntimeAwareModelSelect runtime="codex" value="gpt-5-codex" onChange={onChange} />);

    // Should render without error — the value is valid for codex
    expect(screen.getByText('GPT-5 Codex')).toBeDefined();
  });

  it('auto-resets model when runtime changes and current model is invalid', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RuntimeAwareModelSelect
        runtime="claude-code"
        value="claude-sonnet-4-6"
        onChange={onChange}
      />,
    );

    // Rerender with codex runtime — current model is invalid for codex
    rerender(
      <RuntimeAwareModelSelect runtime="codex" value="claude-sonnet-4-6" onChange={onChange} />,
    );

    // Should have called onChange with codex default model
    expect(onChange).toHaveBeenCalledWith('gpt-5-codex');
  });

  it('does not reset when current model is valid for new runtime', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RuntimeAwareModelSelect runtime="codex" value="gpt-5-codex" onChange={onChange} />,
    );

    // Same runtime, same value — no reset needed
    rerender(<RuntimeAwareModelSelect runtime="codex" value="gpt-5-codex" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not reset when value is empty (default sentinel)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RuntimeAwareModelSelect runtime="claude-code" value="" onChange={onChange} />,
    );

    // Switch runtime with empty value — should not trigger reset
    rerender(<RuntimeAwareModelSelect runtime="codex" value="" onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });
});
