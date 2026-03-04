// ---------------------------------------------------------------------------
// SchedulerScreen — list repeatable jobs and add/remove them.
// Uses SchedulerPresenter for all business logic.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAppContext } from '../context/app-context.js';
import type { SchedulerState } from '../screens/scheduler-presenter.js';
import { SchedulerPresenter } from '../screens/scheduler-presenter.js';
import type { SchedulerJob } from '../services/api-client.js';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchedulerScreen(): React.JSX.Element {
  const { apiClient } = useAppContext();
  const presenterRef = useRef<SchedulerPresenter | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newJobAgentId, setNewJobAgentId] = useState('');
  const [newJobMachineId, setNewJobMachineId] = useState('');
  const [newJobPattern, setNewJobPattern] = useState('');

  const [state, setState] = useState<SchedulerState>({
    jobs: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
  });

  useEffect(() => {
    const presenter = new SchedulerPresenter({
      apiClient,
      onChange: setState,
    });
    presenterRef.current = presenter;
    void presenter.loadJobs();

    return () => {
      presenterRef.current = null;
    };
  }, [apiClient]);

  const onRefresh = useCallback(() => {
    void presenterRef.current?.loadJobs();
  }, []);

  const handleRemoveJob = useCallback((key: string) => {
    Alert.alert('Remove Job', `Remove job "${key}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await presenterRef.current?.removeJob(key);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            Alert.alert('Remove Failed', message);
          }
        },
      },
    ]);
  }, []);

  const handleAddJob = useCallback(async () => {
    if (!newJobAgentId.trim() || !newJobMachineId.trim() || !newJobPattern.trim()) {
      Alert.alert('Validation', 'All fields are required.');
      return;
    }

    try {
      await presenterRef.current?.createCronJob({
        agentId: newJobAgentId.trim(),
        machineId: newJobMachineId.trim(),
        pattern: newJobPattern.trim(),
      });
      setShowAddModal(false);
      setNewJobAgentId('');
      setNewJobMachineId('');
      setNewJobPattern('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Create Failed', message);
    }
  }, [newJobAgentId, newJobMachineId, newJobPattern]);

  const renderJob = useCallback(
    ({ item }: { item: SchedulerJob }) => (
      <View style={styles.jobCard}>
        <View style={styles.jobHeader}>
          <Text style={styles.jobName} numberOfLines={1}>
            {item.name}
          </Text>
          <TouchableOpacity style={styles.removeButton} onPress={() => handleRemoveJob(item.key)}>
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.jobDetail}>Pattern: {item.pattern}</Text>
        {item.every && <Text style={styles.jobDetail}>Every: {item.every}</Text>}
        <Text style={styles.jobDetail}>Next: {new Date(item.next).toLocaleString()}</Text>
        <Text style={styles.jobKey}>Key: {item.key}</Text>
      </View>
    ),
    [handleRemoveJob],
  );

  const keyExtractor = useCallback((item: SchedulerJob) => item.key, []);

  return (
    <View style={styles.container}>
      {/* Error banner */}
      {state.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{state.error.message}</Text>
        </View>
      )}

      {/* Add job button */}
      <View style={styles.toolbar}>
        <Text style={styles.jobCount}>
          {state.jobs.length} job{state.jobs.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
          <Text style={styles.addButtonText}>+ Add Job</Text>
        </TouchableOpacity>
      </View>

      {/* Job list */}
      <FlatList
        data={state.jobs}
        renderItem={renderJob}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={state.isLoading} onRefresh={onRefresh} tintColor="#9ca3af" />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {state.isLoading ? 'Loading jobs...' : 'No scheduled jobs'}
          </Text>
        }
      />

      {/* Add job modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Cron Job</Text>

            <Text style={styles.fieldLabel}>Agent ID</Text>
            <TextInput
              style={styles.input}
              value={newJobAgentId}
              onChangeText={setNewJobAgentId}
              placeholder="e.g. agent-1"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.fieldLabel}>Machine ID</Text>
            <TextInput
              style={styles.input}
              value={newJobMachineId}
              onChangeText={setNewJobMachineId}
              placeholder="e.g. ec2-prod"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.fieldLabel}>Cron Pattern</Text>
            <TextInput
              style={styles.input}
              value={newJobPattern}
              onChangeText={setNewJobPattern}
              placeholder="e.g. */15 * * * *"
              placeholderTextColor="#6b7280"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.createButton]}
                onPress={handleAddJob}
              >
                <Text style={styles.buttonText}>Create</Text>
              </TouchableOpacity>
            </View>
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
  jobCount: {
    color: '#9ca3af',
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#1e40af',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
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
  jobCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  jobName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  removeButton: {
    backgroundColor: '#991b1b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  removeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  jobDetail: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 2,
  },
  jobKey: {
    color: '#4b5563',
    fontSize: 11,
    marginTop: 6,
    fontFamily: 'Courier',
  },
  // Modal styles
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
});
