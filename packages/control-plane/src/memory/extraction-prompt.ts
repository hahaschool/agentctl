// ---------------------------------------------------------------------------
// Meta-cognition extraction quality rules for memory fact extraction
//
// These rules are embedded in the LLM extraction prompt to guide the model
// toward producing high-quality, atomic, standalone facts with accurate
// confidence scores.
//
// Quality rules (§3.6 — Meta-cognition):
//   1. Atomicity      — each fact must assert exactly ONE thing
//   2. Standalone     — understandable without reading the source session
//   3. Outcome        — include result/consequence, not just the action
//   4. Confidence     — scored by evidence strength (direct > inferred > speculative)
//   5. Contradiction  — flag if the fact contradicts existing knowledge
// ---------------------------------------------------------------------------

/** Verbatim quality-rule block injected into the extraction LLM prompt. */
export const EXTRACTION_QUALITY_RULES = `
## Fact Extraction Quality Rules (MANDATORY)

You are extracting memory facts from an AI coding session. Each fact MUST satisfy ALL of the following rules:

### Rule 1 — Atomicity
- Each fact must assert EXACTLY ONE thing (one concept per fact).
- WRONG: "We chose TypeScript for the frontend and PostgreSQL for the database."
- RIGHT (two facts):
  - "TypeScript was chosen for the frontend."
  - "PostgreSQL was chosen as the database."

### Rule 2 — Standalone with Context
- Each fact must be fully understandable WITHOUT reading the original session.
- Include enough context: project name, component, when it happened, why, and any constraints.
- Use specific names and identifiers — NEVER pronouns ("it", "they", "this approach").
- WRONG: "Used the new approach."
- RIGHT: "AgentCTL memory module uses Reciprocal Rank Fusion (RRF) to combine vector and BM25 search results."

### Rule 3 — Outcome / Result
- Facts must record WHAT HAPPENED and WHY, not just what was attempted.
- Include the result or consequence of the action.
- WRONG: "Tried to add an index."
- RIGHT: "Adding a GIN index on memory_facts.tags reduced tag-filter query time from 200ms to 12ms."

### Rule 4 — Confidence Scoring
Rate your own confidence 0.0–1.0 based on evidence strength:
- 0.95–1.0  : Directly stated as a decision or established fact (explicit commit, explicit decision)
- 0.80–0.94 : Inferred from strong signals (multiple mentions, test passing, deploy succeeded)
- 0.60–0.79 : Inferred from weak signals (single mention, partial evidence)
- 0.40–0.59 : Speculative (proposed, discussed but not confirmed)
- Below 0.4 : Do not extract — not worth storing.

### Rule 5 — Contradiction Flag
- If a fact appears to contradict or supersede something that was previously true, set "may_contradict" to true.
- Examples of contradictions: a config option changed, a previous decision was reversed, a previously-valid API endpoint was removed.
- When in doubt, prefer flagging (false negatives are more costly than false positives here).

### Output Format
Return a JSON array of fact objects:
\`\`\`json
[
  {
    "content": "<atomic, standalone fact with outcome>",
    "entity_type": "<one of: code_artifact|decision|pattern|error|person|concept|preference|skill|experience|principle|question>",
    "confidence": <0.0–1.0>,
    "tags": ["<optional role or domain tags, e.g. 'security-reviewer', 'code-reviewer'>"],
    "may_contradict": <true|false>
  }
]
\`\`\`
`.trim();

/**
 * Build the full extraction prompt for a given session text.
 *
 * @param sessionText - Raw session text to extract facts from
 * @param agentId     - Agent ID for scoping extracted facts
 * @returns Complete prompt string ready to send to the LLM
 */
export function buildExtractionPrompt(sessionText: string, agentId: string): string {
  return [
    `You are a knowledge extraction system for AgentCTL (agent ID: ${agentId}).`,
    '',
    'Extract durable, reusable facts from the following AI coding session transcript.',
    'These facts will be stored in a vector database and retrieved in future sessions.',
    '',
    EXTRACTION_QUALITY_RULES,
    '',
    '## Session Transcript',
    '',
    sessionText,
    '',
    '## Output',
    '',
    'Return ONLY a valid JSON array. No markdown fences, no explanation.',
  ].join('\n');
}
