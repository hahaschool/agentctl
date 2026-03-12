import type { WorkerNode } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { workerNodes } from '../db/index.js';

type RegisterNodeInput = {
  hostname: string;
  tailscaleIp: string;
  maxConcurrentAgents?: number;
  capabilities?: string[];
};

export class WorkerNodeStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async registerNode(input: RegisterNodeInput): Promise<WorkerNode> {
    const rows = await this.db
      .insert(workerNodes)
      .values({
        hostname: input.hostname,
        tailscaleIp: input.tailscaleIp,
        maxConcurrentAgents: input.maxConcurrentAgents ?? 3,
        capabilities: input.capabilities ?? [],
        status: 'online',
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('NODE_REGISTER_FAILED', 'Failed to register worker node', {
        input,
      });
    }

    this.logger.info({ nodeId: rows[0].id, hostname: input.hostname }, 'Worker node registered');
    return this.toWorkerNode(rows[0]);
  }

  async getNode(id: string): Promise<WorkerNode | undefined> {
    const rows = await this.db.select().from(workerNodes).where(eq(workerNodes.id, id));
    return rows.length === 0 ? undefined : this.toWorkerNode(rows[0]);
  }

  async listNodes(): Promise<WorkerNode[]> {
    const rows = await this.db.select().from(workerNodes);
    return rows.map((r) => this.toWorkerNode(r));
  }

  async updateHeartbeat(id: string): Promise<void> {
    const result = await this.db
      .update(workerNodes)
      .set({ lastHeartbeatAt: sql`now()` })
      .where(eq(workerNodes.id, id))
      .returning({ id: workerNodes.id });

    if (result.length === 0) {
      throw new ControlPlaneError('NODE_NOT_FOUND', `Worker node '${id}' does not exist`, { id });
    }

    this.logger.debug({ nodeId: id }, 'Worker node heartbeat updated');
  }

  async setStatus(id: string, status: string): Promise<void> {
    const result = await this.db
      .update(workerNodes)
      .set({ status })
      .where(eq(workerNodes.id, id))
      .returning({ id: workerNodes.id });

    if (result.length === 0) {
      throw new ControlPlaneError('NODE_NOT_FOUND', `Worker node '${id}' does not exist`, { id });
    }

    this.logger.info({ nodeId: id, status }, 'Worker node status updated');
  }

  async updateLoad(id: string, currentLoad: number): Promise<void> {
    const result = await this.db
      .update(workerNodes)
      .set({ currentLoad })
      .where(eq(workerNodes.id, id))
      .returning({ id: workerNodes.id });

    if (result.length === 0) {
      throw new ControlPlaneError('NODE_NOT_FOUND', `Worker node '${id}' does not exist`, { id });
    }
  }

  private toWorkerNode(row: typeof workerNodes.$inferSelect): WorkerNode {
    return {
      id: row.id,
      hostname: row.hostname,
      tailscaleIp: row.tailscaleIp,
      maxConcurrentAgents: row.maxConcurrentAgents ?? 3,
      currentLoad: row.currentLoad ?? 0,
      capabilities: (row.capabilities ?? []) as string[],
      status: (row.status ?? 'online') as WorkerNode['status'],
      lastHeartbeatAt: (row.lastHeartbeatAt ?? new Date()).toISOString(),
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
