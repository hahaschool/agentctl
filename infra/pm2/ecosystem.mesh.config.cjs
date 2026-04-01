// PM2 Ecosystem Config — Mesh Node
//
// Runs a complete agentctl mesh node (CP + Worker) with local PG + Redis.
// Each machine in the Tailscale mesh runs this config with its own .env.mesh.
//
// Usage:
//   ./scripts/setup-mesh-node.sh   # generates .env.mesh
//   pnpm build
//   pm2 start infra/pm2/ecosystem.mesh.config.cjs
//   pm2 save     # persist across reboots
//   pm2 startup  # enable boot persistence (follow the output instructions)

const fs = require('node:fs');
const path = require('node:path');
const { deriveStableDispatchSigningSecretKey } = require('./dispatch-signing-key.cjs');
const REPO_ROOT = path.resolve(__dirname, '../..');

// Load .env.mesh so secrets and mesh identity are available to PM2
const envMeshPath = path.join(REPO_ROOT, '.env.mesh');
try {
  const envContent = fs.readFileSync(envMeshPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* .env.mesh is required — setup-mesh-node.sh creates it */ }

const MACHINE_ID = process.env.MACHINE_ID || '';
const PORT = process.env.PORT || '8080';
const WORKER_PORT = process.env.WORKER_PORT || '9000';

module.exports = {
  apps: [
    {
      // ── Control Plane ────────────────────────────────────────────
      name: `agentctl-cp-mesh`,
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/control-plane'),
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'info',
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379/0',
        DATABASE_URL: process.env.DATABASE_URL || '',
        MACHINE_ID,
        TAILSCALE_IP: process.env.TAILSCALE_IP || '',
        CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
        DISPATCH_SIGNING_SECRET_KEY:
          process.env.DISPATCH_SIGNING_SECRET_KEY ||
          deriveStableDispatchSigningSecretKey('mesh'),
        CONTROL_PLANE_URL: `http://127.0.0.1:${PORT}`,
        TIER_LABEL: 'mesh',
        REPO_ROOT,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      error_file: path.join(REPO_ROOT, 'logs/mesh/cp-error.log'),
      out_file: path.join(REPO_ROOT, 'logs/mesh/cp-out.log'),
      merge_logs: true,
    },

    {
      // ── Agent Worker ─────────────────────────────────────────────
      name: `agentctl-worker-mesh`,
      script: 'dist/index.js',
      cwd: path.join(REPO_ROOT, 'packages/agent-worker'),
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_PORT,
        CONTROL_URL: `http://localhost:${PORT}`,
        CONTROL_PLANE_URL: `http://localhost:${PORT}`,
        MACHINE_ID,
        TAILSCALE_IP: process.env.TAILSCALE_IP || '',
        TIER_LABEL: 'mesh',
        REPO_ROOT,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      error_file: path.join(REPO_ROOT, 'logs/mesh/worker-error.log'),
      out_file: path.join(REPO_ROOT, 'logs/mesh/worker-out.log'),
      merge_logs: true,
    },
  ],
};
