import { ControlPlaneError } from '@agentctl/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type InventoryData,
  type InventoryMachineEntry,
  MachineInventory,
} from './machine-inventory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEntry(overrides: Partial<InventoryMachineEntry> = {}): InventoryMachineEntry {
  return {
    id: 'worker-1',
    role: 'agent-worker',
    tailscale_ip: '100.64.0.2',
    hostname: 'ec2-worker',
    services: ['agent-worker'],
    deploy_order: 2,
    capabilities: { gpu: false, max_agents: 4 },
    ...overrides,
  };
}

function validInventoryData(
  machines?: InventoryMachineEntry[],
  defaults?: InventoryData['defaults'],
): InventoryData {
  return {
    defaults: defaults ?? {
      docker_compose_file: 'docker-compose.prod.yml',
      deploy_user: 'deploy',
      health_check_path: '/health',
      health_check_timeout: 30,
    },
    machines: machines ?? [
      validEntry({
        id: 'control-plane-1',
        role: 'control-plane',
        tailscale_ip: '100.64.0.1',
        hostname: 'cp-primary',
        services: ['control-plane'],
        deploy_order: 1,
        capabilities: { gpu: false, max_agents: 0 },
      }),
      validEntry({
        id: 'worker-ec2-1',
        tailscale_ip: '100.64.0.2',
        hostname: 'ec2-us-east',
      }),
      validEntry({
        id: 'worker-mac-mini-1',
        tailscale_ip: '100.64.0.3',
        hostname: 'mac-mini-home',
        capabilities: { gpu: true, max_agents: 2 },
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MachineInventory', () => {
  // -----------------------------------------------------------------------
  // Constructor / parsing
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('accepts valid inventory data', () => {
      const inventory = new MachineInventory(validInventoryData());
      expect(inventory.listMachines()).toHaveLength(3);
    });

    it('stores all machines by id', () => {
      const inventory = new MachineInventory(validInventoryData());
      expect(inventory.getMachine('control-plane-1')).toBeDefined();
      expect(inventory.getMachine('worker-ec2-1')).toBeDefined();
      expect(inventory.getMachine('worker-mac-mini-1')).toBeDefined();
    });

    it('preserves machine entry fields', () => {
      const inventory = new MachineInventory(validInventoryData());
      const cp = inventory.getMachine('control-plane-1');

      expect(cp?.role).toBe('control-plane');
      expect(cp?.tailscale_ip).toBe('100.64.0.1');
      expect(cp?.hostname).toBe('cp-primary');
      expect(cp?.services).toEqual(['control-plane']);
      expect(cp?.deploy_order).toBe(1);
      expect(cp?.capabilities).toEqual({ gpu: false, max_agents: 0 });
    });

    it('defaults inventory defaults when omitted', () => {
      const inventory = new MachineInventory({
        machines: [validEntry()],
      });
      expect(inventory.getDefaults()).toEqual({});
    });

    it('preserves inventory defaults when provided', () => {
      const inventory = new MachineInventory(validInventoryData());
      const defaults = inventory.getDefaults();

      expect(defaults.docker_compose_file).toBe('docker-compose.prod.yml');
      expect(defaults.deploy_user).toBe('deploy');
      expect(defaults.health_check_path).toBe('/health');
      expect(defaults.health_check_timeout).toBe(30);
    });
  });

  // -----------------------------------------------------------------------
  // Validation — missing required fields
  // -----------------------------------------------------------------------

  describe('validation — missing required fields', () => {
    it('rejects entry missing id', () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).id;

      expect(() => new MachineInventory({ machines: [entry as InventoryMachineEntry] })).toThrow(
        ControlPlaneError,
      );
    });

    it('rejects entry missing role', () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).role;

      expect(() => new MachineInventory({ machines: [entry as InventoryMachineEntry] })).toThrow(
        ControlPlaneError,
      );
    });

    it('rejects entry missing tailscale_ip', () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).tailscale_ip;

      expect(() => new MachineInventory({ machines: [entry as InventoryMachineEntry] })).toThrow(
        ControlPlaneError,
      );
    });

    it('rejects entry missing hostname', () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).hostname;

      expect(() => new MachineInventory({ machines: [entry as InventoryMachineEntry] })).toThrow(
        ControlPlaneError,
      );
    });

    it('rejects entry missing services', () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).services;

      expect(() => new MachineInventory({ machines: [entry as InventoryMachineEntry] })).toThrow(
        ControlPlaneError,
      );
    });

    it('rejects entry missing deploy_order', () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).deploy_order;

      expect(() => new MachineInventory({ machines: [entry as InventoryMachineEntry] })).toThrow(
        ControlPlaneError,
      );
    });

    it('reports all missing fields in a single error', () => {
      const errors = MachineInventory.validate([{} as InventoryMachineEntry]);

      expect(errors.length).toBeGreaterThanOrEqual(6);
      expect(errors.some((e) => e.includes("'id'"))).toBe(true);
      expect(errors.some((e) => e.includes("'role'"))).toBe(true);
      expect(errors.some((e) => e.includes("'tailscale_ip'"))).toBe(true);
      expect(errors.some((e) => e.includes("'hostname'"))).toBe(true);
      expect(errors.some((e) => e.includes("'services'"))).toBe(true);
      expect(errors.some((e) => e.includes("'deploy_order'"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Validation — duplicate IDs
  // -----------------------------------------------------------------------

  describe('validation — duplicate machine IDs', () => {
    it('rejects inventory with duplicate ids', () => {
      const machines = [
        validEntry({ id: 'dup-1', tailscale_ip: '100.64.0.10', hostname: 'host-a' }),
        validEntry({ id: 'dup-1', tailscale_ip: '100.64.0.11', hostname: 'host-b' }),
      ];

      expect(() => new MachineInventory({ machines })).toThrow(ControlPlaneError);
    });

    it('includes the duplicate id in the error message', () => {
      const machines = [
        validEntry({ id: 'dup-1', tailscale_ip: '100.64.0.10', hostname: 'host-a' }),
        validEntry({ id: 'dup-1', tailscale_ip: '100.64.0.11', hostname: 'host-b' }),
      ];

      const errors = MachineInventory.validate(machines);
      expect(errors.some((e) => e.includes("duplicate machine id 'dup-1'"))).toBe(true);
    });

    it('rejects inventory with duplicate hostnames', () => {
      const machines = [
        validEntry({ id: 'a', tailscale_ip: '100.64.0.10', hostname: 'same-host' }),
        validEntry({ id: 'b', tailscale_ip: '100.64.0.11', hostname: 'same-host' }),
      ];

      const errors = MachineInventory.validate(machines);
      expect(errors.some((e) => e.includes("duplicate hostname 'same-host'"))).toBe(true);
    });

    it('rejects inventory with duplicate Tailscale IPs', () => {
      const machines = [
        validEntry({ id: 'a', tailscale_ip: '100.64.0.10', hostname: 'host-a' }),
        validEntry({ id: 'b', tailscale_ip: '100.64.0.10', hostname: 'host-b' }),
      ];

      const errors = MachineInventory.validate(machines);
      expect(errors.some((e) => e.includes("duplicate tailscale_ip '100.64.0.10'"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Validation — invalid Tailscale IPs
  // -----------------------------------------------------------------------

  describe('validation — invalid Tailscale IPs', () => {
    it('rejects IPs outside the CGNAT range (192.168.x.x)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '192.168.1.1' })]);
      expect(errors.some((e) => e.includes('invalid Tailscale IP'))).toBe(true);
    });

    it('rejects IPs outside the CGNAT range (10.0.0.x)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '10.0.0.1' })]);
      expect(errors.some((e) => e.includes('invalid Tailscale IP'))).toBe(true);
    });

    it('rejects IPs with second octet below 64 (100.63.0.1)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '100.63.0.1' })]);
      expect(errors.some((e) => e.includes('invalid Tailscale IP'))).toBe(true);
    });

    it('rejects IPs with second octet above 127 (100.128.0.1)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '100.128.0.1' })]);
      expect(errors.some((e) => e.includes('invalid Tailscale IP'))).toBe(true);
    });

    it('accepts IPs at the lower boundary (100.64.0.0)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '100.64.0.0' })]);
      expect(errors.filter((e) => e.includes('invalid Tailscale IP'))).toHaveLength(0);
    });

    it('accepts IPs at the upper boundary (100.127.255.255)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '100.127.255.255' })]);
      expect(errors.filter((e) => e.includes('invalid Tailscale IP'))).toHaveLength(0);
    });

    it('rejects malformed IPs (too few octets)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '100.64.0' })]);
      expect(errors.some((e) => e.includes('invalid Tailscale IP'))).toBe(true);
    });

    it('rejects malformed IPs (non-numeric)', () => {
      const errors = MachineInventory.validate([validEntry({ tailscale_ip: '100.64.abc.1' })]);
      expect(errors.some((e) => e.includes('invalid Tailscale IP'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Validation — invalid role
  // -----------------------------------------------------------------------

  describe('validation — invalid role', () => {
    it('rejects unknown role', () => {
      const errors = MachineInventory.validate([
        validEntry({ role: 'database' as 'agent-worker' }),
      ]);
      expect(errors.some((e) => e.includes("invalid role 'database'"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Validation — empty inventory
  // -----------------------------------------------------------------------

  describe('validation — empty inventory', () => {
    it('rejects empty machines array', () => {
      expect(() => new MachineInventory({ machines: [] })).toThrow(ControlPlaneError);
    });

    it('returns error for empty machines array via static validate', () => {
      const errors = MachineInventory.validate([]);
      expect(errors).toContain('Inventory must contain at least one machine entry');
    });
  });

  // -----------------------------------------------------------------------
  // Validation — deploy_order
  // -----------------------------------------------------------------------

  describe('validation — deploy_order', () => {
    it('rejects deploy_order of 0', () => {
      const errors = MachineInventory.validate([validEntry({ deploy_order: 0 })]);
      expect(errors.some((e) => e.includes("'deploy_order' must be a positive integer"))).toBe(
        true,
      );
    });

    it('rejects negative deploy_order', () => {
      const errors = MachineInventory.validate([validEntry({ deploy_order: -1 })]);
      expect(errors.some((e) => e.includes("'deploy_order' must be a positive integer"))).toBe(
        true,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Validation — error context
  // -----------------------------------------------------------------------

  describe('validation — error context', () => {
    it('throws ControlPlaneError with INVALID_INVENTORY code', () => {
      try {
        new MachineInventory({ machines: [] });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('INVALID_INVENTORY');
      }
    });

    it('includes error list in error context', () => {
      try {
        new MachineInventory({ machines: [] });
        expect.unreachable('Should have thrown');
      } catch (err) {
        const context = (err as ControlPlaneError).context;
        expect(context).toBeDefined();
        expect(Array.isArray(context?.errors)).toBe(true);
      }
    });

    it('reports the count of validation errors in the message', () => {
      const machines = [
        validEntry({ id: 'dup', tailscale_ip: '100.64.0.10', hostname: 'h-a' }),
        validEntry({ id: 'dup', tailscale_ip: '100.64.0.10', hostname: 'h-a' }),
      ];
      const errors = MachineInventory.validate(machines);
      expect(errors.length).toBeGreaterThanOrEqual(2); // duplicate id + duplicate ip + duplicate hostname
    });
  });

  // -----------------------------------------------------------------------
  // getMachine()
  // -----------------------------------------------------------------------

  describe('getMachine()', () => {
    let inventory: MachineInventory;

    beforeEach(() => {
      inventory = new MachineInventory(validInventoryData());
    });

    it('returns the matching machine', () => {
      const machine = inventory.getMachine('worker-ec2-1');
      expect(machine).toBeDefined();
      expect(machine?.hostname).toBe('ec2-us-east');
    });

    it('returns undefined for unknown id', () => {
      const machine = inventory.getMachine('nonexistent');
      expect(machine).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getMachinesByRole()
  // -----------------------------------------------------------------------

  describe('getMachinesByRole()', () => {
    let inventory: MachineInventory;

    beforeEach(() => {
      inventory = new MachineInventory(validInventoryData());
    });

    it('returns only control-plane machines', () => {
      const cps = inventory.getMachinesByRole('control-plane');
      expect(cps).toHaveLength(1);
      expect(cps[0].id).toBe('control-plane-1');
    });

    it('returns only agent-worker machines', () => {
      const workers = inventory.getMachinesByRole('agent-worker');
      expect(workers).toHaveLength(2);
      const ids = workers.map((w) => w.id);
      expect(ids).toContain('worker-ec2-1');
      expect(ids).toContain('worker-mac-mini-1');
    });

    it('returns empty array when no machines match the role', () => {
      const single = new MachineInventory({
        machines: [
          validEntry({
            id: 'cp-only',
            role: 'control-plane',
            tailscale_ip: '100.64.0.1',
            hostname: 'cp-host',
            services: ['control-plane'],
            deploy_order: 1,
          }),
        ],
      });
      expect(single.getMachinesByRole('agent-worker')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getDeploymentPlan()
  // -----------------------------------------------------------------------

  describe('getDeploymentPlan()', () => {
    it('returns machines sorted by deploy_order ascending', () => {
      const inventory = new MachineInventory(validInventoryData());
      const plan = inventory.getDeploymentPlan();

      expect(plan).toHaveLength(3);
      expect(plan[0].machine.deploy_order).toBe(1);
      expect(plan[1].machine.deploy_order).toBe(2);
      expect(plan[2].machine.deploy_order).toBe(2);
    });

    it('places control-plane (deploy_order 1) before workers (deploy_order 2)', () => {
      const inventory = new MachineInventory(validInventoryData());
      const plan = inventory.getDeploymentPlan();

      expect(plan[0].machine.role).toBe('control-plane');
      expect(plan[1].machine.role).toBe('agent-worker');
      expect(plan[2].machine.role).toBe('agent-worker');
    });

    it('marks the first worker in each deploy_order group as canary', () => {
      const inventory = new MachineInventory(validInventoryData());
      const plan = inventory.getDeploymentPlan();

      // deploy_order=1 has only control-plane, no canary
      expect(plan[0].isCanary).toBe(false);

      // deploy_order=2 — first worker is canary, second is not
      const orderTwoEntries = plan.filter((e) => e.machine.deploy_order === 2);
      expect(orderTwoEntries[0].isCanary).toBe(true);
      expect(orderTwoEntries[1].isCanary).toBe(false);
    });

    it('does not mark control-plane as canary even if it is alone', () => {
      const inventory = new MachineInventory(validInventoryData());
      const plan = inventory.getDeploymentPlan();

      const cpEntry = plan.find((e) => e.machine.role === 'control-plane');
      expect(cpEntry?.isCanary).toBe(false);
    });

    it('handles multiple deploy_order groups correctly', () => {
      const machines: InventoryMachineEntry[] = [
        validEntry({
          id: 'cp-1',
          role: 'control-plane',
          tailscale_ip: '100.64.0.1',
          hostname: 'cp-host',
          services: ['control-plane'],
          deploy_order: 1,
        }),
        validEntry({
          id: 'worker-a',
          tailscale_ip: '100.64.0.2',
          hostname: 'worker-a-host',
          deploy_order: 2,
        }),
        validEntry({
          id: 'worker-b',
          tailscale_ip: '100.64.0.3',
          hostname: 'worker-b-host',
          deploy_order: 3,
        }),
      ];

      const inventory = new MachineInventory({ machines });
      const plan = inventory.getDeploymentPlan();

      expect(plan).toHaveLength(3);
      expect(plan[0].machine.deploy_order).toBe(1);
      expect(plan[1].machine.deploy_order).toBe(2);
      expect(plan[2].machine.deploy_order).toBe(3);

      // Each group with a worker gets a canary
      expect(plan[1].isCanary).toBe(true);
      expect(plan[2].isCanary).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getDeploymentGroups()
  // -----------------------------------------------------------------------

  describe('getDeploymentGroups()', () => {
    it('returns groups sorted by deploy_order', () => {
      const inventory = new MachineInventory(validInventoryData());
      const groups = inventory.getDeploymentGroups();

      expect(groups).toHaveLength(2);
      expect(groups[0].order).toBe(1);
      expect(groups[1].order).toBe(2);
    });

    it('groups machines with the same deploy_order together', () => {
      const inventory = new MachineInventory(validInventoryData());
      const groups = inventory.getDeploymentGroups();

      expect(groups[0].machines).toHaveLength(1); // control-plane
      expect(groups[1].machines).toHaveLength(2); // two workers
    });
  });

  // -----------------------------------------------------------------------
  // toSharedCapabilities()
  // -----------------------------------------------------------------------

  describe('toSharedCapabilities()', () => {
    it('converts inventory capabilities to shared type', () => {
      const shared = MachineInventory.toSharedCapabilities({
        gpu: true,
        max_agents: 4,
      });

      expect(shared.gpu).toBe(true);
      expect(shared.docker).toBe(true);
      expect(shared.maxConcurrentAgents).toBe(4);
    });

    it('defaults gpu to false and max_agents to 1 when omitted', () => {
      const shared = MachineInventory.toSharedCapabilities({});

      expect(shared.gpu).toBe(false);
      expect(shared.docker).toBe(true);
      expect(shared.maxConcurrentAgents).toBe(1);
    });

    it('defaults all fields when capabilities is undefined', () => {
      const shared = MachineInventory.toSharedCapabilities(undefined);

      expect(shared.gpu).toBe(false);
      expect(shared.docker).toBe(true);
      expect(shared.maxConcurrentAgents).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // listMachines()
  // -----------------------------------------------------------------------

  describe('listMachines()', () => {
    it('returns all machines in the inventory', () => {
      const inventory = new MachineInventory(validInventoryData());
      const machines = inventory.listMachines();

      expect(machines).toHaveLength(3);
      const ids = machines.map((m) => m.id);
      expect(ids).toContain('control-plane-1');
      expect(ids).toContain('worker-ec2-1');
      expect(ids).toContain('worker-mac-mini-1');
    });
  });

  // -----------------------------------------------------------------------
  // validateInventory()
  // -----------------------------------------------------------------------

  describe('validateInventory()', () => {
    it('returns empty array for valid inventory', () => {
      const inventory = new MachineInventory(validInventoryData());
      expect(inventory.validateInventory()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Single-machine inventory
  // -----------------------------------------------------------------------

  describe('single-machine inventory', () => {
    it('accepts inventory with one machine', () => {
      const inventory = new MachineInventory({
        machines: [validEntry()],
      });
      expect(inventory.listMachines()).toHaveLength(1);
    });

    it('deployment plan for single worker marks it as canary', () => {
      const inventory = new MachineInventory({
        machines: [validEntry()],
      });
      const plan = inventory.getDeploymentPlan();

      expect(plan).toHaveLength(1);
      expect(plan[0].isCanary).toBe(true);
    });
  });
});
