// ---------------------------------------------------------------------------
// AppContext — provides ApiClient, WebSocketClient, and SseClient instances
// to all screens. Configuration values (baseUrl, authToken) are managed
// via the Settings screen and persisted through this context.
// ---------------------------------------------------------------------------

import ExpoConstants, { type Constants as ExpoConstantsValue } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type React from 'react';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { ApiClient } from '../services/api-client.js';
import {
  type ExpoProjectIdSource,
  MOBILE_PUSH_DEVICE_UPSERT_PATH,
  type NotificationPermissionStatus,
  PushRegistrationService,
} from '../services/push-registration.js';
import { requestWithApiClient } from '../services/request-with-api-client.js';
import { SseClient } from '../services/sse-client.js';
import { WebSocketClient } from '../services/websocket-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type AppContextValue = {
  /** The HTTP API client. Recreated when config changes. */
  apiClient: ApiClient;
  /** The WebSocket client. Recreated when config changes. */
  wsClient: WebSocketClient;
  /** The SSE client. Recreated when config changes. */
  sseClient: SseClient;
  /** Current control plane URL. */
  baseUrl: string;
  /** Current auth token (may be empty). */
  authToken: string;
  /** WebSocket connection status. */
  connectionStatus: ConnectionStatus;
  /** Update config and recreate clients. */
  updateConfig: (baseUrl: string, authToken: string) => void;
  /** Connect the WebSocket client. */
  connectWs: () => void;
  /** Disconnect the WebSocket client. */
  disconnectWs: () => void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:3000';

function toNotificationPermissionStatus(status: string): NotificationPermissionStatus {
  switch (status) {
    case 'granted':
    case 'denied':
      return status;
    default:
      return 'undetermined';
  }
}

function createPushRegistrationService(apiClient: ApiClient): PushRegistrationService {
  const expoConstants = ExpoConstants as unknown as ExpoConstantsValue;

  return new PushRegistrationService({
    platform: Platform.OS,
    isDevice: Device.isDevice,
    constants: expoConstants as unknown as ExpoProjectIdSource,
    getPermissionsAsync: async () => {
      const settings = await Notifications.getPermissionsAsync();
      return { status: toNotificationPermissionStatus(settings.status) };
    },
    requestPermissionsAsync: async () => {
      const settings = await Notifications.requestPermissionsAsync();
      return { status: toNotificationPermissionStatus(settings.status) };
    },
    getExpoPushTokenAsync: Notifications.getExpoPushTokenAsync,
    getApplicationId: () =>
      expoConstants.expoConfig?.ios?.bundleIdentifier ??
      expoConstants.expoConfig?.android?.package ??
      null,
    upsertDevice: async (payload) => {
      await requestWithApiClient(apiClient, 'POST', MOBILE_PUSH_DEVICE_UPSERT_PATH, payload);
    },
  });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type AppProviderProps = {
  children: ReactNode;
  initialBaseUrl?: string;
  initialAuthToken?: string;
};

export function AppProvider({
  children,
  initialBaseUrl,
  initialAuthToken,
}: AppProviderProps): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl ?? DEFAULT_BASE_URL);
  const [authToken, setAuthToken] = useState(initialAuthToken ?? '');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Keep refs for cleanup on recreation
  const wsClientRef = useRef<WebSocketClient | null>(null);

  const createClients = useCallback((url: string, token: string) => {
    // Clean up old WebSocket connection if any
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
    }

    const api = new ApiClient({
      baseUrl: url,
      authToken: token || undefined,
    });

    const wsUrl = `${url.replace(/^http/, 'ws')}/api/ws`;
    const ws = new WebSocketClient({ url: wsUrl });

    ws.on('open', () => setConnectionStatus('connected'));
    ws.on('close', () => setConnectionStatus('disconnected'));
    ws.on('error', () => setConnectionStatus('error'));
    ws.on('reconnecting', () => setConnectionStatus('connecting'));

    wsClientRef.current = ws;

    const sse = new SseClient({
      baseUrl: url,
      authToken: token || undefined,
    });

    return { api, ws, sse };
  }, []);

  const [clients, setClients] = useState(() => createClients(baseUrl, authToken));

  const updateConfig = useCallback(
    (newBaseUrl: string, newAuthToken: string) => {
      setBaseUrl(newBaseUrl);
      setAuthToken(newAuthToken);
      const newClients = createClients(newBaseUrl, newAuthToken);
      setClients(newClients);
      setConnectionStatus('disconnected');
    },
    [createClients],
  );

  const connectWs = useCallback(() => {
    setConnectionStatus('connecting');
    clients.ws.connect();
  }, [clients.ws]);

  const disconnectWs = useCallback(() => {
    clients.ws.disconnect();
    setConnectionStatus('disconnected');
  }, [clients.ws]);

  useEffect(() => {
    if (!baseUrl.trim() || !authToken.trim()) {
      return;
    }

    const pushRegistrationService = createPushRegistrationService(clients.api);
    void pushRegistrationService.bootstrap().catch(() => undefined);
  }, [authToken, baseUrl, clients.api]);

  const value = useMemo<AppContextValue>(
    () => ({
      apiClient: clients.api,
      wsClient: clients.ws,
      sseClient: clients.sse,
      baseUrl,
      authToken,
      connectionStatus,
      updateConfig,
      connectWs,
      disconnectWs,
    }),
    [clients, baseUrl, authToken, connectionStatus, updateConfig, connectWs, disconnectWs],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
