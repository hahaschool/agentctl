// ---------------------------------------------------------------------------
// Experience Extraction Prompt — §7.3
//
// Specialized prompt for extracting decisions, patterns, errors, and lessons
// from completed Claude Code sessions. Reuses the quality-rule structure from
// the control-plane extraction-prompt but focuses specifically on experience
// knowledge (as opposed to generic fact extraction).
// ---------------------------------------------------------------------------

/**
 * The entity types that the experience extractor should produce.
 * Kept as a narrow subset of EntityType to guide the LLM.
 */
export const EXPERIENCE_ENTITY_TYPES = ['experience', 'decision', 'pattern', 'error'] as const;

export type ExperienceEntityType = (typeof EXPERIENCE_ENTITY_TYPES)[number];

/** Shape of a single extracted experience fact from the LLM. */
export type ExtractedExperience = {
  content: string;
  entity_type: ExperienceEntityType;
  confidence: number;
  tags: string[];
  may_contradict: boolean;
};

/** Verbatim prompt block sent to the LLM for experience extraction. */
export const EXPERIENCE_EXTRACTION_RULES = `
## Experience Extraction Rules (MANDATORY)

You are analysing a completed AI coding session transcript. Extract the key
**decisions**, **patterns**, **errors/gotchas**, and **general lessons learned**.

Only extract knowledge that would be useful in future sessions. Skip trivial
actions (file reads, simple edits) unless they revealed something surprising.

### Entity Types — pick exactly ONE per fact

- **decision** — An architectural choice, library pick, or design trade-off that
  was explicitly made. Include the rationale and any rejected alternatives.
- **pattern** — A successful approach, technique, or workflow that worked well
  and is worth repeating. Include enough detail to reproduce it.
- **error** — A bug, gotcha, unexpected behaviour, or workaround that was
  discovered. Include the root cause and the resolution (if any).
- **experience** — A general lesson learned that doesn't fit the above three but
  is still valuable (e.g., performance insight, tooling tip, process observation).

### Quality Rules

1. **Atomicity** — One fact = one thing. Do not combine multiple insights.
2. **Standalone** — Each fact must be understandable without the original session.
   Use specific names, never pronouns.
3. **Outcome** — Include what happened and why, not just what was attempted.
4. **Confidence** — Score 0.0–1.0 based on evidence:
   - 0.90–1.0 : Explicit decision or confirmed outcome
   - 0.70–0.89 : Strong evidence (tests passed, deploy succeeded)
   - 0.50–0.69 : Weak evidence (single mention, partial confirmation)
   - Below 0.50 : Do not extract
5. **Contradiction flag** — Set \`may_contradict: true\` if the fact overrides
   or reverses a previous decision/pattern.

### Output Format

Return a JSON array. No markdown fences, no explanation, no extra text.

\`\`\`json
[
  {
    "content": "<atomic, standalone fact with outcome>",
    "entity_type": "<decision|pattern|error|experience>",
    "confidence": <0.5–1.0>,
    "tags": ["<optional domain tags>"],
    "may_contradict": <true|false>
  }
]
\`\`\`
`.trim();

/**
 * Build the complete experience extraction prompt for a session transcript.
 *
 * @param sessionText - The raw session transcript (truncated if needed)
 * @param agentId     - Agent that ran the session
 * @param sessionId   - Session identifier for context
 * @returns Complete prompt string
 */
export function buildExperienceExtractionPrompt(
  sessionText: string,
  agentId: string,
  sessionId: string,
): string {
  return [
    `You are an experience extraction system for AgentCTL (agent: ${agentId}, session: ${sessionId}).`,
    '',
    'Extract durable lessons from the following completed AI coding session.',
    'These will be stored in a knowledge base and surfaced in future sessions.',
    '',
    EXPERIENCE_EXTRACTION_RULES,
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
