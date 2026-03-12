// =============================================================================
// Layout — Main TUI layout with three panels and keyboard navigation
//
// Top-left: ServicePanel    Top-right: AgentPanel
// Bottom: ActivityFeed
// Footer: keyboard shortcut hints
// =============================================================================

import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type React from 'react';
import { useCallback, useState } from 'react';

import { ActivityFeed } from './ActivityFeed.js';
import { AgentPanel } from './AgentPanel.js';
import { LogViewer } from './LogViewer.js';
import { ServicePanel } from './ServicePanel.js';
import type { PanelId, ViewMode } from './types.js';
import { useActivity } from './use-activity.js';
import { useAgents } from './use-agents.js';
import { useServices } from './use-services.js';

const CONTROL_URL = (process.env.CONTROL_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const WORKER_URL = (process.env.WORKER_URL ?? 'http://localhost:9000').replace(/\/$/, '');

export function Layout(): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const termWidth = stdout?.columns ?? 80;

  // Data hooks
  const services = useServices();
  const { agents, error: agentError } = useAgents();
  const events = useActivity();

  // Navigation state
  const [activePanel, setActivePanel] = useState<PanelId>('services');
  const [serviceIndex, setServiceIndex] = useState(0);
  const [agentIndex, setAgentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [logTarget, setLogTarget] = useState<{ name: string; port: number } | null>(null);

  const handleBack = useCallback(() => {
    setViewMode('main');
    setLogTarget(null);
  }, []);

  // Keyboard input handling
  useInput(
    (input, key) => {
      // Quit
      if (input === 'q') {
        exit();
        return;
      }

      // Tab to switch panels
      if (key.tab) {
        setActivePanel((prev) => (prev === 'services' ? 'agents' : 'services'));
        return;
      }

      // Navigation within active panel
      if (key.upArrow) {
        if (activePanel === 'services') {
          setServiceIndex((prev) => Math.max(0, prev - 1));
        } else {
          setAgentIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }

      if (key.downArrow) {
        if (activePanel === 'services') {
          setServiceIndex((prev) => Math.min(services.length - 1, prev + 1));
        } else {
          setAgentIndex((prev) => Math.min(Math.max(0, agents.length - 1), prev + 1));
        }
        return;
      }

      // View logs for selected service
      if (input === 'l') {
        if (activePanel === 'services' && services[serviceIndex]) {
          const svc = services[serviceIndex];
          setLogTarget({ name: svc.name, port: svc.port });
          setViewMode('logs');
        }
        return;
      }

      // Restart service (placeholder — sends action to CP)
      if (input === 'r') {
        if (activePanel === 'services' && services[serviceIndex]) {
          triggerServiceAction('restart', services[serviceIndex].name);
        }
        return;
      }

      // Stop agent or service
      if (input === 's') {
        if (activePanel === 'agents' && agents[agentIndex]) {
          triggerAgentStop(agents[agentIndex].id);
        }
        return;
      }

      // Enter to view agent details (opens logs for now)
      if (key.return) {
        if (activePanel === 'agents' && agents[agentIndex]) {
          const agent = agents[agentIndex];
          setLogTarget({ name: agent.name, port: 8080 });
          setViewMode('logs');
        }
        return;
      }
    },
    { isActive: viewMode === 'main' },
  );

  // Log view mode
  if (viewMode === 'logs' && logTarget) {
    return (
      <LogViewer serviceName={logTarget.name} servicePort={logTarget.port} onBack={handleBack} />
    );
  }

  // Calculate panel heights
  const topPanelHeight = Math.max(10, Math.floor(termHeight * 0.5));
  const bottomPanelHeight = Math.max(6, termHeight - topPanelHeight - 2);

  return (
    <Box flexDirection="column" height={termHeight} width={termWidth}>
      {/* Header */}
      <Box justifyContent="center" paddingY={0}>
        <Text bold color="blue">
          AgentCTL Monitor
        </Text>
        <Text dimColor> {'\u2502'} </Text>
        <Text dimColor>{new Date().toLocaleTimeString('en-US', { hour12: false })}</Text>
      </Box>

      {/* Top panels: Services + Agents side by side */}
      <Box flexDirection="row" height={topPanelHeight}>
        <ServicePanel
          services={services}
          selectedIndex={serviceIndex}
          isActive={activePanel === 'services'}
        />
        <AgentPanel
          agents={agents}
          error={agentError}
          selectedIndex={agentIndex}
          isActive={activePanel === 'agents'}
        />
      </Box>

      {/* Bottom panel: Activity feed */}
      <Box height={bottomPanelHeight}>
        <ActivityFeed events={events} />
      </Box>

      {/* Footer: keyboard shortcuts */}
      <Box paddingX={1} justifyContent="center">
        <Text dimColor>
          q:quit {'  '} Tab:switch {'  '} {'\u2191\u2193'}:select {'  '} l:logs {'  '} r:restart
          {'  '} s:stop {'  '} Enter:detail
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Side-effect helpers (fire-and-forget actions)
// ---------------------------------------------------------------------------

function triggerServiceAction(action: string, serviceName: string): void {
  // Best-effort: POST to control plane for service management
  // This is a placeholder — actual implementation depends on CP endpoints
  fetch(`${CONTROL_URL}/api/services/${encodeURIComponent(serviceName)}/${action}`, {
    method: 'POST',
  }).catch(() => {
    // Silently fail — the poll loop will reflect any changes
  });
}

function triggerAgentStop(agentId: string): void {
  fetch(`${WORKER_URL}/api/agents/${encodeURIComponent(agentId)}/stop`, {
    method: 'POST',
  }).catch(() => {
    // Silently fail — the poll loop will reflect any changes
  });
}
