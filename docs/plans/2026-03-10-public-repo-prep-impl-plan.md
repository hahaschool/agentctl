# Public Repository Preparation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BSL 1.1 license, contribution guidelines, security policy, GitHub templates, and update README to present AgentCTL as a professional source-available project.

**Architecture:** Static documentation files only — no code changes. All files go in the repository root or `.github/` directory. Each task produces one committable file.

**Tech Stack:** Markdown, YAML (GitHub issue forms), BSL 1.1 license text

**Spec:** `docs/superpowers/specs/2026-03-10-public-repo-prep-design.md`

---

## Chunk 1: License & Governance Files

### Task 1: Create LICENSE file

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create the LICENSE file**

Write `LICENSE` with BSL 1.1 text (from MariaDB template, parameterized for AgentCTL):

```text
License text copyright (c) 2020 MariaDB Corporation Ab, All Rights Reserved.
"Business Source License" is a trademark of MariaDB Corporation Ab.

Parameters

Licensor:             hahaschool
Licensed Work:        AgentCTL. The Licensed Work is (c) 2026 hahaschool.
Additional Use Grant: You may make production use of the Licensed Work,
                      provided Your use does not include offering the
                      Licensed Work to third parties on a hosted or
                      embedded basis that is competitive with AgentCTL's
                      products.

                      For purposes of this license:

                      A "competitive offering" is a product that is offered
                      to third parties on a paid basis, including through
                      paid support arrangements, that significantly overlaps
                      with the capabilities of AgentCTL. If your product is
                      not a competitive offering when you first make it
                      generally available, it will not become a competitive
                      offering later due to AgentCTL releasing a new version
                      with additional capabilities. In addition, products
                      that are not provided on a paid basis are not
                      competitive.

                      "Embedded" means including the source code or
                      executable code from the Licensed Work in a
                      competitive offering. "Embedded" also means packaging
                      the competitive offering in such a way that the
                      Licensed Work must be accessed or downloaded for the
                      competitive offering to operate.

                      Hosting or using the Licensed Work for internal
                      purposes within an organization is not considered a
                      competitive offering.
Change Date:          2030-03-10
Change License:       Apache License, Version 2.0

Notice

Business Source License 1.1

Terms

The Licensor hereby grants you the right to copy, modify, create derivative
works, redistribute, and make non-production use of the Licensed Work. The
Licensor may make an Additional Use Grant, above, permitting limited
production use.

Effective on the Change Date, or the fourth anniversary of the first publicly
available distribution of a specific version of the Licensed Work under this
License, whichever comes first, the Licensor hereby grants you rights under
the terms of the Change License, and the rights granted in the paragraph
above terminate.

If your use of the Licensed Work does not comply with the requirements
currently in effect as described in this License, you must purchase a
commercial license from the Licensor, its affiliated entities, or authorized
resellers, or you must refrain from using the Licensed Work.

All copies of the original and modified Licensed Work, and derivative works
of the Licensed Work, are subject to this License. This License applies
separately for each version of the Licensed Work and the Change Date may vary
for each version of the Licensed Work released by Licensor.

You must conspicuously display this License on each original or modified copy
of the Licensed Work. If you receive the Licensed Work in original or
modified form from a third party, the terms and conditions set forth in this
License apply to your use of that work.

Any use of the Licensed Work in violation of this License will automatically
terminate your rights under this License for the current and all other
versions of the Licensed Work.

This License does not grant you any right in any trademark or logo of
Licensor or its affiliates (provided that you may use a trademark or logo of
Licensor as expressly required by this License).

TO THE EXTENT PERMITTED BY APPLICABLE LAW, THE LICENSED WORK IS PROVIDED ON
AN "AS IS" BASIS. LICENSOR HEREBY DISCLAIMS ALL WARRANTIES AND CONDITIONS,
EXPRESS OR IMPLIED, INCLUDING (WITHOUT LIMITATION) WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND
TITLE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add BSL 1.1 license"
```

---

### Task 2: Create CODE_OF_CONDUCT.md

**Files:**
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1: Create CODE_OF_CONDUCT.md**

Write `CODE_OF_CONDUCT.md` with the full Contributor Covenant v2.1 text below.
Replace `[INSERT CONTACT METHOD]` with `https://github.com/hahaschool/agentctl/issues`.

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone, regardless of age, body
size, visible or invisible disability, ethnicity, sex characteristics, gender
identity and expression, level of experience, education, socio-economic status,
nationality, personal appearance, race, caste, color, religion, or sexual
identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming,
diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment for our
community include:

* Demonstrating empathy and kindness toward other people
* Being respectful of differing opinions, viewpoints, and experiences
* Giving and gracefully accepting constructive feedback
* Accepting responsibility and apologizing to those affected by our mistakes,
  and learning from the experience
* Focusing on what is best not just for us as individuals, but for the overall
  community

