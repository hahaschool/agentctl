const path = require('node:path');
const REPO_ROOT = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      name: 'agentctl-cp-dev1',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/control-plane'),
      env: {
        NODE_ENV: 'development',
        PORT: '8180',
        HOST: '0.0.0.0',
        DATABASE_URL: 'postgresql://hahaschool@127.0.0.1:5433/agentctl_dev1',
        REDIS_URL: 'redis://localhost:6379/1',
        LOG_LEVEL: 'info',
        SKIP_MIGRATIONS: 'true',
        TIER_LABEL: 'dev-1',
        REPO_ROOT: REPO_ROOT,
      },
    },
    {
      name: 'agentctl-worker-dev1',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/agent-worker'),
      env: {
        NODE_ENV: 'development',
        WORKER_PORT: '9100',
        HOST: '0.0.0.0',
        CONTROL_PLANE_URL: 'http://localhost:8180',
        CONTROL_URL: 'http://localhost:8180',
        MACHINE_ID: 'mac-local-dev1',
        TIER_LABEL: 'dev-1',
      },
    },
    {
      name: 'agentctl-web-dev1',
      script: 'node_modules/.bin/next',
      args: 'start -p 5273',
      cwd: path.join(REPO_ROOT, 'packages/web'),
      env: {
        NODE_ENV: 'production',
        PORT: '5273',
        NEXT_PUBLIC_API_URL: 'http://localhost:8180',
      },
    },
  ],
};
