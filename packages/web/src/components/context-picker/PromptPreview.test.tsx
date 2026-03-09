import { describe, expect, it } from 'vitest';
import { buildPromptPreview } from './PromptPreview';

describe('buildPromptPreview', () => {
  it('shows resume strategy message', () => {
    const result = buildPromptPreview({
      strategy: 'resume',
      forkPrompt: 'Fix the bug',
      selectedMessages: [],
    });
    expect(result).toContain('Strategy: Resume');
    expect(result).toContain('Full session history will be preserved');
    expect(result).toContain('Fix the bug');
  });

  it('shows jsonl-truncation with index', () => {
    const result = buildPromptPreview({
      strategy: 'jsonl-truncation',
      forkPrompt: 'Continue',
      forkAtIndex: 42,
      selectedMessages: [],
    });
    expect(result).toContain('Strategy: JSONL Truncation');
    expect(result).toContain('42');
    expect(result).toContain('Continue');
  });

  it('shows jsonl-truncation with ? when no index', () => {
    const result = buildPromptPreview({
      strategy: 'jsonl-truncation',
      forkPrompt: 'Continue',
      selectedMessages: [],
    });
    expect(result).toContain('?');
  });

  it('shows context-injection with selected messages', () => {
    const result = buildPromptPreview({
      strategy: 'context-injection',
      forkPrompt: 'Do the thing',
      selectedMessages: [
        { type: 'human', content: 'Set up auth' },
        { type: 'assistant', content: 'Created middleware' },
      ],
    });
    expect(result).toContain('Strategy: Context Injection');
    expect(result).toContain('[human] Set up auth');
    expect(result).toContain('[assistant] Created middleware');
    expect(result).toContain('Do the thing');
  });

  it('truncates long message content at 200 chars', () => {
    const longContent = 'A'.repeat(300);
    const result = buildPromptPreview({
      strategy: 'context-injection',
      forkPrompt: 'test',
      selectedMessages: [{ type: 'human', content: longContent }],
    });
    expect(result).toContain('A'.repeat(200));
    expect(result).toContain('...');
    expect(result).not.toContain('A'.repeat(300));
  });

  it('includes system prompt when provided', () => {
    const result = buildPromptPreview({
      strategy: 'resume',
      forkPrompt: 'Go',
      selectedMessages: [],
      systemPrompt: 'You are a helpful assistant',
    });
    expect(result).toContain('## System Prompt');
    expect(result).toContain('You are a helpful assistant');
  });

  it('shows (empty) when fork prompt is empty', () => {
    const result = buildPromptPreview({
      strategy: 'resume',
      forkPrompt: '',
      selectedMessages: [],
    });
    expect(result).toContain('(empty)');
  });
});
