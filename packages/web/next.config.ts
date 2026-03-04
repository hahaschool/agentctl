import { resolve } from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(import.meta.dirname, '../../'),
  transpilePackages: ['@agentctl/shared'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:8080/api/:path*' },
      { source: '/health', destination: 'http://localhost:8080/health' },
      { source: '/metrics', destination: 'http://localhost:8080/metrics' },
    ];
  },
};

export default nextConfig;
