/**
 * Prompt Injection Detector — Phase 9.4 Security Module
 *
 * Detects and sanitizes prompt injection attempts in external content
 * before it is injected into agent context. Covers direct text patterns,
 * base64-encoded payloads, and unicode homoglyph obfuscation.
 */

// ── Types ────────────────────────────────────────────────────────────

export type InjectionSeverity = 'low' | 'medium' | 'high';

export type InjectionDetection = {
  pattern: string;
  severity: InjectionSeverity;
  offset: number;
  matched: string;
};

export type ScanResult = {
  safe: boolean;
  detections: InjectionDetection[];
  sanitized: string;
};

// ── Homoglyph normalisation map ──────────────────────────────────────
// Maps common unicode look-alikes to their ASCII equivalents.
// This is intentionally non-exhaustive but covers the most common attack
// vectors: Cyrillic, Greek, and other confusable codepoints.

const HOMOGLYPH_MAP: ReadonlyMap<string, string> = new Map([
  // Cyrillic
  ['\u0430', 'a'], // а → a
  ['\u0435', 'e'], // е → e
  ['\u043E', 'o'], // о → o
  ['\u0440', 'p'], // р → p
  ['\u0441', 'c'], // с → c
  ['\u0443', 'y'], // у → y
  ['\u0445', 'x'], // х → x
  ['\u0456', 'i'], // і → i
  ['\u0458', 'j'], // ј → j
  ['\u04BB', 'h'], // һ → h
  ['\u0455', 's'], // ѕ → s
  ['\u0454', 'e'], // є → e  (Ukrainian ye)
  ['\u0410', 'A'], // А → A
  ['\u0412', 'B'], // В → B
  ['\u0415', 'E'], // Е → E
  ['\u041A', 'K'], // К → K
  ['\u041C', 'M'], // М → M
  ['\u041D', 'H'], // Н → H
  ['\u041E', 'O'], // О → O
  ['\u0420', 'P'], // Р → P
  ['\u0421', 'C'], // С → C
  ['\u0422', 'T'], // Т → T
  ['\u0425', 'X'], // Х → X
  // Greek
  ['\u03B1', 'a'], // α → a
  ['\u03BF', 'o'], // ο → o
  ['\u03C1', 'p'], // ρ → p
  ['\u03B5', 'e'], // ε → e
  ['\u0391', 'A'], // Α → A
  ['\u0392', 'B'], // Β → B
  ['\u0395', 'E'], // Ε → E
  ['\u0397', 'H'], // Η → H
  ['\u0399', 'I'], // Ι → I
  ['\u039A', 'K'], // Κ → K
  ['\u039C', 'M'], // Μ → M
  ['\u039D', 'N'], // Ν → N
  ['\u039F', 'O'], // Ο → O
  ['\u03A1', 'P'], // Ρ → P
  ['\u03A4', 'T'], // Τ → T
  ['\u03A7', 'X'], // Χ → X
  // Fullwidth Latin
  ['\uFF41', 'a'], // ａ → a
  ['\uFF45', 'e'], // ｅ → e
  ['\uFF49', 'i'], // ｉ → i
  ['\uFF4F', 'o'], // ｏ → o
  ['\uFF53', 's'], // ｓ → s
  ['\uFF55', 'u'], // ｕ → u
]);

/**
 * Replace known unicode homoglyphs with their ASCII equivalents.
 */
export function normalizeHomoglyphs(input: string): string {
  let result = '';
  for (const char of input) {
    const replacement = HOMOGLYPH_MAP.get(char);
    result += replacement ?? char;
  }
  return result;
}

// ── Detection patterns ───────────────────────────────────────────────
// Each pattern is defined with a detection function, a label, and a
// severity level. Functions receive the homoglyph-normalised input.

type PatternDef = {
  name: string;
  severity: InjectionSeverity;
  detect: (input: string) => Array<{ offset: number; matched: string }>;
};

const REDACTION = '[REDACTED:injection]';

/**
 * Helper: find all case-insensitive occurrences of a literal phrase.
 */
