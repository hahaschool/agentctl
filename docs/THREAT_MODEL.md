# Threat Model

Threat model for the AgentCTL multi-machine AI agent orchestration platform.

**Last updated**: 2026-03-02
**Methodology**: STRIDE + OWASP Agentic Top 10 (ASI01-ASI10)
**Scope**: Control plane, agent workers, iOS mobile client, LLM provider integrations, shared memory, audit pipeline

---

## 1. Attack Surface Diagram

```
                        ┌─────────────────────────────────────┐
                        │         EXTERNAL / UNTRUSTED         │
                        │                                      │
                        │  ┌───────────┐    ┌──────────────┐  │
                        │  │ LLM APIs  │    │  Git Remotes  │  │
                        │  │ Anthropic  │    │  GitHub/GL    │  │
                        │  │ Bedrock    │    └──────┬───────┘  │
                        │  │ Vertex AI  │           │          │
                        │  └─────┬─────┘    ┌──────┴───────┐  │
                        │        │          │  Webhooks     │  │
                        │        │          │  (outbound)   │  │
                        │        │          └──────┬───────┘  │
                        └────────┼─────────────────┼──────────┘
  ═══════════════════════════════╪═════════════════╪═══════════
  TRUST BOUNDARY 1: Internet <-> Tailscale WireGuard Mesh
  ═══════════════════════════════╪═════════════════╪═══════════
                        ┌────────┼─────────────────┼──────────┐
                        │        │   TAILSCALE MESH (100.x)   │
                        │        │                 │          │
  ┌──────────┐          │  ┌─────┴──────────────┐  │          │
  │  iPhone/  │◄─────────┼─►│  CONTROL PLANE     │◄─┘          │
  │  iPad     │  E2E     │  │  :8080 Fastify API │             │
  │  (Expo)   │  Encrypted│  │  :4000 LiteLLM    │             │
  └──────────┘          │  │  :8000 Mem0        │             │
                        │  │  :5432 PostgreSQL  │             │
  ════════════          │  │  :6379 Redis/BullMQ│             │
  TRUST BOUNDARY 2:     │  └────────┬───────────┘             │
  Mobile <-> Control    │           │                          │
  ════════════          │  ═════════╪══════════════            │
                        │  TRUST BOUNDARY 3:                   │
                        │  Control Plane <-> Workers            │
                        │  ═════════╪══════════════            │
                        │           │                          │
                        │  ┌────────┴───────────┐              │
                        │  │  AGENT WORKERS     │              │
                        │  │  :9000 Worker API  │              │
                        │  │  :9090 Metrics     │              │
                        │  │  :9100 SSE Streams │              │
                        │  └────────┬───────────┘              │
                        │           │                          │
                        │  ═════════╪══════════════            │
                        │  TRUST BOUNDARY 4:                   │
                        │  Worker <-> Claude Code Sandbox      │
                        │  ═════════╪══════════════            │
                        │           │                          │
                        │  ┌────────┴───────────┐              │
                        │  │  SANDBOX           │              │
                        │  │  bubblewrap/Seatbelt│             │
                        │  │  gVisor container   │             │
                        │  │  --cap-drop=ALL     │             │
                        │  │  --network=none     │             │
                        │  └────────┬───────────┘              │
                        │           │                          │
                        │  ═════════╪══════════════            │
                        │  TRUST BOUNDARY 5:                   │
                        │  Sandbox <-> Host Filesystem / Net   │
                        │  ═════════╪══════════════            │
                        │           ▼                          │
                        │  ┌─────────────────┐                 │
                        │  │  Host Resources  │                │
                        │  │  Files, Git,     │                │
                        │  │  Network (if     │                │
                        │  │  allowed)        │                │
                        │  └─────────────────┘                 │
                        └──────────────────────────────────────┘
```

---

## 2. STRIDE Threat Analysis

### S — Spoofing

