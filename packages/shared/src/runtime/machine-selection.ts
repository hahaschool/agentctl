import type { MachineStatus } from '../types/machine.js';

export type MachineSelectionCandidate = {
  id: string;
  hostname: string;
  status: MachineStatus;
};

const MACHINE_STATUS_PRIORITY: Record<MachineStatus, number> = {
  online: 0,
  degraded: 1,
  offline: 2,
};

export function isMachineSelectable(machine: Pick<MachineSelectionCandidate, 'status'>): boolean {
  return machine.status !== 'offline';
}

export function formatMachineSelectionLabel(
  machine: Pick<MachineSelectionCandidate, 'hostname' | 'status'>,
): string {
  return `${machine.hostname} (${machine.status})`;
}

export function sortMachinesForSelection<T extends MachineSelectionCandidate>(machines: T[]): T[] {
  return [...machines].sort((left, right) => {
    const priority = MACHINE_STATUS_PRIORITY[left.status] - MACHINE_STATUS_PRIORITY[right.status];
    if (priority !== 0) {
      return priority;
    }

    return left.hostname.localeCompare(right.hostname);
  });
}

export function pickPreferredMachineId<T extends MachineSelectionCandidate>(
  machines: T[],
  preferredMachineId?: string | null,
): string {
  if (machines.length === 0) {
    return '';
  }

  const preferred = preferredMachineId
    ? machines.find((machine) => machine.id === preferredMachineId)
    : null;
  if (preferred && isMachineSelectable(preferred)) {
    return preferred.id;
  }

  const selectable = machines.find((machine) => isMachineSelectable(machine));
  if (selectable) {
    return selectable.id;
  }

  return preferred?.id ?? machines[0]?.id ?? '';
}
