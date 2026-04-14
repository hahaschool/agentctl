#!/usr/bin/env bash
# env-up.test.sh — smoke tests for scripts/env-up.sh --dry-run
#
# Run with: bash scripts/env-up.test.sh
# Exits 0 on success, non-zero on failure.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/env-up.sh"
FAIL=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$label"
  else
    fail "$label (missing: ${needle})"
  fi
}

# ── 1. Syntax check ──────────────────────────────────────────────────
echo "Test 1: bash -n syntax check"
if bash -n "$SCRIPT"; then
  pass "syntax valid"
else
  fail "syntax invalid"
fi

# ── 2. Help flag ─────────────────────────────────────────────────────
echo "Test 2: --help prints usage"
HELP_OUT="$("$SCRIPT" --help 2>&1)"
assert_contains "$HELP_OUT" "--dry-run" "help mentions --dry-run"

# ── 3. Missing tier ──────────────────────────────────────────────────
echo "Test 3: missing tier exits non-zero"
if "$SCRIPT" >/dev/null 2>&1; then
  fail "missing tier should exit non-zero"
else
  pass "missing tier exits non-zero"
fi

# ── 4. Unknown flag ──────────────────────────────────────────────────
echo "Test 4: unknown flag exits non-zero"
if "$SCRIPT" dev-1 --bogus-flag >/dev/null 2>&1; then
  fail "unknown flag should exit non-zero"
else
  pass "unknown flag exits non-zero"
fi

# ── 5. Missing env file ──────────────────────────────────────────────
echo "Test 5: missing env file aborts"
MISS_OUT="$("$SCRIPT" __no_such_tier__ --dry-run 2>&1 || true)"
assert_contains "$MISS_OUT" "env file not found" "missing env file message"

# ── 6. Dry run against an existing tier (only if .env.dev-1 exists) ──
echo "Test 6: --dry-run on dev-1 (skipped if .env.dev-1 missing)"
if [[ -f "${REPO_ROOT}/.env.dev-1" ]]; then
  DRY_OUT="$("$SCRIPT" dev-1 --dry-run 2>&1)"
  DRY_RC=$?
  assert_contains "$DRY_OUT" "DRY RUN MODE" "banner present"
  assert_contains "$DRY_OUT" "No services will be started" "no-start warning present"
  assert_contains "$DRY_OUT" "Env file:" "env file line present"
  assert_contains "$DRY_OUT" "CP port:" "cp port line present"
  assert_contains "$DRY_OUT" "Worker port:" "worker port line present"
  assert_contains "$DRY_OUT" "Web port:" "web port line present"
  assert_contains "$DRY_OUT" "Database:" "database line present"
  assert_contains "$DRY_OUT" "Would start:" "would-start section present"
  assert_contains "$DRY_OUT" "Dry run complete" "completion message present"
  if [[ "$DRY_RC" -eq 0 ]]; then
    pass "dry-run exits 0"
  else
    fail "dry-run exit code was ${DRY_RC}"
  fi

  # Also verify flag order is flexible (--dry-run before tier)
  REORDER_OUT="$("$SCRIPT" --dry-run dev-1 2>&1)"
  assert_contains "$REORDER_OUT" "DRY RUN MODE" "flag-before-tier ordering accepted"
else
  echo "  SKIP: .env.dev-1 not present"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "All env-up.sh dry-run tests passed."
  exit 0
else
  echo "${FAIL} test(s) failed."
  exit 1
fi
