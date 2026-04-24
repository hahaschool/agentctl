import { describe, expect, it } from 'vitest';

import { EMBEDDING_MODEL_CATALOG, validateCatalog } from './providers.js';

describe('EMBEDDING_MODEL_CATALOG', () => {
  it('has openai text-embedding-3-small with verified:true', () => {
    const entry = EMBEDDING_MODEL_CATALOG.find((e) => e.provider === 'openai');
    expect(entry).toBeDefined();
    expect(entry?.verified).toBe(true);
    expect(entry?.dim).toBe(1536);
    expect(entry?.model).toBe('text-embedding-3-small');
  });

  it('has gemini entry with verified:false', () => {
    const gemini = EMBEDDING_MODEL_CATALOG.find((e) => e.provider === 'gemini');
    expect(gemini).toBeDefined();
    expect(gemini?.verified).toBe(false);
  });
});

describe('validateCatalog', () => {
  it('throws CATALOG_INVALID when verified entry has wrong dim', () => {
    expect(() =>
      validateCatalog([
        {
          provider: 'openai',
          model: 'x',
          dim: 768,
          baseUrl: 'https://a.com',
          embeddingsPath: '/v1/e',
          extraBody: {},
          pricePerMtoken: 0.02,
          verified: true,
        },
      ]),
    ).toThrow('CATALOG_INVALID');
  });

  it('passes for valid catalog', () => {
    expect(() => validateCatalog(EMBEDDING_MODEL_CATALOG)).not.toThrow();
  });

  it('does not throw for unverified entry with non-1536 dim', () => {
    expect(() =>
      validateCatalog([
        {
          provider: 'openai',
          model: 'x',
          dim: 768,
          baseUrl: 'https://a.com',
          embeddingsPath: '/v1/e',
          extraBody: {},
          pricePerMtoken: 0.02,
          verified: false,
        },
      ]),
    ).not.toThrow();
  });
});
