#!/usr/bin/env bash
# version-bump.sh — Bump monorepo version, update changelog, create git tag
# Usage: ./scripts/version-bump.sh <patch|minor|major> ["Description of changes"]
# Example: ./scripts/version-bump.sh minor "MCP/skill auto-discovery, runtime selector penetration"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Args ─────────────────────────────────────────────────────────────
BUMP_TYPE="${1:-}"
DESCRIPTION="${2:-}"

if [[ -z "$BUMP_TYPE" ]] || [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 <patch|minor|major> [\"description\"]"
  echo "  patch  — bug fixes, minor adjustments"
  echo "  minor  — new features, UI changes"
  echo "  major  — breaking changes, major refactors"
  exit 1
fi

# ── Read current version ─────────────────────────────────────────────
# Use shared package as source of truth
CURRENT=$(node -e "console.log(require('${REPO_ROOT}/packages/shared/package.json').version)")
echo "Current version: ${CURRENT}"

# ── Compute new version ──────────────────────────────────────────────
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo "New version: ${NEW_VERSION}"

# ── Update all package.json files ────────────────────────────────────
PACKAGES=(
  "${REPO_ROOT}/packages/shared/package.json"
  "${REPO_ROOT}/packages/control-plane/package.json"
  "${REPO_ROOT}/packages/agent-worker/package.json"
  "${REPO_ROOT}/packages/web/package.json"
  "${REPO_ROOT}/packages/mobile/package.json"
)

for pkg in "${PACKAGES[@]}"; do
  if [[ -f "$pkg" ]]; then
    # Use node to update version (preserves formatting)
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('${pkg}', 'utf8'));
      p.version = '${NEW_VERSION}';
      fs.writeFileSync('${pkg}', JSON.stringify(p, null, 2) + '\n');
    "
    echo "  Updated: $(basename $(dirname $pkg))/package.json → ${NEW_VERSION}"
  fi
done

# ── Update sidebar version label ─────────────────────────────────────
SIDEBAR_FILE="${REPO_ROOT}/packages/web/src/components/Sidebar.tsx"
if [[ -f "$SIDEBAR_FILE" ]]; then
  sed -i '' "s/v[0-9]*\.[0-9]*\.[0-9]*/v${NEW_VERSION}/" "$SIDEBAR_FILE"
  echo "  Updated: web/src/components/Sidebar.tsx → v${NEW_VERSION}"
fi

# ── Update CHANGELOG.md ──────────────────────────────────────────────
CHANGELOG="${REPO_ROOT}/CHANGELOG.md"
DATE=$(date +%Y-%m-%d)

if [[ ! -f "$CHANGELOG" ]]; then
  echo "# Changelog" > "$CHANGELOG"
  echo "" >> "$CHANGELOG"
  echo "All notable changes to AgentCTL are documented in this file." >> "$CHANGELOG"
  echo "" >> "$CHANGELOG"
fi

# Build changelog entry
ENTRY="## [${NEW_VERSION}] — ${DATE}\n"

if [[ -n "$DESCRIPTION" ]]; then
  ENTRY="${ENTRY}\n${DESCRIPTION}\n"
fi

# Get commits since last tag (if any)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  COMMITS=$(git log "${LAST_TAG}..HEAD" --oneline --no-merges 2>/dev/null | head -20)
else
  COMMITS=$(git log --oneline --no-merges -20 2>/dev/null)
fi

if [[ -n "$COMMITS" ]]; then
  ENTRY="${ENTRY}\n### Changes\n"
  while IFS= read -r line; do
    ENTRY="${ENTRY}\n- ${line}"
  done <<< "$COMMITS"
  ENTRY="${ENTRY}\n"
fi

# Prepend to changelog (after header)
TEMP=$(mktemp)
head -4 "$CHANGELOG" > "$TEMP"
echo "" >> "$TEMP"
echo -e "$ENTRY" >> "$TEMP"
tail -n +5 "$CHANGELOG" >> "$TEMP" 2>/dev/null || true
mv "$TEMP" "$CHANGELOG"

echo "  Updated: CHANGELOG.md"

# ── Git commit + tag ─────────────────────────────────────────────────
cd "$REPO_ROOT"
git add packages/*/package.json packages/web/src/components/Sidebar.tsx CHANGELOG.md
git commit -m "chore: bump version to ${NEW_VERSION}

${DESCRIPTION}"

git tag -a "v${NEW_VERSION}" -m "Release ${NEW_VERSION}: ${DESCRIPTION:-"Version bump"}"

# ── Push + create GitHub Release ─────────────────────────────────────
echo ""
echo "Pushing to origin..."
git push origin main --tags 2>&1

# Extract this version's changelog section for release notes
RELEASE_NOTES=$(echo -e "$ENTRY" | sed 's/^## .*//' | sed '/^$/d')

if command -v gh &> /dev/null; then
  echo "Creating GitHub Release..."
  gh release create "v${NEW_VERSION}" \
    --title "v${NEW_VERSION}" \
    --notes "${RELEASE_NOTES:-$DESCRIPTION}" \
    2>&1 || echo "  ⚠ GitHub Release creation failed (may need gh auth)"
  echo "✓ GitHub Release v${NEW_VERSION} created"
else
  echo "⚠ gh CLI not found — create release manually at:"
  echo "  https://github.com/hahaschool/agentctl/releases/new?tag=v${NEW_VERSION}"
fi

echo ""
echo "✓ Version bumped to ${NEW_VERSION}"
echo "✓ CHANGELOG.md updated"
echo "✓ Git tag v${NEW_VERSION} pushed"
echo ""
echo "Next steps:"
echo "  ./scripts/env-promote.sh --from dev-1"
