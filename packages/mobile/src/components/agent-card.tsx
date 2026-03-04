// ---------------------------------------------------------------------------
// AgentCard — card component for rendering an agent in a list.
// ---------------------------------------------------------------------------

import type { Agent } from '@agentctl/shared';
import type React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { StatusBadge } from './status-badge.js';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AgentCardProps = {
  agent: Agent;
  onPress?: (agent: Agent) => void;
};

export function AgentCard({ agent, onPress }: AgentCardProps): React.JSX.Element {
  const lastRun = agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never';

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress?.(agent)} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {agent.name}
        </Text>
        <StatusBadge status={agent.status} />
      </View>
      <View style={styles.details}>
        <Text style={styles.detail}>Machine: {agent.machineId}</Text>
        <Text style={styles.detail}>Type: {agent.type}</Text>
        <Text style={styles.detail}>Last run: {lastRun}</Text>
      </View>
      {agent.totalCostUsd > 0 && (
        <Text style={styles.cost}>Total cost: ${agent.totalCostUsd.toFixed(4)}</Text>
      )}
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
  name: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  details: {
    gap: 2,
  },
  detail: {
    color: '#9ca3af',
    fontSize: 13,
  },
  cost: {
    color: '#a78bfa',
    fontSize: 12,
    marginTop: 6,
  },
});
