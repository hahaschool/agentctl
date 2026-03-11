// ---------------------------------------------------------------------------
// SessionActionBar — unified action surface for pause/resume/stop across
// all runtime session types. Displays actions based on session status.
// ---------------------------------------------------------------------------

import type { ManagedSessionStatus } from '@agentctl/shared';
import type React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionActionBarProps = {
  sessionStatus: ManagedSessionStatus | 'active' | 'paused' | 'ended';
  isLoading?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onClose?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_ICONS: Record<string, string> = {
  pause: '\u23F8', // pause
  resume: '\u25B6', // play
  stop: '\u23F9', // stop
  close: '\u2715', // X
};

function canPause(status: string): boolean {
  return status === 'active';
}

function canResume(status: string): boolean {
  return status === 'paused' || status === 'ended' || status === 'error';
}

function canStop(status: string): boolean {
  return status === 'active' || status === 'starting' || status === 'paused';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionActionBar({
  sessionStatus,
  isLoading = false,
  onPause,
  onResume,
  onStop,
  onClose,
}: SessionActionBarProps): React.JSX.Element {
  const showPause = canPause(sessionStatus) && onPause;
  const showResume = canResume(sessionStatus) && onResume;
  const showStop = canStop(sessionStatus) && onStop;

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor(sessionStatus) }]} />
        <Text style={styles.statusText}>{sessionStatus.toUpperCase()}</Text>
      </View>

      <View style={styles.actions}>
        {showPause && (
          <TouchableOpacity
            style={[styles.actionButton, styles.pauseButton]}
            onPress={onPause}
            disabled={isLoading}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{ACTION_ICONS.pause}</Text>
            <Text style={styles.actionLabel}>Pause</Text>
          </TouchableOpacity>
        )}
        {showResume && (
          <TouchableOpacity
            style={[styles.actionButton, styles.resumeButton]}
            onPress={onResume}
            disabled={isLoading}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{ACTION_ICONS.resume}</Text>
            <Text style={styles.actionLabel}>Resume</Text>
          </TouchableOpacity>
        )}
        {showStop && (
          <TouchableOpacity
            style={[styles.actionButton, styles.stopButton]}
            onPress={onStop}
            disabled={isLoading}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{ACTION_ICONS.stop}</Text>
            <Text style={styles.actionLabel}>Stop</Text>
          </TouchableOpacity>
        )}
        {onClose && (
          <TouchableOpacity
            style={[styles.actionButton, styles.closeButton]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.actionIcon}>{ACTION_ICONS.close}</Text>
            <Text style={styles.actionLabel}>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'paused':
      return '#f59e0b';
    case 'error':
      return '#ef4444';
    case 'starting':
      return '#8b5cf6';
    case 'handing_off':
      return '#3b82f6';
    default:
      return '#6b7280';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1e1e1e',
    borderTopWidth: 1,
    borderTopColor: '#2e2e2e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  pauseButton: {
    backgroundColor: '#92400e',
  },
  resumeButton: {
    backgroundColor: '#1d4ed8',
  },
  stopButton: {
    backgroundColor: '#991b1b',
  },
  closeButton: {
    backgroundColor: '#374151',
  },
  actionIcon: {
    color: '#ffffff',
    fontSize: 14,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