| ID | Threat | Description | Likelihood | Impact |
|----|--------|-------------|------------|--------|
| S1 | Agent impersonation | Rogue process sends heartbeats/results claiming to be a registered agent by spoofing `agentId` or `machineId` | Medium | High |
| S2 | Worker impersonation | Compromised machine registers as a worker, receives task assignments containing prompts and secrets | Low | Critical |
| S3 | Mobile client spoofing | Attacker replays or forges WebSocket messages to the control plane, issuing commands as the legitimate user | Medium | High |
| S4 | LiteLLM API key theft | Stolen API keys used to make requests through the proxy, consuming budget and exfiltrating model outputs | Low | High |

**Existing mitigations**: Tailscale device identity (WireGuard key per node), ACL tags (`tag:control`, `tag:worker`, `tag:mobile`), TweetNaCl E2E encryption for mobile.

**Gaps**: No per-request authentication token between control plane and workers beyond Tailscale network identity. Agent registration does not require a shared secret or signed certificate. Mobile session tokens are not rotated on a schedule.

### T — Tampering

| ID | Threat | Description | Likelihood | Impact |
|----|--------|-------------|------------|--------|
| T1 | Audit log manipulation | Attacker with host access modifies NDJSON audit files to hide malicious agent actions | Low | Critical |
| T2 | Memory poisoning | Compromised agent writes false facts to Mem0, influencing future agent decisions across the fleet | Medium | High |
| T3 | Code injection via worktree | Agent writes malicious code to a git worktree that is later merged without review | Medium | High |
| T4 | BullMQ job tampering | Attacker with Redis access modifies queued job payloads (prompts, tool configs) before workers consume them | Low | High |
| T5 | Git remote poisoning | Malicious content in cloned repositories triggers prompt injection when agents read files | Medium | Medium |

**Existing mitigations**: SHA-256 hash chain on audit logs with integrity verification (`AuditLogger.verifyIntegrity()`), per-agent memory namespacing in Mem0, blocked command patterns in PreToolUse hook, prompt injection detector with 7 pattern types and homoglyph normalization.

**Gaps**: Mem0 writes are not signed or attributed with cryptographic proof. No mandatory code review gate before agent commits are merged. Redis is not configured with ACLs (single shared password). Git clone content is scanned for injection patterns but coverage depends on the 7 defined regexes.

### R — Repudiation

| ID | Threat | Description | Likelihood | Impact |
|----|--------|-------------|------------|--------|
| R1 | Unsigned agent actions | An agent or operator claims they did not issue a command; no cryptographic proof ties the action to the actor | Medium | Medium |
| R2 | Missing audit on control plane commands | Administrative actions (agent config changes, emergency stops, schedule modifications) may not be fully logged | Low | Medium |
| R3 | Mobile command non-attribution | Commands sent from the iOS app lack a verifiable signature tied to the device or user identity | Medium | Medium |

**Existing mitigations**: NDJSON audit trail with SHA-256 hash chain, session replay with full timeline reconstruction, Vector pipeline to ClickHouse for durable storage.

**Gaps**: Audit entries are not digitally signed (hash chain proves ordering and tamper evidence but not authorship). Control plane administrative API calls lack a dedicated audit trail separate from agent action logs.

### I — Information Disclosure

| ID | Threat | Description | Likelihood | Impact |
|----|--------|-------------|------------|--------|
| I1 | Credential leak in agent output | Agent reads `.env`, `.aws/credentials`, or similar files and includes secrets in its text output or tool results | Medium | Critical |
| I2 | Model output exfiltration | A prompt injection causes the agent to encode and exfiltrate sensitive file contents via outbound network calls (curl, webhook) | Low | Critical |
| I3 | Memory search leakage | Attacker queries Mem0 across agent namespaces to extract proprietary code patterns or business logic | Low | High |
| I4 | SSE stream interception | Agent output streams on port 9100 transmit full tool output including file contents; any Tailscale node can listen | Medium | Medium |
| I5 | PostgreSQL data exposure | Database contains agent configs, prompts, cost data, and session history; compromise exposes operational intelligence | Low | High |

**Existing mitigations**: Container mounts exclude `.ssh`, `.gnupg`, `.aws`, `.env`, `credentials`. Agent output stored as SHA-256 hash only in audit logs (not full text). Tailscale ACLs restrict port access by tag. `--network=none` prevents agent-initiated exfiltration from containers.

