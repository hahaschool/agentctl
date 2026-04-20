import { describe, expect, it } from 'vitest';

import { redactKeys } from './redaction.js';

describe('redactKeys', () => {
  it('redacts configured secret keys recursively without mutating the input', () => {
    const input = {
      keep: 'visible',
      token: 'raw-token',
      nested: {
        authorization: 'Bearer raw',
        values: [{ password: 'secret' }, { name: 'safe' }],
      },
    };

    const redacted = redactKeys(input);

    expect(redacted).toEqual({
      keep: 'visible',
      token: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
        values: [{ password: '[REDACTED]' }, { name: 'safe' }],
      },
    });
    expect(input.token).toBe('raw-token');
    expect(input.nested.values[0]?.password).toBe('secret');
  });
});
