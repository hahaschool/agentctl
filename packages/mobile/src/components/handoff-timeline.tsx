// ---------------------------------------------------------------------------
// HandoffTimeline — visual timeline of handoff events with reason icons,
// strategy labels, and context-transfer summaries.
// ---------------------------------------------------------------------------

import type { HandoffReason, HandoffStrategy } from '@agentctl/shared';
import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RuntimeSessionHandoff } from '../services/runtime-session-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REASON_ICONS: Record<HandoffReason, string> = {
  manual: '\u270B', // raised hand
  'model-affinity': '\u2699', // gear
  'cost-optimization': '\u2B50', // star (savings)
  'rate-limit-failover': '\u26A0', // warning
};

const STRATEGY_LABELS: Record<HandoffStrategy, string> = {
  'native-import': 'Native Import',
  'snapshot-handoff': 'Snapshot Handoff',
};

function handoffStatusColor(status: RuntimeSessionHandoff['status']): string {
  switch (status) {
    case 'succeeded':
      return '#22c55e';
    case 'failed':
      return '#ef4444';
    default:
      return '#f59e0b';
  }
}

function runtimeLabel(runtime: string): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function formatTimestamp(isoString: string | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type HandoffTimelineProps = {
  handoffs: RuntimeSessionHandoff[];
};

export function HandoffTimeline({ handoffs }: HandoffTimelineProps): React.JSX.Element {
  if (handoffs.length === 0) {
    return <Text style={styles.emptyText}>No handoffs for this session yet.</Text>;
  }

  return (
    <View style={styles.container}>
      {handoffs.map((handoff, index) => {
        const isLast = index === handoffs.length - 1;
        const reasonIcon = REASON_ICONS[handoff.reason] ?? '\u2022';
        const strategyLabel = STRATEGY_LABELS[handoff.strategy] ?? handoff.strategy;
        const contextSummary =
          handoff.snapshot.conversationSummary || handoff.snapshot.diffSummary || null;

        return (
          <View key={handoff.id} style={styles.entry}>
            <View style={styles.markerColumn}>
              <View
                style={[styles.markerCircle, { borderColor: handoffStatusColor(handoff.status) }]}
              >
                <Text style={styles.markerIcon}>{reasonIcon}</Text>
              </View>
              {!isLast && <View style={styles.connectorLine} />}
            </View>

            <View style={styles.content}>
              <View style={styles.headerRow}>
                <Text style={styles.strategyText}>{strategyLabel}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: handoffStatusColor(handoff.status) },
                  ]}
                >
                  <Text style={styles.statusText}>{handoff.status.toUpperCase()}</Text>
                </View>
              </View>

              <Text style={styles.direction}>
                {runtimeLabel(handoff.sourceRuntime)} → {runtimeLabel(handoff.targetRuntime)}
              </Text>

              <View style={styles.reasonRow}>
                <Text style={styles.reasonLabel}>Reason:</Text>
                <Text style={styles.reasonValue}>{handoff.reason.replaceAll('-', ' ')}</Text>
              </View>

              {contextSummary && (
                <View style={styles.contextCard}>
                  <Text style={styles.contextTitle}>Context Transfer</Text>
                  <Text style={styles.contextText} numberOfLines={4}>
                    {contextSummary}
                  </Text>
                </View>
              )}

              {handoff.snapshot.dirtyFiles.length > 0 && (
                <Text style={styles.filesText}>
                  {handoff.snapshot.dirtyFiles.length} dirty file
                  {handoff.snapshot.dirtyFiles.length === 1 ? '' : 's'}
                </Text>
              )}

              {handoff.createdAt && (
                <Text style={styles.timestamp}>{formatTimestamp(handoff.createdAt)}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 13,
  },
  entry: {
    flexDirection: 'row',
  },
  markerColumn: {
    alignItems: 'center',
    width: 36,
  },
  markerCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerIcon: {
    fontSize: 12,
    color: '#ffffff',
  },
  connectorLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#374151',
    marginVertical: 2,
  },
  content: {
    flex: 1,
    backgroundColor: '#1f2937',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    marginLeft: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  strategyText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  direction: {
    color: '#d1d5db',
    fontSize: 12,
    marginBottom: 4,
  },
  reasonRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  reasonLabel: {
    color: '#6b7280',
    fontSize: 12,
  },
  reasonValue: {
    color: '#9ca3af',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  contextCard: {
    backgroundColor: '#111111',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  contextTitle: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  contextText: {
    color: '#d1d5db',
    fontSize: 12,
    lineHeight: 17,
  },
  filesText: {
    color: '#a78bfa',
    fontSize: 11,
    marginBottom: 4,
  },
  timestamp: {
    color: '#4b5563',
    fontSize: 11,
    textAlign: 'right',
  },
});
