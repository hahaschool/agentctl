import type React from 'react';

import { SessionBrowserScreen } from './session-browser-screen.js';

export function SessionScreen(): React.JSX.Element {
  return <SessionBrowserScreen initialTypeFilter="all" />;
}
