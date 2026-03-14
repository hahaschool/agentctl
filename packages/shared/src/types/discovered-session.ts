import type { ManagedRuntime } from './runtime-management.js';

export type DiscoveredSession = {
  sessionId: string;
  projectPath: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  branch: string | null;
  runtime?: ManagedRuntime;
};
