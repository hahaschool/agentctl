// PM2 Ecosystem Config — Worker Machine
//
// This config manages the agent worker daemon on each worker machine
// (Mac Mini, laptop, EC2 instances, etc.). The worker runs agent
// instances via the Claude Agent SDK, manages git worktrees, and
// reports health back to the control plane.
//
// Usage:
//   pm2 start infra/pm2/ecosystem.worker.config.cjs
//   pm2 startup  # enable boot persistence
//   pm2 save     # save current process list
//
// IMPORTANT: Set MACHINE_ID to a unique identifier for each machine.
// This is used for agent registration and task routing.
//
// Environment variables should be set in a machine-local .env file
// loaded by the shell profile, NOT hardcoded here.

module.exports = {
  apps: [
    {
      // ── Agent Worker Daemon ───────────────────────────────────────
      // Manages local agent instances, consumes tasks from BullMQ,
      // reports heartbeats, and streams agent output via SSE.
      name: 'agent-worker',
      script: 'pnpm',
      args: '--filter @agentctl/agent-worker start',
      cwd: '/opt/agentctl', // Override per machine with --cwd flag

      // Environment — production defaults
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',

        // ── Identity ──────────────────────────────────────────────
        // MACHINE_ID must be unique per machine. Use hostname or UUID.
        // This is how the control plane identifies and routes to this worker.
        MACHINE_ID: 'SET_THIS_PER_MACHINE',

        // ── Networking ────────────────────────────────────────────
        // Worker API port (task execution, agent management)
        WORKER_PORT: '9000',
        // Prometheus metrics endpoint
        METRICS_PORT: '9090',
        // SSE stream endpoint for agent output
        SSE_PORT: '9100',

        // ── Control Plane Connection ──────────────────────────────
        // URL of the control plane API. Use Tailscale MagicDNS hostname
        // for production, localhost for dev.
        CONTROL_URL: 'http://ec2-control:8080',

        // Redis URL for BullMQ task consumption
        // Workers connect to the same Redis as the control plane.
        REDIS_URL: 'redis://ec2-control:6379',

        // ── LLM Provider ─────────────────────────────────────────
        // Workers can call LLM directly (for Claude Agent SDK) or
        // route through LiteLLM proxy. Set one or both.
        //
        // Direct Anthropic API key (used by Claude Agent SDK subprocess)
        // NEVER hardcode — set in machine-local .env
        ANTHROPIC_API_KEY: '',
        // LiteLLM proxy for multi-provider routing
        LITELLM_PROXY_URL: 'http://ec2-control:4000',

        // ── Agent Limits ─────────────────────────────────────────
        // Max concurrent agent instances on this machine
        MAX_CONCURRENT_AGENTS: '3',
        // Heartbeat interval to control plane (ms)
        HEARTBEAT_INTERVAL_MS: '15000',
        // Agent execution timeout (ms) — kill if stuck
        AGENT_TIMEOUT_MS: '3600000', // 1 hour
        // Max auto-restarts per agent before giving up
        AGENT_MAX_RESTARTS: '3',

        // ── Workspace ────────────────────────────────────────────
        // Base directory for agent worktrees
        WORKTREE_BASE_DIR: '/opt/agentctl/.trees',
        // Audit log directory
        AUDIT_LOG_DIR: '/var/log/agentctl',
      },

      // Development environment overrides (use with: pm2 start --env dev)
      env_dev: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
        MACHINE_ID: 'dev-laptop',
        WORKER_PORT: '9000',
        METRICS_PORT: '9090',
        SSE_PORT: '9100',
        CONTROL_URL: 'http://localhost:8080',
        REDIS_URL: 'redis://localhost:6379',
        ANTHROPIC_API_KEY: '',
        LITELLM_PROXY_URL: 'http://localhost:4000',
        MAX_CONCURRENT_AGENTS: '2',
        HEARTBEAT_INTERVAL_MS: '15000',
        AGENT_TIMEOUT_MS: '3600000',
        AGENT_MAX_RESTARTS: '3',
        WORKTREE_BASE_DIR: './.trees',
        AUDIT_LOG_DIR: './logs',
      },

      // ── Restart Behavior ──────────────────────────────────────────
      // Workers must survive transient control plane outages and
      // network blips. Exponential backoff prevents thundering herd
      // when the control plane comes back online.
      max_restarts: 15,              // Higher than control plane — workers are more resilient
      restart_delay: 3000,           // Base delay: 3 seconds
      exp_backoff_restart_delay: 1000, // Exponential backoff base
      max_memory_restart: '1G',      // Agent subprocesses can use significant memory

      // ── Logging ───────────────────────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      error_file: '/var/log/agentctl/agent-worker-error.log',
      out_file: '/var/log/agentctl/agent-worker-out.log',
      merge_logs: true,
      log_type: 'json',

      // ── Process Behavior ──────────────────────────────────────────
      // Longer kill timeout because running agents need time to
      // gracefully save state and clean up worktrees.
      kill_timeout: 30000,          // 30s — agents may need time to finish current turn
      listen_timeout: 10000,        // Wait 10s for 'ready' signal
      wait_ready: true,
      autorestart: true,
      watch: false,
    },
  ],
};
