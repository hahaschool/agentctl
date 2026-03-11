import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSteerMutate, mockUseSteerAgent } = vi.hoisted(() => ({
  mockSteerMutate: vi.fn(),
  mockUseSteerAgent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock('./Toast', () => ({
  useToast: () => mockToast,
  ToastContainer: () => null,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/queries', () => ({
  useSteerAgent: () => mockUseSteerAgent(),
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import { SteerInput } from './SteerInput';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SteerInput', () => {
  function setup(isRunning: boolean) {
    mockUseSteerAgent.mockReturnValue({
      mutate: mockSteerMutate,
      isPending: false,
    });
    return render(<SteerInput agentId="agent-1" isRunning={isRunning} />);
  }

  it('shows a disabled message when agent is not running', () => {
    setup(false);
    expect(screen.getByText(/Agent is not running/)).toBeDefined();
  });

  it('shows a textarea and Steer button when agent is running', () => {
    setup(true);
    expect(screen.getByPlaceholderText(/Steer the agent/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Steer/ })).toBeDefined();
  });

  it('disables the Steer button when input is empty', () => {
    setup(true);
    const button = screen.getByRole('button', { name: /Steer/ });
    expect(button).toBeDisabled();
  });

  it('enables the Steer button when text is entered', () => {
    setup(true);
    const textarea = screen.getByPlaceholderText(/Steer the agent/);
    fireEvent.change(textarea, { target: { value: 'Focus on tests' } });

    const button = screen.getByRole('button', { name: /Steer/ });
    expect(button).not.toBeDisabled();
  });

  it('calls steerAgent.mutate on submit', () => {
    setup(true);
    const textarea = screen.getByPlaceholderText(/Steer the agent/);
    fireEvent.change(textarea, { target: { value: 'Focus on tests' } });
    fireEvent.click(screen.getByRole('button', { name: /Steer/ }));

    expect(mockSteerMutate).toHaveBeenCalledWith(
      { agentId: 'agent-1', message: 'Focus on tests' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('clears the input after submitting', () => {
    setup(true);
    const textarea = screen.getByPlaceholderText(/Steer the agent/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Focus on tests' } });
    fireEvent.click(screen.getByRole('button', { name: /Steer/ }));

    expect(textarea.value).toBe('');
  });

  it('submits on Enter key press', () => {
    setup(true);
    const textarea = screen.getByPlaceholderText(/Steer the agent/);
    fireEvent.change(textarea, { target: { value: 'Use Enter' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(mockSteerMutate).toHaveBeenCalled();
  });

  it('does not submit on Shift+Enter', () => {
    setup(true);
    const textarea = screen.getByPlaceholderText(/Steer the agent/);
    fireEvent.change(textarea, { target: { value: 'Shift+Enter' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(mockSteerMutate).not.toHaveBeenCalled();
  });
});
