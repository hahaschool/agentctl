import type { MemoryDrawerSearchResult } from '@agentctl/shared';
import { render, screen } from '@testing-library/react';

import { DrawerResultsSection } from './DrawerResultsSection';

function makeDrawerResult(
  overrides: Partial<MemoryDrawerSearchResult> = {},
): MemoryDrawerSearchResult {
  return {
    id: 'drawer-1',
    scope: 'project:agentctl',
    topic: 'rate-limiter-decision',
    source_type: 'session',
    source_id: 'session-1',
    chunk_index: 0,
    content_preview: 'we picked token bucket to smooth bursts during warm caches',
    score: 0.8123456,
    match_type: 'vector',
    ...overrides,
  };
}

describe('DrawerResultsSection', () => {
  it('renders the match-type pill, topic, score and preview for a single result', () => {
    render(<DrawerResultsSection drawerResults={[makeDrawerResult()]} />);

    const section = screen.getByTestId('drawer-results-section');
    expect(section).toBeDefined();

    // Header reflects total count.
    expect(screen.getByText('Raw Drawers (1)')).toBeDefined();

    // Pill label comes from matchTypeLabel (vector).
    expect(screen.getByTestId('drawer-match-badge').textContent).toBe('vector');

    // Topic rendered in a dedicated element.
    expect(screen.getByText('rate-limiter-decision')).toBeDefined();

    // Content preview rendered (short preview stays intact).
    expect(
      screen.getByText('we picked token bucket to smooth bursts during warm caches'),
    ).toBeDefined();
  });

  it('formats the score to two decimal places', () => {
    render(<DrawerResultsSection drawerResults={[makeDrawerResult({ score: 0.8123456 })]} />);

    expect(screen.getByText('0.81')).toBeDefined();
  });

  it('renders an em-dash when score is null', () => {
    render(<DrawerResultsSection drawerResults={[makeDrawerResult({ score: null })]} />);

    expect(screen.getByText('—')).toBeDefined();
  });

  it('falls back to the "unknown" label when match_type is null', () => {
    render(<DrawerResultsSection drawerResults={[makeDrawerResult({ match_type: null })]} />);

    expect(screen.getByTestId('drawer-match-badge').textContent).toBe('unknown');
  });

  it('renders up to 5 rows and shows a "+N more" footnote when overflowing', () => {
    const drawerResults: MemoryDrawerSearchResult[] = Array.from({ length: 7 }, (_, i) =>
      makeDrawerResult({
        id: `drawer-${i}`,
        topic: `topic-${i}`,
        content_preview: `preview ${i}`,
      }),
    );

    render(<DrawerResultsSection drawerResults={drawerResults} />);

    const rows = screen.getAllByTestId('drawer-result-row');
    expect(rows).toHaveLength(5);

    // Header still reflects the full count, not the visible count.
    expect(screen.getByText('Raw Drawers (7)')).toBeDefined();

    // Overflow footnote surfaces the remainder.
    expect(screen.getByTestId('drawer-results-overflow').textContent).toBe('+2 more');
  });

  it('does not render the overflow footnote when <= 5 results', () => {
    const drawerResults: MemoryDrawerSearchResult[] = Array.from({ length: 3 }, (_, i) =>
      makeDrawerResult({ id: `drawer-${i}`, topic: `topic-${i}` }),
    );

    render(<DrawerResultsSection drawerResults={drawerResults} />);

    expect(screen.queryByTestId('drawer-results-overflow')).toBeNull();
  });

  it('truncates long content previews to ~120 characters with an ellipsis', () => {
    const longPreview = 'x'.repeat(200);
    render(
      <DrawerResultsSection drawerResults={[makeDrawerResult({ content_preview: longPreview })]} />,
    );

    const rendered = screen.getByText(
      (content) => content.startsWith('x') && content.endsWith('…'),
    );
    // 120 chars + ellipsis = 121 visible chars.
    expect(rendered.textContent?.length).toBe(121);
  });
});
