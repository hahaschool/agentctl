import {
  describeHandoffCompletion,
  formatHandoffHistoryFilterLabel,
  HANDOFF_HISTORY_FILTERS,
  isMachineSelectable,
  type Machine,
  matchesHandoffHistoryFilter,
  pickPreferredMachineId,
  sortMachinesForSelection,
  summarizeNativeImportPreflightStatus,
} from '@agentctl/shared';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { DateRangePicker } from '../components/date-range-picker.js';
import { ExpandableDiff } from '../components/expandable-diff.js';
import { HandoffTimeline } from '../components/handoff-timeline.js';
import { SessionActionBar } from '../components/session-action-bar.js';
import { SessionCard } from '../components/session-card.js';
import { useAppContext } from '../context/app-context.js';
import type { RuntimeSessionScreenState } from '../screens/runtime-session-presenter.js';
import { RuntimeSessionPresenter } from '../screens/runtime-session-presenter.js';
import type { SessionBrowserItem, SessionBrowserStatus } from '../screens/session-browser-model.js';
import {
  buildSessionBrowserItems,
  type DateRange,
  type DateRangePresetKey,
  dateRangeFromPreset,
  filterSessionBrowserItems,
} from '../screens/session-browser-model.js';
import type { SessionScreenState } from '../screens/session-presenter.js';
import { SessionPresenter } from '../screens/session-presenter.js';
import type { RuntimeSessionInfo } from '../services/runtime-session-api.js';
import type { SessionMessage } from '../services/session-api.js';
import { SessionStreamScreen } from './session-stream-screen.js';

// ---------------------------------------------------------------------------
// Stream target — describes which session to open in stream/replay view
// ---------------------------------------------------------------------------

type StreamTarget = {
  sessionId: string;
  isLive: boolean;
  machineId: string | null;
};

export type SessionBrowserScreenProps = {
  initialTypeFilter?: 'all' | 'session' | 'runtime';
};

const STATUS_FILTERS: readonly ('all' | SessionBrowserStatus)[] = [
  'all',
  'active',
  'paused',
  'starting',
  'handing_off',
  'ended',
  'error',
];

function truncateId(id: string, length = 10): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function runtimeLabel(runtime: RuntimeSessionInfo['runtime']): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'paused':
      return '#f59e0b';
    case 'handing_off':
      return '#3b82f6';
    case 'error':
      return '#ef4444';
    case 'starting':
      return '#8b5cf6';
    default:
      return '#6b7280';
  }
}

function formatNativeImportReason(reason?: string | null): string {
  if (!reason) return 'unknown';
  return reason.replaceAll('_', ' ');
}

function formatTargetCli(targetCli: Record<string, unknown>): string | null {
  const command = typeof targetCli.command === 'string' ? targetCli.command : null;
  const version = typeof targetCli.version === 'string' ? targetCli.version : null;
  if (!command) return version;
  return version ? `${command} (${version})` : command;
}

function formatSourceStorage(sourceStorage: Record<string, unknown>): string | null {
  if (typeof sourceStorage.sessionPath === 'string') return sourceStorage.sessionPath;
  if (typeof sourceStorage.rootPath === 'string') return sourceStorage.rootPath;
  return null;
}

function machineStatusColor(status: Machine['status']): string {
  switch (status) {
    case 'online':
      return '#22c55e';
    case 'degraded':
      return '#f59e0b';
    default:
      return '#6b7280';
  }
}

