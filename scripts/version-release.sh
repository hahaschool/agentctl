#!/usr/bin/env bash
# version-release.sh — Push tagged commit and create GitHub Release
# Usage: ./scripts/version-release.sh
# Run this only after beta verification passes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="${REPO_ROOT}/CHANGELOG.md"

cd "$REPO_ROOT"

TAG="$(git describe --exact-match HEAD 2>/dev/null || true)"
if [[ -z "$TAG" ]]; then
  echo "Error: Current HEAD has no version tag."
  echo "Run ./scripts/version-bump.sh first"
  exit 1
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Current HEAD tag is not a version tag: ${TAG}"
  exit 1
fi

VERSION="${TAG#v}"

echo "Releasing ${TAG}..."

echo "Pushing branch + tags to origin..."
git push -u origin HEAD --follow-tags

RELEASE_NOTES=""
if [[ -f "$CHANGELOG" ]]; then
  RELEASE_NOTES="$(awk -v version="$VERSION" '
    $0 ~ ("^## \\[" version "\\]") { capture=1; next }
    capture && /^## \[/ { exit }
    capture { print }
  ' "$CHANGELOG")"
fi

if [[ -z "${RELEASE_NOTES//[[:space:]]/}" ]]; then
  RELEASE_NOTES="Release ${VERSION}"
fi

if command -v gh &>/dev/null; then
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "GitHub Release ${TAG} already exists. Skipping creation."
  else
    echo "Creating GitHub Release ${TAG}..."
    gh release create "$TAG" \
      --title "$TAG" \
      --notes "$RELEASE_NOTES"
    echo "✓ GitHub Release ${TAG} created"
  fi
else
  echo "⚠ gh CLI not found — create release manually at:"
  echo "  https://github.com/hahaschool/agentctl/releases/new?tag=${TAG}"
fi

echo ""
echo "✓ Release step complete for ${TAG}"
