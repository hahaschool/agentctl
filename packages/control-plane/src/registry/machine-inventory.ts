import type { MachineCapabilities } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Roles a machine can fulfil within the fleet.
 *
 * `control-plane` — runs the central orchestration server.
 * `agent-worker`  — runs one or more AI agent instances.
 */
export type MachineRole = 'control-plane' | 'agent-worker';

/**
 * Capabilities declared in the YAML inventory for each machine.
 * Intentionally a superset of the shared `MachineCapabilities` — the
 * inventory uses `max_agents` (snake_case, YAML convention) which is
 * normalised to `maxConcurrentAgents` when converting to the shared type.
 */
export type InventoryCapabilities = {
  gpu?: boolean;
  max_agents?: number;
};

/**
 * A single machine entry as read from the YAML inventory file.
 * Field names use snake_case to match YAML conventions.
 */
export type InventoryMachineEntry = {
  id: string;
  role: MachineRole;
  tailscale_ip: string;
  hostname: string;
  services: string[];
  deploy_order: number;
  capabilities?: InventoryCapabilities;
};

/**
 * Top-level inventory YAML structure after parsing.
 */
export type InventoryDefaults = {
  docker_compose_file?: string;
  deploy_user?: string;
  health_check_path?: string;
  health_check_timeout?: number;
};

export type InventoryData = {
  defaults?: InventoryDefaults;
  machines: InventoryMachineEntry[];
};

/**
 * A single entry in the deployment plan returned by `getDeploymentPlan()`.
 */
export type DeploymentPlanEntry = {
  machine: InventoryMachineEntry;
  /** Whether this machine is the canary for its deploy-order group. */
  isCanary: boolean;
};

/**
 * A group of machines that share the same `deploy_order`.
 */
export type DeploymentGroup = {
  order: number;
  machines: DeploymentPlanEntry[];
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_ROLES: ReadonlySet<string> = new Set<string>(['control-plane', 'agent-worker']);

/**
 * Tailscale uses the CGNAT range 100.64.0.0/10 which spans
 * 100.64.0.0 – 100.127.255.255.  Each octet must be a valid 0-255 value.
 */
function isValidTailscaleIp(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255 || !Number.isInteger(o))) {
    return false;
  }

  const [first, second] = octets;
  // 100.64.0.0/10 → first octet must be 100, second 64-127
  return first === 100 && second >= 64 && second <= 127;
}

const REQUIRED_FIELDS: ReadonlyArray<keyof InventoryMachineEntry> = [
  'id',
  'role',
  'tailscale_ip',
  'hostname',
  'services',
  'deploy_order',
];

// ---------------------------------------------------------------------------
// MachineInventory
// ---------------------------------------------------------------------------

/**
 * Manages a parsed YAML machine inventory for fleet deployments.
 *
 * The class does **not** perform YAML parsing itself — callers are expected
 * to parse the YAML file externally (e.g. via `js-yaml`) and pass the
 * resulting object to the constructor or to `loadFromParsedData`.
 *
 * @example
 * ```ts
 * import * as yaml from 'js-yaml';
 * import { readFileSync } from 'node:fs';
 *
 * const raw = yaml.load(readFileSync('infra/machines.yml', 'utf8'));
 * const inventory = new MachineInventory(raw as InventoryData);
 * ```
 */
export class MachineInventory {
  private readonly machines: Map<string, InventoryMachineEntry>;
  private readonly defaults: InventoryDefaults;

