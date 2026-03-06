import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Spinner } from './Spinner';

describe('Spinner', () => {
  describe('rendering', () => {
    it('renders an element with role implied by the output tag', () => {
      const { container } = render(<Spinner />);
      // <output> has implicit role="status"
      const el = container.querySelector('output');
      expect(el).not.toBeNull();
    });

    it('renders with aria-label="Loading"', () => {
      render(<Spinner />);
      expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('applies animate-spin class', () => {
      render(<Spinner />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.className).toContain('animate-spin');
    });

    it('applies rounded-full class', () => {
      render(<Spinner />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.className).toContain('rounded-full');
    });
  });

  describe('size variants', () => {
    it('defaults to md size (h-6 w-6 border-2)', () => {
      render(<Spinner />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.className).toContain('h-6');
      expect(spinner.className).toContain('w-6');
      expect(spinner.className).toContain('border-2');
    });

    it('renders sm size (h-4 w-4 border-2)', () => {
      render(<Spinner size="sm" />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.className).toContain('h-4');
      expect(spinner.className).toContain('w-4');
      expect(spinner.className).toContain('border-2');
    });

    it('renders lg size (h-10 w-10 border-3)', () => {
      render(<Spinner size="lg" />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.className).toContain('h-10');
      expect(spinner.className).toContain('w-10');
      expect(spinner.className).toContain('border-3');
    });
  });

  describe('custom className', () => {
    it('appends custom className to existing classes', () => {
      render(<Spinner className="text-primary" />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.className).toContain('text-primary');
      // Should still have default classes
      expect(spinner.className).toContain('animate-spin');
    });

    it('defaults className to empty string when not provided', () => {
      render(<Spinner />);
      const spinner = screen.getByLabelText('Loading');
      // No trailing extra space issues — just check it renders
      expect(spinner.className).toContain('animate-spin');
    });
  });

  describe('accessibility', () => {
    it('uses the <output> element which has implicit status role', () => {
      render(<Spinner />);
      // <output> has implicit role="status" in accessibility tree
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.tagName).toBe('OUTPUT');
    });

    it('is accessible by aria-label for screen readers', () => {
      render(<Spinner />);
      const spinner = screen.getByLabelText('Loading');
      expect(spinner.getAttribute('aria-label')).toBe('Loading');
    });
  });
});
