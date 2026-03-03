// ---------------------------------------------------------------------------
// App — root entry point for the AgentCTL mobile application.
// Wraps the entire app in AppProvider (context) and TabNavigator (routing).
// ---------------------------------------------------------------------------

import React from 'react';

import { AppProvider } from './src/context/app-context.js';
import { TabNavigator } from './src/navigation/tab-navigator.js';

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <TabNavigator />
    </AppProvider>
  );
}
