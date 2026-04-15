// ---------------------------------------------------------------------------
// Mesh auto-update — `/settings` panel queries + mutations (roadmap §33.11).
// The matching backend routes live in
// `packages/control-plane/src/api/routes/mesh-auto-update.ts`.
// ---------------------------------------------------------------------------

import type {
  AutoUpdateDryRunEvent,
  AutoUpdateStatus,
  AutoUpdateToggleRequest,
} from '@agentctl/shared';

import { request } from './core';

export type { AutoUpdateDryRunEvent, AutoUpdateStatus, AutoUpdateToggleRequest };

export const meshAutoUpdateApi = {
  getAutoUpdateStatus: () => request<AutoUpdateStatus>('/api/mesh/auto-update'),

  toggleAutoUpdate: (body: AutoUpdateToggleRequest) =>
    request<AutoUpdateStatus>('/api/mesh/auto-update/toggle', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/**
 * Open an SSE stream for `POST /api/mesh/auto-update/dry-run` and invoke
 * `onEvent` once per `data:` frame. The returned `abort` function closes the
 * underlying fetch so component unmount can cancel an in-flight run.
 */
export async function streamAutoUpdateDryRun(
  onEvent: (event: AutoUpdateDryRunEvent) => void,
  options?: { readonly signal?: AbortSignal },
): Promise<void> {
  const response = await fetch('/api/mesh/auto-update/dry-run', {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    signal: options?.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`dry-run stream failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are delimited by \n\n per the SSE protocol.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
        if (dataLine) {
          const payload = dataLine.slice('data:'.length).trim();
          try {
            const parsed = JSON.parse(payload) as AutoUpdateDryRunEvent;
            onEvent(parsed);
          } catch {
            // ignore malformed frame — server should never emit one
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
