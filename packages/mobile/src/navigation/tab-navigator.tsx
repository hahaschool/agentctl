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
import { NavigationContainer } from '@react-navigation/native';
import type React from 'react';
import { Text } from 'react-native';
import { AgentListScreen } from '../ui-screens/agent-list-screen.js';
import { DashboardScreen } from '../ui-screens/dashboard-screen.js';
import { RuntimeSessionScreen } from '../ui-screens/runtime-session-screen.js';
import { SchedulerScreen } from '../ui-screens/scheduler-screen.js';
import { SessionScreen } from '../ui-screens/session-screen.js';
import { SettingsScreen } from '../ui-screens/settings-screen.js';

// ---------------------------------------------------------------------------
// Tab param list
// ---------------------------------------------------------------------------

type TabParamList = {
  Dashboard: undefined;
  Agents: undefined;
  Sessions: undefined;
  Runtimes: undefined;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabNavigator(): React.JSX.Element {
  return (
    <NavigationContainer theme={NAVIGATION_THEME}>
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
        <Tab.Screen
          name="Runtimes"
          component={RuntimeSessionScreen}
          options={{ title: 'Runtimes' }}
        />
        <Tab.Screen name="Scheduler" component={SchedulerScreen} options={{ title: 'Scheduler' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
