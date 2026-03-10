# Design: Public Repository Preparation

> Date: 2026-03-10
> Status: Approved
> Scope: Repository-wide — license, contribution guidelines, security policy, GitHub templates, README

## Context

AgentCTL is already public on GitHub but lacks standard open-source hygiene:
no LICENSE file, no CONTRIBUTING.md, no SECURITY.md, no issue/PR templates,
and the README still says "Private repository. All rights reserved."

This design covers all changes needed to present the repository professionally
as a source-available project under the Business Source License 1.1.

## License: BSL 1.1

### Parameters

| Field | Value |
|-------|-------|
| Licensor | hahaschool |
| Licensed Work | AgentCTL |
| Change Date | 2030-03-10 |
| Change License | Apache License, Version 2.0 |

### Additional Use Grant

> You may make production use of the Licensed Work, provided Your use does not
> include offering the Licensed Work to third parties on a hosted or embedded
> basis that is competitive with AgentCTL's products.

### Rationale

- BSL 1.1 is source-available: anyone can read, fork, modify, and self-host
- The competitive-SaaS restriction prevents free-riding on the hosted product
- After 4 years, code automatically becomes Apache 2.0 (fully permissive)
- Precedent: HashiCorp (Terraform), Sentry, CockroachDB, MariaDB

### AGPL Dependency Note

`claude-mem` uses AGPL. AgentCTL uses it as an external service/dependency,
not by embedding its source code. This is compatible with BSL 1.1. The
existing warning in `docs/LESSONS_LEARNED.md` remains valid: do not copy
claude-mem source code into this repository.

## File Changes

### 1. New: `LICENSE`

Standard BSL 1.1 text from MariaDB's template with parameters filled in.

### 2. New: `CONTRIBUTING.md`

Sections:
- **How to Contribute** — fork → feature branch → PR workflow
- **Development Setup** — link to README Quick Start
- **Code Style** — Biome formatting, link to `.claude/rules/code-style.md`
- **Commit Convention** — Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`)
- **Pull Request Requirements** — clear description, tests pass, Biome check pass, no secrets
- **DCO Sign-off** — `Signed-off-by: Name <email>` line in commits (lightweight alternative to CLA)
- **Issue First Policy** — open an issue before large changes

### 3. New: `CODE_OF_CONDUCT.md`

Contributor Covenant v2.1 (industry standard, used by Node.js, Kubernetes, etc.)

### 4. New: `SECURITY.md`

- **Reporting** — GitHub Private Vulnerability Reporting (built-in, no email needed)
- **Response SLA** — acknowledgment within 48 hours, fix target within 90 days
- **Scope** — defines what qualifies as a security vulnerability vs. a bug
- **Credit** — responsible disclosure reporters acknowledged in SECURITY.md
- **Supported Versions** — only latest release on `main` branch

### 5. New: `.github/ISSUE_TEMPLATE/bug_report.yml`

YAML-based form (not markdown):
- Description (required)
- Steps to reproduce (required)
- Expected behavior (required)
- Environment: OS, Node version, pnpm version (required)
- Logs/screenshots (optional)

### 6. New: `.github/ISSUE_TEMPLATE/feature_request.yml`

YAML-based form:
- Problem description (required)
- Proposed solution (required)
- Alternatives considered (optional)
- Additional context (optional)

### 7. New: `.github/PULL_REQUEST_TEMPLATE.md`

- What changed and why
- Related issue (closes #N)
- How to test
- Checklist: tests pass, biome check, no hardcoded secrets, conventional commit

### 8. Modified: `README.md`

- Add license badge at top: `[![BSL 1.1](shield-badge)](LICENSE)`
- Replace "Private repository. All rights reserved." with BSL 1.1 description + link
- Add "Contributing" section pointing to `CONTRIBUTING.md`
- Add "Security" section pointing to `SECURITY.md`

### 9. Deleted: `AGENTS.md` (untracked)

This file is a broken copy of `CLAUDE.md` with "Claude Code" replaced by "Codex".
It serves no purpose and contains inaccurate information. Delete it.

## Files NOT Changed

- `package.json` `"private": true` — **keep**. This prevents accidental `npm publish`,
  not GitHub visibility. Standard practice even for public repos.
- Source files — no license headers added. This is a future enhancement if needed.
- `.gitignore` — already correctly configured.
- `.env.example` — already uses placeholder values.

## Implementation Order

1. `LICENSE` — foundation, everything else references it
2. `CODE_OF_CONDUCT.md` — standalone, no dependencies
3. `SECURITY.md` — standalone
4. `CONTRIBUTING.md` — references code style and commit conventions
5. `.github/ISSUE_TEMPLATE/bug_report.yml`
6. `.github/ISSUE_TEMPLATE/feature_request.yml`
7. `.github/PULL_REQUEST_TEMPLATE.md`
8. `README.md` updates
9. Delete `AGENTS.md`

## Testing

- Verify LICENSE renders correctly on GitHub (BSL 1.1 is recognized)
- Verify issue templates appear in "New Issue" dropdown
- Verify PR template auto-populates on new PRs
- Verify README badges render
- Verify `pnpm build` and `pnpm check` still pass (no code changes)
