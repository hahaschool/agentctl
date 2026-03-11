import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { FactEditorModal } from './FactEditorModal';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FACT: MemoryFact = {
  id: 'fact-abc',
  scope: 'project:agentctl',
  content: 'Use BullMQ for task scheduling in the MVP phase.',
  content_model: 'text-embedding-3-small',
  entity_type: 'decision',
  confidence: 0.9,
  strength: 0.85,
  pinned: false,
  source: {
    session_id: 'session-1',
    agent_id: 'agent-1',
    machine_id: 'machine-1',
    turn_index: 3,
    extraction_method: 'manual',
  },
  valid_from: '2026-03-11T10:00:00.000Z',
  valid_until: null,
  created_at: '2026-03-11T10:00:00.000Z',
  accessed_at: '2026-03-11T10:00:00.000Z',
};

const EDGE: MemoryEdge = {
  id: 'edge-1',
  source_fact_id: 'fact-abc',
  target_fact_id: 'fact-xyz',
  relation: 'depends_on',
  weight: 0.7,
  created_at: '2026-03-11T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(props: Partial<React.ComponentProps<typeof FactEditorModal>> = {}) {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <FactEditorModal open onOpenChange={onOpenChange} mode="create" onSave={onSave} {...props} />,
  );
  return { onSave, onOpenChange };
}

// ---------------------------------------------------------------------------
// Tests: Create mode
// ---------------------------------------------------------------------------

