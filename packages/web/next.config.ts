import { resolve } from 'node:path';

import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(import.meta.dirname, '../../'),
  transpilePackages: ['@agentctl/shared'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/health', destination: `${apiUrl}/health` },
      { source: '/metrics', destination: `${apiUrl}/metrics` },
    ];
  },
};

export default nextConfig;
