// ---------------------------------------------------------------------------
// SettingsScreen — configure control plane URL, auth token, and view
// connection status.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAppContext } from '../context/app-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectionStatusColor(status: string): string {
  switch (status) {
    case 'connected':
      return '#22c55e';
    case 'connecting':
      return '#f59e0b';
    case 'error':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsScreen(): React.JSX.Element {
  const { baseUrl, authToken, connectionStatus, updateConfig, connectWs, disconnectWs } =
    useAppContext();

  const [editUrl, setEditUrl] = useState(baseUrl);
  const [editToken, setEditToken] = useState(authToken);

  const handleSave = useCallback(() => {
    if (!editUrl.trim()) {
      Alert.alert('Validation', 'Control plane URL is required.');
      return;
    }

    // Strip trailing slash
    const cleanUrl = editUrl.trim().replace(/\/+$/, '');
    updateConfig(cleanUrl, editToken.trim());
    Alert.alert('Saved', 'Configuration updated. Clients have been recreated.');
  }, [editUrl, editToken, updateConfig]);

  const handleConnect = useCallback(() => {
    connectWs();
  }, [connectWs]);

  const handleDisconnect = useCallback(() => {
    disconnectWs();
  }, [disconnectWs]);

  const statusColor = connectionStatusColor(connectionStatus);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Control Plane</Text>

      <Text style={styles.fieldLabel}>URL</Text>
      <TextInput
        style={styles.input}
        value={editUrl}
        onChangeText={setEditUrl}
        placeholder="http://localhost:3000"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.fieldLabel}>Auth Token</Text>
      <TextInput
        style={styles.input}
        value={editToken}
        onChangeText={setEditToken}
        placeholder="Bearer token (optional)"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>Save Configuration</Text>
      </TouchableOpacity>

      {/* Connection status */}
      <Text style={[styles.sectionTitle, { marginTop: 32 }]}>WebSocket Connection</Text>

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{connectionStatus}</Text>
      </View>

      <View style={styles.connectionActions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.connectButton]}
          onPress={handleConnect}
          disabled={connectionStatus === 'connected'}
        >
          <Text style={styles.actionButtonText}>Connect</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.disconnectButton]}
          onPress={handleDisconnect}
          disabled={connectionStatus === 'disconnected'}
        >
          <Text style={styles.actionButtonText}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      {/* App info */}
      <Text style={[styles.sectionTitle, { marginTop: 32 }]}>About</Text>
      <Text style={styles.infoText}>AgentCTL Mobile v0.1.0</Text>
      <Text style={styles.infoText}>Multi-machine AI agent orchestration</Text>
    </ScrollView>
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
  content: {
    padding: 20,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  fieldLabel: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
    color: '#ffffff',
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    color: '#d1d5db',
    fontSize: 15,
    textTransform: 'capitalize',
  },
  connectionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  connectButton: {
    backgroundColor: '#166534',
  },
  disconnectButton: {
    backgroundColor: '#991b1b',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  infoText: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 4,
  },
});
