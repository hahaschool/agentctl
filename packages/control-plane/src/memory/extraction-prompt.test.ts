import { describe, expect, it } from 'vitest';

import {
  EXTRACTION_QUALITY_RULES,
  buildExtractionPrompt,
} from './extraction-prompt.js';

describe('extraction quality rules', () => {
  it('contains all four quality rule headings', () => {
    expect(EXTRACTION_QUALITY_RULES).toContain('Rule 1');
    expect(EXTRACTION_QUALITY_RULES).toContain('Atomicity');
    expect(EXTRACTION_QUALITY_RULES).toContain('Rule 2');
    expect(EXTRACTION_QUALITY_RULES).toContain('Standalone');
    expect(EXTRACTION_QUALITY_RULES).toContain('Rule 3');
    expect(EXTRACTION_QUALITY_RULES).toContain('Outcome');
    expect(EXTRACTION_QUALITY_RULES).toContain('Rule 4');
    expect(EXTRACTION_QUALITY_RULES).toContain('Confidence');
  });

  it('specifies confidence scoring tiers', () => {
    // High confidence tier
    expect(EXTRACTION_QUALITY_RULES).toContain('0.95');
    // Speculative tier
    expect(EXTRACTION_QUALITY_RULES).toContain('0.40');
    // Below threshold note
    expect(EXTRACTION_QUALITY_RULES).toContain('Below 0.4');
  });

  it('includes entity_type in the expected output format', () => {
    expect(EXTRACTION_QUALITY_RULES).toContain('entity_type');
    expect(EXTRACTION_QUALITY_RULES).toContain('decision');
    expect(EXTRACTION_QUALITY_RULES).toContain('pattern');
  });

  it('includes tags field in the expected output format', () => {
    expect(EXTRACTION_QUALITY_RULES).toContain('tags');
    expect(EXTRACTION_QUALITY_RULES).toContain('security-reviewer');
    expect(EXTRACTION_QUALITY_RULES).toContain('code-reviewer');
  });

  it('includes JSON output format', () => {
    expect(EXTRACTION_QUALITY_RULES).toContain('"content"');
    expect(EXTRACTION_QUALITY_RULES).toContain('"confidence"');
  });
});

describe('buildExtractionPrompt', () => {
  const AGENT_ID = 'agent-test-1';
  const SESSION_TEXT = 'User: How do we handle errors? Assistant: Use typed error classes.';

  it('includes the agent ID in the prompt', () => {
    const prompt = buildExtractionPrompt(SESSION_TEXT, AGENT_ID);
    expect(prompt).toContain(AGENT_ID);
  });

  it('includes the session text in the prompt', () => {
    const prompt = buildExtractionPrompt(SESSION_TEXT, AGENT_ID);
    expect(prompt).toContain(SESSION_TEXT);
  });

  it('embeds the quality rules', () => {
    const prompt = buildExtractionPrompt(SESSION_TEXT, AGENT_ID);
    expect(prompt).toContain('Atomicity');
    expect(prompt).toContain('Standalone');
    expect(prompt).toContain('Outcome');
    expect(prompt).toContain('Confidence');
  });

  it('instructs the model to return only JSON', () => {
    const prompt = buildExtractionPrompt(SESSION_TEXT, AGENT_ID);
    expect(prompt).toContain('valid JSON array');
    expect(prompt).toContain('No markdown fences');
  });

  it('produces a non-empty, deterministic prompt', () => {
    const prompt1 = buildExtractionPrompt(SESSION_TEXT, AGENT_ID);
    const prompt2 = buildExtractionPrompt(SESSION_TEXT, AGENT_ID);
    expect(prompt1).toBe(prompt2);
    expect(prompt1.length).toBeGreaterThan(100);
  });
});
