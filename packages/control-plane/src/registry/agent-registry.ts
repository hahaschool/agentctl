export type MachineEntry = {
  machineId: string;
  hostname: string;
  lastHeartbeat: Date;
  status: 'online' | 'offline';
};

/**
 * Minimal shape that any object returned from `getMachine` must have.
 * Both {@link MachineEntry} (in-memory) and the shared `Machine` type
 * (from `@agentctl/shared`) satisfy this.
 *
 * Routes use `tailscaleIp` to construct worker URLs for cross-machine
 * communication via the Tailscale mesh. The `hostname` is kept for
 * display and logging purposes.
 */
export type MachineRecord = {
  hostname: string;
  tailscaleIp?: string;
  [key: string]: unknown;
};

/**
 * Minimal machine-registry interface shared between the in-memory
 * {@link AgentRegistry} and the database-backed {@link DbAgentRegistry}.
 *
 * All methods return `MaybePromise` so callers always `await` them,
 * keeping route handlers agnostic of the backing store.
 */
export type MachineRegistryLike = {
  registerMachine(...args: unknown[]): void | Promise<void>;
  heartbeat(machineId: string): void | Promise<void>;
  listMachines(): MachineRecord[] | Promise<MachineRecord[]>;
  getMachine(machineId: string): MachineRecord | undefined | Promise<MachineRecord | undefined>;
};

export class AgentRegistry {
  private machines = new Map<string, MachineEntry>();

  registerMachine(machineId: string, hostname: string): void {
    this.machines.set(machineId, {
      machineId,
      hostname,
      lastHeartbeat: new Date(),
      status: 'online',
    });
  }

  heartbeat(machineId: string): void {
    const machine = this.machines.get(machineId);
    if (machine) {
      machine.lastHeartbeat = new Date();
      machine.status = 'online';
    }
  }

  listMachines(): MachineEntry[] {
    return Array.from(this.machines.values());
  }

  getMachine(machineId: string): MachineEntry | undefined {
    return this.machines.get(machineId);
  }
}
