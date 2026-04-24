import { EventEmitter } from 'node:events';

export type ProviderChangedId = string | 'active';

export const providerInvalidationBus = new EventEmitter();
providerInvalidationBus.setMaxListeners(20);

function standardListener(_id: ProviderChangedId): void {
  // The factory registers its cache listener separately. This stable listener
  // keeps test resets deterministic and documents the event shape.
}

providerInvalidationBus.on('provider.changed', standardListener);

export function resetBusForTesting(): void {
  providerInvalidationBus.removeAllListeners('provider.changed');
  providerInvalidationBus.on('provider.changed', standardListener);
}
