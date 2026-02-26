#!/usr/bin/env bash
set -euo pipefail

# AgentCTL Machine Setup Script
# Usage: ./scripts/setup-machine.sh [control|worker] [hostname]

ROLE="${1:-worker}"
HOSTNAME="${2:-$(hostname)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "══════════════════════════════════════════════"
echo "  AgentCTL Machine Setup"
echo "  Role: $ROLE"
echo "  Hostname: $HOSTNAME"
echo "══════════════════════════════════════════════"

# --- 1. System Dependencies ---
echo ""
echo "▸ Installing system dependencies..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  command -v brew >/dev/null 2>&1 || {
    echo "  Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  }
  brew install git node@20 pnpm redis postgresql@16 2>/dev/null || true

  if [[ "$ROLE" == "control" ]]; then
    brew services start redis
    brew services start postgresql@16
  fi
else
  # Linux (Ubuntu/Debian)
  sudo apt update -qq
  sudo apt install -y -qq git curl build-essential

  # Node.js 20 via fnm
  if ! command -v node >/dev/null 2>&1; then
    echo "  Installing Node.js via fnm..."
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
    fnm install 20
    fnm use 20
  fi

  # pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    npm install -g pnpm
  fi

  if [[ "$ROLE" == "control" ]]; then
    sudo apt install -y -qq redis-server postgresql
    sudo systemctl enable --now redis-server postgresql
  fi
fi

# --- 2. Claude Code ---
echo ""
echo "▸ Installing Claude Code..."
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code
  echo "  ⚠ Run 'claude' once to authenticate with your Anthropic API key"
else
  echo "  Already installed: $(claude --version 2>/dev/null || echo 'unknown version')"
fi

# --- 3. Tailscale ---
echo ""
echo "▸ Setting up Tailscale..."
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

TAG="tag:$ROLE"
echo "  Bringing up Tailscale with hostname=$HOSTNAME, tag=$TAG..."
echo "  ⚠ You may need to authenticate in the browser"
sudo tailscale up --hostname="$HOSTNAME" --advertise-tags="$TAG" --ssh

echo "  Tailscale IP: $(tailscale ip -4)"
echo "  Hostname: $HOSTNAME (accessible as $HOSTNAME via MagicDNS)"

# --- 4. PM2 ---
echo ""
echo "▸ Installing PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
pm2 install pm2-logrotate 2>/dev/null || true

# --- 5. Project Setup ---
echo ""
echo "▸ Setting up project..."
cd "$PROJECT_DIR"
pnpm install

# --- 6. Role-Specific Setup ---
echo ""
if [[ "$ROLE" == "control" ]]; then
  echo "▸ Control plane setup..."

  # Create database
  createdb agentctl 2>/dev/null || echo "  Database 'agentctl' already exists"

  # Generate PM2 ecosystem config
  cat > "$PROJECT_DIR/ecosystem.config.cjs" << PMEOF
module.exports = {
  apps: [{
    name: 'control-plane',
    script: 'pnpm',
    args: 'dev:control',
    cwd: '$PROJECT_DIR',
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://localhost:5432/agentctl',
    },
    max_restarts: 10,
    restart_delay: 5000,
  }],
};
PMEOF

  echo "  Start with: pm2 start ecosystem.config.cjs"

else
  echo "▸ Worker setup..."

  # Check control plane reachability
  if ping -c 1 control >/dev/null 2>&1; then
    echo "  ✓ Control plane reachable at 'control'"
  else
    echo "  ⚠ Cannot reach 'control' — ensure the control machine is on Tailscale"
  fi

  # Generate PM2 ecosystem config
  cat > "$PROJECT_DIR/ecosystem.config.cjs" << PMEOF
module.exports = {
  apps: [{
    name: 'agent-worker',
    script: 'pnpm',
    args: 'dev:worker',
    cwd: '$PROJECT_DIR',
    env: {
      NODE_ENV: 'production',
      CONTROL_URL: 'http://control:8080',
      REDIS_URL: 'redis://control:6379',
      AGENT_ID: '$HOSTNAME',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    },
    max_restarts: 10,
    restart_delay: 5000,
  }],
};
PMEOF

  echo "  ⚠ Set ANTHROPIC_API_KEY in ecosystem.config.cjs before starting"
  echo "  Start with: pm2 start ecosystem.config.cjs"
fi

# --- 7. PM2 Startup ---
echo ""
echo "▸ Configuring PM2 startup..."
pm2 startup 2>/dev/null | tail -1 || true

# --- Summary ---
echo ""
echo "══════════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Tailscale IP:  $(tailscale ip -4)"
echo "  Hostname:      $HOSTNAME"
echo "  Role:          $ROLE"
echo ""
echo "  Next steps:"
echo "  1. Edit ecosystem.config.cjs with your API keys"
echo "  2. pm2 start ecosystem.config.cjs"
echo "  3. pm2 save"
echo "══════════════════════════════════════════════"
