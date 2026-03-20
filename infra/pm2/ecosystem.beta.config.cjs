// PM2 Ecosystem Config — Beta Tier (Developer's Daily-Use Environment)
//
// Runs built artifacts on standard ports (CP 8080, Worker 9000, Web 5173).
// Stable, auto-restarting, unaffected by dev tier agent work.
//
// Usage:
//   pm2 start infra/pm2/ecosystem.beta.config.cjs
//   pm2 save     # persist across reboots
//   pm2 startup  # enable boot persistence (follow the output instructions)
//
// See docs/plans/2026-03-12-dev-environment-cd-strategy.md for full context.

const path = require('node:path');
const { deriveStableDispatchSigningSecretKey } = require('./dispatch-signing-key.cjs');
const REPO_ROOT = path.resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      // ── Control Plane ────────────────────────────────────────────
      name: 'agentctl-cp-beta',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/control-plane'),
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
        REDIS_URL: 'redis://localhost:6379/0',
        DATABASE_URL: 'postgresql://hahaschool@127.0.0.1:5433/agentctl',
        CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
        DISPATCH_SIGNING_SECRET_KEY:
          process.env.DISPATCH_SIGNING_SECRET_KEY ||
          deriveStableDispatchSigningSecretKey('beta'),
        CONTROL_PLANE_URL: 'http://127.0.0.1:8080',
        SKIP_MIGRATIONS: 'true',
        TIER_LABEL: 'beta',
        REPO_ROOT: REPO_ROOT,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      error_file: path.join(REPO_ROOT, 'logs/beta/cp-error.log'),
      out_file: path.join(REPO_ROOT, 'logs/beta/cp-out.log'),
      merge_logs: true,
    },

    {
      // ── Agent Worker ─────────────────────────────────────────────
      name: 'agentctl-worker-beta',
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/agent-worker'),
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_PORT: '9000',
        CONTROL_URL: 'http://localhost:8080',
        CONTROL_PLANE_URL: 'http://localhost:8080',
        MACHINE_ID: 'mac-local',
        TIER_LABEL: 'beta',
        REPO_ROOT: REPO_ROOT,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      error_file: path.join(REPO_ROOT, 'logs/beta/worker-error.log'),
      out_file: path.join(REPO_ROOT, 'logs/beta/worker-out.log'),
      merge_logs: true,
    },

    {
      // ── Web App (Next.js) ────────────────────────────────────────
      name: 'agentctl-web-beta',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 5173',
      cwd: path.join(REPO_ROOT, 'packages/web'),
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: 'http://localhost:8080',
        NEXT_PUBLIC_WS_URL: 'ws://localhost:8080',
        TIER_LABEL: 'beta',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '256M',
      kill_timeout: 5000,
      error_file: path.join(REPO_ROOT, 'logs/beta/web-error.log'),
      out_file: path.join(REPO_ROOT, 'logs/beta/web-out.log'),
      merge_logs: true,
    },
  ],
};
