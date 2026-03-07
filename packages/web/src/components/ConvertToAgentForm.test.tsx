import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConvertToAgentForm } from './ConvertToAgentForm';

afterEach(() => {
  vi.restoreAllMocks();
});

const defaultProps = {
  convertName: 'my-agent',
  onNameChange: vi.fn(),
  convertType: 'autonomous',
  onTypeChange: vi.fn(),
  machineId: 'machine-001',
  projectPath: '/home/user/project',
  model: 'claude-sonnet-4-20250514',
  isPending: false,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConvertToAgentForm', () => {
  describe('rendering', () => {
    it('renders the form title', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      expect(screen.getByText('Create Agent from Session')).toBeDefined();
    });

    it('renders the Agent Name input with current value', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      const input = screen.getByLabelText('Agent Name') as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.value).toBe('my-agent');
    });

    it('renders the Agent Type select with current value', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      const select = screen.getByLabelText('Agent Type') as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.value).toBe('autonomous');
    });

    it('renders both agent type options', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      const options = screen.getAllByRole('option');
      expect(options.length).toBe(2);
      expect(options[0]?.textContent).toBe('Autonomous (long-running)');
      expect(options[1]?.textContent).toBe('Ad-hoc (one-shot)');
    });

    it('renders machineId', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      expect(screen.getByText('machine-001')).toBeDefined();
    });

    it('renders projectPath when provided', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      expect(screen.getByText('/home/user/project')).toBeDefined();
    });

    it('does not render project line when projectPath is null', () => {
      render(<ConvertToAgentForm {...defaultProps} projectPath={null} />);
      expect(screen.queryByText('Project:')).toBeNull();
    });

    it('renders model when provided', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      expect(screen.getByText('claude-sonnet-4-20250514')).toBeDefined();
    });

    it('does not render model line when model is null', () => {
      render(<ConvertToAgentForm {...defaultProps} model={null} />);
      expect(screen.queryByText('Model:')).toBeNull();
    });

    it('renders Create Agent button', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Create Agent' })).toBeDefined();
    });

    it('renders Cancel button', () => {
      render(<ConvertToAgentForm {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    });
  });

  describe('pending state', () => {
    it('shows "Creating..." when isPending is true', () => {
      render(<ConvertToAgentForm {...defaultProps} isPending={true} />);
      expect(screen.getByRole('button', { name: 'Creating...' })).toBeDefined();
    });

    it('disables the submit button when isPending is true', () => {
      render(<ConvertToAgentForm {...defaultProps} isPending={true} />);
      const button = screen.getByRole('button', { name: 'Creating...' });
      expect(button.hasAttribute('disabled')).toBe(true);
    });

    it('submit button is enabled when isPending is false', () => {
      render(<ConvertToAgentForm {...defaultProps} isPending={false} />);
      const button = screen.getByRole('button', { name: 'Create Agent' });
      expect(button.hasAttribute('disabled')).toBe(false);
    });
  });

  describe('user interactions', () => {
    it('calls onNameChange when name input changes', () => {
      const onNameChange = vi.fn();
      render(<ConvertToAgentForm {...defaultProps} onNameChange={onNameChange} />);
      const input = screen.getByLabelText('Agent Name');
      fireEvent.change(input, { target: { value: 'new-agent-name' } });
      expect(onNameChange).toHaveBeenCalledWith('new-agent-name');
    });

    it('calls onTypeChange when type select changes', () => {
      const onTypeChange = vi.fn();
      render(<ConvertToAgentForm {...defaultProps} onTypeChange={onTypeChange} />);
      const select = screen.getByLabelText('Agent Type');
      fireEvent.change(select, { target: { value: 'ad-hoc' } });
      expect(onTypeChange).toHaveBeenCalledWith('ad-hoc');
    });

    it('calls onSubmit when Create Agent button is clicked', () => {
      const onSubmit = vi.fn();
      render(<ConvertToAgentForm {...defaultProps} onSubmit={onSubmit} />);
      fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }));
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('calls onCancel when Cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<ConvertToAgentForm {...defaultProps} onCancel={onCancel} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('does not call onSubmit when button is disabled (isPending)', () => {
      const onSubmit = vi.fn();
      render(<ConvertToAgentForm {...defaultProps} isPending={true} onSubmit={onSubmit} />);
      const button = screen.getByRole('button', { name: 'Creating...' });
      fireEvent.click(button);
      // disabled buttons don't fire click events in the DOM
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('name input placeholder', () => {
    it('has placeholder text "my-agent"', () => {
      render(<ConvertToAgentForm {...defaultProps} convertName="" />);
      const input = screen.getByPlaceholderText('my-agent');
      expect(input).toBeDefined();
    });
  });

  describe('select value binding', () => {
    it('reflects ad-hoc type when convertType is ad-hoc', () => {
      render(<ConvertToAgentForm {...defaultProps} convertType="ad-hoc" />);
      const select = screen.getByLabelText('Agent Type') as HTMLSelectElement;
      expect(select.value).toBe('ad-hoc');
    });
  });
});
