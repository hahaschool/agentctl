// =============================================================================
// AgentPanel — Shows registered agents and their status
// =============================================================================

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';

import type { AgentInfo } from './types.js';

type Props = {
  readonly agents: readonly AgentInfo[];
  readonly error: string | null;
  readonly selectedIndex: number;
  readonly isActive: boolean;
};

function AgentStatusBadge({
  status,
}: {
  readonly status: AgentInfo['status'];
}): React.ReactElement {
  const colorMap = {
    running: 'green',
    idle: 'gray',
    stopped: 'yellow',
    error: 'red',
  } as const;

  if (status === 'running') {
    return (
      <Text color="green">
        <Spinner type="dots" />
      </Text>
    );
  }

  return <Text color={colorMap[status]}>{status}</Text>;
}

function formatCost(cost: number | null): string {
  if (cost === null) return '';
  return `$${cost.toFixed(2)}`;
}

function AgentRow({
  agent,
  isSelected,
}: {
  readonly agent: AgentInfo;
  readonly isSelected: boolean;
}): React.ReactElement {
  return (
    <Box>
      <Text inverse={isSelected}>{isSelected ? '>' : ' '} </Text>
      <Box width={14}>
        <Text bold={isSelected}>{agent.name}</Text>
      </Box>
      <Text> </Text>
      <Box width={10}>
        <AgentStatusBadge status={agent.status} />
      </Box>
      {agent.cost !== null ? (
        <Box width={8}>
          <Text color="cyan">{formatCost(agent.cost)}</Text>
        </Box>
      ) : null}
      {agent.duration ? (
        <Box width={6}>
          <Text dimColor>{agent.duration}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function AgentPanel({ agents, error, selectedIndex, isActive }: Props): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isActive ? 'blue' : 'gray'}
      paddingX={1}
      flexGrow={1}
      flexBasis="50%"
    >
      <Box marginBottom={1}>
        <Text bold color={isActive ? 'blue' : 'white'}>
          {'\u2501'} Agents {'\u2501'}
        </Text>
      </Box>
      {error ? (
        <Text color="red">{error}</Text>
      ) : agents.length === 0 ? (
        <Text dimColor>No agents registered</Text>
      ) : (
        agents.map((agent, index) => (
          <AgentRow key={agent.id} agent={agent} isSelected={isActive && index === selectedIndex} />
        ))
      )}
    </Box>
  );
}
