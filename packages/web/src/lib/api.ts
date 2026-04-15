// ---------------------------------------------------------------------------
// API barrel — re-exports every public symbol from the domain modules under
// `./api/`. The module was split by domain to keep each file small and avoid
// merge conflicts across parallel feature work. DO NOT add new logic here —
// add functions/types to the matching domain module and let them flow through
// the re-exports below.
// ---------------------------------------------------------------------------

import type {
  AgentConfig,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalGate,
  ApprovalGateStatus,
  ApprovalTimeoutPolicy,
  ContextRef,
  CrossSpaceSubscription,
  DecomposedEdge,
  DecomposedTask,
  DecompositionConstraints,
  DecompositionRequest,
  DecompositionResponse,
  DecompositionResult,
  DiscoveredMcpServer,
  DiscoveredSkill,
  EventSenderType,
  EventVisibility,
  FleetOverview,
  ImportJob,
  McpServerConfig,
  McpServerTemplate,
  MemoryScopeRecord,
  MemoryScopeType,
  MobilePushDevice,
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  PermissionRequest,
  PermissionRequestStatus,
  Space,
  SpaceEvent,
  SpaceEventType,
  SpaceMember,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  TaskDefinition,
  TaskEdge,
  TaskGraph,
  TaskRun,
  TaskRunStatus,
  Thread,
  ThreadType,
  WorkerNode,
} from '@agentctl/shared';

// Re-export the shared types that callers import from `@/lib/api`.
export type {
  AgentConfig,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalGate,
  ApprovalGateStatus,
  ApprovalTimeoutPolicy,
  ContextRef,
  CrossSpaceSubscription,
  DecomposedEdge,
  DecomposedTask,
  DecompositionConstraints,
  DecompositionRequest,
  DecompositionResponse,
  DecompositionResult,
  DiscoveredMcpServer,
  DiscoveredSkill,
  EventSenderType,
  EventVisibility,
  FleetOverview,
  ImportJob,
  McpServerConfig,
  McpServerTemplate,
  MemoryScopeRecord,
  MemoryScopeType,
  MobilePushDevice,
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  PermissionRequest,
  PermissionRequestStatus,
  Space,
  SpaceEvent,
  SpaceEventType,
  SpaceMember,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  TaskDefinition,
  TaskEdge,
  TaskGraph,
  TaskRun,
  TaskRunStatus,
  Thread,
  ThreadType,
  WorkerNode,
};

// ---------------------------------------------------------------------------
// Domain module re-exports (types + helpers).
// ---------------------------------------------------------------------------

export * from './api/agent-profiles';
export * from './api/agents';
export * from './api/core';
export * from './api/deployment';
export * from './api/machines';
export * from './api/memory';
export * from './api/mesh-auto-update';
export * from './api/scheduler';
export * from './api/security';
export * from './api/sessions';
export * from './api/settings';
export * from './api/spaces';
export * from './api/sync';
export * from './api/webhooks';

import { agentProfilesApi } from './api/agent-profiles';
import { agentsApi } from './api/agents';
import { type Attachment, healthApi } from './api/core';
import { deploymentApi } from './api/deployment';
import { machinesApi } from './api/machines';
import { memoryApi } from './api/memory';
import { meshAutoUpdateApi } from './api/mesh-auto-update';
import { schedulerApi } from './api/scheduler';
import { securityApi } from './api/security';
import { sessionsApi } from './api/sessions';
import { settingsApi } from './api/settings';
import { spacesApi } from './api/spaces';
import { syncApi } from './api/sync';
import { webhooksApi } from './api/webhooks';

// ---------------------------------------------------------------------------
// Aggregate API object — reconstructed from domain slices. Every function is
// spread in, preserving the original flat `api.foo()` call surface.
// ---------------------------------------------------------------------------

export const api = {
  ...healthApi,
  ...agentsApi,
  ...agentProfilesApi,
  ...sessionsApi,
  ...settingsApi,
  ...securityApi,
  ...machinesApi,
  ...memoryApi,
  ...schedulerApi,
  ...spacesApi,
  ...deploymentApi,
  ...meshAutoUpdateApi,
  ...syncApi,
  ...webhooksApi,
};

/**
 * Upload attachments to the worker machine and return the file paths.
 * Files are saved under `<projectPath>/.agentctl-uploads/`.
 *
 * Lives on the barrel (not a domain module) because it wires together the
 * filesystem write endpoint with the attachment helpers.
 */
export async function uploadAttachments(
  machineId: string,
  projectPath: string,
  attachments: Attachment[],
): Promise<string[]> {
  const uploadDir = `${projectPath}/.agentctl-uploads`;
  const paths: string[] = [];

  for (const attachment of attachments) {
    const filePath = `${uploadDir}/${attachment.name}`;
    const content = attachment.isBase64 ? `__BASE64__${attachment.content}` : attachment.content;

    await api.writeFile(machineId, filePath, content);
    paths.push(filePath);
  }

  return paths;
}
