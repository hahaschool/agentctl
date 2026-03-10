import type React from 'react';

import { SessionBrowserScreen } from './session-browser-screen.js';

export function RuntimeSessionScreen(): React.JSX.Element {
  return <SessionBrowserScreen initialTypeFilter="runtime" />;
}
