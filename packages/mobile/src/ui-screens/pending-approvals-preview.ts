import type { PermissionRequest } from '@agentctl/shared';

const PREVIEW_EMPTY = 'No input preview';
const PREVIEW_MAX_KEYS = 4;
const SECRET_PREVIEW_MARKERS = ['authorization', 'cookie', 'key', 'password', 'secret', 'token'];

function isSecretLikeKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_PREVIEW_MARKERS.some((marker) => lower.includes(marker));
}

export function formatRemaining(timeoutAt: string, nowMs = Date.now()): string {
  const remainingMs = new Date(timeoutAt).getTime() - nowMs;
  if (remainingMs <= 0) return 'Expired';

  const totalSeconds = Math.floor(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}m ${String(seconds)}s`;
}

export function formatToolInputPreview(
  toolInput: PermissionRequest['toolInput'],
  description?: string,
): string {
  const trimmedDescription = description?.trim();
  if (trimmedDescription) {
    return trimmedDescription;
  }

  if (!toolInput || Object.keys(toolInput).length === 0) {
    return PREVIEW_EMPTY;
  }

  const keys = Object.keys(toolInput);
  const previewKeys = keys
    .slice(0, PREVIEW_MAX_KEYS)
    .map((key) => (isSecretLikeKey(key) ? '[redacted]' : key));
  const remainder = keys.length - previewKeys.length;
  const suffix = remainder > 0 ? ` +${String(remainder)} more` : '';

  return `Input fields: ${previewKeys.join(', ')}${suffix}`;
}
