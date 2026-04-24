import { beforeEach, describe, expect, it } from 'vitest';

import { providerInvalidationBus, resetBusForTesting } from './provider-invalidation-bus.js';

describe('providerInvalidationBus', () => {
  beforeEach(() => {
    resetBusForTesting();
  });

  it('emits provider.changed and can be listened to', () => {
    const received: string[] = [];
    providerInvalidationBus.on('provider.changed', (id) => received.push(id));

    providerInvalidationBus.emit('provider.changed', 'uuid-1');

    expect(received).toEqual(['uuid-1']);
  });

  it('resetBusForTesting removes transient listeners and leaves the standard listener', () => {
    providerInvalidationBus.on('provider.changed', () => undefined);
    providerInvalidationBus.on('provider.changed', () => undefined);

    resetBusForTesting();

    expect(providerInvalidationBus.listenerCount('provider.changed')).toBe(1);
  });
});
