import type { RuntimeSessionInfo } from '../services/api-client.js';

export function getRuntimeTabBadgeCount(runtimeSessions: RuntimeSessionInfo[]): number {
  return runtimeSessions.filter((session) => session.status === 'handing_off').length;
}
