import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { DiscoverNewSessionForm } from './DiscoverNewSessionForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MACHINES = [
  { id: 'machine-1', hostname: 'mac-mini' },
  { id: 'machine-2', hostname: 'ec2-worker' },
];

function defaultProps(overrides: Partial<Parameters<typeof DiscoverNewSessionForm>[0]> = {}) {
  return {
    machines: MACHINES,
    machineId: 'machine-1',
    onMachineIdChange: vi.fn(),
    projectPath: '',
    onProjectPathChange: vi.fn(),
    prompt: '',
    onPromptChange: vi.fn(),
    creating: false,
    onSubmit: vi.fn(),
    runtime: 'claude-code' as const,
    onRuntimeChange: vi.fn(),
    ...overrides,
  };
}

// ===========================================================================
// DiscoverNewSessionForm
// ===========================================================================
describe('DiscoverNewSessionForm', () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  it('renders the Machine label and select', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByLabelText('Machine')).toBeDefined();
  });

  it('renders machine options from props', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByText('mac-mini')).toBeDefined();
    expect(screen.getByText('ec2-worker')).toBeDefined();
  });

  it('renders "No machines" option when machines list is empty', () => {
    render(<DiscoverNewSessionForm {...defaultProps({ machines: [] })} />);
    expect(screen.getByText('No machines')).toBeDefined();
  });

  it('renders the Project Path input', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByLabelText('Project Path')).toBeDefined();
  });

  it('renders the Prompt input', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByLabelText('Prompt')).toBeDefined();
  });

  it('renders the Create button', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDefined();
  });

  it('renders "Creating..." text when creating is true', () => {
    render(<DiscoverNewSessionForm {...defaultProps({ creating: true })} />);
    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Controlled values
  // -------------------------------------------------------------------------
  it('reflects the current machineId value', () => {
    render(<DiscoverNewSessionForm {...defaultProps({ machineId: 'machine-2' })} />);
    const select = screen.getByLabelText('Machine') as HTMLSelectElement;
    expect(select.value).toBe('machine-2');
  });

  it('reflects the current projectPath value', () => {
    render(<DiscoverNewSessionForm {...defaultProps({ projectPath: '/home/user/project' })} />);
    const input = screen.getByLabelText('Project Path') as HTMLInputElement;
    expect(input.value).toBe('/home/user/project');
  });

  it('reflects the current prompt value', () => {
    render(<DiscoverNewSessionForm {...defaultProps({ prompt: 'fix the bug' })} />);
    const input = screen.getByLabelText('Prompt') as HTMLInputElement;
    expect(input.value).toBe('fix the bug');
  });

  // -------------------------------------------------------------------------
  // Disabled states
  // -------------------------------------------------------------------------
  it('disables the Create button when projectPath is empty', () => {
    render(
      <DiscoverNewSessionForm {...defaultProps({ projectPath: '', prompt: 'do something' })} />,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('disables the Create button when prompt is empty', () => {
    render(
      <DiscoverNewSessionForm
        {...defaultProps({ projectPath: '/home/user/project', prompt: '' })}
      />,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('disables the Create button when projectPath is only whitespace', () => {
    render(
      <DiscoverNewSessionForm {...defaultProps({ projectPath: '   ', prompt: 'do something' })} />,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('enables the Create button when both projectPath and prompt have values', () => {
    render(
      <DiscoverNewSessionForm
        {...defaultProps({ projectPath: '/home/user/project', prompt: 'do it' })}
      />,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('disables the Create button when creating is true', () => {
    render(
      <DiscoverNewSessionForm
        {...defaultProps({
          projectPath: '/home/user/project',
          prompt: 'do it',
          creating: true,
        })}
      />,
    );
    const button = screen.getByRole('button', { name: 'Creating...' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('disables all form fields when creating is true', () => {
    render(<DiscoverNewSessionForm {...defaultProps({ creating: true })} />);
    const machineSelect = screen.getByLabelText('Machine') as HTMLSelectElement;
    const projectInput = screen.getByLabelText('Project Path') as HTMLInputElement;
    const promptInput = screen.getByLabelText('Prompt') as HTMLInputElement;
    expect(machineSelect.disabled).toBe(true);
    expect(projectInput.disabled).toBe(true);
    expect(promptInput.disabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // User interactions — callbacks
  // -------------------------------------------------------------------------
  it('calls onMachineIdChange when selecting a machine', () => {
    const onMachineIdChange = vi.fn();
    render(<DiscoverNewSessionForm {...defaultProps({ onMachineIdChange })} />);
    fireEvent.change(screen.getByLabelText('Machine'), {
      target: { value: 'machine-2' },
    });
    expect(onMachineIdChange).toHaveBeenCalledWith('machine-2');
  });

  it('calls onProjectPathChange when typing in project path', () => {
    const onProjectPathChange = vi.fn();
    render(<DiscoverNewSessionForm {...defaultProps({ onProjectPathChange })} />);
    fireEvent.change(screen.getByLabelText('Project Path'), {
      target: { value: '/new/path' },
    });
    expect(onProjectPathChange).toHaveBeenCalledWith('/new/path');
  });

  it('calls onPromptChange when typing in prompt', () => {
    const onPromptChange = vi.fn();
    render(<DiscoverNewSessionForm {...defaultProps({ onPromptChange })} />);
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'new prompt' },
    });
    expect(onPromptChange).toHaveBeenCalledWith('new prompt');
  });

  it('calls onSubmit when clicking the Create button', () => {
    const onSubmit = vi.fn();
    render(
      <DiscoverNewSessionForm
        {...defaultProps({
          projectPath: '/home/user/project',
          prompt: 'do it',
          onSubmit,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onSubmit when pressing Enter in the prompt input', () => {
    const onSubmit = vi.fn();
    render(
      <DiscoverNewSessionForm
        {...defaultProps({
          projectPath: '/home/user/project',
          prompt: 'do it',
          onSubmit,
        })}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('Prompt'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not call onSubmit for non-Enter key presses', () => {
    const onSubmit = vi.fn();
    render(
      <DiscoverNewSessionForm
        {...defaultProps({
          projectPath: '/home/user/project',
          prompt: 'do it',
          onSubmit,
        })}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('Prompt'), { key: 'Escape' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Placeholders
  // -------------------------------------------------------------------------
  it('shows project path placeholder', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByPlaceholderText('/Users/hahaschool/my-project')).toBeDefined();
  });

  it('shows prompt placeholder', () => {
    render(<DiscoverNewSessionForm {...defaultProps()} />);
    expect(screen.getByPlaceholderText('What should Claude work on?')).toBeDefined();
  });
});
