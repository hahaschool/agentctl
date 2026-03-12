// ---------------------------------------------------------------------------
// SessionReplay — renders completed session messages in chronological order
// with expand/collapse for tool calls and thinking blocks, plus a timeline
// scrubber for navigating through the conversation.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { ReplayMessage } from '../screens/session-stream-presenter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  human: 'USER',
  assistant: 'ASSISTANT',
  thinking: 'THINKING',
  tool_use: 'TOOL',
  tool_result: 'RESULT',
  progress: 'PROGRESS',
  subagent: 'SUBAGENT',
  todo: 'TODO',
};

const TYPE_COLORS: Record<string, string> = {
  human: '#60a5fa',
  assistant: '#e5e7eb',
  thinking: '#a78bfa',
  tool_use: '#38bdf8',
  tool_result: '#34d399',
  progress: '#fbbf24',
  subagent: '#f472b6',
  todo: '#fb923c',
};

function isCollapsible(type: string): boolean {
  return type === 'thinking' || type === 'tool_use' || type === 'tool_result' || type === 'todo';
}

function formatTimestamp(isoString?: string): string {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString();
  } catch {
    return '';
  }
}

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}...`;
}

// ---------------------------------------------------------------------------
// MessageRow
// ---------------------------------------------------------------------------

type MessageRowProps = {
  message: ReplayMessage;
  onToggle: (index: number) => void;
};

function MessageRow({ message, onToggle }: MessageRowProps): React.JSX.Element {
  const label = TYPE_LABELS[message.type] ?? message.type.toUpperCase();
  const color = TYPE_COLORS[message.type] ?? '#9ca3af';
  const collapsible = isCollapsible(message.type);
  const showFull = !collapsible || message.expanded;

  const toolSuffix = message.toolName ? ` [${message.toolName}]` : '';

  return (
    <View style={styles.messageRow}>
      <TouchableOpacity
        style={styles.messageHeader}
        onPress={() => collapsible && onToggle(message.index)}
        activeOpacity={collapsible ? 0.7 : 1}
        disabled={!collapsible}
      >
        <View style={styles.messageLabelRow}>
          <View style={[styles.typeBadge, { backgroundColor: `${color}22` }]}>
            <Text style={[styles.typeText, { color }]}>{label}</Text>
          </View>
          {message.toolName && <Text style={styles.toolName}>{toolSuffix}</Text>}
          {collapsible && (
            <Text style={styles.expandIcon}>{message.expanded ? '\u25BC' : '\u25B6'}</Text>
          )}
        </View>
        {message.timestamp && (
          <Text style={styles.timestamp}>{formatTimestamp(message.timestamp)}</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.messageContent, { color }]} numberOfLines={showFull ? undefined : 2}>
        {showFull ? message.content : truncateContent(message.content, 120)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Timeline scrubber
// ---------------------------------------------------------------------------

type TimelineScrubberProps = {
  position: number;
  total: number;
  onSeek: (position: number) => void;
};

function TimelineScrubber({ position, total, onSeek }: TimelineScrubberProps): React.JSX.Element {
  const fraction = total > 1 ? position / (total - 1) : 0;

  return (
    <View style={styles.scrubberContainer}>
      <TouchableOpacity
        style={styles.scrubberButton}
        onPress={() => onSeek(Math.max(0, position - 1))}
        disabled={position <= 0}
      >
        <Text style={[styles.scrubberButtonText, position <= 0 && styles.scrubberButtonDisabled]}>
          {'\u25C0'}
        </Text>
      </TouchableOpacity>

      <View style={styles.scrubberTrack}>
        <View style={[styles.scrubberFill, { width: `${fraction * 100}%` }]} />
      </View>

      <Text style={styles.scrubberLabel}>{total > 0 ? `${position + 1}/${total}` : '0/0'}</Text>

      <TouchableOpacity
        style={styles.scrubberButton}
        onPress={() => onSeek(Math.min(total - 1, position + 1))}
        disabled={position >= total - 1}
      >
        <Text
          style={[
            styles.scrubberButtonText,
            position >= total - 1 && styles.scrubberButtonDisabled,
          ]}
        >
          {'\u25B6'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SessionReplayProps = {
  messages: readonly ReplayMessage[];
  scrubberPosition: number;
  onToggleMessage: (index: number) => void;
  onSeek: (position: number) => void;
};

export function SessionReplay({
  messages,
  scrubberPosition,
  onToggleMessage,
  onSeek,
}: SessionReplayProps): React.JSX.Element {
  const scrollViewRef = useRef<ScrollView>(null);

  const handleToggle = useCallback(
    (index: number) => {
      onToggleMessage(index);
    },
    [onToggleMessage],
  );

  // Scroll to the scrubber position when it changes
  const messageCount = messages.length;
  useEffect(() => {
    // We can't scroll to an exact item in ScrollView without measuring,
    // so we approximate by scrolling to the proportional position.
    if (scrollViewRef.current && messageCount > 0) {
      const fraction = messageCount > 1 ? scrubberPosition / (messageCount - 1) : 0;
      // Approximate scroll — will be close but not pixel-perfect.
      // A FlatList with getItemLayout would be more precise, but for
      // variable-height items ScrollView is simpler.
      scrollViewRef.current.scrollTo({ y: fraction * messageCount * 80, animated: true });
    }
  }, [scrubberPosition, messageCount]);

  return (
    <View style={styles.container}>
      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No messages in this session</Text>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
          >
            {messages.map((msg) => (
              <MessageRow key={msg.index} message={msg} onToggle={handleToggle} />
            ))}
          </ScrollView>

          <TimelineScrubber position={scrubberPosition} total={messages.length} onSeek={onSeek} />
        </>
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
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    gap: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
    fontStyle: 'italic',
  },
  messageRow: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  messageLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'Courier',
  },
  toolName: {
    color: '#6b7280',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  expandIcon: {
    color: '#6b7280',
    fontSize: 10,
  },
  timestamp: {
    color: '#4b5563',
    fontSize: 10,
    fontFamily: 'Courier',
  },
  messageContent: {
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  scrubberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: '#1e1e1e',
    borderTopWidth: 1,
    borderTopColor: '#2e2e2e',
  },
  scrubberButton: {
    padding: 6,
  },
  scrubberButtonText: {
    color: '#3b82f6',
    fontSize: 16,
  },
  scrubberButtonDisabled: {
    color: '#374151',
  },
  scrubberTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#374151',
    borderRadius: 2,
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 2,
  },
  scrubberLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontFamily: 'Courier',
    minWidth: 48,
    textAlign: 'center',
  },
});
