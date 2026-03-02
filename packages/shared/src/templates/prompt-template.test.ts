import { describe, expect, it } from 'vitest';

import type { PromptTemplateVars } from '../types/agent.js';
import { renderPromptTemplate } from './prompt-template.js';

const baseVars: PromptTemplateVars = {
  date: '2026-03-02',
  iteration: 5,
  lastResult: 'All tests passed',
  agentId: 'agent-001',
};

describe('renderPromptTemplate', () => {
  // ── Basic variable substitution ───────────────────────────────────

  it('replaces {{date}} with the date value', () => {
    const result = renderPromptTemplate('Today is {{date}}.', baseVars);
    expect(result).toBe('Today is 2026-03-02.');
  });

  it('replaces {{iteration}} with the iteration number as a string', () => {
    const result = renderPromptTemplate('Iteration {{iteration}}', baseVars);
    expect(result).toBe('Iteration 5');
  });

  it('replaces {{lastResult}} with the last result string', () => {
    const result = renderPromptTemplate('Previous: {{lastResult}}', baseVars);
    expect(result).toBe('Previous: All tests passed');
  });

  it('replaces {{agentId}} with the agent ID', () => {
    const result = renderPromptTemplate('Agent {{agentId}} reporting.', baseVars);
    expect(result).toBe('Agent agent-001 reporting.');
  });

  // ── Multiple variables ────────────────────────────────────────────

  it('replaces all known variables in a single template', () => {
    const template = 'Run #{{iteration}} for {{agentId}} on {{date}}. Last: {{lastResult}}';
    const result = renderPromptTemplate(template, baseVars);
    expect(result).toBe('Run #5 for agent-001 on 2026-03-02. Last: All tests passed');
  });

  it('handles the same variable appearing multiple times', () => {
    const result = renderPromptTemplate('{{agentId}} is {{agentId}}', baseVars);
    expect(result).toBe('agent-001 is agent-001');
  });

  // ── Optional/missing lastResult ───────────────────────────────────

  it('replaces {{lastResult}} with empty string when undefined', () => {
    const vars: PromptTemplateVars = {
      date: '2026-03-02',
      iteration: 0,
      agentId: 'agent-002',
    };
    const result = renderPromptTemplate('Result: {{lastResult}}', vars);
    expect(result).toBe('Result: ');
  });

  // ── Unknown variables ─────────────────────────────────────────────

  it('leaves unknown variables as-is', () => {
    const result = renderPromptTemplate('Hello {{unknown}} and {{date}}', baseVars);
    expect(result).toBe('Hello {{unknown}} and 2026-03-02');
  });

  it('leaves unknown variables with spaces as-is', () => {
    const result = renderPromptTemplate('{{ notAVar }}', baseVars);
    expect(result).toBe('{{ notAVar }}');
  });

  // ── Empty and edge cases ──────────────────────────────────────────

  it('returns empty string for an empty template', () => {
    const result = renderPromptTemplate('', baseVars);
    expect(result).toBe('');
  });

  it('returns the template unchanged when no variables are present', () => {
    const result = renderPromptTemplate('No variables here.', baseVars);
    expect(result).toBe('No variables here.');
  });

  it('handles iteration value of zero', () => {
    const vars: PromptTemplateVars = {
      date: '2026-01-01',
      iteration: 0,
      agentId: 'agent-zero',
    };
    const result = renderPromptTemplate('Iter: {{iteration}}', vars);
    expect(result).toBe('Iter: 0');
  });

  // ── Whitespace tolerance ──────────────────────────────────────────

  it('handles whitespace inside braces: {{ date }}', () => {
    const result = renderPromptTemplate('{{ date }}', baseVars);
    expect(result).toBe('2026-03-02');
  });

  it('handles varied whitespace: {{  agentId  }}', () => {
    const result = renderPromptTemplate('{{  agentId  }}', baseVars);
    expect(result).toBe('agent-001');
  });

  // ── Special characters in values ──────────────────────────────────

  it('handles special regex characters in variable values', () => {
    const vars: PromptTemplateVars = {
      date: '2026-03-02',
      iteration: 1,
      lastResult: 'Result: $100 (success) [done]',
      agentId: 'agent-001',
    };
    const result = renderPromptTemplate('{{lastResult}}', vars);
    expect(result).toBe('Result: $100 (success) [done]');
  });

  it('handles multiline lastResult', () => {
    const vars: PromptTemplateVars = {
      date: '2026-03-02',
      iteration: 2,
      lastResult: 'Line 1\nLine 2\nLine 3',
      agentId: 'agent-001',
    };
    const result = renderPromptTemplate('Previous:\n{{lastResult}}', vars);
    expect(result).toBe('Previous:\nLine 1\nLine 2\nLine 3');
  });

  // ── Large iteration number ────────────────────────────────────────

  it('handles large iteration numbers', () => {
    const vars: PromptTemplateVars = {
      date: '2026-12-31',
      iteration: 999999,
      agentId: 'agent-large',
    };
    const result = renderPromptTemplate('Iter {{iteration}}', vars);
    expect(result).toBe('Iter 999999');
  });

  // ── Partial braces (not valid template syntax) ────────────────────

  it('does not replace single braces or incomplete patterns', () => {
    const result = renderPromptTemplate('{date} and {{ and }}', baseVars);
    expect(result).toBe('{date} and {{ and }}');
  });

  // ── Template with only variables ──────────────────────────────────

  it('renders a template that is only a variable', () => {
    const result = renderPromptTemplate('{{date}}', baseVars);
    expect(result).toBe('2026-03-02');
  });
});