Examples of unacceptable behavior include:

* The use of sexualized language or imagery, and sexual attention or advances of
  any kind
* Trolling, insulting or derogatory comments, and personal or political attacks
* Public or private harassment
* Publishing others' private information, such as a physical or email address,
  without their explicit permission
* Other conduct which could reasonably be considered inappropriate in a
  professional setting

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards of
acceptable behavior and will take appropriate and fair corrective action in
response to any behavior that they deem inappropriate, threatening, offensive,
or harmful.

Community leaders have the right and responsibility to remove, edit, or reject
comments, commits, code, wiki edits, issues, and other contributions that are
not aligned to this Code of Conduct, and will communicate reasons for moderation
decisions when appropriate.

## Scope

This Code of Conduct applies within all community spaces, and also applies when
an individual is officially representing the community in public spaces.
Examples of representing our community include using an official e-mail address,
posting via an official social media account, or acting as an appointed
representative at an online or offline event.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the community leaders responsible for enforcement at
https://github.com/hahaschool/agentctl/issues.
All complaints will be reviewed and investigated promptly and fairly.

All community leaders are obligated to respect the privacy and security of the
reporter of any incident.

## Enforcement Guidelines

Community leaders will follow these Community Impact Guidelines in determining
the consequences for any action they deem in violation of this Code of Conduct:

### 1. Correction

**Community Impact**: Use of inappropriate language or other behavior deemed
unprofessional or unwelcome in the community.

**Consequence**: A private, written warning from community leaders, providing
clarity around the nature of the violation and an explanation of why the
behavior was inappropriate. A public apology may be requested.

### 2. Warning

**Community Impact**: A violation through a single incident or series of
actions.

**Consequence**: A warning with consequences for continued behavior. No
interaction with the people involved, including unsolicited interaction with
those enforcing the Code of Conduct, for a specified period of time. This
includes avoiding interactions in community spaces as well as external channels
like social media. Violating these terms may lead to a temporary or permanent
ban.

### 3. Temporary Ban

**Community Impact**: A serious violation of community standards, including
sustained inappropriate behavior.

**Consequence**: A temporary ban from any sort of interaction or public
communication with the community for a specified period of time. No public or
private interaction with the people involved, including unsolicited interaction
with those enforcing the Code of Conduct, is allowed during this period.
Violating these terms may lead to a permanent ban.

### 4. Permanent Ban

**Community Impact**: Demonstrating a pattern of violation of community
standards, including sustained inappropriate behavior, harassment of an
individual, or aggression toward or disparagement of classes of individuals.

**Consequence**: A permanent ban from any sort of public interaction within the
community.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant][homepage],
version 2.1, available at
[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html][v2.1].

