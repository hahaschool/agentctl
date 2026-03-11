import { fireEvent, render, screen } from '@testing-library/react';

import type { ReportCardConfig, ReportType } from './ReportCard';
import { ReportCard } from './ReportCard';

const CONFIG: ReportCardConfig = {
  type: 'project-progress',
  title: 'Project Progress',
  description: 'Summarise completed milestones, open tasks, and next steps.',
  icon: <span>icon</span>,
};

describe('ReportCard', () => {
  it('renders the title and description', () => {
    render(<ReportCard config={CONFIG} />);

    expect(screen.getByText('Project Progress')).toBeDefined();
    expect(
      screen.getByText('Summarise completed milestones, open tasks, and next steps.'),
    ).toBeDefined();
  });

  it('is not visually selected by default', () => {
    render(<ReportCard config={CONFIG} />);

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects selected state via aria-pressed', () => {
    render(<ReportCard config={CONFIG} selected />);

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onSelect with the report type when clicked', () => {
    const onSelect = vi.fn<[ReportType], void>();
    render(<ReportCard config={CONFIG} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith('project-progress');
  });

  it('does not throw when onSelect is not provided', () => {
    render(<ReportCard config={CONFIG} />);

    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
  });

  it('renders the icon', () => {
    render(<ReportCard config={CONFIG} />);

    expect(screen.getByText('icon')).toBeDefined();
  });
});
