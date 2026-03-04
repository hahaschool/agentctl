// ---------------------------------------------------------------------------
// StatusBadge — colored badge for agent status display.
// ---------------------------------------------------------------------------

import type { AgentStatus } from '@agentctl/shared';
import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<AgentStatus, string> = {
  registered: '#6b7280', // gray
  starting: '#f59e0b', // amber
  running: '#22c55e', // green
  stopping: '#f59e0b', // amber
  stopped: '#6b7280', // gray
  error: '#ef4444', // red
  timeout: '#ef4444', // red
  restarting: '#3b82f6', // blue
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type StatusBadgeProps = {
  status: AgentStatus;
};

export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  const backgroundColor = STATUS_COLORS[status] ?? '#6b7280';

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
