// PM2 Ecosystem Config — Control Plane Machine
//
// This config manages the control plane process on the primary machine
// (typically EC2). It runs the API server, task scheduler, agent registry,
// memory sync, and LLM router.
//
// Usage:
//   pm2 start infra/pm2/ecosystem.control.config.cjs
//   pm2 startup  # enable boot persistence
//   pm2 save     # save current process list
//
// Environment variables should be set in a machine-local .env file
// loaded by the shell profile, NOT hardcoded here. The values below
// are defaults that can be overridden via PM2_ENV or --env flags.

module.exports = {
  apps: [
    {
      // ── Control Plane API Server ──────────────────────────────────
      // Central orchestration server: REST + WebSocket endpoints,
      // BullMQ scheduler, agent registry, memory sync, LLM router.
      name: 'control-plane',
      script: 'pnpm',
      args: '--filter @agentctl/control-plane start',
      cwd: '/opt/agentctl', // Override with PM2_HOME or --cwd flag

      // Environment — production defaults
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        LOG_LEVEL: 'info',

        // Redis (BullMQ task queue + LiteLLM cache)
        REDIS_URL: 'redis://localhost:6379',

        // PostgreSQL (agent registry, run history, audit log)
        DATABASE_URL: 'postgresql://agentctl:agentctl@localhost:5432/agentctl',

        // LiteLLM proxy URL (Docker container on same machine)
        LITELLM_PROXY_URL: 'http://localhost:4000',

        // Mem0 memory server URL
        MEM0_URL: 'http://localhost:8000',
      },

      // Development environment overrides (use with: pm2 start --env dev)
      env_dev: {
        NODE_ENV: 'development',
        PORT: '8080',
        LOG_LEVEL: 'debug',
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_URL: 'postgresql://agentctl:agentctl@localhost:5432/agentctl',
        LITELLM_PROXY_URL: 'http://localhost:4000',
        MEM0_URL: 'http://localhost:8000',
      },

      // ── Restart Behavior ──────────────────────────────────────────
      // Aggressive restart with exponential backoff to survive transient
      // failures (DB reconnect, Redis restart, etc.) without operator
      // intervention.
      max_restarts: 10,              // Max restarts within restart window
      restart_delay: 5000,           // Base delay: 5 seconds
      exp_backoff_restart_delay: 1000, // Exponential backoff base (1s, 2s, 4s, 8s...)
      max_memory_restart: '512M',    // Restart if memory exceeds 512MB

      // ── Logging ───────────────────────────────────────────────────
      // PM2 captures stdout/stderr. The app itself uses pino for
      // structured JSON logging — PM2 logs are the outer container.
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      error_file: '/var/log/agentctl/control-plane-error.log',
      out_file: '/var/log/agentctl/control-plane-out.log',
      merge_logs: true,              // Merge stdout and stderr
      log_type: 'json',             // Structured PM2 log format

      // ── Process Behavior ──────────────────────────────────────────
      kill_timeout: 10000,          // 10s graceful shutdown window
      listen_timeout: 15000,        // Wait 15s for 'ready' signal
      wait_ready: true,             // Wait for process.send('ready')
      autorestart: true,
      watch: false,                 // Never watch in production
    },
  ],
};
