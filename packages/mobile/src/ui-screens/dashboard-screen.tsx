// ---------------------------------------------------------------------------
// DashboardScreen — fleet overview showing health, machine count, agent
// count, and a list of agents with status badges. Uses DashboardPresenter
// for all business logic.
// ---------------------------------------------------------------------------

import type { Agent } from '@agentctl/shared';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { AgentCard } from '../components/agent-card.js';
import { useAppContext } from '../context/app-context.js';
import type { DashboardState } from '../screens/dashboard-presenter.js';
import { DashboardPresenter } from '../screens/dashboard-presenter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardScreenProps = {
  onAgentPress?: (agent: Agent) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardScreen({ onAgentPress }: DashboardScreenProps): React.JSX.Element {
  const { apiClient } = useAppContext();
  const presenterRef = useRef<DashboardPresenter | null>(null);
  const [state, setState] = useState<DashboardState>({
    health: null,
    machines: [],
    agents: [],
    runtimeSessions: [],
    runtimeHandoffSummary: null,
    stats: {
      totalAgents: 0,
      running: 0,
      idle: 0,
      error: 0,
      totalMachines: 0,
      onlineMachines: 0,
      totalManagedRuntimes: 0,
      activeManagedRuntimes: 0,
      switchingManagedRuntimes: 0,
      totalRuntimeHandoffs: 0,
      runtimeNativeImportSuccesses: 0,
      runtimeFallbacks: 0,
      runtimeNativeImportRate: 0,
      runtimeFallbackRate: 0,
    },
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useEffect(() => {
    const presenter = new DashboardPresenter({
      apiClient,
      onChange: setState,
    });
    presenterRef.current = presenter;
    presenter.start();

    return () => {
      presenter.stop();
    };
  }, [apiClient]);

  const onRefresh = useCallback(() => {
    void presenterRef.current?.refresh();
  }, []);

  const healthStatus = state.health?.status ?? 'unknown';
  const healthColor =
    healthStatus === 'ok' ? '#22c55e' : healthStatus === 'degraded' ? '#f59e0b' : '#6b7280';

  const renderAgent = useCallback(
    ({ item }: { item: Agent }) => <AgentCard agent={item} onPress={onAgentPress} />,
    [onAgentPress],
  );

  const keyExtractor = useCallback((item: Agent) => item.id, []);

  return (
    <View style={styles.container}>
      {/* Stats header */}
      <View style={styles.statsContainer}>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{state.stats.totalMachines}</Text>
            <Text style={styles.statLabel}>Machines</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{state.stats.onlineMachines}</Text>
            <Text style={styles.statLabel}>Online</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{state.stats.totalAgents}</Text>
            <Text style={styles.statLabel}>Agents</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#22c55e' }]}>{state.stats.running}</Text>
            <Text style={styles.statLabel}>Running</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#6b7280' }]}>{state.stats.idle}</Text>
            <Text style={styles.statLabel}>Idle</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#ef4444' }]}>{state.stats.error}</Text>
            <Text style={styles.statLabel}>Error</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#60a5fa' }]}>
              {state.stats.totalManagedRuntimes}
            </Text>
            <Text style={styles.statLabel}>Runtimes</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#22c55e' }]}>
              {state.stats.activeManagedRuntimes}
            </Text>
            <Text style={styles.statLabel}>Runtime Active</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#3b82f6' }]}>
              {state.stats.switchingManagedRuntimes}
            </Text>
            <Text style={styles.statLabel}>Switching</Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#a78bfa' }]}>
              {state.stats.totalRuntimeHandoffs}
            </Text>
            <Text style={styles.statLabel}>Handoffs</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#22c55e' }]}>
              {state.stats.runtimeNativeImportSuccesses}
            </Text>
            <Text style={styles.statLabel}>Native Import</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: '#f59e0b' }]}>
              {state.stats.runtimeFallbacks}
            </Text>
            <Text style={styles.statLabel}>Fallbacks</Text>
          </View>
        </View>
        <Text style={styles.runtimeRateSummary}>
          {state.stats.runtimeNativeImportRate}% native import rate ·{' '}
          {state.stats.runtimeFallbackRate}% fallback rate
        </Text>

        {/* Health indicator */}
        <View style={styles.healthRow}>
          <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
          <Text style={styles.healthText}>Control Plane: {healthStatus}</Text>
        </View>
      </View>

      {/* Error banner */}
      {state.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error.message}</Text>
        </View>
      )}

      {/* Agent list */}
      <FlatList
        data={state.agents}
        renderItem={renderAgent}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={state.isLoading} onRefresh={onRefresh} tintColor="#9ca3af" />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {state.isLoading ? 'Loading agents...' : 'No agents registered'}
          </Text>
        }
      />

      {/* Last updated */}
      {state.lastUpdated && (
        <Text style={styles.lastUpdated}>Updated: {state.lastUpdated.toLocaleTimeString()}</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  statsContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e2e',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  runtimeRateSummary: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 12,
    textAlign: 'center',
  },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  healthText: {
    color: '#9ca3af',
    fontSize: 13,
  },
  errorBanner: {
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyText: {
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 32,
    fontSize: 14,
  },
  lastUpdated: {
    color: '#4b5563',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
