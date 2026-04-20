export const DEFAULT_MEMORY_QUERY_MAX_CHARS = 250;
export const DEFAULT_MEMORY_SANITIZER_FALLBACK_WARN_RATIO = 0.05;

export type MemoryQuerySanitizerStage =
  | 'passthrough'
  | 'question_extracted'
  | 'tail_fallback'
  | 'truncated'
  | 'empty';

export type SanitizedMemoryQuery = {
  query: string;
  stage: MemoryQuerySanitizerStage;
  originalChars: number;
  sanitizedChars: number;
  hasPrefixSmell: boolean;
  maxChars: number;
};

export type SanitizeQueryOptions = {
  maxChars?: number;
};

type Environment = Record<string, string | undefined>;

const ROLE_MARKER_PATTERN =
  /(?:^|[\n\r]|[|> \t-]+)(?:system|developer|user|human|assistant|ai|tool)\s*:/i;
const USER_ROLE_MARKER_PATTERN = /(?:^|[\n\r]|[|> \t-]+)(?:user|human)\s*:/gi;
const LEADING_ROLE_MARKER_PATTERN =
  /^(?:[|> \t#*-]+)?(?:system|developer|user|human|assistant|ai|tool)\s*:\s*/i;
const PREFIX_SMELL_PATTERNS = [
  ROLE_MARKER_PATTERN,
  /\b(system prompt|developer instructions|conversation transcript|current conversation)\b/i,
  /^\s*(?:you are|instructions:|context:)/i,
  /^\s*```/,
  /[\n\r]\s*```/,
  /<\|im_start\|>/i,
  /^-{3,}\s*(?:system|user|assistant)?/i,
] as const;

export const MEMORY_QUERY_MAX_CHARS = readPositiveInteger(
  readEnv('MEMORY_QUERY_MAX_CHARS'),
  DEFAULT_MEMORY_QUERY_MAX_CHARS,
);

export const MEMORY_SANITIZER_FALLBACK_WARN_RATIO = readPositiveNumber(
  readEnv('MEMORY_SANITIZER_FALLBACK_WARN_RATIO'),
  DEFAULT_MEMORY_SANITIZER_FALLBACK_WARN_RATIO,
);

export function sanitizeQuery(
  rawQuery: string | null | undefined,
  options: SanitizeQueryOptions = {},
): SanitizedMemoryQuery {
  const raw = rawQuery ?? '';
  const originalChars = raw.length;
  const maxChars = normalizeMaxChars(options.maxChars);
  const trimmed = raw.trim();
  const hasPrefixSmell = detectPrefixSmell(trimmed);

  if (trimmed.length === 0) {
    return buildResult('', 'empty', originalChars, hasPrefixSmell, maxChars);
  }

  if (trimmed.length <= maxChars && !hasPrefixSmell) {
    return buildResult(trimmed, 'passthrough', originalChars, hasPrefixSmell, maxChars);
  }

  const question = extractLastQuestion(trimmed);
  if (question.length > 0) {
    return enforceMaxChars(question, 'question_extracted', originalChars, hasPrefixSmell, maxChars);
  }

  const fallback = extractTailSentence(trimmed);
  if (fallback.length === 0) {
    return buildResult('', 'empty', originalChars, hasPrefixSmell, maxChars);
  }

  return enforceMaxChars(fallback, 'tail_fallback', originalChars, hasPrefixSmell, maxChars);
}

export function querySanitizerLogFields(
  result: SanitizedMemoryQuery,
): Record<string, boolean | number | string> {
  return {
    'query.sanitizer_stage': result.stage,
    'query.has_prefix_smell': result.hasPrefixSmell,
    'query.original_chars': result.originalChars,
    'query.sanitized_chars': result.sanitizedChars,
  };
}

function enforceMaxChars(
  query: string,
  stage: Exclude<MemoryQuerySanitizerStage, 'empty' | 'truncated'>,
  originalChars: number,
  hasPrefixSmell: boolean,
  maxChars: number,
): SanitizedMemoryQuery {
  if (query.length <= maxChars) {
    return buildResult(query, stage, originalChars, hasPrefixSmell, maxChars);
  }

  return buildResult(
    query.slice(0, maxChars).trim(),
    'truncated',
    originalChars,
    hasPrefixSmell,
    maxChars,
  );
}

function extractLastQuestion(query: string): string {
  const lastQuestionIndex = query.lastIndexOf('?');
  if (lastQuestionIndex === -1) {
    return '';
  }

  const userQuestion = extractLastUserMarkedQuestion(query, lastQuestionIndex);
  if (userQuestion.length > 0) {
    return userQuestion;
  }

  const prefix = query.slice(0, lastQuestionIndex);
  const sentenceStart =
    Math.max(
      prefix.lastIndexOf('\n'),
      prefix.lastIndexOf('\r'),
      prefix.lastIndexOf('.'),
      prefix.lastIndexOf('!'),
      prefix.lastIndexOf('?'),
    ) + 1;

  return cleanCandidate(query.slice(sentenceStart, lastQuestionIndex + 1));
}

function extractLastUserMarkedQuestion(query: string, lastQuestionIndex: number): string {
  const prefix = query.slice(0, lastQuestionIndex + 1);
  let markerEnd = -1;

  for (const match of prefix.matchAll(USER_ROLE_MARKER_PATTERN)) {
    markerEnd = match.index + match[0].length;
  }

  if (markerEnd === -1) {
    return '';
  }

  return cleanCandidate(query.slice(markerEnd, lastQuestionIndex + 1));
}

function extractTailSentence(query: string): string {
  const withoutTrailingPunctuation = query.trimEnd();
  const matches = [...withoutTrailingPunctuation.matchAll(/[^.!?]+[.!?]?/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const candidate = cleanCandidate(match[0] ?? '');
    if (candidate.length > 0) {
      return candidate;
    }
  }

  return cleanCandidate(query);
}

function cleanCandidate(candidate: string): string {
  let cleaned = candidate
    .replace(/```[a-zA-Z0-9_-]*\s*/g, '')
    .replace(/```/g, '')
    .trim();

  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(LEADING_ROLE_MARKER_PATTERN, '').trim();
  } while (cleaned !== previous);

  const embeddedUserMarker = findLastEmbeddedUserMarker(cleaned);
  if (embeddedUserMarker !== -1) {
    cleaned = cleaned.slice(embeddedUserMarker).replace(LEADING_ROLE_MARKER_PATTERN, '').trim();
  }

  return cleaned;
}

function findLastEmbeddedUserMarker(value: string): number {
  let markerIndex = -1;
  for (const match of value.matchAll(USER_ROLE_MARKER_PATTERN)) {
    markerIndex = match.index;
  }
  return markerIndex;
}

function detectPrefixSmell(query: string): boolean {
  return PREFIX_SMELL_PATTERNS.some((pattern) => pattern.test(query));
}

function buildResult(
  query: string,
  stage: MemoryQuerySanitizerStage,
  originalChars: number,
  hasPrefixSmell: boolean,
  maxChars: number,
): SanitizedMemoryQuery {
  return {
    query,
    stage,
    originalChars,
    sanitizedChars: query.length,
    hasPrefixSmell,
    maxChars,
  };
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (maxChars === undefined) {
    return MEMORY_QUERY_MAX_CHARS;
  }
  return Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : DEFAULT_MEMORY_QUERY_MAX_CHARS;
}

function readEnv(name: string): string | undefined {
  const maybeProcess = globalThis as typeof globalThis & { process?: { env?: Environment } };
  return maybeProcess.process?.env?.[name];
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
