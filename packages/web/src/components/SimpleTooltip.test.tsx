import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock the shadcn/radix tooltip primitives to avoid needing a full Radix provider setup
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-root">{children}</div>
  ),
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
    <div data-testid="tooltip-trigger" data-as-child={asChild}>
      {children}
    </div>
  ),
  TooltipContent: ({ children, side }: { children: React.ReactNode; side?: string }) => (
    <div data-testid="tooltip-content" data-side={side}>
      {children}
    </div>
  ),
}));

import { SimpleTooltip } from './SimpleTooltip';

describe('SimpleTooltip', () => {
  describe('rendering', () => {
    it('renders the trigger child element', () => {
      render(
        <SimpleTooltip content="Tooltip text">
          <button type="button">Hover me</button>
        </SimpleTooltip>,
      );
      expect(screen.getByText('Hover me')).toBeDefined();
    });

    it('renders the tooltip content text', () => {
      render(
        <SimpleTooltip content="Help text">
          <span>Target</span>
        </SimpleTooltip>,
      );
      expect(screen.getByText('Help text')).toBeDefined();
    });

    it('wraps children in Tooltip root', () => {
      render(
        <SimpleTooltip content="Info">
          <span>Wrapped</span>
        </SimpleTooltip>,
      );
      expect(screen.getByTestId('tooltip-root')).toBeDefined();
    });
  });

  describe('trigger', () => {
    it('renders the trigger with asChild=true', () => {
      render(
        <SimpleTooltip content="Tip">
          <button type="button">Click</button>
        </SimpleTooltip>,
      );
      const trigger = screen.getByTestId('tooltip-trigger');
      expect(trigger.getAttribute('data-as-child')).toBe('true');
    });

    it('wraps the child inside TooltipTrigger', () => {
      render(
        <SimpleTooltip content="Tip">
          <span>Inside trigger</span>
        </SimpleTooltip>,
      );
      const trigger = screen.getByTestId('tooltip-trigger');
      expect(trigger.textContent).toContain('Inside trigger');
    });
  });

  describe('content', () => {
    it('places content text inside TooltipContent', () => {
      render(
        <SimpleTooltip content="Detailed info">
          <span>Trigger</span>
        </SimpleTooltip>,
      );
      const content = screen.getByTestId('tooltip-content');
      expect(content.textContent).toBe('Detailed info');
    });
  });

  describe('side prop', () => {
    it('defaults to "top" side', () => {
      render(
        <SimpleTooltip content="Top tooltip">
          <span>Trigger</span>
        </SimpleTooltip>,
      );
      const content = screen.getByTestId('tooltip-content');
      expect(content.getAttribute('data-side')).toBe('top');
    });

    it('passes side="right" to TooltipContent', () => {
      render(
        <SimpleTooltip content="Right tooltip" side="right">
          <span>Trigger</span>
        </SimpleTooltip>,
      );
      const content = screen.getByTestId('tooltip-content');
      expect(content.getAttribute('data-side')).toBe('right');
    });

    it('passes side="bottom" to TooltipContent', () => {
      render(
        <SimpleTooltip content="Bottom tooltip" side="bottom">
          <span>Trigger</span>
        </SimpleTooltip>,
      );
      const content = screen.getByTestId('tooltip-content');
      expect(content.getAttribute('data-side')).toBe('bottom');
    });

    it('passes side="left" to TooltipContent', () => {
      render(
        <SimpleTooltip content="Left tooltip" side="left">
          <span>Trigger</span>
        </SimpleTooltip>,
      );
      const content = screen.getByTestId('tooltip-content');
      expect(content.getAttribute('data-side')).toBe('left');
    });
  });

  describe('children rendering', () => {
    it('renders complex children inside the trigger', () => {
      render(
        <SimpleTooltip content="Complex">
          <div>
            <span>Nested</span>
            <strong>Content</strong>
          </div>
        </SimpleTooltip>,
      );
      expect(screen.getByText('Nested')).toBeDefined();
      expect(screen.getByText('Content')).toBeDefined();
    });

    it('renders an anchor element as child', () => {
      render(
        <SimpleTooltip content="Link info">
          <a href="/test">Link</a>
        </SimpleTooltip>,
      );
      expect(screen.getByText('Link')).toBeDefined();
    });
  });
});
