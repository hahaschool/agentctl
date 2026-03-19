import type { PermissionRequest } from '@agentctl/shared';
import { useIsFocused } from '@react-navigation/native';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAppContext } from '../context/app-context.js';
import type { PendingApprovalsState } from '../screens/pending-approvals-presenter.js';
import { PendingApprovalsPresenter } from '../screens/pending-approvals-presenter.js';
import type { PermissionRequestDecision } from '../services/permission-request-api.js';
import { formatRemaining, formatToolInputPreview } from './pending-approvals-preview.js';

export type PendingApprovalsScreenProps = {
  onPendingCountChange?: (count: number) => void;
};

export function PendingApprovalsScreen({
  onPendingCountChange,
}: PendingApprovalsScreenProps = {}): React.JSX.Element {
  const { apiClient } = useAppContext();
  const isFocused = useIsFocused();
  const presenterRef = useRef<PendingApprovalsPresenter | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [state, setState] = useState<PendingApprovalsState>({
    requests: [],
    pendingCount: 0,
    isLoading: false,
    resolvingRequestId: null,
    error: null,
    lastUpdated: null,
  });

  useEffect(() => {
    const presenter = new PendingApprovalsPresenter({
      apiClient,
      onChange: setState,
    });
    presenterRef.current = presenter;

    return () => {
      presenter.stop();
      presenterRef.current = null;
    };
  }, [apiClient]);

  useEffect(() => {
    const presenter = presenterRef.current;
    if (!presenter) {
      return;
    }

    if (isFocused) {
      presenter.start();
      return () => {
        presenter.stop();
      };
    }

    presenter.stop();
    return;
  }, [isFocused]);

  useEffect(() => {
    onPendingCountChange?.(state.pendingCount);
  }, [onPendingCountChange, state.pendingCount]);

  useEffect(() => {
    if (!isFocused || state.requests.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      clearInterval(timer);
    };
  }, [isFocused, state.requests.length]);

  const handleRefresh = useCallback(async () => {
    await presenterRef.current?.refresh();
  }, []);

  const handleResolve = useCallback(async (id: string, decision: PermissionRequestDecision) => {
    try {
      await presenterRef.current?.resolveRequest(id, decision);
    } catch (err: unknown) {
      Alert.alert(
        'Approval Update Failed',
        err instanceof Error ? err.message : 'Unable to resolve permission request.',
      );
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: PermissionRequest }) => {
      const isResolving = state.resolvingRequestId === item.id;
      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.agentText}>Agent {item.agentId.slice(0, 8)}</Text>
            <Text style={styles.timeoutText}>{formatRemaining(item.timeoutAt, nowMs)}</Text>
          </View>
          <Text style={styles.toolName}>{item.toolName}</Text>
          <Text style={styles.metaText}>Session {item.sessionId.slice(0, 8)}</Text>
          <Text style={styles.previewText}>
            {formatToolInputPreview(item.toolInput, item.description)}
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.approveButton,
                isResolving && styles.disabledButton,
              ]}
              disabled={isResolving}
              onPress={() => void handleResolve(item.id, 'approved')}
            >
              <Text style={styles.actionButtonText}>{isResolving ? 'Working...' : 'Approve'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.denyButton, isResolving && styles.disabledButton]}
              disabled={isResolving}
              onPress={() => void handleResolve(item.id, 'denied')}
            >
              <Text style={styles.actionButtonText}>{isResolving ? 'Working...' : 'Deny'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [handleResolve, nowMs, state.resolvingRequestId],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pending Approvals</Text>
        <Text style={styles.subtitle}>
          Review agent permission requests without switching back to web.
        </Text>
        <Text style={styles.countText}>{state.pendingCount} pending</Text>
      </View>

      {state.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error.message}</Text>
        </View>
      )}

      <FlatList
        data={state.requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          state.requests.length === 0 ? styles.emptyContent : styles.listContent
        }
        refreshControl={<RefreshControl refreshing={state.isLoading} onRefresh={handleRefresh} />}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {state.isLoading ? 'Loading approvals...' : 'No pending approvals'}
            </Text>
            <Text style={styles.emptyText}>
              {state.isLoading
                ? 'Fetching the latest permission queue.'
                : 'New agent permission requests will appear here.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111111',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
  countText: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#450a0a',
    padding: 12,
  },
  errorText: {
    color: '#fecaca',
    fontSize: 13,
    lineHeight: 18,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3f2f0b',
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  agentText: {
    color: '#fef3c7',
    fontSize: 13,
    fontWeight: '700',
  },
  timeoutText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
  },
  toolName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  metaText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  previewText: {
    color: '#d1d5db',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Courier',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 11,
  },
  approveButton: {
    backgroundColor: '#166534',
  },
  denyButton: {
    backgroundColor: '#991b1b',
  },
  disabledButton: {
    opacity: 0.65,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
