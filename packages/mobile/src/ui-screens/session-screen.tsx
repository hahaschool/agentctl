// ---------------------------------------------------------------------------
// SessionScreen — browse and control Claude Code sessions. Shows a list of
// discovered sessions with status, message count, and last activity. Tapping
// a session shows detail with actions (resume, send message, view transcript).
// Uses SessionPresenter for all business logic.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { SessionScreenState } from '../screens/session-presenter.js';
import { SessionPresenter } from '../screens/session-presenter.js';
import type { SessionInfo, SessionMessage } from '../services/session-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return '#22c55e';
    case 'paused':
      return '#f59e0b';
    case 'ended':
      return '#6b7280';
    default:
      return '#6b7280';
  }
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionScreen(): React.JSX.Element {
  const { apiClient } = useAppContext();
  const presenterRef = useRef<SessionPresenter | null>(null);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [newSessionPath, setNewSessionPath] = useState('');
  const [newSessionModel, setNewSessionModel] = useState('');
  const [newSessionPrompt, setNewSessionPrompt] = useState('');
  const [messageText, setMessageText] = useState('');

  const [state, setState] = useState<SessionScreenState>({
    sessions: [],
    selectedSession: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    lastUpdated: null,
  });

  useEffect(() => {
    const presenter = new SessionPresenter({
      apiClient,
      onChange: setState,
    });
    presenterRef.current = presenter;
    presenter.start();

    return () => {
      presenter.stop();
    };
  }, [apiClient]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const onRefresh = useCallback(() => {
    void presenterRef.current?.loadSessions();
  }, []);

  const handleSessionPress = useCallback((session: SessionInfo) => {
    setShowDetailModal(true);
    void presenterRef.current?.loadSessionDetail(session.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setShowDetailModal(false);
    presenterRef.current?.clearSelectedSession();
  }, []);

  const handleResume = useCallback(async () => {
    const sessionId = state.selectedSession?.id;
    if (!sessionId) return;

    try {
      await presenterRef.current?.resumeSession(sessionId);
      Alert.alert('Resumed', `Session ${truncateId(sessionId)} has been resumed.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Resume Failed', message);
    }
  }, [state.selectedSession?.id]);

  const handleSendMessage = useCallback(async () => {
    const sessionId = state.selectedSession?.id;
    if (!sessionId) return;

    if (!messageText.trim()) {
      Alert.alert('Validation', 'Please enter a message.');
      return;
    }

    try {
      await presenterRef.current?.sendMessage(sessionId, messageText.trim());
      setMessageText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Send Failed', message);
    }
  }, [state.selectedSession?.id, messageText]);

  const handleCreateSession = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (newSessionPath.trim()) params.projectPath = newSessionPath.trim();
      if (newSessionModel.trim()) params.model = newSessionModel.trim();
      if (newSessionPrompt.trim()) params.prompt = newSessionPrompt.trim();

      await presenterRef.current?.createSession(
        Object.keys(params).length > 0 ? params : undefined,
      );

      setShowNewSessionModal(false);
      setNewSessionPath('');
      setNewSessionModel('');
      setNewSessionPrompt('');
      Alert.alert('Created', 'New session has been started.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Create Failed', message);
    }
  }, [newSessionPath, newSessionModel, newSessionPrompt]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderSession = useCallback(
    ({ item }: { item: SessionInfo }) => (
      <TouchableOpacity
        style={styles.sessionCard}
        onPress={() => handleSessionPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionId}>{truncateId(item.id)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: sessionStatusColor(item.status) }]}>
            <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.sessionDetail} numberOfLines={1}>
          {item.projectPath}
        </Text>

        <View style={styles.sessionMeta}>
          <Text style={styles.metaText}>
            {item.messageCount} message{item.messageCount !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.metaDot}> · </Text>
          <Text style={styles.metaText}>{formatRelativeTime(item.lastActivity)}</Text>
          {item.model && (
            <>
              <Text style={styles.metaDot}> · </Text>
              <Text style={styles.metaText}>{item.model}</Text>
            </>
          )}
        </View>

        {item.costUsd !== undefined && item.costUsd > 0 && (
          <Text style={styles.costText}>Cost: ${item.costUsd.toFixed(4)}</Text>
        )}
      </TouchableOpacity>
    ),
    [handleSessionPress],
  );

  const keyExtractor = useCallback((item: SessionInfo) => item.id, []);

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

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <View style={styles.container}>
      {/* Error banner */}
      {state.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error.message}</Text>
        </View>
      )}

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.sessionCount}>
          {state.sessions.length} session
          {state.sessions.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity
          style={styles.newSessionButton}
          onPress={() => setShowNewSessionModal(true)}
        >
          <Text style={styles.newSessionButtonText}>+ New Session</Text>
        </TouchableOpacity>
      </View>

      {/* Session list */}
      <FlatList
        data={state.sessions}
        renderItem={renderSession}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={state.isLoading} onRefresh={onRefresh} tintColor="#9ca3af" />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {state.isLoading ? 'Loading sessions...' : 'No sessions found'}
          </Text>
        }
      />

      {/* Last updated */}
      {state.lastUpdated && (
        <Text style={styles.lastUpdated}>Updated: {state.lastUpdated.toLocaleTimeString()}</Text>
      )}

      {/* New Session Modal */}
      <Modal
        visible={showNewSessionModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNewSessionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Session</Text>

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
                onPress={() => setShowNewSessionModal(false)}
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

      {/* Session Detail Modal */}
      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent
        onRequestClose={handleCloseDetail}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            {state.isDetailLoading ? (
              <Text style={styles.loadingText}>Loading session...</Text>
            ) : state.selectedSession ? (
              <>
                {/* Detail header */}
                <View style={styles.detailHeader}>
                  <View style={styles.detailHeaderTop}>
                    <Text style={styles.detailTitle}>
                      {truncateId(state.selectedSession.id, 12)}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: sessionStatusColor(state.selectedSession.status),
                        },
                      ]}
                    >
                      <Text style={styles.statusText}>
                        {state.selectedSession.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.detailInfo}>
                    Project: {state.selectedSession.projectPath}
                  </Text>
                  <Text style={styles.detailInfo}>
                    Messages: {state.selectedSession.messageCount}
                  </Text>
                  {state.selectedSession.model && (
                    <Text style={styles.detailInfo}>Model: {state.selectedSession.model}</Text>
                  )}
                  {state.selectedSession.costUsd !== undefined &&
                    state.selectedSession.costUsd > 0 && (
                      <Text style={styles.detailCost}>
                        Cost: ${state.selectedSession.costUsd.toFixed(4)}
                      </Text>
                    )}
                </View>

                {/* Action buttons */}
                <View style={styles.detailActions}>
                  {state.selectedSession.status === 'paused' && (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.resumeButton]}
                      onPress={handleResume}
                    >
                      <Text style={styles.buttonText}>Resume</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionButton, styles.closeDetailButton]}
                    onPress={handleCloseDetail}
                  >
                    <Text style={styles.buttonText}>Close</Text>
                  </TouchableOpacity>
                </View>

                {/* Send message (only for active sessions) */}
                {state.selectedSession.status === 'active' && (
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

                {/* Transcript */}
                <Text style={styles.transcriptLabel}>
                  Transcript ({state.selectedSession.messages.length} messages)
                </Text>
                <ScrollView
                  style={styles.transcriptScroll}
                  contentContainerStyle={styles.transcriptContent}
                >
                  {state.selectedSession.messages.length === 0 ? (
                    <Text style={styles.emptyTranscript}>No messages in this session</Text>
                  ) : (
                    state.selectedSession.messages.map(renderMessage)
                  )}
                </ScrollView>
              </>
            ) : (
              <Text style={styles.loadingText}>Session not found</Text>
            )}
          </View>
        </View>
      </Modal>
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

  // Session card
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
  sessionDetail: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    color: '#6b7280',
    fontSize: 12,
  },
  metaDot: {
    color: '#4b5563',
    fontSize: 12,
  },
  costText: {
    color: '#a78bfa',
    fontSize: 12,
    marginTop: 6,
  },

  // New Session Modal
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

  // Detail modal
  detailModalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    maxHeight: '85%',
    flex: 1,
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 32,
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
  detailCost: {
    color: '#a78bfa',
    fontSize: 13,
    marginTop: 4,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeButton: {
    backgroundColor: '#166534',
  },
  closeDetailButton: {
    backgroundColor: '#374151',
  },

  // Send message
  sendMessageRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  messageInput: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 80,
  },
  sendButton: {
    backgroundColor: '#1e40af',
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Transcript
  transcriptLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  transcriptScroll: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  transcriptContent: {
    padding: 12,
  },
  emptyTranscript: {
    color: '#6b7280',
    fontStyle: 'italic',
    fontSize: 13,
  },
  messageBubble: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    maxWidth: '90%',
  },
  userMessage: {
    backgroundColor: '#1e3a5f',
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    backgroundColor: '#1e2e1e',
    alignSelf: 'flex-start',
  },
  messageRole: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  messageContent: {
    color: '#e5e7eb',
    fontSize: 13,
    lineHeight: 18,
  },
  messageTime: {
    color: '#4b5563',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
});
