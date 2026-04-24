// packages/shared/src/memory/providers.ts

export type EmbeddingProviderKind = 'openai' | 'gemini';

export type EmbeddingCatalogEntry = {
  provider: EmbeddingProviderKind;
  model: string;
  dim: number;
  baseUrl: string;
  embeddingsPath: string;
  extraBody: Record<string, unknown>;
  pricePerMtoken: number; // USD per million tokens
  verified: boolean; // false = hidden from UI until Gate 2 passes
};

export const EMBEDDING_MODEL_CATALOG: EmbeddingCatalogEntry[] = [
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dim: 1536,
    baseUrl: 'https://api.openai.com',
    embeddingsPath: '/v1/embeddings',
    extraBody: {},
    pricePerMtoken: 0.02,
    verified: true,
  },
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dim: 1536,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    embeddingsPath: '/embeddings',
    extraBody: { output_dimensionality: 1536 },
    pricePerMtoken: 0.15,
    verified: false, // Gate 2 required before flipping to true
  },
];

/** Validates that all verified entries have dim=1536. Throws with CATALOG_INVALID prefix if not. */
export function validateCatalog(catalog: EmbeddingCatalogEntry[] = EMBEDDING_MODEL_CATALOG): void {
  for (const entry of catalog) {
    if (entry.verified && entry.dim !== 1536) {
      throw new Error(
        `CATALOG_INVALID: verified entry ${entry.provider}/${entry.model} has dim=${entry.dim}, expected 1536`,
      );
    }
  }
}

export type EmbeddingProvider = {
  id: string;
  name: string;
  provider: EmbeddingProviderKind;
  model: string;
  apiKeyLast4: string | null;
  isActive: boolean;
  metadata: EmbeddingProviderMetadata;
  createdAt: string;
  updatedAt: string;
};

export type EmbeddingProviderMetadata = {
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  dim: number | null;
  latencyMs: number | null;
  costUsd: number | null;
};

export type EgressSnapshot = {
  kind: 'embedding-backfill' | 'drawer-backfill';
  providerKind: string;
  providerModel: string;
  providerHost: string;
  priceUsdPerMtoken: number;
  rowCount?: number;
  chunkCount?: number;
  fileCount?: number;
  totalBytes?: number;
  tokenEstimate: number;
  costEstimate: number;
  contentClass: 'memory-facts' | 'drawer-source-files';
  computedAt: string;
};
