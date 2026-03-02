import { beforeEach, describe, expect, it } from 'vitest';

import { AgentRegistry } from './agent-registry.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe('registerMachine()', () => {
    it('adds machine entry', () => {
      registry.registerMachine('machine-1', 'ec2-host.tailnet');

      const machine = registry.getMachine('machine-1');
      expect(machine).toBeDefined();
      expect(machine?.machineId).toBe('machine-1');
      expect(machine?.hostname).toBe('ec2-host.tailnet');
      expect(machine?.status).toBe('online');
      expect(machine?.lastHeartbeat).toBeInstanceOf(Date);
    });

    it('updates existing machine (upsert)', () => {
      registry.registerMachine('machine-1', 'old-host.tailnet');
      registry.registerMachine('machine-1', 'new-host.tailnet');

      const machines = registry.listMachines();
      expect(machines).toHaveLength(1);

      const machine = registry.getMachine('machine-1');
      expect(machine?.hostname).toBe('new-host.tailnet');
    });
  });

  describe('getMachine()', () => {
    it('returns machine URL', () => {
      registry.registerMachine('machine-1', 'ec2-host.tailnet');

      const machine = registry.getMachine('machine-1');
      expect(machine).toBeDefined();
      expect(machine?.hostname).toBe('ec2-host.tailnet');
    });

    it('returns undefined for unknown machine', () => {
      const machine = registry.getMachine('nonexistent');
      expect(machine).toBeUndefined();
    });
  });

  describe('heartbeat()', () => {
    it('updates lastHeartbeat for existing machine', () => {
      registry.registerMachine('machine-1', 'host.tailnet');

      const before = registry.getMachine('machine-1')?.lastHeartbeat;

      // Small delay to ensure timestamp differs
      registry.heartbeat('machine-1');

      const after = registry.getMachine('machine-1')?.lastHeartbeat;
      expect(after).toBeDefined();
      expect(after?.getTime()).toBeGreaterThanOrEqual(before?.getTime() ?? 0);
    });

    it('does nothing for unknown machine', () => {
      // Should not throw
      registry.heartbeat('nonexistent');
      expect(registry.listMachines()).toHaveLength(0);
    });
  });

  describe('listMachines()', () => {
    it('returns all registered machines', () => {
      registry.registerMachine('machine-1', 'host1.tailnet');
      registry.registerMachine('machine-2', 'host2.tailnet');
      registry.registerMachine('machine-3', 'host3.tailnet');

      const machines = registry.listMachines();
      expect(machines).toHaveLength(3);

      const hostnames = machines.map((m) => m.hostname);
      expect(hostnames).toContain('host1.tailnet');
      expect(hostnames).toContain('host2.tailnet');
      expect(hostnames).toContain('host3.tailnet');
    });

    it('returns empty array when no machines are registered', () => {
      const machines = registry.listMachines();
      expect(machines).toEqual([]);
    });
  });
});
