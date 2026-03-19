// ---------------------------------------------------------------------------
// TabNavigator — bottom tab navigation for the AgentCTL mobile app.
// Uses @react-navigation/bottom-tabs with NavigationContainer.
//
// Tabs:
//   1. Dashboard  — fleet overview
//   2. Agents     — agent list
//   3. Sessions   — Claude Code session management
//   4. Runtimes   — managed Claude Code / Codex runtime sessions
//   5. Scheduler  — cron/heartbeat job management
//   6. Settings   — control plane config & connection
// ---------------------------------------------------------------------------

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useAppContext } from '../context/app-context.js';
import { PermissionRequestApi } from '../services/permission-request-api.js';
import { AgentListScreen } from '../ui-screens/agent-list-screen.js';
import { DashboardScreen } from '../ui-screens/dashboard-screen.js';
import { PendingApprovalsScreen } from '../ui-screens/pending-approvals-screen.js';
import { RuntimeSessionScreen } from '../ui-screens/runtime-session-screen.js';
import { SchedulerScreen } from '../ui-screens/scheduler-screen.js';
import { SessionScreen } from '../ui-screens/session-screen.js';
import { SettingsScreen } from '../ui-screens/settings-screen.js';
import { approvalRouteToPath } from './approval-notification-routing.js';
import {
  type RuntimeTabBadgeSnapshot,
  refreshRuntimeTabBadgeSnapshot,
  toRuntimeTabBadgeCount,
} from './runtime-tab-badge.js';

// ---------------------------------------------------------------------------
// Tab param list
// ---------------------------------------------------------------------------

type TabParamList = {
  Dashboard: undefined;
  Agents: undefined;
  Sessions: undefined;
  Runtimes: undefined;
  Approvals: undefined;
  Scheduler: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

// ---------------------------------------------------------------------------
// Tab icon mapping (Unicode symbols since we don't have icon packages)
// ---------------------------------------------------------------------------

const TAB_ICONS: Record<keyof TabParamList, string> = {
  Dashboard: '\u2302', // House symbol
  Agents: '\u2699', // Gear/cog (representing CPU/robot)
  Sessions: '\u25B6', // Play triangle (representing terminal/sessions)
  Runtimes: '\u21C4', // Left-right arrows
  Approvals: '\u{1F514}', // Bell
  Scheduler: '\u23F0', // Alarm clock
  Settings: '\u2638', // Wheel of dharma (gear-like)
};

// ---------------------------------------------------------------------------
// Theme — matches the existing dark theme
// ---------------------------------------------------------------------------

const NAVIGATION_THEME = {
  dark: true,
  colors: {
    primary: '#3b82f6',
    background: '#111111',
    card: '#1e1e1e',
    text: '#ffffff',
    border: '#2e2e2e',
    notification: '#ef4444',
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '800' as const },
  },
};

