// ---------------------------------------------------------------------------
// AppContext — provides ApiClient, WebSocketClient, and SseClient instances
// to all screens. Configuration values (baseUrl, authToken) are managed
// via the Settings screen and persisted through this context.
// ---------------------------------------------------------------------------

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
import type { ApprovalNotificationRoute } from '../navigation/approval-notification-routing.js';
import { ApiClient } from '../services/api-client.js';
import { createExpoPushNotificationRuntime } from '../services/expo-push-runtime.js';
import { MobilePushDeviceApi } from '../services/mobile-push-device-api.js';
import { PushRegistrationService } from '../services/push-registration.js';
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
  /** Pending notification-driven navigation target. */
  pendingNotificationRoute: ApprovalNotificationRoute | null;
  /** Update config and recreate clients. */
  updateConfig: (baseUrl: string, authToken: string) => void;
  /** Connect the WebSocket client. */
  connectWs: () => void;
  /** Disconnect the WebSocket client. */
  disconnectWs: () => void;
  /** Clear a handled notification route. */
  consumePendingNotificationRoute: () => void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:3000';

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
  const [pendingNotificationRoute, setPendingNotificationRoute] =
    useState<ApprovalNotificationRoute | null>(null);

  // Keep refs for cleanup on recreation
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const pushRuntimeRef = useRef(createExpoPushNotificationRuntime());

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
  const deviceApi = useMemo(() => new MobilePushDeviceApi(clients.api), [clients.api]);

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

  const consumePendingNotificationRoute = useCallback(() => {
    setPendingNotificationRoute(null);
  }, []);

  useEffect(() => {
    const pushService = new PushRegistrationService({
      runtime: pushRuntimeRef.current,
      upsertDevice: async (payload) => deviceApi.upsertDevice(payload),
    });

    let cancelled = false;
    void pushService
      .getInitialNotificationRoute()
      .then((route) => {
        if (!cancelled && route) {
          setPendingNotificationRoute(route);
        }
      })
      .catch(() => {
        // Best-effort startup route hydration only.
      });

    const subscription = pushService.addNotificationResponseListener((route) => {
      if (route) {
        setPendingNotificationRoute(route);
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [deviceApi]);

  useEffect(() => {
    if (!baseUrl.trim() || !authToken.trim()) {
      return;
    }

    const pushService = new PushRegistrationService({
      runtime: pushRuntimeRef.current,
      upsertDevice: async (payload) => deviceApi.upsertDevice(payload),
    });

    let cancelled = false;
    void pushService.bootstrap().catch(() => {
      if (!cancelled) {
        // Missing endpoint support or transient registration failures should not break app startup.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authToken, baseUrl, deviceApi]);

  const value = useMemo<AppContextValue>(
    () => ({
      apiClient: clients.api,
      wsClient: clients.ws,
      sseClient: clients.sse,
      baseUrl,
      authToken,
      connectionStatus,
      pendingNotificationRoute,
      updateConfig,
      connectWs,
      disconnectWs,
      consumePendingNotificationRoute,
    }),
    [
      clients,
      baseUrl,
      authToken,
      connectionStatus,
      pendingNotificationRoute,
      updateConfig,
      connectWs,
      disconnectWs,
      consumePendingNotificationRoute,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
