const path = require('node:path');
const { deriveStableDispatchSigningSecretKey } = require('./dispatch-signing-key.cjs');
const REPO_ROOT = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      name: 'agentctl-cp-dev2',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/control-plane'),
      env: {
        NODE_ENV: 'development',
        PORT: '8250',
        HOST: '0.0.0.0',
        DATABASE_URL: 'postgresql://hahaschool@127.0.0.1:5433/agentctl_dev2',
        REDIS_URL: 'redis://localhost:6379/2',
        LOG_LEVEL: 'info',
        // Stable non-secret tier label; helper derives the Ed25519 key material locally.
        DISPATCH_SIGNING_SECRET_KEY:
          process.env.DISPATCH_SIGNING_SECRET_KEY ||
          deriveStableDispatchSigningSecretKey('dev-2'),
        SKIP_MIGRATIONS: 'true',
        TIER_LABEL: 'dev-2',
        REPO_ROOT: REPO_ROOT,
      },
    },
    {
      name: 'agentctl-worker-dev2',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/agent-worker'),
      env: {
        NODE_ENV: 'development',
        WORKER_PORT: '9200',
        HOST: '0.0.0.0',
        CONTROL_PLANE_URL: 'http://localhost:8250',
        CONTROL_URL: 'http://localhost:8250',
        MACHINE_ID: 'mac-local-dev2',
        TIER_LABEL: 'dev-2',
      },
    },
    {
      name: 'agentctl-web-dev2',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 5373',
      cwd: path.join(REPO_ROOT, 'packages/web'),
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '5373',
        NEXT_PUBLIC_API_URL: 'http://localhost:8250',
        HOSTNAME: '0.0.0.0',
      },
    },
  ],
};
