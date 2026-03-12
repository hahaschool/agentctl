// =============================================================================
// ActivityFeed — Timestamped event log with color-coded entries
// =============================================================================

import { Box, Text } from 'ink';
import type React from 'react';

import type { ActivityEvent, ActivityEventType } from './types.js';

type Props = {
  readonly events: readonly ActivityEvent[];
};

const EVENT_COLORS: Record<ActivityEventType, string> = {
  success: 'green',
  error: 'red',
  info: 'cyan',
  warning: 'yellow',
};

function EventRow({ event }: { readonly event: ActivityEvent }): React.ReactElement {
  const color = EVENT_COLORS[event.type];

  return (
    <Box>
      <Text dimColor>{event.timestamp}</Text>
      <Text> </Text>
      <Text color={color}>[{event.source}]</Text>
      <Text> </Text>
      <Text>{event.message}</Text>
    </Box>
  );
}

export function ActivityFeed({ events }: Props): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold>
          {'\u2501'} Activity {'\u2501'}
        </Text>
      </Box>
      {events.length === 0 ? (
        <Text dimColor>No recent activity</Text>
      ) : (
        events.map((event, index) => <EventRow key={`${event.timestamp}-${index}`} event={event} />)
      )}
    </Box>
  );
}
