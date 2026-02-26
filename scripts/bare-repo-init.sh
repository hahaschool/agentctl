#!/usr/bin/env bash
set -euo pipefail

# Initialize a bare repository with worktree pattern for multi-agent development
# Usage: ./scripts/bare-repo-init.sh <git-url> [directory-name]
#
# Creates:
#   project/
#   ├── .bare/       # All git objects
#   ├── .git         # Pointer to .bare
#   ├── main/        # Main branch worktree
#   └── .gitignore   # Ignores worktree directories

URL="${1:?Usage: $0 <git-url> [directory-name]}"
NAME="${2:-$(basename "$URL" .git)}"

echo "Setting up bare repo for: $URL"
echo "Directory: $NAME"

# Create directory structure
mkdir -p "$NAME"
cd "$NAME"

# Clone as bare repo
git clone --bare "$URL" .bare

# Create .git pointer
echo "gitdir: ./.bare" > .git

# Configure fetch refspec (bare repos don't set this by default)
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git config core.logAllRefUpdates true

# Fetch all branches
git fetch origin

# Determine default branch
DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

# Create main worktree
git worktree add "$DEFAULT_BRANCH" "$DEFAULT_BRANCH"

# Add worktree patterns to gitignore (if it exists in the repo)
GITIGNORE="$DEFAULT_BRANCH/.gitignore"
if [[ -f "$GITIGNORE" ]]; then
  if ! grep -q '.trees/' "$GITIGNORE" 2>/dev/null; then
    echo "" >> "$GITIGNORE"
    echo "# Agent worktrees" >> "$GITIGNORE"
    echo ".trees/" >> "$GITIGNORE"
    echo ".claude/worktrees/" >> "$GITIGNORE"
  fi
fi

echo ""
echo "✓ Bare repo ready at: $(pwd)"
echo ""
echo "Usage:"
echo "  # Create a new agent worktree"
echo "  cd $(pwd)"
echo "  git worktree add agent-1 -b agent-1/feature/description"
echo ""
echo "  # List worktrees"
echo "  git worktree list"
echo ""
echo "  # Remove a worktree after merging"
echo "  git worktree remove agent-1"
echo ""
echo "  # Work in the main branch"
echo "  cd $(pwd)/$DEFAULT_BRANCH"
