export const MEMORY_NAME_MAX_LENGTH = 128;

const PATH_SEPARATOR_PATTERN = /[/\\]/u;

export function sanitizeName(name: string): string {
  const trimmed = name.trim();

  if (
    trimmed.length === 0 ||
    trimmed.includes('..') ||
    hasControlCharacter(trimmed) ||
    PATH_SEPARATOR_PATTERN.test(trimmed)
  ) {
    throw new Error('Unsafe memory name');
  }

  return trimmed.slice(0, MEMORY_NAME_MAX_LENGTH);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}