**Gaps**: Agents running outside containers (direct PM2) have full filesystem access. SSE streams are not encrypted beyond Tailscale WireGuard. Mem0 API has no authentication layer beyond network isolation. PostgreSQL connection uses password auth, not mTLS.

### D — Denial of Service

| ID | Threat | Description | Likelihood | Impact |
|----|--------|-------------|------------|--------|
| D1 | Runaway agent | Agent enters infinite loop generating tokens, exhausting LLM API budget and rate limits | Medium | High |
| D2 | Queue flooding | Attacker with Redis access or compromised worker floods BullMQ with thousands of jobs, starving legitimate work | Low | High |
| D3 | Resource exhaustion on worker | Agent spawns excessive subprocesses, fills disk with file writes, or consumes all memory | Medium | Medium |
| D4 | PostgreSQL connection exhaustion | Many simultaneous agent registrations or health checks exhaust the connection pool | Low | Medium |
| D5 | LiteLLM rate limit cascade | One runaway agent triggers rate limits across all providers, blocking the entire fleet | Medium | High |

**Existing mitigations**: Dead-loop detection (3 identical results), tool rate limiter (120 calls/min, 3600/hr per agent), cost alerts at 80% budget, circuit breaker with exponential backoff, emergency stop API (per-agent and fleet-wide), DB connection pool with limits.

**Gaps**: No per-agent token budget enforced at the LiteLLM proxy level (cost alerts are reactive, not preventive). No disk quota or memory cgroup limits documented for PM2-managed agents. BullMQ has no queue depth limit or admission control.

### E — Elevation of Privilege

| ID | Threat | Description | Likelihood | Impact |
|----|--------|-------------|------------|--------|
| E1 | Sandbox escape | Agent exploits a vulnerability in bubblewrap, Seatbelt, or gVisor to gain host-level access | Low | Critical |
| E2 | Tool allow-list bypass | Agent constructs a tool call that passes PreToolUse validation but achieves a blocked effect (e.g., writing a shell script then executing it) | Medium | High |
| E3 | Prompt injection to override controls | Malicious content in a file or git repo causes the agent to ignore its system prompt restrictions and execute arbitrary commands | Medium | Critical |
| E4 | Redis to control plane escalation | Attacker with Redis access crafts BullMQ jobs that execute arbitrary code in the worker's job processor | Low | Critical |
| E5 | Cross-agent privilege escalation | Agent A modifies shared memory or worktree resources to influence Agent B into performing privileged actions | Medium | High |

**Existing mitigations**: Claude Code sandbox (bubblewrap on Linux, Seatbelt on macOS), `allowedTools`/`disallowedTools` per agent config, Docker `--cap-drop=ALL` + gVisor runtime, prompt injection detector with base64 decoding and unicode normalization, anomaly detector for suspicious tool combinations (Bash+Write within 5s).

**Gaps**: Multi-step attacks (write script, then execute) may not be caught by single-call pattern matching. The anomaly detector uses a time-based heuristic (5s window) that sophisticated attacks could evade. No sandboxing for agents running directly under PM2 without Docker.

---

## 3. OWASP Agentic Top 10 Mapping

