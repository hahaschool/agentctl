#!/usr/bin/env npx tsx
// =============================================================================
// agentctl tui — Full-screen TUI monitoring panel
//
// Usage:
//   npx tsx scripts/tui.tsx
//   pnpm tui
//   pnpm agentctl tui
// =============================================================================

import { render } from 'ink';

import { Layout } from './tui/Layout.js';

render(<Layout />);
