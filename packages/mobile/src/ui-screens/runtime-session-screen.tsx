// ---------------------------------------------------------------------------
// RuntimeSessionScreen — browse and control managed Claude Code / Codex
// runtime sessions. Supports create, resume, fork, handoff, and handoff
// history without disturbing the classic Claude session workflow.
// ---------------------------------------------------------------------------

import {
  describeHandoffCompletion,
  describeHandoffExecution,
  formatHandoffHistoryFilterLabel,
  formatHandoffStrategyLabel,
  HANDOFF_HISTORY_FILTERS,
  isMachineSelectable,
  type Machine,
  matchesHandoffHistoryFilter,
  pickPreferredMachineId,
  sortMachinesForSelection,
  summarizeHandoffAnalytics,
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

import { useAppContext } from '../context/app-context.js';
import type { RuntimeSessionScreenState } from '../screens/runtime-session-presenter.js';
import { RuntimeSessionPresenter } from '../screens/runtime-session-presenter.js';
import type { RuntimeSessionHandoff, RuntimeSessionInfo } from '../services/runtime-session-api.js';

function truncateId(id: string, length = 10): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function runtimeLabel(runtime: RuntimeSessionInfo['runtime']): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function sessionStatusColor(status: RuntimeSessionInfo['status']): string {
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

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'unknown';
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function handoffStatusColor(status: RuntimeSessionHandoff['status']): string {
  switch (status) {
    case 'succeeded':
      return '#22c55e';
    case 'failed':
      return '#ef4444';
    default:
      return '#f59e0b';
  }
}

function formatNativeImportReason(reason?: string | null): string {
  if (!reason) return 'unknown';
  return reason.replaceAll('_', ' ');
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
  const sourceSessionSummary =
    typeof attempt.metadata?.sourceSessionSummary === 'object' &&
    attempt.metadata.sourceSessionSummary !== null
      ? (attempt.metadata.sourceSessionSummary as Record<string, unknown>)
      : null;
  const messageCounts =
    sourceSessionSummary &&
    typeof sourceSessionSummary.messageCounts === 'object' &&
    sourceSessionSummary.messageCounts !== null
      ? (sourceSessionSummary.messageCounts as Record<string, unknown>)
      : null;
  const userMessages = typeof messageCounts?.user === 'number' ? messageCounts.user : 0;
  const assistantMessages =
    typeof messageCounts?.assistant === 'number' ? messageCounts.assistant : 0;
  const lastActivity =
    typeof sourceSessionSummary?.lastActivity === 'string'
      ? sourceSessionSummary.lastActivity
      : null;

  if (targetCli) {
    details.push(`target CLI ${targetCli}`);
  }
  if (sourceStorage) {
    details.push(`source storage ${sourceStorage}`);
  }
  if (userMessages + assistantMessages > 0) {
    details.push(`${userMessages} user / ${assistantMessages} assistant messages`);
  }
  if (lastActivity) {
    details.push(`last activity ${lastActivity}`);
  }

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
    const targetCli =
      typeof preflight.attempt.metadata?.targetCli === 'string'
        ? preflight.attempt.metadata.targetCli
        : typeof preflight.attempt.metadata?.targetCli === 'object' &&
            preflight.attempt.metadata.targetCli !== null
          ? formatTargetCli(preflight.attempt.metadata.targetCli as Record<string, unknown>)
          : null;
    const sourceStorage =
      typeof preflight.attempt.metadata?.sourceStorage === 'string'
        ? preflight.attempt.metadata.sourceStorage
        : typeof preflight.attempt.metadata?.sourceStorage === 'object' &&
            preflight.attempt.metadata.sourceStorage !== null
          ? formatSourceStorage(preflight.attempt.metadata.sourceStorage as Record<string, unknown>)
          : null;
    const details = [
      targetCli ? `target CLI ${targetCli}` : null,
      sourceStorage ? `source storage ${sourceStorage}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return details
      ? `Native import ready (${details}).`
      : 'Native import ready on this target runtime.';
  }

  const summary = describeNativeImportAttempt(preflight.attempt);
  return summary ? `${summary} Snapshot handoff will be used.` : null;
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

export function RuntimeSessionScreen(): React.JSX.Element {
  const { apiClient } = useAppContext();
  const presenterRef = useRef<RuntimeSessionPresenter | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
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

  const [state, setState] = useState<RuntimeSessionScreenState>({
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

  useEffect(() => {
    const presenter = new RuntimeSessionPresenter({
      apiClient,
      onChange: setState,
    });
    presenterRef.current = presenter;
    presenter.start();

    return () => {
      presenter.stop();
    };
  }, [apiClient]);

  useEffect(() => {
    if (!state.selectedSession) return;
    const preferredMachineId = pickPreferredMachineId(
      state.machines,
      state.selectedSession.machineId,
    );
    setForkMachineId(preferredMachineId);
    setHandoffMachineId(preferredMachineId);
    setHandoffTargetRuntime(state.selectedSession.runtime === 'codex' ? 'claude-code' : 'codex');
  }, [state.machines, state.selectedSession]);

  useEffect(() => {
    if (!state.selectedSession) return;
    if (!state.selectedSession.nativeSessionId) return;
    if (!(state.selectedSession.status === 'active' || state.selectedSession.status === 'paused'))
      return;
    if (handoffTargetRuntime === state.selectedSession.runtime) return;

    void presenterRef.current?.loadHandoffPreflight({
      sessionId: state.selectedSession.id,
      targetRuntime: handoffTargetRuntime,
      ...(handoffMachineId.trim() ? { targetMachineId: handoffMachineId.trim() } : {}),
    });
  }, [handoffMachineId, handoffTargetRuntime, state.selectedSession]);

  useEffect(() => {
    if (createMachineId) return;
    const preferredMachineId = pickPreferredMachineId(state.machines);
    if (preferredMachineId) {
      setCreateMachineId(preferredMachineId);
    }
  }, [createMachineId, state.machines]);

  const selectableMachines = useMemo(
    () => sortMachinesForSelection(state.machines),
    [state.machines],
  );

  const machineLookup = useMemo(
    () => new Map(selectableMachines.map((machine) => [machine.id, machine] as const)),
    [selectableMachines],
  );

  const onRefresh = useCallback(() => {
    void presenterRef.current?.loadSessions();
  }, []);

  const handleSessionPress = useCallback((session: RuntimeSessionInfo) => {
    setShowDetailModal(true);
    void presenterRef.current?.selectSession(session);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setShowDetailModal(false);
    presenterRef.current?.clearSelectedSession();
    setResumePrompt('');
    setResumeModel('');
    setForkPrompt('');
    setForkModel('');
    setForkMachineId('');
    setHandoffPrompt('');
  }, []);

  const handleCreateSession = useCallback(async () => {
    if (!createMachineId.trim() || !createProjectPath.trim() || !createPrompt.trim()) {
      Alert.alert('Validation', 'Runtime, machine ID, project path, and prompt are required.');
      return;
    }

    try {
      const session = await presenterRef.current?.createSession({
        runtime: createRuntime,
        machineId: createMachineId.trim(),
        projectPath: createProjectPath.trim(),
        prompt: createPrompt.trim(),
        ...(createModel.trim() ? { model: createModel.trim() } : {}),
      });
      setShowCreateModal(false);
      setCreateMachineId('');
      setCreateProjectPath('');
      setCreatePrompt('');
      setCreateModel('');
      Alert.alert('Created', `${runtimeLabel(session?.runtime ?? createRuntime)} session started.`);
    } catch (err: unknown) {
      Alert.alert('Create Failed', err instanceof Error ? err.message : String(err));
    }
  }, [createMachineId, createModel, createProjectPath, createPrompt, createRuntime]);

  const handleResume = useCallback(async () => {
    const selectedSession = state.selectedSession;
    if (!selectedSession) return;
    if (!resumePrompt.trim()) {
      Alert.alert('Validation', 'Resume prompt is required.');
      return;
    }

    try {
      await presenterRef.current?.resumeSession({
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
  }, [resumeModel, resumePrompt, state.selectedSession]);

  const handleFork = useCallback(async () => {
    const selectedSession = state.selectedSession;
    if (!selectedSession) return;

    try {
      const forkedSession = await presenterRef.current?.forkSession({
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
  }, [forkMachineId, forkModel, forkPrompt, state.selectedSession]);

  const handleHandoff = useCallback(async () => {
    const selectedSession = state.selectedSession;
    if (!selectedSession) return;

    try {
      const response = await presenterRef.current?.handoffSession({
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
  }, [handoffMachineId, handoffPrompt, handoffTargetRuntime, state.selectedSession]);

  const renderSession = useCallback(
    ({ item }: { item: RuntimeSessionInfo }) => {
      const modelLabel =
        typeof item.metadata?.model === 'string'
          ? item.metadata.model
          : item.metadata?.model !== undefined && item.metadata?.model !== null
            ? String(item.metadata.model)
            : null;

      return (
        <TouchableOpacity
          style={styles.sessionCard}
          onPress={() => handleSessionPress(item)}
          activeOpacity={0.7}
        >
          <View style={styles.sessionHeader}>
            <Text style={styles.sessionId}>{truncateId(item.id, 12)}</Text>
            <View
              style={[styles.statusBadge, { backgroundColor: sessionStatusColor(item.status) }]}
            >
              <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.runtimeRow}>
            <Text style={styles.runtimePill}>{runtimeLabel(item.runtime)}</Text>
            <Text style={styles.machineText}>
              {machineLookup.get(item.machineId)?.hostname ?? item.machineId}
            </Text>
          </View>

          <Text style={styles.sessionDetail} numberOfLines={1}>
            {item.projectPath}
          </Text>

          <View style={styles.sessionMeta}>
            <Text style={styles.metaText}>
              {formatRelativeTime(item.lastHeartbeat ?? item.startedAt)}
            </Text>
            {modelLabel && (
              <>
                <Text style={styles.metaDot}> · </Text>
                <Text style={styles.metaText}>{modelLabel}</Text>
              </>
            )}
            {item.nativeSessionId && (
              <>
                <Text style={styles.metaDot}> · </Text>
                <Text style={styles.metaText}>native {truncateId(item.nativeSessionId, 8)}</Text>
              </>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [handleSessionPress, machineLookup],
  );

  const renderHandoff = useCallback(
    (handoff: RuntimeSessionHandoff, index: number) => (
      <View key={`${handoff.id}-${index}`} style={styles.handoffCard}>
        <View style={styles.handoffHeader}>
          <Text style={styles.handoffStrategy}>{formatHandoffStrategyLabel(handoff.strategy)}</Text>
          <View
            style={[
              styles.handoffStatusBadge,
              { backgroundColor: handoffStatusColor(handoff.status) },
            ]}
          >
            <Text style={styles.handoffStatusText}>{handoff.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.handoffText}>
          {runtimeLabel(handoff.sourceRuntime)} to {runtimeLabel(handoff.targetRuntime)}
        </Text>
        <Text style={styles.handoffText}>
          {describeHandoffExecution({
            strategy: handoff.strategy,
            nativeImportAttempt: handoff.nativeImportAttempt,
          })}
        </Text>
        <Text style={styles.handoffText}>Reason: {handoff.reason}</Text>
        <Text style={styles.handoffSummary} numberOfLines={3}>
          {handoff.snapshot.diffSummary ||
            handoff.snapshot.conversationSummary ||
            'No snapshot summary'}
        </Text>
        {handoff.nativeImportAttempt && (
          <Text style={styles.handoffMeta}>
            {describeNativeImportAttempt(handoff.nativeImportAttempt)}
          </Text>
        )}
        {handoff.errorMessage && <Text style={styles.handoffError}>{handoff.errorMessage}</Text>}
      </View>
    ),
    [],
  );

  const resumable =
    state.selectedSession?.status === 'paused' ||
    state.selectedSession?.status === 'ended' ||
    state.selectedSession?.status === 'error';
  const handoffable =
    state.selectedSession?.status === 'active' || state.selectedSession?.status === 'paused';
  const preflightSummary = handoffable
    ? describeNativeImportPreflight(state.handoffPreflight)
    : null;
  const preflightStatus = summarizeNativeImportPreflightStatus({
    preflight:
      handoffable && state.selectedSession?.runtime !== handoffTargetRuntime
        ? state.handoffPreflight
        : null,
    isLoading:
      state.isPreflightLoading &&
      handoffable &&
      state.selectedSession?.runtime !== handoffTargetRuntime,
  });
  const handoffActionDisabled =
    !handoffable ||
    (state.isPreflightLoading && state.selectedSession?.runtime !== handoffTargetRuntime);
  const filteredHandoffs = useMemo(
    () =>
      state.handoffs.filter((handoff) =>
        matchesHandoffHistoryFilter(handoff, handoffHistoryFilter),
      ),
    [handoffHistoryFilter, state.handoffs],
  );
  const handoffAnalytics = useMemo(
    () => summarizeHandoffAnalytics(filteredHandoffs),
    [filteredHandoffs],
  );

  return (
    <View style={styles.container}>
      {state.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error.message}</Text>
        </View>
      )}

      <View style={styles.toolbar}>
        <Text style={styles.sessionCount}>
          {state.sessions.length} managed session{state.sessions.length === 1 ? '' : 's'}
        </Text>
        <TouchableOpacity style={styles.newSessionButton} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.newSessionButtonText}>+ New Runtime</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={state.sessions}
        renderItem={renderSession}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={state.isLoading} onRefresh={onRefresh} tintColor="#9ca3af" />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {state.isLoading ? 'Loading runtime sessions...' : 'No managed runtime sessions found'}
          </Text>
        }
      />

      {state.lastUpdated && (
        <Text style={styles.lastUpdated}>Updated: {state.lastUpdated.toLocaleTimeString()}</Text>
      )}

      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCreateModal(false)}
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
            {state.machines.length > 0 ? (
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
              <>
                <TextInput
                  style={styles.input}
                  value={createMachineId}
                  onChangeText={setCreateMachineId}
                  placeholder="e.g. mac-mini-01"
                  placeholderTextColor="#6b7280"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.helperText}>
                  No machine inventory loaded; using manual entry.
                </Text>
              </>
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
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton]}
                onPress={handleCreateSession}
              >
                <Text style={styles.buttonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent
        onRequestClose={handleCloseDetail}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            {state.selectedSession ? (
              <>
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderTop}>
                    <Text style={styles.detailTitle}>
                      {truncateId(state.selectedSession.id, 14)}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: sessionStatusColor(state.selectedSession.status) },
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {state.selectedSession.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.detailInfo}>
                    Runtime: {runtimeLabel(state.selectedSession.runtime)}
                  </Text>
                  <Text style={styles.detailInfo}>
                    Machine:{' '}
                    {machineLookup.get(state.selectedSession.machineId)?.hostname ??
                      state.selectedSession.machineId}
                  </Text>
                  <Text style={styles.detailInfo}>
                    Project: {state.selectedSession.projectPath}
                  </Text>
                  {state.selectedSession.worktreePath && (
                    <Text style={styles.detailInfo}>
                      Worktree: {state.selectedSession.worktreePath}
                    </Text>
                  )}
                  {state.selectedSession.nativeSessionId && (
                    <Text style={styles.detailInfo}>
                      Native: {state.selectedSession.nativeSessionId}
                    </Text>
                  )}
                </View>

                <ScrollView
                  style={styles.detailScroll}
                  contentContainerStyle={styles.detailScrollContent}
                >
                  {resumable && (
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
                        onPress={handleResume}
                      >
                        <Text style={styles.buttonText}>Resume Session</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {state.selectedSession.nativeSessionId && (
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
                      {state.machines.length > 0 ? (
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
                      ) : (
                        <TextInput
                          style={styles.input}
                          value={forkMachineId}
                          onChangeText={setForkMachineId}
                          placeholder="Optional target machine ID"
                          placeholderTextColor="#6b7280"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      )}
                      <TouchableOpacity
                        style={[styles.actionButton, styles.forkButton]}
                        onPress={handleFork}
                      >
                        <Text style={styles.buttonText}>Fork Session</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {handoffable && (
                    <View style={styles.sectionCard}>
                      <Text style={styles.sectionTitle}>Handoff</Text>
                      <View style={styles.segmentRow}>
                        {(['codex', 'claude-code'] as const)
                          .filter((runtime) => runtime !== state.selectedSession?.runtime)
                          .map((runtime) => (
                            <TouchableOpacity
                              key={runtime}
                              style={[
                                styles.segmentButton,
                                handoffTargetRuntime === runtime && styles.segmentButtonActive,
                              ]}
                              onPress={() => setHandoffTargetRuntime(runtime)}
                            >
                              <Text style={styles.segmentButtonText}>{runtimeLabel(runtime)}</Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                      {state.machines.length > 0 ? (
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
                      ) : (
                        <TextInput
                          style={styles.input}
                          value={handoffMachineId}
                          onChangeText={setHandoffMachineId}
                          placeholder="Optional target machine ID"
                          placeholderTextColor="#6b7280"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      )}
                      {handoffable && state.selectedSession?.runtime !== handoffTargetRuntime && (
                        <View
                          style={[
                            styles.preflightBadge,
                            preflightStatus.tone === 'success' && styles.preflightBadgeReady,
                            preflightStatus.tone === 'warning' && styles.preflightBadgeFallback,
                            preflightStatus.tone === 'neutral' && styles.preflightBadgeNeutral,
                          ]}
                        >
                          <Text style={styles.preflightBadgeText}>
                            {preflightStatus.badgeLabel}
                          </Text>
                        </View>
                      )}
                      {preflightSummary && (
                        <View
                          style={[
                            styles.preflightCard,
                            preflightStatus.tone === 'success' && styles.preflightCardReady,
                            preflightStatus.tone === 'warning' && styles.preflightCardFallback,
                            preflightStatus.tone === 'neutral' && styles.preflightCardNeutral,
                          ]}
                        >
                          <Text
                            style={[
                              styles.preflightText,
                              preflightStatus.tone === 'success' && styles.preflightTextReady,
                              preflightStatus.tone === 'warning' && styles.preflightTextFallback,
                              preflightStatus.tone === 'neutral' && styles.preflightTextNeutral,
                            ]}
                          >
                            {state.isPreflightLoading
                              ? 'Refreshing native import preflight...'
                              : preflightSummary}
                          </Text>
                        </View>
                      )}
                      <TextInput
                        style={[styles.input, styles.promptInput]}
                        value={handoffPrompt}
                        onChangeText={setHandoffPrompt}
                        placeholder="Optional takeover prompt"
                        placeholderTextColor="#6b7280"
                        multiline
                      />
                      <TouchableOpacity
                        style={[
                          styles.actionButton,
                          styles.handoffButton,
                          handoffActionDisabled && styles.actionButtonDisabled,
                        ]}
                        onPress={handleHandoff}
                        disabled={handoffActionDisabled}
                      >
                        <Text style={styles.buttonText}>{preflightStatus.actionLabel}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Handoff History</Text>
                    {state.isHandoffsLoading ? (
                      <Text style={styles.loadingText}>Loading handoffs...</Text>
                    ) : state.handoffs.length === 0 ? (
                      <Text style={styles.emptyTranscript}>
                        No handoffs recorded for this session.
                      </Text>
                    ) : (
                      <>
                        <View style={styles.handoffFilterRow}>
                          {HANDOFF_HISTORY_FILTERS.map((filter) => (
                            <TouchableOpacity
                              key={filter}
                              style={[
                                styles.handoffFilterChip,
                                handoffHistoryFilter === filter && styles.handoffFilterChipActive,
                              ]}
                              onPress={() => setHandoffHistoryFilter(filter)}
                            >
                              <Text
                                style={[
                                  styles.handoffFilterChipText,
                                  handoffHistoryFilter === filter &&
                                    styles.handoffFilterChipTextActive,
                                ]}
                              >
                                {formatHandoffHistoryFilterLabel(filter)}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <View style={styles.handoffAnalyticsRow}>
                          <View style={styles.handoffAnalyticsCard}>
                            <Text style={styles.handoffAnalyticsLabel}>Total</Text>
                            <Text style={styles.handoffAnalyticsValue}>
                              {handoffAnalytics.total}
                            </Text>
                          </View>
                          <View style={styles.handoffAnalyticsCard}>
                            <Text style={styles.handoffAnalyticsLabel}>Succeeded</Text>
                            <Text style={styles.handoffAnalyticsValue}>
                              {handoffAnalytics.succeeded}
                            </Text>
                          </View>
                          <View style={styles.handoffAnalyticsCard}>
                            <Text style={styles.handoffAnalyticsLabel}>Native Import</Text>
                            <Text style={styles.handoffAnalyticsValue}>
                              {handoffAnalytics.nativeImportSuccesses}
                            </Text>
                          </View>
                          <View style={styles.handoffAnalyticsCard}>
                            <Text style={styles.handoffAnalyticsLabel}>Fallbacks</Text>
                            <Text style={styles.handoffAnalyticsValue}>
                              {handoffAnalytics.nativeImportFallbacks}
                            </Text>
                          </View>
                        </View>
                        {filteredHandoffs.length === 0 ? (
                          <Text style={styles.emptyTranscript}>No handoffs match this filter.</Text>
                        ) : (
                          filteredHandoffs.map(renderHandoff)
                        )}
                      </>
                    )}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  style={[styles.actionButton, styles.closeDetailButton]}
                  onPress={handleCloseDetail}
                >
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.loadingText}>Runtime session not found</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e2e',
  },
  sessionCount: {
    color: '#9ca3af',
    fontSize: 14,
  },
  newSessionButton: {
    backgroundColor: '#1e40af',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  newSessionButtonText: {
    color: '#ffffff',
    fontSize: 13,
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
  sessionCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionId: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Courier',
  },
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
  runtimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  runtimePill: {
    color: '#bfdbfe',
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  machineText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  sessionDetail: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaText: {
    color: '#6b7280',
    fontSize: 12,
  },
  metaDot: {
    color: '#4b5563',
    fontSize: 12,
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
    marginBottom: 14,
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
  detailHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e2e',
    paddingBottom: 12,
    marginBottom: 12,
  },
  detailHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Courier',
  },
  detailInfo: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 2,
  },
  detailScroll: {
    flex: 1,
  },
  detailScrollContent: {
    paddingBottom: 8,
    gap: 12,
  },
  sectionCard: {
    backgroundColor: '#111111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    padding: 14,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  resumeButton: {
    backgroundColor: '#166534',
  },
  forkButton: {
    backgroundColor: '#4338ca',
  },
  handoffButton: {
    backgroundColor: '#0f766e',
  },
  closeDetailButton: {
    backgroundColor: '#374151',
    marginTop: 12,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
  emptyTranscript: {
    color: '#6b7280',
    fontStyle: 'italic',
    fontSize: 13,
  },
  handoffAnalyticsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  handoffFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  handoffFilterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  handoffFilterChipActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  handoffFilterChipText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  handoffFilterChipTextActive: {
    color: '#bbf7d0',
  },
  handoffAnalyticsCard: {
    minWidth: '47%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  handoffAnalyticsLabel: {
    color: '#6b7280',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  handoffAnalyticsValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6,
  },
  handoffCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    backgroundColor: '#161616',
    padding: 12,
    marginTop: 10,
  },
  handoffHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  handoffStrategy: {
    color: '#bfdbfe',
    fontSize: 12,
    fontWeight: '700',
  },
  handoffStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  handoffStatusText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  handoffText: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  handoffSummary: {
    color: '#d1d5db',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  handoffMeta: {
    color: '#f59e0b',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  preflightCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  preflightCardReady: {
    borderColor: 'rgba(34, 197, 94, 0.28)',
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
  },
  preflightCardFallback: {
    borderColor: 'rgba(245, 158, 11, 0.28)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  preflightCardNeutral: {
    borderColor: 'rgba(148, 163, 184, 0.28)',
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
  preflightText: {
    fontSize: 12,
    lineHeight: 18,
  },
  preflightTextReady: {
    color: '#86efac',
  },
  preflightTextFallback: {
    color: '#fcd34d',
  },
  preflightTextNeutral: {
    color: '#cbd5e1',
  },
  preflightBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
  },
  preflightBadgeReady: {
    borderColor: 'rgba(34, 197, 94, 0.28)',
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
  },
  preflightBadgeFallback: {
    borderColor: 'rgba(245, 158, 11, 0.28)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  preflightBadgeNeutral: {
    borderColor: 'rgba(148, 163, 184, 0.28)',
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
  preflightBadgeText: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  handoffError: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 8,
  },
});