| OWASP ID | Risk Name | AgentCTL-Specific Threat | Existing Mitigation | Residual Risk |
|----------|-----------|-------------------------|---------------------|---------------|
| ASI01 | Excessive Agency | Agents with broad `allowedTools` can read/write arbitrary files, execute shell commands, and access network resources | Per-agent `allowedTools`/`disallowedTools` config, blocked command patterns in PreToolUse hook | Medium -- default configs may be too permissive; no least-privilege template per task type |
| ASI02 | Inadequate Sandboxing | Claude Code subprocess inherits worker process permissions when running outside Docker | bubblewrap/Seatbelt sandbox, Docker gVisor runtime, `--cap-drop=ALL`, `--network=none` | Medium -- PM2-managed agents without Docker lack container isolation |
| ASI03 | Uncontrolled Code Generation | Agent generates and commits code that introduces vulnerabilities, backdoors, or supply chain risks | Git worktree isolation per agent, post-tool-use hooks can inspect written files | High -- no automated SAST/DAST scanning of agent-generated code before merge |
| ASI04 | Insufficient Input Validation | External content (git repos, web pages, webhook payloads) may contain prompt injection payloads | 7-pattern prompt injection detector with homoglyph normalization and base64 decoding | Medium -- detector coverage is regex-based; novel injection techniques may bypass |
| ASI05 | Insecure Output Handling | Agent text output may contain secrets, PII, or executable payloads forwarded to downstream systems | Audit logs store output hash only (not full text), blocked file mount patterns | Medium -- SSE streams carry full output; no output sanitization layer |
| ASI06 | Lack of Guardrails | Autonomous agents in heartbeat/cron mode run without human oversight for extended periods | Dead-loop detection (3 identical results), cost alerts at 80% budget, emergency stop API | Medium -- no mandatory human-in-the-loop gate for high-risk tool calls in autonomous mode |
| ASI07 | Broken Access Control | All agents on a worker share the same OS user and filesystem namespace | Tailscale ACLs per tag, per-agent worktree isolation, Mem0 namespace scoping by `agent_id` | Medium -- no OS-level user separation between agents on the same machine |
| ASI08 | Insufficient Monitoring | Delayed detection of anomalous agent behavior allows damage before intervention | Anomaly detector (3 types), rate limiter, session replay, Vector to ClickHouse pipeline | Low -- monitoring is comprehensive; gap is alerting latency for P0 events |
| ASI09 | Improper Inventory Management | Stale agent registrations, orphaned worktrees, or forgotten cron schedules consume resources and expand attack surface | Agent registry in PostgreSQL with status tracking, heartbeat-based health checks | Medium -- no automated cleanup of stale agents or abandoned worktrees |
| ASI10 | Insecure Agent Communication | Inter-component messages (control plane to worker, worker to sandbox) could be intercepted or tampered | Tailscale WireGuard encryption, TweetNaCl E2E for mobile | Low -- all traffic is within WireGuard tunnel; gap is lack of message-level signing |

---

## 4. Risk Assessment Matrix

Risk levels: **Low** (acceptable, monitor), **Medium** (address in next sprint), **High** (address before production), **Critical** (block deployment).

