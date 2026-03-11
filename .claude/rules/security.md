---
triggers:
  - security
  - auth
  - secrets
  - shell
  - sql
  - docker
always_on: true
last_reviewed: "2026-03-12"
---

# Security Rules

When working on AgentCTL code:

- NEVER hardcode API keys, tokens, or credentials in source files
- NEVER use `--privileged` or `SYS_ADMIN` in Docker configurations
- ALWAYS use `--cap-drop=ALL` in Docker run commands for agents
- ALWAYS validate and sanitize user input before passing to shell commands
- ALWAYS use parameterized queries for SQL, never string interpolation
- NEVER log full API keys or tokens — log only the last 4 characters
- ALWAYS use TweetNaCl or libsodium for encryption, never roll custom crypto
- Container agent commands must be allow-listed, not deny-listed
- File system mounts to containers must exclude: `.ssh`, `.gnupg`, `.aws`, `.env`, `credentials`
- Network access from agent containers must default to `--network=none`
