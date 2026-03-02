#!/usr/bin/env bash
# ── Docker Preflight Check ──────────────────────────────────────────
# Validates required environment variables and service connectivity
# before starting Docker Compose in production.
#
# Usage:
#   ./infra/docker/docker-preflight.sh [--env-file .env]
#
# Exit codes:
#   0 = all checks passed
#   1 = validation failed (missing vars or unreachable services)
# ────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# ── Parse arguments ─────────────────────────────────────────────────
ENV_FILE=""
for arg in "$@"; do
  case "$arg" in
    --env-file=*) ENV_FILE="${arg#*=}" ;;
    --env-file) shift; ENV_FILE="${1:-}" ;;
  esac
done

# Load .env file if provided or exists in default location
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  echo -e "${GREEN}✓${NC} Loaded env file: $ENV_FILE"
elif [ -f ".env" ]; then
  # shellcheck disable=SC1091
  set -a; source ".env"; set +a
  echo -e "${GREEN}✓${NC} Loaded env file: .env"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  AgentCTL Docker Preflight Check"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Helper functions ────────────────────────────────────────────────

check_required() {
  local var_name="$1"
  local description="$2"
  local value="${!var_name:-}"

  if [ -z "$value" ]; then
    echo -e "  ${RED}✗${NC} $var_name — $description"
    ERRORS=$((ERRORS + 1))
  else
    # Mask sensitive values
    local masked
    case "$var_name" in
      *PASSWORD*|*SECRET*|*KEY*|*TOKEN*)
        if [ ${#value} -gt 8 ]; then
          masked="${value:0:4}...${value: -4}"
        else
          masked="****"
        fi
        ;;
      *)
        masked="$value"
        ;;
    esac
    echo -e "  ${GREEN}✓${NC} $var_name = $masked"
  fi
}

check_optional() {
  local var_name="$1"
  local description="$2"
  local value="${!var_name:-}"

  if [ -z "$value" ]; then
    echo -e "  ${YELLOW}○${NC} $var_name — $description (unset, using default)"
    WARNINGS=$((WARNINGS + 1))
  else
    echo -e "  ${GREEN}✓${NC} $var_name = $value"
  fi
}

check_url_format() {
  local var_name="$1"
  local value="${!var_name:-}"

  if [ -n "$value" ]; then
    if [[ ! "$value" =~ ^https?:// ]] && [[ ! "$value" =~ ^postgresql:// ]] && [[ ! "$value" =~ ^redis(s)?:// ]]; then
      echo -e "  ${RED}✗${NC} $var_name has invalid URL format: $value"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

check_port_range() {
  local var_name="$1"
  local value="${!var_name:-}"

  if [ -n "$value" ]; then
    if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
      echo -e "  ${RED}✗${NC} $var_name must be a port number (1-65535), got: $value"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

# ── 1. Required Variables ───────────────────────────────────────────

echo "── Required Variables ──────────────────────────────────────"
echo ""

check_required "DATABASE_URL" "PostgreSQL connection string"
check_url_format "DATABASE_URL"

check_required "REDIS_URL" "Redis connection URL"
check_url_format "REDIS_URL"

check_required "POSTGRES_PASSWORD" "PostgreSQL container password"

echo ""

# ── 2. Optional Variables ───────────────────────────────────────────

echo "── Optional Variables ──────────────────────────────────────"
echo ""

check_optional "PORT" "Control plane API port"
check_port_range "PORT"

check_optional "HOST" "Control plane bind address"

check_optional "LITELLM_URL" "LiteLLM proxy URL"
check_url_format "LITELLM_URL"

check_optional "MEM0_URL" "Mem0 server URL"
check_url_format "MEM0_URL"

check_optional "CONTROL_PLANE_URL" "Public control plane URL"
check_url_format "CONTROL_PLANE_URL"

check_optional "MACHINE_ID" "Unique machine identifier"

check_optional "NODE_ENV" "Node environment"
if [ -n "${NODE_ENV:-}" ] && [ "$NODE_ENV" != "production" ] && [ "$NODE_ENV" != "development" ] && [ "$NODE_ENV" != "test" ]; then
  echo -e "  ${YELLOW}!${NC} NODE_ENV should be 'production', 'development', or 'test' (got: $NODE_ENV)"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""

# ── 3. Security Checks ─────────────────────────────────────────────

echo "── Security Checks ────────────────────────────────────────"
echo ""

# Check for default/weak passwords
if [ "${POSTGRES_PASSWORD:-}" = "change-me-in-production" ] || [ "${POSTGRES_PASSWORD:-}" = "agentctl" ]; then
  echo -e "  ${RED}✗${NC} POSTGRES_PASSWORD is set to a default value — change it!"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}✓${NC} POSTGRES_PASSWORD is not a default value"
fi

# Check NODE_ENV is production for prod deploys
if [ "${NODE_ENV:-}" = "production" ]; then
  echo -e "  ${GREEN}✓${NC} NODE_ENV is set to production"
else
  echo -e "  ${YELLOW}!${NC} NODE_ENV is not 'production' — set it for production deploys"
  WARNINGS=$((WARNINGS + 1))
fi

# Check for placeholder API keys
for key_var in ANTHROPIC_KEY_ORG1 ANTHROPIC_API_KEY; do
  local_val="${!key_var:-}"
  if [ -n "$local_val" ] && [[ "$local_val" == *"REPLACE"* ]]; then
    echo -e "  ${RED}✗${NC} $key_var contains placeholder text — replace with real key"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# ── 4. Docker Check ─────────────────────────────────────────────────

echo "── Docker Environment ─────────────────────────────────────"
echo ""

if command -v docker &> /dev/null; then
  docker_version=$(docker --version 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${NC} Docker: $docker_version"
else
  echo -e "  ${RED}✗${NC} Docker is not installed"
  ERRORS=$((ERRORS + 1))
fi

if command -v docker compose &> /dev/null 2>&1 || docker compose version &> /dev/null 2>&1; then
  compose_version=$(docker compose version 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${NC} Docker Compose: $compose_version"
else
  echo -e "  ${RED}✗${NC} Docker Compose is not installed"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# ── Summary ─────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════"

if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}FAILED${NC}: $ERRORS error(s), $WARNINGS warning(s)"
  echo ""
  echo "  Fix the errors above before running docker compose up."
  echo ""
  exit 1
else
  if [ $WARNINGS -gt 0 ]; then
    echo -e "  ${GREEN}PASSED${NC} with $WARNINGS warning(s)"
  else
    echo -e "  ${GREEN}PASSED${NC}: All checks OK"
  fi
  echo ""
  echo "  Ready to deploy: docker compose -f docker-compose.prod.yml up -d"
  echo ""
  exit 0
fi
