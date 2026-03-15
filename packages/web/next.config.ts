import { resolve } from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(import.meta.dirname, '../../'),
  transpilePackages: ['@agentctl/shared'],
  // API proxying moved to src/middleware.ts for runtime env var support.
  // Each tier (dev-1, dev-2, beta) sets NEXT_PUBLIC_API_URL at runtime.
};

export default nextConfig;
