// ---------------------------------------------------------------------------
// SessionStreamScreen — displays a live SSE stream for running sessions or
// a chronological replay for completed/stopped sessions. Shows message type
// indicators, auto-scrolls to bottom on new events, and provides a back
// button to return to the session browser.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { OutputViewer } from '../components/output-viewer.js';
import { SessionReplay } from '../components/session-replay.js';
import { useAppContext } from '../context/app-context.js';
import type { OutputLine } from '../screens/agent-detail-presenter.js';
import type { SessionStreamState } from '../screens/session-stream-presenter.js';
import { SessionStreamPresenter } from '../screens/session-stream-presenter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionStreamScreenProps = {
  /** The session ID to stream or replay. */
  sessionId: string;
  /** Whether the session is currently running (live) or completed (replay). */
  isLive: boolean;
  /** Machine ID — required for replay mode to fetch content. */
  machineId: string | null;
  /** Callback to navigate back to the session browser. */
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert StreamLine[] to OutputLine[] for the existing OutputViewer. */
function toOutputLines(state: SessionStreamState): OutputLine[] {
  return state.streamLines.map((line) => ({
    lineNumber: line.lineNumber,
    event: line.event,
    receivedAt: line.receivedAt,
  }));
}

function modeLabel(state: SessionStreamState): string {
  if (state.mode === 'live') {
    return state.isStreaming ? 'LIVE' : 'CONNECTING...';
  }
  return 'REPLAY';
}

function modeColor(state: SessionStreamState): string {
  if (state.mode === 'live') {
    return state.isStreaming ? '#22c55e' : '#f59e0b';
  }
  return '#3b82f6';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionStreamScreen({
  sessionId,
  isLive,
  machineId,
  onBack,
}: SessionStreamScreenProps): React.JSX.Element {
  const { baseUrl, authToken } = useAppContext();
  const presenterRef = useRef<SessionStreamPresenter | null>(null);

  const [state, setState] = useState<SessionStreamState>({
    mode: isLive ? 'live' : 'replay',
    streamLines: [],
    replayMessages: [],
    scrubberPosition: 0,
    isStreaming: false,
    isLoading: false,
    sessionId: null,
    error: null,
  });

  useEffect(() => {
    const presenter = new SessionStreamPresenter({
      baseUrl,
      authToken: authToken || undefined,
      onChange: setState,
    });
    presenterRef.current = presenter;

    if (isLive) {
      presenter.connectLive(sessionId);
    } else if (machineId) {
      void presenter.loadReplay(sessionId, machineId);
    }

    return () => {
      presenter.destroy();
    };
  }, [sessionId, isLive, machineId, baseUrl, authToken]);

  const handleToggleMessage = useCallback((index: number) => {
    presenterRef.current?.toggleMessageExpanded(index);
  }, []);

  const handleSeek = useCallback((position: number) => {
    presenterRef.current?.setScrubberPosition(position);
  }, []);

  const outputLines = state.mode === 'live' ? toOutputLines(state) : [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backText}>{'\u2190'} Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.sessionLabel} numberOfLines={1}>
            {sessionId.length > 16 ? `${sessionId.slice(0, 16)}...` : sessionId}
          </Text>
          <View style={styles.modeBadgeRow}>
            <View style={[styles.modeDot, { backgroundColor: modeColor(state) }]} />
            <Text style={[styles.modeText, { color: modeColor(state) }]}>{modeLabel(state)}</Text>
          </View>
        </View>

        <View style={styles.headerRight} />
      </View>

      {/* Error banner */}
      {state.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error.message}</Text>
        </View>
      )}

      {/* Loading indicator */}
      {state.isLoading && (
        <View style={styles.loadingBanner}>
          <Text style={styles.loadingText}>Loading session content...</Text>
        </View>
      )}

      {/* Content area */}
      <View style={styles.content}>
        {state.mode === 'live' ? (
          <View style={styles.streamContainer}>
            <Text style={styles.lineCount}>
              {state.streamLines.length} events
              {state.isStreaming ? ' (streaming)' : ''}
            </Text>
            <OutputViewer lines={outputLines} autoScroll />
          </View>
        ) : (
          <SessionReplay
            messages={state.replayMessages}
            scrubberPosition={state.scrubberPosition}
            onToggleMessage={handleToggleMessage}
            onSeek={handleSeek}
          />
        )}
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e2e',
    backgroundColor: '#1e1e1e',
  },
  backButton: {
    paddingRight: 12,
    paddingVertical: 4,
  },
  backText: {
    color: '#3b82f6',
    fontSize: 15,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  sessionLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Courier',
  },
  modeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headerRight: {
    width: 60, // Balance the back button
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
  loadingBanner: {
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  loadingText: {
    color: '#bfdbfe',
    fontSize: 13,
  },
  content: {
    flex: 1,
  },
  streamContainer: {
    flex: 1,
    padding: 12,
  },
  lineCount: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
});
