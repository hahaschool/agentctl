# Contributing to AgentCTL

Thank you for your interest in contributing to AgentCTL! This document explains
how to get involved.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/agentctl.git`
3. Install dependencies: `pnpm install`
4. Create a feature branch: `git checkout -b feat/your-feature`

For full development setup instructions, see the [Quick Start](README.md#quick-start)
section in the README.

## Development

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker Desktop (for Redis/PostgreSQL) or local installs

### Running Locally

```bash
cp .env.example .env
docker compose -f infra/docker/docker-compose.dev.yml up -d
pnpm dev:control   # Control plane on :8080
pnpm dev:worker    # Worker on :9000
pnpm --filter @agentctl/web dev  # Web UI on :5173
```

### Code Style

This project uses [Biome](https://biomejs.dev/) for formatting and linting.

```bash
pnpm check       # Check formatting and lint
pnpm check:fix   # Auto-fix issues
```

Key conventions:
- TypeScript with strict mode
- `type` over `interface` (unless extending)
- `const` over `let`, never `var`
- Typed errors with error codes (never bare `throw new Error()`)
- Structured logging via pino (never `console.log`)
- Files: `kebab-case.ts`, types: `PascalCase`, constants: `SCREAMING_SNAKE_CASE`

### Testing

```bash
pnpm test              # All tests
pnpm test:packages     # Package tests only
pnpm --filter @agentctl/web exec playwright test  # E2E tests
```

Write tests for new functionality. Test behavior, not implementation.

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:
- `feat: add execution summary generation`
- `fix: handle null agent status in heartbeat`
- `docs: update API endpoint documentation`

## Pull Requests

### Before Submitting

- [ ] Tests pass (`pnpm test`)
- [ ] Biome check passes (`pnpm check`)
- [ ] No hardcoded secrets or credentials
- [ ] Commit messages follow conventional commits format

### PR Process

1. **Open an issue first** for non-trivial changes (new features, architectural changes).
   Small bug fixes and documentation improvements can go directly to a PR.
2. Fill out the PR template completely.
3. Link to the relevant issue (`closes #N`).
4. Keep PRs focused — one feature or fix per PR.
5. Respond to review feedback.

### DCO Sign-off

By contributing, you certify that your contribution is your original work
and you have the right to submit it under the project's license.

Add a sign-off line to your commits:

```bash
git commit -s -m "feat: add new feature"
```

This adds `Signed-off-by: Your Name <your@email.com>` to the commit message.

## Issue First Policy

For large changes (new features, refactoring, architectural decisions), please
open a GitHub issue to discuss the approach before starting work. This helps
avoid wasted effort and ensures alignment with the project's direction.

## License

By contributing to AgentCTL, you agree that your contributions will be licensed
under the [Business Source License 1.1](LICENSE). On the Change Date (2030-03-10),
contributions will be relicensed under the Apache License, Version 2.0.
