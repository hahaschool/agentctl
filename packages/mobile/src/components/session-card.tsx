// ---------------------------------------------------------------------------
// SessionCard — rich card for displaying a session browser item with
// agent type badge, model name, cost, duration, and last tool call.
// ---------------------------------------------------------------------------

import type React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { SessionBrowserItem } from '../screens/session-browser-model.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUNTIME_ICONS: Record<string, string> = {
  'claude-code': '\u2B22', // hexagon
  codex: '\u2B21', // pentagon outline
};

function runtimeLabel(runtime: string): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function sourceLabel(kind: SessionBrowserItem['kind']): string {
  return kind === 'session' ? 'Classic' : 'Managed';
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'paused':
      return '#f59e0b';
    case 'handing_off':
      return '#3b82f6';
    case 'error':
      return '#ef4444';
    case 'starting':
      return '#8b5cf6';
    default:
      return '#6b7280';
  }
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'unknown';
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function formatDuration(startedAt: string | null, lastActivityAt: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(lastActivityAt ?? Date.now()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const diffMs = end - start;
  if (diffMs < 60_000) return '<1m';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
  return `${Math.floor(diffMs / 86_400_000)}d`;
}

function truncateId(id: string, length = 12): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SessionCardProps = {
  item: SessionBrowserItem;
  onPress?: (item: SessionBrowserItem) => void;
  onLongPress?: (item: SessionBrowserItem) => void;
};

export function SessionCard({ item, onPress, onLongPress }: SessionCardProps): React.JSX.Element {
  const duration = formatDuration(item.startedAt, item.lastActivityAt);
  const runtimeIcon = RUNTIME_ICONS[item.runtime] ?? '\u25CF';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(item)}
      onLongPress={() => onLongPress?.(item)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.badgeRow}>
          <View style={styles.agentTypeBadge}>
            <Text style={styles.agentTypeIcon}>{runtimeIcon}</Text>
            <Text style={styles.agentTypeText}>{runtimeLabel(item.runtime)}</Text>
          </View>
          <Text style={styles.sourcePill}>{sourceLabel(item.kind)}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: sessionStatusColor(item.status) }]}>
          <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.sessionId}>{truncateId(item.id)}</Text>
      <Text style={styles.projectPath} numberOfLines={1}>
        {item.projectPath}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{formatRelativeTime(item.lastActivityAt)}</Text>
        {item.machineLabel && (
          <>
            <Text style={styles.metaDot}> · </Text>
            <Text style={styles.metaText}>{item.machineLabel}</Text>
          </>
        )}
        {item.model && (
          <>
            <Text style={styles.metaDot}> · </Text>
            <View style={styles.modelBadge}>
              <Text style={styles.modelText}>{item.model}</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.statsRow}>
        {item.costUsd !== null && item.costUsd > 0 && (
          <View style={styles.statChip}>
            <Text style={styles.statLabel}>Cost</Text>
            <Text style={styles.statValue}>${item.costUsd.toFixed(4)}</Text>
          </View>
        )}
        {duration && (
          <View style={styles.statChip}>
            <Text style={styles.statLabel}>Duration</Text>
            <Text style={styles.statValue}>{duration}</Text>
          </View>
        )}
        {item.messageCount !== null && (
          <View style={styles.statChip}>
            <Text style={styles.statLabel}>Messages</Text>
            <Text style={styles.statValue}>{item.messageCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  agentTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  agentTypeIcon: {
    color: '#60a5fa',
    fontSize: 10,
  },
  agentTypeText: {
    color: '#bfdbfe',
    fontSize: 11,
    fontWeight: '700',
  },
  sourcePill: {
    color: '#e5e7eb',
    backgroundColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  sessionId: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Courier',
    marginBottom: 4,
  },
  projectPath: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  metaText: {
    color: '#6b7280',
    fontSize: 12,
  },
  metaDot: {
    color: '#4b5563',
    fontSize: 12,
  },
  modelBadge: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modelText: {
    color: '#a78bfa',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statLabel: {
    color: '#4b5563',
    fontSize: 11,
    fontWeight: '600',
  },
  statValue: {
    color: '#60a5fa',
    fontSize: 12,
    fontFamily: 'Courier',
  },
});
