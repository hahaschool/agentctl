// ---------------------------------------------------------------------------
// AgentListScreen — displays all registered agents with status, machine,
// and last activity. Tapping an agent navigates to the detail screen.
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

type AgentListScreenProps = {
  onAgentPress?: (agent: Agent) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentListScreen({ onAgentPress }: AgentListScreenProps): React.JSX.Element {
  const { apiClient } = useAppContext();
  const presenterRef = useRef<DashboardPresenter | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const presenter = new DashboardPresenter({
      apiClient,
      pollIntervalMs: 30_000,
      onChange: (state: DashboardState) => {
        setAgents(state.agents);
        setIsLoading(state.isLoading);
        setError(state.error?.message ?? null);
      },
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

  const renderAgent = useCallback(
    ({ item }: { item: Agent }) => <AgentCard agent={item} onPress={onAgentPress} />,
    [onAgentPress],
  );

  const keyExtractor = useCallback((item: Agent) => item.id, []);

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={agents}
        renderItem={renderAgent}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor="#9ca3af" />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>{isLoading ? 'Loading...' : 'No agents found'}</Text>
        }
      />
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
});
