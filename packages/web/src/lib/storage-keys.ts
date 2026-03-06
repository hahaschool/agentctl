/** Centralized localStorage key constants to prevent typos and ease maintenance. */
export const STORAGE_KEYS = {
  DEFAULT_MODEL: 'agentctl:defaultModel',
  AUTO_REFRESH_INTERVAL: 'agentctl:autoRefreshInterval',
  MAX_DISPLAY_MESSAGES: 'agentctl:maxDisplayMessages',
  LAST_MACHINE_ID: 'agentctl:lastMachineId',
} as const;
