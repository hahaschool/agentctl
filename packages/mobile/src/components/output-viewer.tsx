// ---------------------------------------------------------------------------
// OutputViewer — scrollable text view for agent SSE output.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { OutputLine } from '../screens/agent-detail-presenter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLine(line: OutputLine): string {
  const { event } = line;

  switch (event.event) {
    case 'output':
      return event.data.content;
    case 'status':
      return `[STATUS] ${event.data.status}${event.data.reason ? `: ${event.data.reason}` : ''}`;
    case 'cost':
      return `[COST] turn=$${event.data.turnCost.toFixed(4)} total=$${event.data.totalCost.toFixed(4)}`;
    case 'approval_needed':
      return `[APPROVAL] Tool: ${event.data.tool} (timeout: ${event.data.timeoutSeconds}s)`;
    case 'heartbeat':
      return `[HEARTBEAT] ${new Date(event.data.timestamp).toLocaleTimeString()}`;
    case 'loop_iteration':
      return `[LOOP] iteration=${event.data.iteration} cost=$${event.data.costUsd.toFixed(4)} duration=${event.data.durationMs}ms`;
    case 'loop_complete':
      return `[LOOP COMPLETE] iterations=${event.data.totalIterations} total=$${event.data.totalCostUsd.toFixed(4)} reason=${event.data.reason}`;
    default:
      return JSON.stringify(event);
  }
}

function lineColor(line: OutputLine): string {
  switch (line.event.event) {
    case 'output':
      return line.event.data.type === 'tool_use'
        ? '#60a5fa'
        : line.event.data.type === 'tool_result'
          ? '#34d399'
          : '#e5e7eb';
    case 'status':
      return '#f59e0b';
    case 'cost':
      return '#a78bfa';
    case 'approval_needed':
      return '#ef4444';
    case 'heartbeat':
      return '#6b7280';
    case 'loop_iteration':
      return '#38bdf8';
    case 'loop_complete':
      return '#22c55e';
    default:
      return '#9ca3af';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type OutputViewerProps = {
  lines: OutputLine[];
  autoScroll?: boolean;
};

export function OutputViewer({ lines, autoScroll = true }: OutputViewerProps): React.JSX.Element {
  const scrollViewRef = useRef<ScrollView>(null);

  const lineCount = lines.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: lineCount intentionally triggers scroll on new lines
  useEffect(() => {
    if (autoScroll && scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [lineCount, autoScroll]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        {lines.length === 0 ? (
          <Text style={styles.placeholder}>No output yet</Text>
        ) : (
          lines.map((line) => (
            <Text key={line.lineNumber} style={[styles.line, { color: lineColor(line) }]}>
              {formatLine(line)}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 12,
  },
  placeholder: {
    color: '#6b7280',
    fontStyle: 'italic',
    fontSize: 13,
  },
  line: {
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
});