| Threat ID | Threat | Likelihood | Impact | Risk Level | Current Mitigation | Recommended Improvement |
|-----------|--------|------------|--------|------------|-------------------|------------------------|
| E3 | Prompt injection to override controls | Medium | Critical | **Critical** | 7-pattern detector, homoglyph normalization, base64 decoding | Add LLM-based secondary classifier for injection detection; implement content tagging so agents distinguish trusted vs untrusted input |
| I1 | Credential leak in agent output | Medium | Critical | **Critical** | Mount exclusions, security rules | Add real-time output scanning for secret patterns (regex + entropy analysis); integrate gitleaks as a PostToolUse hook |
| E2 | Tool allow-list bypass (multi-step) | Medium | High | **High** | PreToolUse blocked patterns, anomaly detector | Implement stateful tool-chain analysis tracking sequences across calls (e.g., Write followed by Bash on the same path) |
| T2 | Memory poisoning via Mem0 | Medium | High | **High** | Per-agent namespace scoping | Add write-ahead validation: hash and sign memory entries; implement cross-agent memory access controls with explicit grants |
| D1 | Runaway agent / budget exhaustion | Medium | High | **High** | Dead-loop detection, cost alerts | Enforce hard token budgets at the LiteLLM proxy level (kill request if budget exceeded); add per-agent spending caps that halt execution |
| D5 | LiteLLM rate limit cascade | Medium | High | **High** | Circuit breaker, backoff | Implement per-agent rate limit quotas in LiteLLM config; add priority queuing so critical agents get capacity first |
| S1 | Agent impersonation | Medium | High | **High** | Tailscale network identity | Add per-agent registration tokens (HMAC-signed, time-limited) exchanged during registration handshake |
| E5 | Cross-agent privilege escalation | Medium | High | **High** | Worktree isolation, Mem0 namespacing | Enforce filesystem permissions per worktree (separate OS user or cgroup); add Mem0 access control lists |
| T3 | Code injection via worktree | Medium | High | **High** | Git worktree isolation | Add mandatory PR review gate; integrate automated security scanning (Semgrep/CodeQL) on agent-authored branches |
| E1 | Sandbox escape | Low | Critical | **High** | bubblewrap/Seatbelt, gVisor, --cap-drop=ALL | Keep sandbox runtimes updated; run periodic escape tests; subscribe to gVisor and bubblewrap CVE feeds |
| E4 | Redis to control plane escalation | Low | Critical | **High** | Network isolation via Tailscale | Enable Redis ACLs with separate credentials per service; validate all BullMQ job payloads against a schema before processing |
| T1 | Audit log manipulation | Low | Critical | **Medium** | SHA-256 hash chain, Vector to ClickHouse | Add periodic integrity verification as a cron job; replicate audit hashes to a separate append-only store |
| I2 | Model output exfiltration | Low | Critical | **Medium** | --network=none for containers | Extend network isolation to PM2-managed agents via firewall rules; add egress monitoring for non-containerized agents |
| S3 | Mobile client spoofing | Medium | High | **Medium** | TweetNaCl E2E encryption | Implement session token rotation; add device attestation via iOS DeviceCheck API |
| R1 | Unsigned agent actions | Medium | Medium | **Medium** | Hash chain audit trail | Sign audit entries with the originating machine's Tailscale key; add operator identity to control plane audit records |
| D3 | Resource exhaustion on worker | Medium | Medium | **Medium** | Rate limiter (calls/min) | Add cgroup resource limits (CPU, memory, disk) per agent via PM2 or systemd slices |
| I4 | SSE stream interception | Medium | Medium | **Medium** | Tailscale WireGuard | Restrict SSE port access in ACLs to `tag:control` only; consider adding bearer token auth on SSE endpoints |
| T4 | BullMQ job tampering | Low | High | **Medium** | Network isolation | Enable Redis ACLs; validate job payloads with JSON Schema before execution |
| I3 | Memory search leakage | Low | High | **Medium** | Namespace scoping by agent_id | Add authentication to Mem0 API; implement read access controls per namespace |
| D2 | Queue flooding | Low | High | **Medium** | Circuit breaker | Add BullMQ queue depth limits; implement admission control with priority classes |
| I5 | PostgreSQL data exposure | Low | High | **Medium** | Tailscale network isolation | Use mTLS for PostgreSQL connections; enable row-level security for multi-tenant queries |
| T5 | Git remote poisoning | Medium | Medium | **Low** | Prompt injection detector | Scan cloned repo content before agent ingestion; consider sandboxing git clone operations |
| S4 | LiteLLM API key theft | Low | High | **Low** | Keys in env vars, never in code | Rotate API keys on a 90-day schedule; use short-lived STS tokens for Bedrock/Vertex |
| D4 | PostgreSQL connection exhaustion | Low | Medium | **Low** | Connection pool with limits | Monitor active connections; add connection timeout and eviction policies |
| R2 | Missing control plane audit trail | Low | Medium | **Low** | Agent action logs exist | Add a dedicated admin audit log for all control plane API calls with operator identity |
| S2 | Worker impersonation | Low | Critical | **Low** | Tailscale device identity, ACL tags | Add mutual authentication during worker registration; require signed machine attestation |
| R3 | Mobile command non-attribution | Medium | Medium | **Low** | E2E encryption | Sign mobile commands with device key; include signature in audit trail |

---

## 5. Trust Boundaries

### Boundary 1: Internet <-> Tailscale Mesh

**What crosses**: Mobile app traffic, LLM API calls (outbound), git remote operations (outbound), webhook deliveries (outbound).

**Protection**: Tailscale WireGuard tunnel (all mesh traffic encrypted with Noise protocol and Curve25519 keys). No ports exposed to the public internet. Mobile app connects via Tailscale iOS client.

**Threats at this boundary**: Compromised Tailscale account grants mesh access. LLM API responses could contain adversarial content. Git remote content is untrusted input.

**Monitoring**: Tailscale admin console for device inventory. Log all outbound connections from the control plane.

### Boundary 2: Mobile App <-> Control Plane

**What crosses**: Agent commands (start, stop, message), agent status updates, SSE output streams, configuration changes.

**Protection**: TweetNaCl E2E encryption (NaCl box with X25519 key exchange). Tailscale WireGuard as transport layer. Mobile connects only to `:8080` per ACL.