Community Impact Guidelines were inspired by
[Mozilla's code of conduct enforcement ladder][Mozilla CoC].

For answers to common questions about this code of conduct, see the FAQ at
[https://www.contributor-covenant.org/faq][FAQ]. Translations are available at
[https://www.contributor-covenant.org/translations][translations].

[homepage]: https://www.contributor-covenant.org
[v2.1]: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html
[Mozilla CoC]: https://github.com/mozilla/diversity
[FAQ]: https://www.contributor-covenant.org/faq
[translations]: https://www.contributor-covenant.org/translations
```

- [ ] **Step 2: Commit**

```bash
git add CODE_OF_CONDUCT.md
git commit -m "chore: add Contributor Covenant v2.1 code of conduct"
```

---

### Task 3: Create SECURITY.md

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: Create SECURITY.md**

```markdown
# Security Policy

## Supported Versions

Only the latest version on the `main` branch is supported with security updates.

| Version | Supported          |
|---------|--------------------|
| main    | :white_check_mark: |
| < main  | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Private Vulnerability Reporting](https://github.com/hahaschool/agentctl/security/advisories/new)
to report security vulnerabilities. This ensures the report is only visible to the maintainers.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix target:** within 90 days (severity-dependent)

### What to Expect

1. You will receive an acknowledgment within 48 hours.
2. We will investigate and provide an initial assessment within 7 days.
3. We will work on a fix and coordinate disclosure with you.
4. Once the fix is released, we will publicly disclose the vulnerability.

### Scope

The following are considered security vulnerabilities:

- Authentication or authorization bypasses
- Remote code execution
- SQL injection, XSS, CSRF
- Secrets or credentials exposed in code or logs
- Container escape or sandbox bypass
- Privilege escalation

The following are **not** security vulnerabilities (report as regular issues):

- Denial of service via resource exhaustion (unless trivially exploitable)
- Bugs that require physical access to the machine
- Issues in dependencies (report upstream, but let us know)

## Acknowledgments

We thank the following individuals for responsibly disclosing security issues:

*No reports yet.*
```

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "chore: add security vulnerability reporting policy"
```

---

### Task 4: Create CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "chore: add contribution guidelines"
```

---

## Chunk 2: GitHub Templates & README

### Task 5: Create bug report issue template

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`

- [ ] **Step 1: Create `.github/ISSUE_TEMPLATE/bug_report.yml`**

```yaml
name: Bug Report
description: Report a bug in AgentCTL
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thank you for reporting a bug. Please fill out the information below.
  - type: textarea
    id: description
    attributes:
      label: Description
      description: A clear and concise description of the bug.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Steps to reproduce the behavior.
      placeholder: |
        1. Start the control plane with `pnpm dev:control`
        2. Navigate to '...'
        3. Click on '...'
        4. See error
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: What you expected to happen.
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
      description: What actually happened.
    validations:
      required: true
  - type: input
    id: os
    attributes:
      label: Operating System
      placeholder: "e.g., macOS 15.2, Ubuntu 24.04"
    validations:
      required: true
  - type: input
    id: node
    attributes:
      label: Node.js Version
      placeholder: "e.g., 20.11.0"
    validations:
      required: true
  - type: input
    id: pnpm
    attributes:
      label: pnpm Version
      placeholder: "e.g., 8.15.4"
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Logs / Screenshots
      description: Any relevant log output or screenshots.
    validations:
      required: false
```

- [ ] **Step 2: Commit**

```bash
git add .github/ISSUE_TEMPLATE/bug_report.yml
git commit -m "chore: add bug report issue template"
```

---

### Task 6: Create feature request issue template

**Files:**
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`

- [ ] **Step 1: Create `.github/ISSUE_TEMPLATE/feature_request.yml`**

```yaml
name: Feature Request
description: Suggest a new feature or improvement
title: "[Feature]: "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Thank you for suggesting a feature. Please describe the problem and your proposed solution.
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What problem does this feature solve? What is your use case?
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: Describe the solution you'd like.
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: Any alternative solutions or features you've considered.
    validations:
      required: false
  - type: textarea
    id: context
    attributes:
      label: Additional Context
      description: Any other context, screenshots, or references.
    validations:
      required: false
```

- [ ] **Step 2: Commit**

```bash
git add .github/ISSUE_TEMPLATE/feature_request.yml
git commit -m "chore: add feature request issue template"
```

---

### Task 7: Create PR template

**Files:**
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: Create `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## What Changed

<!-- Describe what this PR does and why. -->

## Related Issue

<!-- Link to the related issue: closes #N -->

## How to Test

<!-- Steps to verify this change works correctly. -->

## Checklist

- [ ] Tests pass (`pnpm test`)
- [ ] Biome check passes (`pnpm check`)
- [ ] No hardcoded secrets or credentials
- [ ] Commit messages follow [conventional commits](https://www.conventionalcommits.org/)
- [ ] Documentation updated (if applicable)
```

- [ ] **Step 2: Commit**

```bash
git add .github/PULL_REQUEST_TEMPLATE.md
git commit -m "chore: add pull request template"
```

---

### Task 8: Update README.md

**Files:**
- Modify: `README.md:1` (add badge after title)
- Modify: `README.md:220-222` (replace license section)

- [ ] **Step 1: Add license badge after the title on line 1**

Replace line 1:
```markdown
# AgentCTL
```
With:
```markdown
# AgentCTL

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL_1.1-blue.svg)](LICENSE)
```

- [ ] **Step 2: Replace the License section (lines 220-222)**

Replace:
```markdown
## License

Private repository. All rights reserved.
```
With:
```markdown
## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved.

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the [Business Source License 1.1](LICENSE).

You may use, modify, and redistribute the code for non-production purposes freely.
Production use is permitted provided you do not offer AgentCTL as a competitive
hosted service. On 2030-03-10, the license automatically converts to
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README with license badge, contributing, and security sections"
```

---

### Task 9: Delete AGENTS.md

**Files:**
- Delete: `AGENTS.md` (untracked)

- [ ] **Step 1: Delete the file**

```bash
rm AGENTS.md
```

This file is untracked (never committed), so `rm` is sufficient. No git operation needed.

- [ ] **Step 2: Verify clean state and push**

```bash
git status
git push origin main
```

Expected: only the pending roadmap + astro-patterns changes remain as modified/untracked.

---

### Task 10: Post-push verification

- [ ] **Step 1: Verify build still passes**

```bash
pnpm build && pnpm check
```

Expected: both commands succeed with exit code 0.

- [ ] **Step 2: Verify GitHub rendering**

After push, manually check on GitHub:
- `LICENSE` renders correctly (GitHub recognizes BSL 1.1)
- Issue templates appear in "New Issue" dropdown (bug report + feature request)
- PR template auto-populates when creating a new PR
- README badge renders with "BSL 1.1" text and links to LICENSE
- Contributing and Security sections are visible in README