  constructor(data: InventoryData) {
    this.defaults = data.defaults ?? {};
    this.machines = new Map();
    this.ingest(data.machines);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Return the machine entry matching `id`, or `undefined` if not found.
   */
  getMachine(id: string): InventoryMachineEntry | undefined {
    return this.machines.get(id);
  }

  /**
   * Return all machines that match the given role.
   */
  getMachinesByRole(role: MachineRole): InventoryMachineEntry[] {
    const results: InventoryMachineEntry[] = [];
    for (const machine of this.machines.values()) {
      if (machine.role === role) {
        results.push(machine);
      }
    }
    return results;
  }

  /**
   * Return all machines in the inventory.
   */
  listMachines(): InventoryMachineEntry[] {
    return Array.from(this.machines.values());
  }

  /**
   * Return the fleet-level defaults parsed from the inventory.
   */
  getDefaults(): InventoryDefaults {
    return { ...this.defaults };
  }

  /**
   * Build a deployment plan: machines grouped by `deploy_order` (ascending),
   * with the first worker-role machine in each group marked as a canary.
   *
   * The returned array is a flat list of {@link DeploymentPlanEntry} objects
   * sorted by `deploy_order` then by original insertion order.
   */
  getDeploymentPlan(): DeploymentPlanEntry[] {
    const groups = this.getDeploymentGroups();
    const plan: DeploymentPlanEntry[] = [];

    for (const group of groups) {
      plan.push(...group.machines);
    }

    return plan;
  }

  /**
   * Return deployment groups — machines grouped by `deploy_order`.
   * Within each group the first worker is marked as canary.
   */
  getDeploymentGroups(): DeploymentGroup[] {
    // Collect machines by deploy_order
    const orderMap = new Map<number, InventoryMachineEntry[]>();

    for (const machine of this.machines.values()) {
      const order = machine.deploy_order;
      const list = orderMap.get(order) ?? [];
      list.push(machine);
      orderMap.set(order, list);
    }

    // Sort groups by deploy_order ascending
    const sortedOrders = Array.from(orderMap.keys()).sort((a, b) => a - b);

    const groups: DeploymentGroup[] = [];

    for (const order of sortedOrders) {
      const machinesInGroup = orderMap.get(order) as InventoryMachineEntry[];
      let canaryAssigned = false;

      const entries: DeploymentPlanEntry[] = machinesInGroup.map((machine) => {
        // Mark the first worker-role machine in each group as canary
        const isCanary = !canaryAssigned && machine.role === 'agent-worker';
        if (isCanary) {
          canaryAssigned = true;
        }
        return { machine, isCanary };
      });

      groups.push({ order, machines: entries });
    }

    return groups;
  }

  /**
   * Validate the entire inventory and return an array of human-readable
   * error messages.  An empty array means the inventory is valid.
   */
  validateInventory(): string[] {
    return MachineInventory.validate(Array.from(this.machines.values()));
  }

  /**
   * Convert an inventory entry's capabilities to the shared
   * {@link MachineCapabilities} type used by the rest of the control plane.
   */
  static toSharedCapabilities(caps?: InventoryCapabilities): MachineCapabilities {
    return {
      gpu: caps?.gpu ?? false,
      docker: true, // fleet machines always have Docker
      maxConcurrentAgents: caps?.max_agents ?? 1,
    };
  }

  // -------------------------------------------------------------------------
  // Static validation (usable without constructing an instance)
  // -------------------------------------------------------------------------

  /**
   * Validate an array of raw machine entries and return error strings.
   * Returns an empty array when all entries are valid.
   */
  static validate(entries: InventoryMachineEntry[]): string[] {
    const errors: string[] = [];

    if (!Array.isArray(entries) || entries.length === 0) {
      errors.push('Inventory must contain at least one machine entry');
      return errors;
    }

    const seenIds = new Set<string>();
    const seenHostnames = new Set<string>();
    const seenIps = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const prefix = `machines[${i}]`;

      // --- Required fields ------------------------------------------------
      for (const field of REQUIRED_FIELDS) {
        if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
          errors.push(`${prefix}: missing required field '${field}'`);
        }
      }

      // If id is missing we cannot do uniqueness checks, skip ahead.
      if (!entry.id) {
        continue;
      }

      // --- Unique ID ------------------------------------------------------
      if (seenIds.has(entry.id)) {
        errors.push(`${prefix}: duplicate machine id '${entry.id}'`);
      }
      seenIds.add(entry.id);

      // --- Unique hostname ------------------------------------------------
      if (entry.hostname && seenHostnames.has(entry.hostname)) {
        errors.push(`${prefix}: duplicate hostname '${entry.hostname}'`);
      }
      if (entry.hostname) {
        seenHostnames.add(entry.hostname);
      }

      // --- Valid role -----------------------------------------------------
      if (entry.role && !VALID_ROLES.has(entry.role)) {
        errors.push(
          `${prefix}: invalid role '${entry.role}' (expected one of: ${Array.from(VALID_ROLES).join(', ')})`,
        );
      }

      // --- Valid Tailscale IP ---------------------------------------------
      if (entry.tailscale_ip) {
        if (!isValidTailscaleIp(entry.tailscale_ip)) {
          errors.push(
            `${prefix}: invalid Tailscale IP '${entry.tailscale_ip}' (must be in CGNAT range 100.64.0.0/10)`,
          );
        }
        if (seenIps.has(entry.tailscale_ip)) {
          errors.push(`${prefix}: duplicate tailscale_ip '${entry.tailscale_ip}'`);
        }
        seenIps.add(entry.tailscale_ip);
      }

      // --- Services array -------------------------------------------------
      if (entry.services !== undefined && !Array.isArray(entry.services)) {
        errors.push(`${prefix}: 'services' must be an array`);
      }

      // --- Deploy order ---------------------------------------------------
      if (
        entry.deploy_order !== undefined &&
        (typeof entry.deploy_order !== 'number' ||
          !Number.isInteger(entry.deploy_order) ||
          entry.deploy_order < 1)
      ) {
        errors.push(`${prefix}: 'deploy_order' must be a positive integer`);
      }

      // --- Capabilities (optional) ----------------------------------------
      if (entry.capabilities) {
        if (
          entry.capabilities.max_agents !== undefined &&
          (typeof entry.capabilities.max_agents !== 'number' || entry.capabilities.max_agents < 0)
        ) {
          errors.push(`${prefix}: 'capabilities.max_agents' must be a non-negative number`);
        }
      }
    }

    return errors;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Ingest parsed machine entries, validating as we go.
   * Throws {@link ControlPlaneError} when any entry is invalid.
   */
  private ingest(entries: InventoryMachineEntry[]): void {
    const errors = MachineInventory.validate(entries);

    if (errors.length > 0) {
      throw new ControlPlaneError(
        'INVALID_INVENTORY',
        `Machine inventory has ${errors.length} validation error(s):\n  - ${errors.join('\n  - ')}`,
        { errors },
      );
    }

    for (const entry of entries) {
      this.machines.set(entry.id, entry);
    }
  }
}