**Threats at this boundary**: Replay attacks on encrypted messages. Device theft granting control plane access. Push notification metadata leakage.

**Monitoring**: Track mobile session origins, alert on connections from new Tailscale IPs.

### Boundary 3: Control Plane <-> Agent Workers

**What crosses**: Task assignments (BullMQ jobs via Redis), heartbeat health checks, emergency stop commands, audit query results, SSE agent output.

**Protection**: Tailscale ACLs restrict workers to ports `4000,5432,6379,8000,8080` on control plane; control plane accesses workers on `9000-9100`. All within WireGuard.

**Threats at this boundary**: Compromised worker sends falsified results. Redis access allows job manipulation. Worker exploits SQL injection if control plane API has flaws.

**Monitoring**: Worker heartbeat monitoring (15s interval), anomaly detection on job completion patterns, PostgreSQL query logging.

### Boundary 4: Agent Worker <-> Claude Code Sandbox

**What crosses**: Agent prompts (inbound), tool calls (bidirectional), tool results (inbound), stop signals.

**Protection**: Claude Code sandbox (bubblewrap on Linux, Seatbelt on macOS). Docker gVisor runtime with `--cap-drop=ALL`, `--network=none`, seccomp + AppArmor profiles. PreToolUse hooks validate every tool call. PostToolUse hooks inspect results.

**Threats at this boundary**: Sandbox escape via kernel or runtime vulnerability. Tool call smuggling past PreToolUse validation. Agent manipulates IPC filesystem.

**Monitoring**: PreToolUse/PostToolUse hook logging, anomaly detector (new_tool, frequency_spike, suspicious_combination), rate limiter (120/min, 3600/hr).

### Boundary 5: Sandbox <-> Host Resources

**What crosses**: File reads/writes (within allowed paths), git operations (within worktree), network calls (if `--network=none` is not set).

**Protection**: Container mount exclusions (`.ssh`, `.gnupg`, `.aws`, `.env`, `credentials`). Worktree isolation (each agent gets its own git worktree). Blocked command patterns in PreToolUse.

**Threats at this boundary**: Agent reads sensitive files outside its worktree. Agent writes to shared paths affecting other agents. Symlink attacks to escape mount restrictions.

**Monitoring**: Audit logger records all file operations with SHA-256 hashes. Git diff analysis post-run for worktree changes.

---

## 6. Assumptions and Dependencies

### Assumptions

| ID | Assumption | If Violated |
|----|-----------|-------------|
| A1 | Tailscale mesh provides authentic device identity and encrypted transport for all inter-machine communication | All trust boundaries collapse; attacker gains man-in-the-middle position across the fleet |
| A2 | Claude Code sandbox (bubblewrap/Seatbelt) correctly isolates agent subprocess from host system resources | Agent gains full host access; credential theft, lateral movement, and data exfiltration become trivial |
| A3 | gVisor runtime correctly interposes on all system calls from Docker containers | Container escape gives agent access to host kernel; all container-based isolation is void |
| A4 | LLM provider APIs (Anthropic, Bedrock, Vertex AI) do not return adversarial content designed to compromise our agents | Prompt injection via model response could override system prompts and safety controls |
| A5 | Redis and PostgreSQL are only accessible within the Tailscale mesh and use credential-based authentication | Database compromise exposes all agent configs, prompts, cost data, and scheduling state |
| A6 | The operator's Tailscale account is not compromised (MFA enabled, admin console secured) | Attacker can add rogue nodes, modify ACLs, and gain full mesh access |
| A7 | PM2 process manager faithfully executes ecosystem configs and does not introduce privilege escalation | Agent processes could run with elevated permissions or modified environment variables |
| A8 | The Vector logging pipeline delivers audit data to ClickHouse reliably and in order | Gaps in the audit trail during incidents; inability to reconstruct timeline for forensics |

### External Dependencies

