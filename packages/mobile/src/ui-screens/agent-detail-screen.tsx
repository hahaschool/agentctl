// ---------------------------------------------------------------------------
// AgentDetailScreen — view and control a single agent. Shows agent status,
// start/stop/signal buttons, prompt input, and scrollable SSE output.
// Uses AgentDetailPresenter for all business logic.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { OutputViewer } from '../components/output-viewer.js';
import { StatusBadge } from '../components/status-badge.js';
import { useAppContext } from '../context/app-context.js';
import type { AgentDetailState } from '../screens/agent-detail-presenter.js';
import { AgentDetailPresenter } from '../screens/agent-detail-presenter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentDetailScreenProps = {
  agentId: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentDetailScreen({ agentId }: AgentDetailScreenProps): React.JSX.Element {
  const { apiClient, sseClient } = useAppContext();
  const presenterRef = useRef<AgentDetailPresenter | null>(null);
  const [promptText, setPromptText] = useState('');

  const [state, setState] = useState<AgentDetailState>({
    agent: null,
    runs: [],
    latestRunSummary: null,
    outputLines: [],
    isLoading: false,
    isStreaming: false,
    error: null,
    lastUpdated: null,
  });

  useEffect(() => {
    const presenter = new AgentDetailPresenter({
      apiClient,
      sseClient,
      onChange: setState,
    });
    presenterRef.current = presenter;
    void presenter.loadAgent(agentId);

    return () => {
      presenter.destroy();
    };
  }, [agentId, apiClient, sseClient]);

  const handleStart = useCallback(async () => {
    try {
      await presenterRef.current?.startAgent(promptText || undefined);
      setPromptText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Start Failed', message);
    }
  }, [promptText]);

  const handleStop = useCallback(async () => {
    try {
      await presenterRef.current?.stopAgent();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Stop Failed', message);
    }
  }, []);

  const handleSignal = useCallback(async () => {
    if (!promptText.trim()) {
      Alert.alert('Signal', 'Enter a prompt to signal the agent.');
      return;
    }
    try {
      await presenterRef.current?.signalAgent(promptText);
      setPromptText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Signal Failed', message);
    }
  }, [promptText]);

  const handleToggleStream = useCallback(() => {
    if (state.isStreaming) {
      presenterRef.current?.stopStreaming();
    } else {
      presenterRef.current?.startStreaming();
    }
  }, [state.isStreaming]);

  const handleClearOutput = useCallback(() => {
    presenterRef.current?.clearOutput();
  }, []);

  const handleRefresh = useCallback(async () => {
    await presenterRef.current?.refreshAgent();
  }, []);

  const isRunning =
    state.agent?.status === 'running' ||
    state.agent?.status === 'starting' ||
    state.agent?.status === 'restarting';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Agent info header */}
      <ScrollView style={styles.headerScroll}>
        <View style={styles.header}>
          {state.agent ? (
            <>
              <View style={styles.headerTop}>
                <Text style={styles.agentName}>{state.agent.name}</Text>
                <StatusBadge status={state.agent.status} />
              </View>
              <Text style={styles.detailText}>Machine: {state.agent.machineId}</Text>
              <Text style={styles.detailText}>Type: {state.agent.type}</Text>
              {state.agent.currentSessionId && (
                <Text style={styles.detailText}>
                  Session: {state.agent.currentSessionId.slice(0, 8)}...
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.loadingText}>
              {state.isLoading ? 'Loading agent...' : 'Agent not found'}
            </Text>
          )}
        </View>

        {/* Error banner */}
        {state.error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{state.error.message}</Text>
          </View>
        )}

        {state.latestRunSummary && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Latest Run Summary</Text>
            <Text style={styles.summaryText}>{state.latestRunSummary.executiveSummary}</Text>
            {state.latestRunSummary.keyFindings.map((finding) => (
              <Text key={finding} style={styles.summaryMeta}>
                • {finding}
              </Text>
            ))}
            {state.latestRunSummary.followUps.map((item) => (
              <Text key={item} style={styles.summaryMeta}>
                Next: {item}
              </Text>
            ))}
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.startButton]}
            onPress={handleStart}
            disabled={isRunning || state.isLoading}
          >
            <Text style={styles.buttonText}>Start</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.stopButton]}
            onPress={handleStop}
            disabled={!isRunning || state.isLoading}
          >
            <Text style={styles.buttonText}>Stop</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.signalButton]}
            onPress={handleSignal}
            disabled={!isRunning || state.isLoading}
          >
            <Text style={styles.buttonText}>Signal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.refreshButton]}
            onPress={handleRefresh}
            disabled={state.isLoading}
          >
            <Text style={styles.buttonText}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {/* Prompt input */}
        <View style={styles.promptContainer}>
          <TextInput
            style={styles.promptInput}
            value={promptText}
            onChangeText={setPromptText}
            placeholder="Enter prompt or signal message..."
            placeholderTextColor="#6b7280"
            multiline
          />
        </View>

        {/* Stream controls */}
        <View style={styles.streamControls}>
          <TouchableOpacity
            style={[styles.button, state.isStreaming ? styles.stopButton : styles.startButton]}
            onPress={handleToggleStream}
          >
            <Text style={styles.buttonText}>
              {state.isStreaming ? 'Stop Stream' : 'Start Stream'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.clearButton]} onPress={handleClearOutput}>
            <Text style={styles.buttonText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Output viewer */}
      <View style={styles.outputContainer}>
        <Text style={styles.outputLabel}>
          Output ({state.outputLines.length} lines)
          {state.isStreaming ? ' -- LIVE' : ''}
        </Text>
        <OutputViewer lines={state.outputLines} />
      </View>
    </KeyboardAvoidingView>
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
  headerScroll: {
    maxHeight: '50%',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e2e',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  agentName: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  detailText: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 2,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 14,
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
  summaryCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
  },
  summaryTitle: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  summaryText: {
    color: '#e5e7eb',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  summaryMeta: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: '#166534',
  },
  stopButton: {
    backgroundColor: '#991b1b',
  },
  signalButton: {
    backgroundColor: '#1e40af',
  },
  refreshButton: {
    backgroundColor: '#374151',
  },
  clearButton: {
    backgroundColor: '#374151',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  promptContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  promptInput: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    color: '#ffffff',
    padding: 12,
    fontSize: 14,
    minHeight: 48,
    maxHeight: 120,
  },
  streamControls: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  outputContainer: {
    flex: 1,
    padding: 12,
  },
  outputLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '600',
  },
});