function describeNativeImportAttempt(attempt?: {
  ok: boolean;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): string | null {
  if (!attempt) return null;

  const details: string[] = [];
  const targetCli =
    typeof attempt.metadata?.targetCli === 'string'
      ? attempt.metadata.targetCli
      : typeof attempt.metadata?.targetCli === 'object' && attempt.metadata.targetCli !== null
        ? formatTargetCli(attempt.metadata.targetCli as Record<string, unknown>)
        : null;
  const sourceStorage =
    typeof attempt.metadata?.sourceStorage === 'string'
      ? attempt.metadata.sourceStorage
      : typeof attempt.metadata?.sourceStorage === 'object' &&
          attempt.metadata.sourceStorage !== null
        ? formatSourceStorage(attempt.metadata.sourceStorage as Record<string, unknown>)
        : null;

  if (targetCli) details.push(`target CLI ${targetCli}`);
  if (sourceStorage) details.push(`source storage ${sourceStorage}`);

  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return attempt.ok
    ? `Native import succeeded${suffix}.`
    : `Native import unavailable: ${formatNativeImportReason(attempt.reason)}${suffix}.`;
}

function describeNativeImportPreflight(
  preflight?: RuntimeSessionScreenState['handoffPreflight'],
): string | null {
  if (!preflight) return null;
  if (preflight.nativeImportCapable) {
    return 'Native import ready on this target runtime.';
  }
  const summary = describeNativeImportAttempt(preflight.attempt);
  return summary ? `${summary} Snapshot handoff will be used.` : null;
}

function isRuntimeItem(
  item: SessionBrowserItem,
): item is SessionBrowserItem & { kind: 'runtime'; original: RuntimeSessionInfo } {
  return item.kind === 'runtime';
}

export function SessionBrowserScreen({
  initialTypeFilter = 'all',
}: SessionBrowserScreenProps): React.JSX.Element {
  const { apiClient } = useAppContext();
  const sessionPresenterRef = useRef<SessionPresenter | null>(null);
  const runtimePresenterRef = useRef<RuntimeSessionPresenter | null>(null);

  const [classicState, setClassicState] = useState<SessionScreenState>({
    sessions: [],
    selectedSession: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    lastUpdated: null,
  });
  const [runtimeState, setRuntimeState] = useState<RuntimeSessionScreenState>({
    sessions: [],
    machines: [],
    selectedSession: null,
    handoffs: [],
    handoffPreflight: null,
    isLoading: false,
    isHandoffsLoading: false,
    isPreflightLoading: false,
    error: null,
    lastUpdated: null,
  });

  const [typeFilter, setTypeFilter] = useState<'all' | 'session' | 'runtime'>(initialTypeFilter);
  const [runtimeFilter, setRuntimeFilter] = useState<'all' | RuntimeSessionInfo['runtime']>('all');
  const [machineFilter, setMachineFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | SessionBrowserStatus>('all');
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePresetKey>('all');
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });

  const handleDateRangeChange = useCallback((key: DateRangePresetKey) => {
    setDateRangePreset(key);
    setDateRange(dateRangeFromPreset(key));
  }, []);

  const [showClassicCreateModal, setShowClassicCreateModal] = useState(false);
  const [showRuntimeCreateModal, setShowRuntimeCreateModal] = useState(false);
  const [showClassicDetailModal, setShowClassicDetailModal] = useState(false);
  const [showRuntimeDetailModal, setShowRuntimeDetailModal] = useState(false);
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);

  const [newSessionPath, setNewSessionPath] = useState('');
  const [newSessionModel, setNewSessionModel] = useState('');
  const [newSessionPrompt, setNewSessionPrompt] = useState('');
  const [messageText, setMessageText] = useState('');

  const [createRuntime, setCreateRuntime] = useState<RuntimeSessionInfo['runtime']>('codex');
  const [createMachineId, setCreateMachineId] = useState('');
  const [createProjectPath, setCreateProjectPath] = useState('');
  const [createPrompt, setCreatePrompt] = useState('');
  const [createModel, setCreateModel] = useState('');

  const [resumePrompt, setResumePrompt] = useState('');
  const [resumeModel, setResumeModel] = useState('');
  const [forkPrompt, setForkPrompt] = useState('');
  const [forkModel, setForkModel] = useState('');
  const [forkMachineId, setForkMachineId] = useState('');
  const [handoffPrompt, setHandoffPrompt] = useState('');
  const [handoffTargetRuntime, setHandoffTargetRuntime] =
    useState<RuntimeSessionInfo['runtime']>('claude-code');
  const [handoffMachineId, setHandoffMachineId] = useState('');
  const [handoffHistoryFilter, setHandoffHistoryFilter] = useState<
    'all' | 'native-import' | 'fallback' | 'failed'
  >('all');

  useEffect(() => {
    setTypeFilter(initialTypeFilter);
  }, [initialTypeFilter]);

  useEffect(() => {
    const sessionPresenter = new SessionPresenter({
      apiClient,
      onChange: setClassicState,
    });
    const runtimePresenter = new RuntimeSessionPresenter({
      apiClient,
      onChange: setRuntimeState,
    });
    sessionPresenterRef.current = sessionPresenter;
    runtimePresenterRef.current = runtimePresenter;
    sessionPresenter.start();
    runtimePresenter.start();

    return () => {
      sessionPresenter.stop();
      runtimePresenter.stop();
    };
  }, [apiClient]);

  useEffect(() => {
    const selectedSession = runtimeState.selectedSession;
    if (!selectedSession) return;
    const preferredMachineId = pickPreferredMachineId(
      runtimeState.machines,
      selectedSession.machineId,
    );
    setForkMachineId(preferredMachineId);
    setHandoffMachineId(preferredMachineId);
    setHandoffTargetRuntime(selectedSession.runtime === 'codex' ? 'claude-code' : 'codex');
  }, [runtimeState.machines, runtimeState.selectedSession]);

  useEffect(() => {
    if (createMachineId) return;
    const preferredMachineId = pickPreferredMachineId(runtimeState.machines);
    if (preferredMachineId) {
      setCreateMachineId(preferredMachineId);
    }
  }, [createMachineId, runtimeState.machines]);

  useEffect(() => {
    const selectedSession = runtimeState.selectedSession;
    if (!selectedSession?.nativeSessionId) return;
    if (!(selectedSession.status === 'active' || selectedSession.status === 'paused')) return;
    if (handoffTargetRuntime === selectedSession.runtime) return;

    void runtimePresenterRef.current?.loadHandoffPreflight({
      sessionId: selectedSession.id,
      targetRuntime: handoffTargetRuntime,
      ...(handoffMachineId.trim() ? { targetMachineId: handoffMachineId.trim() } : {}),
    });
  }, [handoffMachineId, handoffTargetRuntime, runtimeState.selectedSession]);

  const selectableMachines = useMemo(
    () => sortMachinesForSelection(runtimeState.machines),
    [runtimeState.machines],
  );

  const browserItems = useMemo(
    () =>
      buildSessionBrowserItems({
        classicSessions: classicState.sessions,
        runtimeSessions: runtimeState.sessions,
        machines: runtimeState.machines,
      }),
    [classicState.sessions, runtimeState.machines, runtimeState.sessions],
  );

  const filteredItems = useMemo(
    () =>
      filterSessionBrowserItems(browserItems, {
        type: typeFilter,
        runtime: runtimeFilter,
        machineId: machineFilter,
        status: statusFilter,
        dateRange,
      }),
    [browserItems, dateRange, machineFilter, runtimeFilter, statusFilter, typeFilter],
  );

  const lastUpdated = useMemo(() => {
    const timestamps = [classicState.lastUpdated, runtimeState.lastUpdated]
      .filter((value): value is Date => value instanceof Date)
      .map((value) => value.getTime());
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps));
  }, [classicState.lastUpdated, runtimeState.lastUpdated]);

  const filteredHandoffs = useMemo(
    () =>
      runtimeState.handoffs.filter((handoff) =>
        matchesHandoffHistoryFilter(handoff, handoffHistoryFilter),
      ),
    [handoffHistoryFilter, runtimeState.handoffs],
  );

  const combinedError = classicState.error ?? runtimeState.error;
  const combinedLoading = classicState.isLoading || runtimeState.isLoading;

  const onRefresh = useCallback(() => {
    void Promise.allSettled([
      sessionPresenterRef.current?.loadSessions(),
      runtimePresenterRef.current?.loadSessions(),
    ]);
  }, []);

  const handleBrowserItemPress = useCallback((item: SessionBrowserItem) => {
    const isLive = item.status === 'active' || item.status === 'starting';
    setStreamTarget({
      sessionId: item.id,
      isLive,
      machineId: item.machineId,
    });
  }, []);

  const handleStreamBack = useCallback(() => {
    setStreamTarget(null);
  }, []);

  const handleBrowserItemLongPress = useCallback((item: SessionBrowserItem) => {
    if (isRuntimeItem(item)) {
      setShowRuntimeDetailModal(true);
      void runtimePresenterRef.current?.selectSession(item.original);
      return;
    }

    setShowClassicDetailModal(true);
    void sessionPresenterRef.current?.loadSessionDetail(item.id);
  }, []);

  const handleCloseClassicDetail = useCallback(() => {
    setShowClassicDetailModal(false);
    setMessageText('');
    sessionPresenterRef.current?.clearSelectedSession();
  }, []);

  const handleCloseRuntimeDetail = useCallback(() => {
    setShowRuntimeDetailModal(false);
    setResumePrompt('');
    setResumeModel('');
    setForkPrompt('');
    setForkModel('');
    setForkMachineId('');
    setHandoffPrompt('');
    runtimePresenterRef.current?.clearSelectedSession();
  }, []);

  const handleClassicCreate = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (newSessionPath.trim()) params.projectPath = newSessionPath.trim();
      if (newSessionModel.trim()) params.model = newSessionModel.trim();
      if (newSessionPrompt.trim()) params.prompt = newSessionPrompt.trim();
      await sessionPresenterRef.current?.createSession(
        Object.keys(params).length > 0 ? params : undefined,
      );
      setShowClassicCreateModal(false);
      setNewSessionPath('');
      setNewSessionModel('');
      setNewSessionPrompt('');
      Alert.alert('Created', 'New classic session has been started.');
    } catch (err: unknown) {
      Alert.alert('Create Failed', err instanceof Error ? err.message : String(err));
    }
  }, [newSessionModel, newSessionPath, newSessionPrompt]);

  const handleClassicResume = useCallback(async () => {
    const sessionId = classicState.selectedSession?.id;
    if (!sessionId) return;
    try {
      await sessionPresenterRef.current?.resumeSession(sessionId);
      Alert.alert('Resumed', `Session ${truncateId(sessionId)} has been resumed.`);
    } catch (err: unknown) {
      Alert.alert('Resume Failed', err instanceof Error ? err.message : String(err));
    }
  }, [classicState.selectedSession?.id]);

  const handleSendMessage = useCallback(async () => {
    const sessionId = classicState.selectedSession?.id;
    if (!sessionId) return;
    if (!messageText.trim()) {
      Alert.alert('Validation', 'Please enter a message.');
      return;
    }

    try {
      await sessionPresenterRef.current?.sendMessage(sessionId, messageText.trim());
      setMessageText('');
    } catch (err: unknown) {
      Alert.alert('Send Failed', err instanceof Error ? err.message : String(err));
    }
  }, [classicState.selectedSession?.id, messageText]);

  const handleRuntimeCreate = useCallback(async () => {
    if (!createMachineId.trim() || !createProjectPath.trim() || !createPrompt.trim()) {
      Alert.alert('Validation', 'Runtime, machine ID, project path, and prompt are required.');
      return;
    }

    try {
      const session = await runtimePresenterRef.current?.createSession({
        runtime: createRuntime,
        machineId: createMachineId.trim(),
        projectPath: createProjectPath.trim(),
        prompt: createPrompt.trim(),
        ...(createModel.trim() ? { model: createModel.trim() } : {}),
      });
      setShowRuntimeCreateModal(false);
      setCreateMachineId('');
      setCreateProjectPath('');
      setCreatePrompt('');
      setCreateModel('');
      Alert.alert('Created', `${runtimeLabel(session?.runtime ?? createRuntime)} session started.`);
    } catch (err: unknown) {
      Alert.alert('Create Failed', err instanceof Error ? err.message : String(err));
    }
  }, [createMachineId, createModel, createProjectPath, createPrompt, createRuntime]);

  const handleRuntimeResume = useCallback(async () => {
    const selectedSession = runtimeState.selectedSession;
    if (!selectedSession) return;
    if (!resumePrompt.trim()) {
      Alert.alert('Validation', 'Resume prompt is required.');
      return;
    }

    try {
      await runtimePresenterRef.current?.resumeSession({
        sessionId: selectedSession.id,
        prompt: resumePrompt.trim(),
        ...(resumeModel.trim() ? { model: resumeModel.trim() } : {}),
      });
      setResumePrompt('');
      setResumeModel('');
      Alert.alert('Resumed', `${truncateId(selectedSession.id)} resumed.`);
    } catch (err: unknown) {
      Alert.alert('Resume Failed', err instanceof Error ? err.message : String(err));
    }
  }, [resumeModel, resumePrompt, runtimeState.selectedSession]);

  const handleFork = useCallback(async () => {
    const selectedSession = runtimeState.selectedSession;
    if (!selectedSession) return;

    try {
      const forkedSession = await runtimePresenterRef.current?.forkSession({
        sessionId: selectedSession.id,
        ...(forkPrompt.trim() ? { prompt: forkPrompt.trim() } : {}),
        ...(forkModel.trim() ? { model: forkModel.trim() } : {}),
        ...(forkMachineId.trim() ? { targetMachineId: forkMachineId.trim() } : {}),
      });
      setForkPrompt('');
      setForkModel('');
      Alert.alert('Forked', `Created ${truncateId(forkedSession?.id ?? 'new-session')}.`);
    } catch (err: unknown) {
      Alert.alert('Fork Failed', err instanceof Error ? err.message : String(err));
    }
  }, [forkMachineId, forkModel, forkPrompt, runtimeState.selectedSession]);

  const handleHandoff = useCallback(async () => {
    const selectedSession = runtimeState.selectedSession;
    if (!selectedSession) return;

    try {
      const response = await runtimePresenterRef.current?.handoffSession({
        sessionId: selectedSession.id,
        targetRuntime: handoffTargetRuntime,
        ...(handoffMachineId.trim() ? { targetMachineId: handoffMachineId.trim() } : {}),
        ...(handoffPrompt.trim() ? { prompt: handoffPrompt.trim() } : {}),
      });
      setHandoffPrompt('');
      const nativeImportSummary = describeNativeImportAttempt(response?.nativeImportAttempt);
      const completionSummary = response
        ? describeHandoffCompletion({
            targetRuntime: response.session.runtime,
            strategy: response.strategy,
            nativeImportAttempt: response.nativeImportAttempt,
          })
        : `${truncateId(selectedSession.id)} switched`;
      Alert.alert(
        'Handed Off',
        `${completionSummary}.${nativeImportSummary ? `\n\n${nativeImportSummary}` : ''}`,
      );
    } catch (err: unknown) {
      Alert.alert('Handoff Failed', err instanceof Error ? err.message : String(err));
    }
  }, [handoffMachineId, handoffPrompt, handoffTargetRuntime, runtimeState.selectedSession]);

  const renderBrowserItem = useCallback(
    ({ item }: { item: SessionBrowserItem }) => (
      <SessionCard
        item={item}
        onPress={handleBrowserItemPress}
        onLongPress={handleBrowserItemLongPress}
      />
    ),
    [handleBrowserItemPress, handleBrowserItemLongPress],
  );

  const renderMessage = useCallback(
    (msg: SessionMessage, index: number) => (
      <View
        key={`${msg.timestamp}-${index}`}
        style={[
          styles.messageBubble,
          msg.role === 'user' ? styles.userMessage : styles.assistantMessage,
        ]}
      >
        <Text style={styles.messageRole}>{msg.role === 'user' ? 'You' : 'Assistant'}</Text>
        <Text style={styles.messageContent}>{msg.content}</Text>
        <Text style={styles.messageTime}>{new Date(msg.timestamp).toLocaleTimeString()}</Text>
      </View>
    ),
    [],
  );

  const handleStopRuntimeSession = useCallback(async () => {
    const selected = runtimeState.selectedSession;
    if (!selected) return;
    try {
      // Use the API client directly to stop an agent-backed session
      if (selected.agentId) {
        await apiClient.stopAgent(selected.agentId, 'user', true);
        Alert.alert('Stopped', `Session ${truncateId(selected.id)} agent has been stopped.`);
        void runtimePresenterRef.current?.loadSessions();
      } else {
        Alert.alert('Not Supported', 'This session does not have an associated agent to stop.');
      }
    } catch (err: unknown) {
      Alert.alert('Stop Failed', err instanceof Error ? err.message : String(err));
    }
  }, [apiClient, runtimeState.selectedSession]);

  const classicSelectedSession = classicState.selectedSession;
  const runtimeSelectedSession = runtimeState.selectedSession;
  const runtimeResumable =
    runtimeSelectedSession?.status === 'paused' ||
    runtimeSelectedSession?.status === 'ended' ||
    runtimeSelectedSession?.status === 'error';

  // When a stream target is set, render the full-screen stream/replay view
  if (streamTarget) {
    return (
      <SessionStreamScreen
        sessionId={streamTarget.sessionId}
        isLive={streamTarget.isLive}
        machineId={streamTarget.machineId}
        onBack={handleStreamBack}
      />
    );
  }

  return (
    <View style={styles.container}>
      {combinedError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{combinedError.message}</Text>
        </View>
      )}

      <View style={styles.toolbar}>
        <View>
          <Text style={styles.sessionCount}>
            {filteredItems.length} item{filteredItems.length === 1 ? '' : 's'}
          </Text>
          <Text style={styles.helperText}>Unified browser for classic and managed sessions.</Text>
        </View>
        <View style={styles.toolbarButtons}>
          <TouchableOpacity
            style={[styles.newSessionButton, styles.secondaryButton]}
            onPress={() => setShowClassicCreateModal(true)}
          >
            <Text style={styles.newSessionButtonText}>+ Session</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.newSessionButton}
            onPress={() => setShowRuntimeCreateModal(true)}
          >
            <Text style={styles.newSessionButtonText}>+ Runtime</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {(['all', 'session', 'runtime'] as const).map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.filterChip, typeFilter === value && styles.filterChipActive]}
            onPress={() => setTypeFilter(value)}
          >
            <Text style={styles.filterChipText}>
              {value === 'all' ? 'All' : value === 'session' ? 'Classic' : 'Managed'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {(['all', 'claude-code', 'codex'] as const).map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.filterChip, runtimeFilter === value && styles.filterChipActive]}
            onPress={() => setRuntimeFilter(value)}
          >
            <Text style={styles.filterChipText}>
              {value === 'all' ? 'All runtimes' : runtimeLabel(value)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <TouchableOpacity
          style={[styles.filterChip, machineFilter === 'all' && styles.filterChipActive]}
          onPress={() => setMachineFilter('all')}
        >
          <Text style={styles.filterChipText}>All machines</Text>
        </TouchableOpacity>
        {selectableMachines.map((machine) => (
          <TouchableOpacity
            key={machine.id}
            style={[styles.filterChip, machineFilter === machine.id && styles.filterChipActive]}
            onPress={() => setMachineFilter(machine.id)}
          >
            <Text style={styles.filterChipText}>{machine.hostname}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {STATUS_FILTERS.map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.filterChip, statusFilter === value && styles.filterChipActive]}
            onPress={() => setStatusFilter(value)}
          >
            <Text style={styles.filterChipText}>
              {value === 'all' ? 'All status' : value.replaceAll('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <DateRangePicker selected={dateRangePreset} onSelect={handleDateRangeChange} />

      <FlatList
        data={filteredItems}
        renderItem={renderBrowserItem}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={combinedLoading} onRefresh={onRefresh} tintColor="#9ca3af" />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {combinedLoading ? 'Loading sessions...' : 'No sessions match the current filters'}
          </Text>
        }
      />

      {lastUpdated && (
        <Text style={styles.lastUpdated}>Updated: {lastUpdated.toLocaleTimeString()}</Text>
      )}

      <Modal
        visible={showClassicCreateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowClassicCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Classic Session</Text>
            <Text style={styles.fieldLabel}>Project Path (optional)</Text>
            <TextInput
              style={styles.input}
              value={newSessionPath}
              onChangeText={setNewSessionPath}
              placeholder="e.g. /home/user/project"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldLabel}>Model (optional)</Text>
            <TextInput
              style={styles.input}
              value={newSessionModel}
              onChangeText={setNewSessionModel}
              placeholder="e.g. claude-sonnet-4-20250514"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldLabel}>Initial Prompt (optional)</Text>
            <TextInput
              style={[styles.input, styles.promptInput]}
              value={newSessionPrompt}
              onChangeText={setNewSessionPrompt}
              placeholder="Enter a prompt to start the session with..."
              placeholderTextColor="#6b7280"
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowClassicCreateModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton]}
                onPress={handleClassicCreate}
              >
                <Text style={styles.buttonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRuntimeCreateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRuntimeCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Managed Session</Text>
            <Text style={styles.fieldLabel}>Runtime</Text>
            <View style={styles.segmentRow}>
              {(['codex', 'claude-code'] as const).map((runtime) => (
                <TouchableOpacity
                  key={runtime}
                  style={[
                    styles.segmentButton,
                    createRuntime === runtime && styles.segmentButtonActive,
                  ]}
                  onPress={() => setCreateRuntime(runtime)}
                >
                  <Text style={styles.segmentButtonText}>{runtimeLabel(runtime)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Machine</Text>
            {runtimeState.machines.length > 0 ? (
              <View style={styles.machinePickerList}>
                {selectableMachines.map((machine) => (
                  <TouchableOpacity
                    key={machine.id}
                    style={[
                      styles.machinePickerButton,
                      createMachineId === machine.id && styles.machinePickerButtonActive,
                      !isMachineSelectable(machine) && styles.machinePickerButtonDisabled,
                    ]}
                    disabled={!isMachineSelectable(machine)}
                    onPress={() => setCreateMachineId(machine.id)}
                  >
                    <View
                      style={[
                        styles.machineStatusDot,
                        { backgroundColor: machineStatusColor(machine.status) },
                      ]}
                    />
                    <View style={styles.machinePickerTextBlock}>
                      <Text style={styles.machinePickerTitle}>{machine.hostname}</Text>
                      <Text style={styles.machinePickerSubtitle}>
                        {machine.id} · {machine.status}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TextInput
                style={styles.input}
                value={createMachineId}
                onChangeText={setCreateMachineId}
                placeholder="e.g. mac-mini-01"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <Text style={styles.fieldLabel}>Project Path</Text>
            <TextInput
              style={styles.input}
              value={createProjectPath}
              onChangeText={setCreateProjectPath}
              placeholder="e.g. /Users/me/project"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldLabel}>Prompt</Text>
            <TextInput
              style={[styles.input, styles.promptInput]}
              value={createPrompt}
              onChangeText={setCreatePrompt}
              placeholder="Tell the runtime what to do"
              placeholderTextColor="#6b7280"
              multiline
            />
            <Text style={styles.fieldLabel}>Model (optional)</Text>
            <TextInput
              style={styles.input}
              value={createModel}
              onChangeText={setCreateModel}
              placeholder="e.g. claude-sonnet-4"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowRuntimeCreateModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton]}
                onPress={handleRuntimeCreate}
              >
                <Text style={styles.buttonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showClassicDetailModal}
        animationType="slide"
        transparent
        onRequestClose={handleCloseClassicDetail}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            {classicState.isDetailLoading ? (
              <Text style={styles.loadingText}>Loading session...</Text>
            ) : classicSelectedSession ? (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderTop}>
                    <Text style={styles.detailTitle}>
                      {truncateId(classicSelectedSession.id, 12)}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: sessionStatusColor(classicSelectedSession.status) },
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {classicSelectedSession.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.detailInfo}>Source: Classic session</Text>
                  <Text style={styles.detailInfo}>
                    Project: {classicSelectedSession.projectPath}
                  </Text>
                  <Text style={styles.detailInfo}>
                    Messages: {classicSelectedSession.messageCount}
                  </Text>
                  {classicSelectedSession.model && (
                    <Text style={styles.detailInfo}>Model: {classicSelectedSession.model}</Text>
                  )}
                </View>

                <View style={styles.detailActions}>
                  {classicSelectedSession.status === 'paused' && (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.resumeButton]}
                      onPress={handleClassicResume}
                    >
                      <Text style={styles.buttonText}>Resume</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionButton, styles.closeDetailButton]}
                    onPress={handleCloseClassicDetail}
                  >
                    <Text style={styles.buttonText}>Close</Text>
                  </TouchableOpacity>
                </View>

                {classicSelectedSession.status === 'active' && (
                  <View style={styles.sendMessageRow}>
                    <TextInput
                      style={styles.messageInput}
                      value={messageText}
                      onChangeText={setMessageText}
                      placeholder="Send a message..."
                      placeholderTextColor="#6b7280"
                      multiline
                    />
                    <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
                      <Text style={styles.sendButtonText}>Send</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Text style={styles.transcriptLabel}>
                  Transcript ({classicSelectedSession.messages.length} messages)
                </Text>
                <ScrollView
                  style={styles.transcriptScroll}
                  contentContainerStyle={styles.transcriptContent}
                >
                  {classicSelectedSession.messages.length === 0 ? (
                    <Text style={styles.emptyTranscript}>No messages in this session</Text>
                  ) : (
                    classicSelectedSession.messages.map(renderMessage)
                  )}
                </ScrollView>
              </>
            ) : (
              <Text style={styles.loadingText}>Session not found</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRuntimeDetailModal}
        animationType="slide"
        transparent
        onRequestClose={handleCloseRuntimeDetail}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            {runtimeSelectedSession ? (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderTop}>
                    <Text style={styles.detailTitle}>
                      {truncateId(runtimeSelectedSession.id, 14)}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: sessionStatusColor(runtimeSelectedSession.status) },
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {runtimeSelectedSession.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.detailInfo}>
                    Runtime: {runtimeLabel(runtimeSelectedSession.runtime)}
                  </Text>
                  <Text style={styles.detailInfo}>Machine: {runtimeSelectedSession.machineId}</Text>
                  <Text style={styles.detailInfo}>
                    Project: {runtimeSelectedSession.projectPath}
                  </Text>
                  {runtimeSelectedSession.nativeSessionId && (
                    <Text style={styles.detailInfo}>
                      Native: {runtimeSelectedSession.nativeSessionId}
                    </Text>
                  )}
                </View>

                <ScrollView
                  style={styles.detailScroll}
                  contentContainerStyle={styles.detailScrollContent}
                >
                  {runtimeResumable && (
                    <View style={styles.sectionCard}>
                      <Text style={styles.sectionTitle}>Resume</Text>
                      <TextInput
                        style={[styles.input, styles.promptInput]}
                        value={resumePrompt}
                        onChangeText={setResumePrompt}
                        placeholder="Required resume prompt"
                        placeholderTextColor="#6b7280"
                        multiline
                      />
                      <TextInput
                        style={styles.input}
                        value={resumeModel}
                        onChangeText={setResumeModel}
                        placeholder="Optional model override"
                        placeholderTextColor="#6b7280"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        style={[styles.actionButton, styles.resumeButton]}
                        onPress={handleRuntimeResume}
                      >
                        <Text style={styles.buttonText}>Resume Session</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {runtimeSelectedSession.nativeSessionId && (
                    <View style={styles.sectionCard}>
                      <Text style={styles.sectionTitle}>Fork</Text>
                      <TextInput
                        style={[styles.input, styles.promptInput]}
                        value={forkPrompt}
                        onChangeText={setForkPrompt}
                        placeholder="Optional fork prompt"
                        placeholderTextColor="#6b7280"
                        multiline
                      />
                      <TextInput
                        style={styles.input}
                        value={forkModel}
                        onChangeText={setForkModel}
                        placeholder="Optional model override"
                        placeholderTextColor="#6b7280"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <View style={styles.machinePickerList}>
                        {selectableMachines.map((machine) => (
                          <TouchableOpacity
                            key={machine.id}
                            style={[
                              styles.machinePickerButton,
                              forkMachineId === machine.id && styles.machinePickerButtonActive,
                              !isMachineSelectable(machine) && styles.machinePickerButtonDisabled,
                            ]}
                            disabled={!isMachineSelectable(machine)}
                            onPress={() => setForkMachineId(machine.id)}
                          >
                            <View
                              style={[
                                styles.machineStatusDot,
                                { backgroundColor: machineStatusColor(machine.status) },
                              ]}
                            />
                            <View style={styles.machinePickerTextBlock}>
                              <Text style={styles.machinePickerTitle}>{machine.hostname}</Text>
                              <Text style={styles.machinePickerSubtitle}>
                                {machine.id} · {machine.status}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.forkButton]}
                        onPress={handleFork}
                      >
                        <Text style={styles.buttonText}>Fork Session</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {runtimeSelectedSession.nativeSessionId && (
                    <View style={styles.sectionCard}>
                      <Text style={styles.sectionTitle}>Handoff</Text>
                      <View style={styles.segmentRow}>
                        {(['claude-code', 'codex'] as const).map((runtime) => (
                          <TouchableOpacity
                            key={runtime}
                            style={[
                              styles.segmentButton,
                              handoffTargetRuntime === runtime && styles.segmentButtonActive,
                              runtimeSelectedSession.runtime === runtime &&
                                styles.segmentButtonDisabled,
                            ]}
                            disabled={runtimeSelectedSession.runtime === runtime}
                            onPress={() => setHandoffTargetRuntime(runtime)}
                          >
                            <Text style={styles.segmentButtonText}>{runtimeLabel(runtime)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.machinePickerList}>
                        {selectableMachines.map((machine) => (
                          <TouchableOpacity
                            key={machine.id}
                            style={[
                              styles.machinePickerButton,
                              handoffMachineId === machine.id && styles.machinePickerButtonActive,
                              !isMachineSelectable(machine) && styles.machinePickerButtonDisabled,
                            ]}
                            disabled={!isMachineSelectable(machine)}
                            onPress={() => setHandoffMachineId(machine.id)}
                          >
                            <View
                              style={[
                                styles.machineStatusDot,
                                { backgroundColor: machineStatusColor(machine.status) },
                              ]}
                            />
                            <View style={styles.machinePickerTextBlock}>
                              <Text style={styles.machinePickerTitle}>{machine.hostname}</Text>
                              <Text style={styles.machinePickerSubtitle}>
                                {machine.id} · {machine.status}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextInput
                        style={[styles.input, styles.promptInput]}
                        value={handoffPrompt}
                        onChangeText={setHandoffPrompt}
                        placeholder="Optional handoff prompt"
                        placeholderTextColor="#6b7280"
                        multiline
                      />
                      {runtimeState.handoffPreflight && (
                        <View style={styles.preflightCard}>
                          <Text style={styles.preflightTitle}>
                            {
                              summarizeNativeImportPreflightStatus({
                                preflight: runtimeState.handoffPreflight,
                                isLoading: runtimeState.isPreflightLoading,
                              }).badgeLabel
                            }
                          </Text>
                          {describeNativeImportPreflight(runtimeState.handoffPreflight) && (
                            <Text style={styles.preflightText}>
                              {describeNativeImportPreflight(runtimeState.handoffPreflight)}
                            </Text>
                          )}
                        </View>
                      )}
                      <TouchableOpacity
                        style={[styles.actionButton, styles.handoffButton]}
                        onPress={handleHandoff}
                      >
                        <Text style={styles.buttonText}>Hand Off Session</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Handoff Timeline</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.filterRow}
                    >
                      {HANDOFF_HISTORY_FILTERS.map((filter) => (
                        <TouchableOpacity
                          key={filter}
                          style={[
                            styles.filterChip,
                            handoffHistoryFilter === filter && styles.filterChipActive,
                          ]}
                          onPress={() => setHandoffHistoryFilter(filter)}
                        >
                          <Text style={styles.filterChipText}>
                            {formatHandoffHistoryFilterLabel(filter)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>

                    <HandoffTimeline handoffs={filteredHandoffs} />
                  </View>

                  {filteredHandoffs.length > 0 && (
                    <View style={styles.sectionCard}>
                      <Text style={styles.sectionTitle}>Agent Contributions</Text>
                      <ExpandableDiff handoffs={filteredHandoffs} />
                    </View>
                  )}

                  <SessionActionBar
                    sessionStatus={runtimeSelectedSession.status}
                    onResume={runtimeResumable ? handleRuntimeResume : undefined}
                    onStop={handleStopRuntimeSession}
                    onClose={handleCloseRuntimeDetail}
                  />
                </ScrollView>
              </>
            ) : (
              <Text style={styles.loadingText}>Managed session not found</Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

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
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e2e',
    gap: 10,
  },
  toolbarButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sessionCount: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  newSessionButton: {
    backgroundColor: '#1e40af',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  secondaryButton: {
    backgroundColor: '#374151',
  },
  newSessionButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: '#1d4ed8',
  },
  filterChipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
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
  // SessionCard and DateRangePicker components handle their own styles.
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 20,
  },
  fieldLabel: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
    fontWeight: '600',
  },
  helperText: {
    color: '#6b7280',
    fontSize: 11,
  },
  input: {
    backgroundColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    color: '#ffffff',
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  promptInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  segmentButton: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111111',
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#1e40af',
    borderColor: '#1e40af',
  },
  segmentButtonDisabled: {
    opacity: 0.45,
  },
  segmentButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  machinePickerList: {
    gap: 8,
    marginBottom: 16,
  },
  machinePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  machinePickerButtonActive: {
    borderColor: '#1e40af',
    backgroundColor: '#172554',
  },
  machinePickerButtonDisabled: {
    opacity: 0.45,
  },
  machineStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  machinePickerTextBlock: {
    flex: 1,
  },
  machinePickerTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  machinePickerSubtitle: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#374151',
  },
  createButton: {
    backgroundColor: '#1e40af',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  detailModalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    maxHeight: '88%',
    flex: 1,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 32,
  },
  detailHeader: {
    marginBottom: 16,
  },
  detailHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  detailInfo: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  resumeButton: {
    backgroundColor: '#1d4ed8',
  },
  forkButton: {
    backgroundColor: '#0f766e',
  },
  handoffButton: {
    backgroundColor: '#9333ea',
  },
  closeDetailButton: {
    backgroundColor: '#374151',
  },
  detailScroll: {
    flex: 1,
  },
  detailScrollContent: {
    paddingBottom: 24,
  },
  sectionCard: {
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  preflightCard: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  preflightTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  preflightText: {
    color: '#d1d5db',
    fontSize: 12,
  },
  // HandoffTimeline and ExpandableDiff components handle their own styles.
  sendMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 16,
  },
  messageInput: {
    flex: 1,
    minHeight: 64,
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    color: '#ffffff',
    padding: 12,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  transcriptLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  transcriptScroll: {
    flex: 1,
  },
  transcriptContent: {
    paddingBottom: 20,
  },
  emptyTranscript: {
    color: '#6b7280',
    fontSize: 13,
  },
  messageBubble: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  userMessage: {
    backgroundColor: '#1e3a8a',
  },
  assistantMessage: {
    backgroundColor: '#1f2937',
  },
  messageRole: {
    color: '#bfdbfe',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  messageContent: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  messageTime: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 8,
  },
});