| Dependency | Version Sensitivity | Failure Mode | Mitigation |
|-----------|-------------------|-------------|------------|
| Tailscale | Control plane and client versions must support ACL syntax used | Mesh connectivity loss; agents isolated from control plane | Pin Tailscale version in `setup-machine.sh`; test ACL changes in staging |
| Claude Code CLI | SDK wraps CLI as subprocess; breaking changes in CLI affect all agents | Agent runtime failure; tool calls may change format | Pin CLI version; test against new releases before fleet rollout |
| bubblewrap / Seatbelt | OS-specific sandbox; kernel updates may affect behavior | Sandbox bypass or agent crash | Monitor security advisories; test sandbox after OS updates |
| gVisor (runsc) | Kernel compatibility varies; may not support all syscalls | Container crashes or degraded performance | Maintain syscall compatibility list; fallback to runc with seccomp as degraded mode |
| Redis (BullMQ) | BullMQ requires Redis 6.2+ for stream features | Job scheduling failure; agents stop receiving work | Redis health check in Docker Compose; automatic failover with Redis Sentinel |
| PostgreSQL | Schema managed by Drizzle ORM; version 14+ required | Registry and audit queries fail; control plane degraded | Connection pool with health checks; read replicas for query load |
| Mem0 | Self-hosted Docker image; depends on embedding model availability | Memory sync fails; agents lose cross-session context | Graceful degradation (agents proceed without memory); retry with backoff |
| LiteLLM Proxy | Routing config must match provider API changes | Model routing fails; agents cannot make LLM calls | Health check endpoint; automatic fallback chain (Anthropic -> Bedrock -> Vertex) |
| Vector (logging) | Pipeline config must match ClickHouse schema | Audit logs not persisted to durable storage | Local NDJSON files as primary (always written); ClickHouse as secondary |
| React Native / Expo | iOS SDK updates may break TweetNaCl bindings or push notifications | Mobile app loses connectivity or encryption | Pin Expo SDK version; E2E test encryption round-trip in CI |

---

## 7. Priority Remediation Roadmap

### Immediate (before production deployment)

1. **Output scanning for secrets** -- Add a PostToolUse hook that scans agent text output for API key patterns, high-entropy strings, and known credential file formats. Block output that matches and alert the operator.
2. **Hard token budget enforcement** -- Configure LiteLLM proxy with per-agent `max_budget` settings that reject requests when the budget is exhausted, rather than relying on reactive cost alerts alone.
3. **Redis ACLs** -- Enable Redis 6+ ACL support with separate credentials for BullMQ workers, the control plane, and the LiteLLM cache. Restrict each to only the commands and key prefixes they need.
4. **BullMQ job payload validation** -- Add JSON Schema validation to the task consumer that rejects malformed or suspicious job payloads before processing.

### Short-term (within 30 days of production)

5. **Stateful tool-chain analysis** -- Extend the anomaly detector to track tool call sequences across a session and flag multi-step attack patterns (e.g., Write then Bash on the same file path).
6. **Automated code scanning** -- Integrate Semgrep or CodeQL as a PostToolUse hook or CI gate on agent-authored branches to catch generated vulnerabilities before merge.
7. **Agent registration tokens** -- Implement HMAC-signed, time-limited tokens for agent registration handshakes, adding a layer beyond Tailscale network identity.
8. **Mem0 access controls** -- Add authentication to the Mem0 API and implement per-agent read/write ACLs on memory namespaces.

### Medium-term (within 90 days)

9. **OS-level agent isolation** -- Run each agent under a dedicated OS user or cgroup (via systemd slices) to prevent cross-agent filesystem access on the same worker.
10. **Admin audit trail** -- Create a separate audit log for control plane administrative actions (config changes, emergency stops, schedule modifications) with operator identity.
11. **LLM-based injection classifier** -- Add a secondary prompt injection detection layer using a small, fast model to classify inputs that pass the regex-based detector.
12. **Signed audit entries** -- Digitally sign audit log entries with the originating machine's key to provide non-repudiation beyond hash chain tamper evidence.

---

## 8. Review Schedule

This threat model should be reviewed and updated:

- **Quarterly** -- Full review of all threat categories and risk assessments
- **On architecture change** -- Any new component, trust boundary, or external integration
- **On incident** -- After any P0 or P1 security incident (per `docs/SECURITY_RUNBOOK.md` post-incident checklist)
- **On dependency update** -- Major version changes to Tailscale, Claude Code CLI, gVisor, or Redis
