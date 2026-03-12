// =============================================================================
// ServicePanel — Shows health status for all monitored services
// =============================================================================

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';

import type { ServiceInfo } from './types.js';

type Props = {
  readonly services: readonly ServiceInfo[];
  readonly selectedIndex: number;
  readonly isActive: boolean;
};

function StatusIndicator({
  status,
}: {
  readonly status: ServiceInfo['status'];
}): React.ReactElement {
  if (status === 'loading') {
    return (
      <Text color="yellow">
        <Spinner type="dots" />
      </Text>
    );
  }
  if (status === 'ok') {
    return <Text color="green">{'\u25CF'}</Text>;
  }
  return <Text color="red">{'\u25CF'}</Text>;
}

function StatusLabel({ status }: { readonly status: ServiceInfo['status'] }): React.ReactElement {
  if (status === 'loading') return <Text color="yellow">...</Text>;
  if (status === 'ok') return <Text color="green">OK</Text>;
  return <Text color="red">DOWN</Text>;
}

function ServiceRow({
  service,
  isSelected,
}: {
  readonly service: ServiceInfo;
  readonly isSelected: boolean;
}): React.ReactElement {
  return (
    <Box>
      <Text inverse={isSelected}>{isSelected ? '>' : ' '} </Text>
      <StatusIndicator status={service.status} />
      <Text> </Text>
      <Box width={16}>
        <Text bold={isSelected}>{service.name}</Text>
      </Box>
      <Box width={7}>
        <Text dimColor>:{service.port}</Text>
      </Box>
      <Box width={6}>
        <StatusLabel status={service.status} />
      </Box>
      {service.uptime ? (
        <Box width={8}>
          <Text dimColor>{service.uptime}</Text>
        </Box>
      ) : null}
      {service.memory ? (
        <Box width={8}>
          <Text dimColor>{service.memory}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function ServicePanel({ services, selectedIndex, isActive }: Props): React.ReactElement {
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
          {'\u2501'} Services {'\u2501'}
        </Text>
      </Box>
      {services.map((service, index) => (
        <ServiceRow
          key={service.name}
          service={service}
          isSelected={isActive && index === selectedIndex}
        />
      ))}
    </Box>
  );
}