const RUNTIME_BADGE_POLL_INTERVAL_MS = 30_000;
const APPROVALS_DEEP_LINK = approvalRouteToPath('approvals');
const NAVIGATION_LINKING = {
  prefixes: ['agentctl://'],
  config: {
    screens: {
      Approvals: APPROVALS_DEEP_LINK.replace('agentctl://', ''),
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabNavigator(): React.JSX.Element {
  const { apiClient, pendingNotificationRoute, consumePendingNotificationRoute } = useAppContext();
  const [activeTab, setActiveTab] = useState<keyof TabParamList>('Dashboard');
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const [badgeSnapshot, setBadgeSnapshot] = useState<RuntimeTabBadgeSnapshot>({
    handoffCount: 0,
    approvalCount: 0,
  });
  const badgeSnapshotRef = useRef(badgeSnapshot);
  const navigationRef = useMemo(() => createNavigationContainerRef<TabParamList>(), []);
  const runtimeBadgeCount = useMemo(() => toRuntimeTabBadgeCount(badgeSnapshot), [badgeSnapshot]);
  const approvalBadgeCount = badgeSnapshot.approvalCount;

  const handlePendingCountChange = useCallback((count: number) => {
    setBadgeSnapshot((prev) => ({ ...prev, approvalCount: count }));
  }, []);

  useEffect(() => {
    badgeSnapshotRef.current = badgeSnapshot;
  }, [badgeSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const permissionRequestApi = new PermissionRequestApi(apiClient);

    async function refreshRuntimeBadge(): Promise<void> {
      const snapshot = await refreshRuntimeTabBadgeSnapshot({
        previous: cancelled ? { handoffCount: 0, approvalCount: 0 } : badgeSnapshotRef.current,
        includeApprovalCount: activeTab !== 'Approvals',
        loadRuntimeSessions: async () => {
          const response = await apiClient.listRuntimeSessions({ limit: 100 });
          return response.sessions;
        },
        loadPendingApprovalCount: async () => {
          const pendingRequests = await permissionRequestApi.listRequests({ status: 'pending' });
          return pendingRequests.length;
        },
      });

      if (!cancelled) {
        setBadgeSnapshot(snapshot);
      }
    }

    void refreshRuntimeBadge();
    const timer = setInterval(() => {
      void refreshRuntimeBadge();
    }, RUNTIME_BADGE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab, apiClient]);

  useEffect(() => {
    if (!isNavigationReady || pendingNotificationRoute !== 'approvals') {
      return;
    }

    navigationRef.navigate('Approvals');
    consumePendingNotificationRoute();
  }, [consumePendingNotificationRoute, isNavigationReady, navigationRef, pendingNotificationRoute]);

  const runtimesTabOptions = useMemo(
    () => ({
      title: 'Runtimes',
      ...(runtimeBadgeCount > 0 ? { tabBarBadge: runtimeBadgeCount } : {}),
    }),
    [runtimeBadgeCount],
  );

  const approvalsTabOptions = useMemo(
    () => ({
      title: 'Approvals',
      ...(approvalBadgeCount > 0 ? { tabBarBadge: approvalBadgeCount } : {}),
    }),
    [approvalBadgeCount],
  );

  const renderApprovalsScreen = useCallback(
    () => <PendingApprovalsScreen onPendingCountChange={handlePendingCountChange} />,
    [handlePendingCountChange],
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={NAVIGATION_LINKING}
      theme={NAVIGATION_THEME}
      onReady={() => {
        setIsNavigationReady(true);
      }}
      onStateChange={(state: { index?: number; routes: Array<{ name: string }> } | undefined) => {
        const nextTab = state?.routes[state.index ?? 0]?.name as keyof TabParamList | undefined;
        if (nextTab) {
          setActiveTab(nextTab);
        }
      }}
    >
      <Tab.Navigator
        screenOptions={({ route }: { route: { name: string } }) => ({
          headerStyle: {
            backgroundColor: '#1e1e1e',
            borderBottomWidth: 1,
            borderBottomColor: '#2e2e2e',
          },
          headerTitleStyle: {
            color: '#ffffff',
            fontSize: 17,
            fontWeight: '600',
          },
          tabBarStyle: {
            backgroundColor: '#1e1e1e',
            borderTopWidth: 1,
            borderTopColor: '#2e2e2e',
          },
          tabBarActiveTintColor: '#3b82f6',
          tabBarInactiveTintColor: '#6b7280',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Text style={{ color, fontSize: size }}>
              {TAB_ICONS[route.name as keyof TabParamList] ?? '?'}
            </Text>
          ),
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
        <Tab.Screen name="Agents" component={AgentListScreen} options={{ title: 'Agents' }} />
        <Tab.Screen name="Sessions" component={SessionScreen} options={{ title: 'Sessions' }} />
        <Tab.Screen name="Runtimes" component={RuntimeSessionScreen} options={runtimesTabOptions} />
        <Tab.Screen name="Approvals" options={approvalsTabOptions}>
          {renderApprovalsScreen}
        </Tab.Screen>
        <Tab.Screen name="Scheduler" component={SchedulerScreen} options={{ title: 'Scheduler' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
