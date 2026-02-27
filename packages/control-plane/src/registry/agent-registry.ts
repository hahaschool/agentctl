type MachineEntry = {
  machineId: string;
  hostname: string;
  lastHeartbeat: Date;
  status: 'online' | 'offline';
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