describe('FactEditorModal — create mode', () => {
  it('renders the dialog with title "New Memory Fact"', () => {
    renderModal({ mode: 'create' });
    expect(screen.getByText('New Memory Fact')).toBeDefined();
  });

  it('renders all required form fields', () => {
    renderModal({ mode: 'create' });
    expect(screen.getByRole('textbox', { name: /content/i })).toBeDefined();
    expect(screen.getByLabelText(/entity type/i)).toBeDefined();
    expect(screen.getByLabelText(/scope/i)).toBeDefined();
    expect(screen.getByRole('slider', { name: /confidence/i })).toBeDefined();
    expect(screen.getByRole('switch', { name: /pinned/i })).toBeDefined();
  });

  it('shows validation error when content is empty and save is clicked', () => {
    renderModal({ mode: 'create' });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(screen.getByText(/content is required/i)).toBeDefined();
  });

  it('calls onSave with correct values when form is valid', () => {
    const { onSave } = renderModal({ mode: 'create' });

    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Prefer immutable data patterns.' },
    });

    fireEvent.change(screen.getByLabelText(/entity type/i), {
      target: { value: 'principle' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));

    expect(onSave).toHaveBeenCalledOnce();
    const [values] = onSave.mock.calls[0] as Parameters<typeof onSave>;
    expect(values.content).toBe('Prefer immutable data patterns.');
    expect(values.entityType).toBe('principle');
    expect(values.scope).toBe('global');
    expect(typeof values.confidence).toBe('number');
    expect(values.pinned).toBe(false);
    expect(values.pendingEdges).toHaveLength(0);
  });

  it('trims whitespace from content before saving', () => {
    const { onSave } = renderModal({ mode: 'create' });
    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: '  Fact with spaces  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(onSave.mock.calls[0][0].content).toBe('Fact with spaces');
  });

  it('reflects selected entity type in saved values', () => {
    const { onSave } = renderModal({ mode: 'create' });
    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Some fact.' },
    });
    fireEvent.change(screen.getByLabelText(/entity type/i), {
      target: { value: 'error' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(onSave.mock.calls[0][0].entityType).toBe('error');
  });

  it('toggles the pinned switch and reflects it in saved values', () => {
    const { onSave } = renderModal({ mode: 'create' });

    const toggle = screen.getByRole('switch', { name: /pinned/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'A pinned fact.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(onSave.mock.calls[0][0].pinned).toBe(true);
  });

  it('updates confidence when slider changes', () => {
    const { onSave } = renderModal({ mode: 'create' });
    const slider = screen.getByRole('slider', { name: /confidence/i });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(screen.getByText('60%')).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Low confidence fact.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(onSave.mock.calls[0][0].confidence).toBeCloseTo(0.6);
  });

  it('selects a scope preset and passes it to onSave', () => {
    const { onSave } = renderModal({ mode: 'create' });
    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Project-scoped fact.' },
    });
    fireEvent.change(screen.getByLabelText(/scope/i), {
      target: { value: 'project:agentctl' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(onSave.mock.calls[0][0].scope).toBe('project:agentctl');
  });
});

// ---------------------------------------------------------------------------
// Tests: Edit mode
// ---------------------------------------------------------------------------

describe('FactEditorModal — edit mode', () => {
  it('renders with title "Edit Memory Fact"', () => {
    renderModal({ mode: 'edit', initialFact: FACT });
    expect(screen.getByText('Edit Memory Fact')).toBeDefined();
  });

  it('pre-fills content from initialFact', () => {
    renderModal({ mode: 'edit', initialFact: FACT });
    const textarea = screen.getByRole('textbox', { name: /content/i }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(FACT.content);
  });

  it('pre-selects entity type from initialFact', () => {
    renderModal({ mode: 'edit', initialFact: FACT });
    const select = screen.getByLabelText(/entity type/i) as HTMLSelectElement;
    expect(select.value).toBe('decision');
  });

  it('pre-fills confidence slider from initialFact', () => {
    renderModal({ mode: 'edit', initialFact: FACT });
    const slider = screen.getByRole('slider', { name: /confidence/i }) as HTMLInputElement;
    expect(Number(slider.value)).toBe(90);
  });

  it('shows "Save changes" button label in edit mode', () => {
    renderModal({ mode: 'edit', initialFact: FACT });
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDefined();
  });

  it('calls onSave with updated content in edit mode', () => {
    const { onSave } = renderModal({ mode: 'edit', initialFact: FACT });
    const textarea = screen.getByRole('textbox', { name: /content/i });
    fireEvent.change(textarea, { target: { value: 'Updated fact content.' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave.mock.calls[0][0].content).toBe('Updated fact content.');
  });
});

// ---------------------------------------------------------------------------
// Tests: Existing edges (edit mode)
// ---------------------------------------------------------------------------

describe('FactEditorModal — existing edges', () => {
  it('renders existing edges', () => {
    renderModal({ mode: 'edit', initialFact: FACT, existingEdges: [EDGE] });
    expect(screen.getByText('depends on')).toBeDefined();
    expect(screen.getByText(/fact-xyz/)).toBeDefined();
  });

  it('marks an existing edge for removal when trash icon is clicked', () => {
    const { onSave } = renderModal({ mode: 'edit', initialFact: FACT, existingEdges: [EDGE] });

    const removeBtn = screen.getByRole('button', { name: /remove edge/i });
    fireEvent.click(removeBtn);

    // The edge row should appear struck-through / faded (opacity class applied)
    // Verify the edge id is included in edgesToRemove via onSave
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave.mock.calls[0][0].edgesToRemove).toContain('edge-1');
  });

  it('un-marks an edge removal when trash is clicked again', () => {
    const { onSave } = renderModal({ mode: 'edit', initialFact: FACT, existingEdges: [EDGE] });

    // Mark for removal
    fireEvent.click(screen.getByRole('button', { name: /remove edge/i }));
    // Undo
    fireEvent.click(screen.getByRole('button', { name: /undo remove edge/i }));

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave.mock.calls[0][0].edgesToRemove).not.toContain('edge-1');
  });
});

// ---------------------------------------------------------------------------
// Tests: Pending edges
// ---------------------------------------------------------------------------

describe('FactEditorModal — pending edges', () => {
  it('adds a pending edge when Add button is clicked', () => {
    renderModal({ mode: 'create' });
    fireEvent.change(screen.getByRole('textbox', { name: /target fact id/i }), {
      target: { value: 'fact-xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add edge/i }));
    expect(screen.getByText('fact-xyz')).toBeDefined();
  });

  it('adds a pending edge when Enter is pressed in the target field', () => {
    renderModal({ mode: 'create' });
    const targetInput = screen.getByRole('textbox', { name: /target fact id/i });
    fireEvent.change(targetInput, { target: { value: 'fact-enter' } });
    fireEvent.keyDown(targetInput, { key: 'Enter' });
    expect(screen.getByText('fact-enter')).toBeDefined();
  });

  it('clears the target input after adding an edge', () => {
    renderModal({ mode: 'create' });
    const targetInput = screen.getByRole('textbox', {
      name: /target fact id/i,
    }) as HTMLInputElement;
    fireEvent.change(targetInput, { target: { value: 'fact-xyz' } });
    fireEvent.click(screen.getByRole('button', { name: /add edge/i }));
    expect(targetInput.value).toBe('');
  });

  it('removes a pending edge when trash icon is clicked', () => {
    renderModal({ mode: 'create' });
    fireEvent.change(screen.getByRole('textbox', { name: /target fact id/i }), {
      target: { value: 'fact-to-remove' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add edge/i }));
    expect(screen.getByText('fact-to-remove')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /remove pending edge/i }));
    expect(screen.queryByText('fact-to-remove')).toBeNull();
  });

  it('does not add a duplicate pending edge with same target and relation', () => {
    renderModal({ mode: 'create' });
    const addEdge = () => {
      fireEvent.change(screen.getByRole('textbox', { name: /target fact id/i }), {
        target: { value: 'fact-dup' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add edge/i }));
    };
    addEdge();
    addEdge();
    // Only one instance should appear
    const items = screen.getAllByText(/fact-dup/);
    expect(items).toHaveLength(1);
  });

  it('disables Add button when target input is empty', () => {
    renderModal({ mode: 'create' });
    const addBtn = screen.getByRole('button', { name: /add edge/i });
    expect(addBtn).toBeDisabled();
  });

  it('includes pending edges in onSave values', () => {
    const { onSave } = renderModal({ mode: 'create' });
    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Fact with a relationship.' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /target fact id/i }), {
      target: { value: 'fact-related' },
    });
    fireEvent.change(screen.getByLabelText(/relation type/i), {
      target: { value: 'depends_on' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add edge/i }));
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));

    const [values] = onSave.mock.calls[0] as Parameters<typeof onSave>;
    expect(values.pendingEdges).toHaveLength(1);
    expect(values.pendingEdges[0].targetFactId).toBe('fact-related');
    expect(values.pendingEdges[0].relation).toBe('depends_on');
  });
});

// ---------------------------------------------------------------------------
// Tests: isSaving state
// ---------------------------------------------------------------------------

describe('FactEditorModal — isSaving', () => {
  it('disables the save button while saving', () => {
    renderModal({ mode: 'create', isSaving: true });
    const saveBtn = screen.getByRole('button', { name: /saving/i });
    expect(saveBtn).toBeDisabled();
  });

  it('shows "Saving…" label while isSaving is true', () => {
    renderModal({ mode: 'create', isSaving: true });
    expect(screen.getByText('Saving…')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Scope validation
// ---------------------------------------------------------------------------

describe('FactEditorModal — scope validation', () => {
  it('shows scope error when custom scope has invalid format', () => {
    renderModal({ mode: 'create' });

    // Switch to custom scope
    const scopeSelect = screen.getByLabelText(/scope/i);
    fireEvent.change(scopeSelect, { target: { value: '__custom__' } });

    // Enter an invalid scope
    const customInput = screen.getByRole('textbox', { name: /custom scope/i });
    fireEvent.change(customInput, { target: { value: 'invalid-scope' } });

    // Trigger validation by entering content and saving
    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Something.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));

    expect(screen.getByText(/scope must be global, project:.*agent:.*session:/i)).toBeDefined();
  });

  it('does not call onSave when scope is invalid', () => {
    const { onSave } = renderModal({ mode: 'create' });

    const scopeSelect = screen.getByLabelText(/scope/i);
    fireEvent.change(scopeSelect, { target: { value: '__custom__' } });
    const customInput = screen.getByRole('textbox', { name: /custom scope/i });
    fireEvent.change(customInput, { target: { value: 'bad' } });

    fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
      target: { value: 'Content.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create fact/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