function findAll(input: string, phrase: string): Array<{ offset: number; matched: string }> {
  const results: Array<{ offset: number; matched: string }> = [];
  const lower = input.toLowerCase();
  const target = phrase.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(target, pos);
    if (idx === -1) break;
    results.push({
      offset: idx,
      matched: input.slice(idx, idx + phrase.length),
    });
    pos = idx + 1;
  }
  return results;
}

/**
 * Helper: find all regex matches.
 */
function findAllRegex(input: string, regex: RegExp): Array<{ offset: number; matched: string }> {
  const results: Array<{ offset: number; matched: string }> = [];
  const global = new RegExp(regex.source, `${regex.flags.replace('g', '')}g`);
  for (;;) {
    const match = global.exec(input);
    if (match === null) break;
    results.push({
      offset: match.index,
      matched: match[0],
    });
    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      global.lastIndex += 1;
    }
  }
  return results;
}

const PATTERNS: readonly PatternDef[] = [
  // 1. "ignore previous instructions" / "ignore all instructions"
  {
    name: 'ignore_instructions',
    severity: 'high',
    detect: (input) => [
      ...findAll(input, 'ignore previous instructions'),
      ...findAll(input, 'ignore all instructions'),
      ...findAll(input, 'ignore your instructions'),
      ...findAll(input, 'disregard previous instructions'),
      ...findAll(input, 'disregard all instructions'),
    ],
  },

  // 2. "system:" prefix at start of line
  {
    name: 'system_prefix',
    severity: 'high',
    detect: (input) => findAllRegex(input, /^system\s*:/im),
  },

  // 3. <system> / </system> tags
  {
    name: 'system_tags',
    severity: 'high',
    detect: (input) => [...findAllRegex(input, /<\/?system>/gi)],
  },

  // 4. [INST] / [/INST] markers
  {
    name: 'inst_markers',
    severity: 'high',
    detect: (input) => [...findAll(input, '[INST]'), ...findAll(input, '[/INST]')],
  },

  // 5. "Human:" / "Assistant:" role markers at start of line
  {
    name: 'role_markers',
    severity: 'medium',
    detect: (input) => findAllRegex(input, /^(Human|Assistant)\s*:/im),
  },

  // 6. Base64-encoded payloads that decode to injection patterns
  {
    name: 'base64_injection',
    severity: 'high',
    detect: (input) => {
      const results: Array<{ offset: number; matched: string }> = [];
      // Match base64 strings that are at least 16 chars (to avoid false positives
      // on short tokens) and are word-boundary delimited
      const b64Regex = /(?:^|[\s"'`])([A-Za-z0-9+/]{16,}={0,2})(?:$|[\s"'`])/g;
      for (;;) {
        const match = b64Regex.exec(input);
        if (match === null) break;
        const candidate = match[1];
        try {
          const decoded = Buffer.from(candidate, 'base64').toString('utf-8');
          // Check if decoded content looks like text (has enough printable chars)
          const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length;
          if (printableRatio >= 0.7) {
            // Now scan the decoded text for injection patterns
            const decodedLower = decoded.toLowerCase();
            const injectionPhrases = [
              'ignore previous instructions',
              'ignore all instructions',
              'system:',
              '<system>',
              '</system>',
              '[inst]',
              '[/inst]',
            ];
            for (const phrase of injectionPhrases) {
              if (decodedLower.includes(phrase)) {
                const offset = match.index + (match[0].length - match[1].length);
                results.push({
                  offset,
                  matched: candidate,
                });
                break;
              }
            }
          }
        } catch {
          // Not valid base64 — skip
        }
        // Prevent infinite loop
        if (match[0].length === 0) {
          b64Regex.lastIndex += 1;
        }
      }
      return results;
    },
  },

  // 7. Separator attacks: "\n\n---\nNew instructions:"
  {
    name: 'separator_attack',
    severity: 'medium',
    detect: (input) => [
      ...findAllRegex(input, /\n\n---\n\s*new instructions\s*:/gi),
      ...findAllRegex(input, /\n\n---\n\s*updated instructions\s*:/gi),
      ...findAllRegex(input, /\n\n---\n\s*override\s*:/gi),
    ],
  },
];

// ── Core scanning logic ──────────────────────────────────────────────

/**
 * Truncate a matched string to a maximum length for safe inclusion
 * in detection reports.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Scan an input string for prompt injection attempts.
 *
 * The input is first normalised for unicode homoglyphs, then checked
 * against all detection patterns. The returned `ScanResult` includes
 * whether the input is considered safe, all detections found, and a
 * sanitised version with injections replaced by `[REDACTED:injection]`.
 */
export function scanForInjections(input: string): ScanResult {
  if (!input) {
    return { safe: true, detections: [], sanitized: input ?? '' };
  }

  const normalised = normalizeHomoglyphs(input);
  const detections: InjectionDetection[] = [];

  for (const pattern of PATTERNS) {
    const matches = pattern.detect(normalised);
    for (const match of matches) {
      detections.push({
        pattern: pattern.name,
        severity: pattern.severity,
        offset: match.offset,
        matched: truncate(match.matched, 100),
      });
    }
  }

  // Sort detections by offset for deterministic output
  detections.sort((a, b) => a.offset - b.offset);

  const sanitized = sanitizeInput(input);

  return {
    safe: detections.length === 0,
    detections,
    sanitized,
  };
}

/**
 * Sanitise an input string by replacing detected injection patterns
 * with `[REDACTED:injection]` and escaping angle brackets in suspicious
 * contexts.
 *
 * The function first normalises unicode homoglyphs, then applies all
 * pattern replacements, and finally escapes remaining `<` / `>` that
 * appear to be tag-like but were not caught by explicit patterns.
 */
export function sanitizeInput(input: string): string {
  if (!input) return input ?? '';

  // Work on normalised copy to catch homoglyph attacks
  let result = normalizeHomoglyphs(input);

  // 1. Replace "ignore previous/all/your instructions" and "disregard" variants
  result = result.replace(/ignore\s+(previous|all|your)\s+instructions/gi, REDACTION);
  result = result.replace(/disregard\s+(previous|all)\s+instructions/gi, REDACTION);

  // 2. Replace "system:" at start of line
  result = result.replace(/^(system\s*:)/gim, REDACTION);

  // 3. Replace <system> / </system> tags
  result = result.replace(/<\/?system>/gi, REDACTION);

  // 4. Replace [INST] / [/INST] markers
  result = result.replace(/\[\/?INST\]/gi, REDACTION);

  // 5. Replace "Human:" / "Assistant:" at start of line
  result = result.replace(/^(Human|Assistant)\s*:/gim, REDACTION);

  // 6. Replace base64-encoded injection payloads
  result = result.replace(/(?<=^|[\s"'`])([A-Za-z0-9+/]{16,}={0,2})(?=$|[\s"'`])/g, (candidate) => {
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf-8');
      const printableRatio = decoded.replace(/[^\x20-\x7E]/g, '').length / decoded.length;
      if (printableRatio < 0.7) return candidate;

      const decodedLower = decoded.toLowerCase();
      const injectionPhrases = [
        'ignore previous instructions',
        'ignore all instructions',
        'system:',
        '<system>',
        '</system>',
        '[inst]',
        '[/inst]',
      ];
      for (const phrase of injectionPhrases) {
        if (decodedLower.includes(phrase)) {
          return REDACTION;
        }
      }
    } catch {
      // Not valid base64 — leave as-is
    }
    return candidate;
  });

  // 7. Replace separator attacks
  result = result.replace(
    /\n\n---\n\s*(new instructions|updated instructions|override)\s*:/gi,
    `\n\n---\n${REDACTION}`,
  );

  // 8. Escape remaining suspicious angle brackets (tag-like patterns that
  //    were not caught above, e.g. <prompt>, <instruction>)
  result = result.replace(
    /<\/?(?:prompt|instruction|context|role|user|assistant|sys)\b[^>]*>/gi,
    (match) => match.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );

  return result;
}
