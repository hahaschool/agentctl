import { describe, expect, it } from 'vitest';

import type { MachineSelectionCandidate } from './machine-selection.js';
import {
  formatMachineSelectionLabel,
  isMachineSelectable,
  pickPreferredMachineId,
  sortMachinesForSelection,
} from './machine-selection.js';

function makeMachine(
  overrides: Partial<MachineSelectionCandidate> = {},
): MachineSelectionCandidate {
  return {
    id: 'machine-1',
    hostname: 'mac-mini',
    status: 'online',
    ...overrides,
  };
}

describe('machine selection helpers', () => {
  it('treats online and degraded machines as selectable targets', () => {
    expect(isMachineSelectable(makeMachine({ status: 'online' }))).toBe(true);
    expect(isMachineSelectable(makeMachine({ status: 'degraded' }))).toBe(true);
    expect(isMachineSelectable(makeMachine({ status: 'offline' }))).toBe(false);
  });

  it('formats machine labels with hostname and status', () => {
    expect(
      formatMachineSelectionLabel(makeMachine({ hostname: 'ec2-runner', status: 'degraded' })),
    ).toBe('ec2-runner (degraded)');
  });

  it('sorts machines by availability before hostname', () => {
    const machines = sortMachinesForSelection([
      makeMachine({ id: 'machine-3', hostname: 'zzz-offline', status: 'offline' }),
      makeMachine({ id: 'machine-2', hostname: 'bravo-degraded', status: 'degraded' }),
      makeMachine({ id: 'machine-1', hostname: 'alpha-online', status: 'online' }),
    ]);

    expect(machines.map((machine) => machine.id)).toEqual(['machine-1', 'machine-2', 'machine-3']);
  });

  it('prefers the requested machine when it is selectable', () => {
    const machines = sortMachinesForSelection([
      makeMachine({ id: 'machine-1', status: 'online' }),
      makeMachine({ id: 'machine-2', hostname: 'ec2-runner', status: 'degraded' }),
    ]);

    expect(pickPreferredMachineId(machines, 'machine-2')).toBe('machine-2');
  });

  it('falls back to the first selectable machine when preferred target is offline', () => {
    const machines = sortMachinesForSelection([
      makeMachine({ id: 'machine-1', hostname: 'backup', status: 'offline' }),
      makeMachine({ id: 'machine-2', hostname: 'mac-mini', status: 'online' }),
    ]);

    expect(pickPreferredMachineId(machines, 'machine-1')).toBe('machine-2');
  });

  it('falls back to the only machine when every machine is offline', () => {
    const machines = sortMachinesForSelection([
      makeMachine({ id: 'machine-9', hostname: 'offline-only', status: 'offline' }),
    ]);

    expect(pickPreferredMachineId(machines)).toBe('machine-9');
  });
});
