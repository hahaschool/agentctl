# Security Runbook

Operational procedures for detecting, responding to, and recovering from security incidents in the AgentCTL platform.

**Audience**: On-call engineers, fleet operators, incident commanders.

---

## 1. Incident Classification

| Priority | Severity | Examples | Response Time | Escalation |
|----------|----------|----------|---------------|------------|
| **P0** | Critical | Rogue agent executing unauthorized commands, credential leak, data exfiltration via Bash+Write combo | Immediate (< 5 min) | Page incident commander + all engineers |
| **P1** | High | Prompt injection detected (high severity), agent exceeding cost limits, unauthorized API access to control plane | < 15 min | Page on-call engineer |
| **P2** | Medium | Anomalous tool patterns (new_tool / frequency_spike), failed webhook deliveries, memory poisoning attempt in Mem0 | < 1 hour | Slack alert, next business day if after hours |
| **P3** | Low | Rate limiting triggered (per_minute / per_hour), failed auth attempts, audit hash chain integrity break | < 4 hours | Slack notification |

---

## 2. Emergency Commands Quick Reference

### Kill a specific agent

```bash
# Via control plane (proxies to the correct worker automatically)
curl -X POST http://control-plane:8080/api/agents/{agentId}/emergency-stop

# If you know the worker machine, bypass the control plane
curl -X POST http://{worker-tailscale-ip}:9000/api/agents/{agentId}/emergency-stop

# Specify machine explicitly via query parameter
curl -X POST "http://control-plane:8080/api/agents/{agentId}/emergency-stop?machineId=mac-mini-worker"
```

### Kill ALL agents on ALL machines

```bash
curl -X POST http://control-plane:8080/api/agents/emergency-stop-all
```

### Query audit logs for suspicious activity

```bash
# All Bash calls by a specific agent in a date range
curl "http://control-plane:8080/api/audit?agentId={agentId}&tool=Bash&from=2026-03-01&limit=500"

# Aggregated audit summary
curl "http://control-plane:8080/api/audit/summary?agentId={agentId}&from=2026-03-01"
```

### Session replay

```bash
# Full timeline for a session
curl "http://control-plane:8080/api/audit/replay/{sessionId}"

# Session summary statistics
curl "http://control-plane:8080/api/audit/replay/{sessionId}/summary"

# Suspicious pattern detection (rapid_fire, high_denial_rate, unusual_tool_sequence, cost_spike)
curl "http://control-plane:8080/api/audit/replay/{sessionId}/suspicious"

# Filter replay events by tool
curl "http://control-plane:8080/api/audit/replay/{sessionId}?toolName=Bash"
```

### Verify audit log integrity

```bash
# On the worker machine, verify an NDJSON audit file hash chain
pnpm tsx -e "
  import { AuditLogger } from './packages/agent-worker/src/hooks/audit-logger.js';
  const result = await AuditLogger.verifyIntegrity('./logs/audit-2026-03-02.ndjson');
  console.log(JSON.stringify(result, null, 2));
"
```

### Tailscale node management

```bash
# List all nodes in the mesh
tailscale status

# Revoke a compromised node's key
tailscale lock remove {nodeKey}

# Force re-authentication of a node
tailscale logout   # Run on the compromised machine
```

---

## 3. Response Procedures

### 3.1 Rogue Agent (P0)

A rogue agent is one executing commands outside its allowed scope, ignoring tool restrictions, or behaving in ways that indicate compromise.

**Indicators**: Anomaly detector reports `suspicious_combination` (Bash+Write within 5s), session replay shows `unusual_tool_sequence` (Bash appearing after 80% safe-only calls), denied tool calls followed by successful variants.

**Steps**:

1. **Contain** -- Issue emergency stop immediately:
   ```bash
   curl -X POST http://control-plane:8080/api/agents/{agentId}/emergency-stop
   ```
2. **Isolate** -- If the agent is running in a container, kill the container directly:
   ```bash
   ssh {machine} "docker kill agentctl-worker-{agentId}"
   ```
3. **Assess** -- Pull the session replay and suspicious patterns:
   ```bash
   curl "http://control-plane:8080/api/audit/replay/{sessionId}/suspicious"
   curl "http://control-plane:8080/api/audit/replay/{sessionId}?toolName=Bash"
   ```
4. **Audit the worktree** -- Check what files the agent modified:
   ```bash
   ssh {machine} "cd /path/to/.trees/{agent-branch} && git diff HEAD~10 --stat"
   ```
5. **Revert** -- If the agent wrote malicious files, reset the worktree:
   ```bash
   ssh {machine} "cd /path/to/.trees/{agent-branch} && git stash && git checkout main"
   ```
6. **Review agent config** -- Check `allowedTools` and `disallowedTools` in the agent's config JSONB. Verify the pre-tool-use hook chain (rate limiter, anomaly detector, prompt injection detector) was active.

### 3.2 Credential Leak (P0)

API keys, tokens, or secrets found in source code, logs, or agent output.

**Steps**:

1. **Rotate immediately** -- Revoke and regenerate the exposed credentials:
   - Anthropic API keys: regenerate in console.anthropic.com
   - AWS credentials (Bedrock): rotate via IAM
   - GCP service account (Vertex): rotate key in Cloud Console
   - Tailscale auth keys: revoke in admin console
   - Redis/PostgreSQL passwords: rotate and restart services
2. **Scan the repository**:
   ```bash
   # Install and run gitleaks
   gitleaks detect --source . --verbose
   # Check full git history
   gitleaks detect --source . --verbose --log-opts="--all"
   ```
3. **Audit git history** for the leaked secret:
   ```bash
   git log --all --full-history -S "{partial-secret}" --oneline
   ```
4. **Purge from history** if the secret was committed (use BFG or git-filter-repo):
   ```bash
   git filter-repo --replace-text expressions.txt --force
   ```
5. **Check agent audit logs** -- Determine if any agent output contained the secret. Audit entries store `toolOutputHash` (SHA-256), not full output, so check the worker's local NDJSON files for the timeframe.
6. **Verify `.env` files** are in `.gitignore` and never mounted into agent containers (per security rules: exclude `.ssh`, `.gnupg`, `.aws`, `.env`, `credentials`).

### 3.3 Prompt Injection (P1)

The prompt injection detector (`prompt-injection-detector.ts`) flagged external content containing injection patterns.

**Detection types**: `ignore_instructions`, `system_prefix`, `system_tags`, `inst_markers`, `role_markers`, `base64_injection`, `separator_attack`.

**Steps**:

1. **Review the detection** -- Check agent worker logs for `InjectionDetection` entries. The detector reports the pattern name, severity, offset, and matched text.
2. **Check if the injection succeeded** -- Pull the session replay:
   ```bash
   curl "http://control-plane:8080/api/audit/replay/{sessionId}"
   ```
   Look for behavior changes after the injection point (unexpected tool calls, changed objectives).
3. **Quarantine agent memory** -- If the injected content reached Mem0:
   ```bash
   # Search Mem0 for the agent's memories
   curl "http://mem0:8000/v1/memories/search" -d '{"query": "injected content snippet", "agent_id": "{agentId}"}'
   # Delete tainted memories by ID
   curl -X DELETE "http://mem0:8000/v1/memories/{memoryId}"
   ```
4. **Emergency stop the agent** if still running.
5. **Update detection rules** -- If the injection used a pattern not covered by the existing 7 pattern types, add a new `PatternDef` in `packages/agent-worker/src/hooks/prompt-injection-detector.ts`.
6. **Check for homoglyph bypass** -- The detector normalizes Cyrillic, Greek, and fullwidth Latin characters. If the attack used other unicode categories, expand the `HOMOGLYPH_MAP`.

### 3.4 Cost Overrun (P1)

An agent exceeding expected cost thresholds. Session replay detects `cost_spike` (single call > $1 USD). The cost alert module tracks per-agent and per-run spending.

**Steps**:

1. **Pause the agent**:
   ```bash
   curl -X POST http://control-plane:8080/api/agents/{agentId}/emergency-stop
   ```
2. **Check cost data**:
   ```bash
   curl "http://control-plane:8080/api/audit/summary?agentId={agentId}"
   curl "http://control-plane:8080/api/audit/replay/{sessionId}/summary"
   ```
3. **Review loop configuration** -- If the agent is in a heartbeat/cron loop, check:
   - `maxIterations` -- Is it set? Is it reasonable?
   - `maxCostPerRunUsd` -- Was a cost cap configured?
   - Loop checkpoint data for iteration counts
4. **Check LiteLLM proxy** -- Verify the routing strategy. If the agent was hitting the primary Anthropic tier instead of the budget Haiku tier:
   ```bash
   curl http://control-plane:4000/model/info
   ```
5. **Set cost alerts** if not already configured. Ensure webhooks are delivering cost notifications to Slack/Discord.

### 3.5 Memory Poisoning (P2)

An attacker or compromised agent writes false or malicious data to the shared Mem0 memory system to influence other agents.

**Steps**:

1. **Identify the tainted memories** -- Search Mem0 by agent ID and time range:
   ```bash
   curl "http://mem0:8000/v1/memories/search" -d '{
     "query": "suspicious content keywords",
     "agent_id": "{agentId}",
     "limit": 50
   }'
   ```
2. **Isolate the agent's memory namespace** -- Stop all agents that share the same `user_id` scope in Mem0.
3. **Purge tainted entries**:
   ```bash
   curl -X DELETE "http://mem0:8000/v1/memories/{memoryId}"
   ```
4. **Audit the write timeline** -- Cross-reference Mem0 writes with the agent's audit log to determine which session introduced the bad data.
5. **Rebuild memory** from trusted sources if needed (re-import from claude-mem or JSONL history):
   ```bash
   pnpm tsx scripts/import-claude-mem.ts ~/.claude-mem/claude-mem.db
   ```

### 3.6 Tailscale Mesh Compromise (P1)

A node on the Tailscale mesh is compromised or an unauthorized device joins the network.

**Steps**:

1. **Identify the compromised node**:
   ```bash
   tailscale status --json | jq '.Peer[] | select(.Online==true) | {hostname: .HostName, ip: .TailscaleIPs, lastSeen: .LastSeen}'
   ```
2. **Revoke the node key** from the Tailscale admin console (admin.tailscale.com) or via CLI:
   ```bash
   tailscale lock remove {nodeKey}
   ```
3. **Update ACLs** -- Restrict the compromised machine's tag. The ACL policy uses `tag:control`, `tag:worker`, `tag:mobile`. Remove the compromised machine's tag assignment.
4. **Audit connection logs** -- Check which services the compromised node accessed:
   - Control plane API (:8080)
   - Redis (:6379)
   - PostgreSQL (:5432)
   - LiteLLM Proxy (:4000)
   - Mem0 (:8000)
5. **Rotate secrets** accessible from that machine -- database passwords, API keys in the machine's `.env` file.
6. **Re-bootstrap the machine** after forensics:
   ```bash
   ./scripts/setup-machine.sh
   ```

---

## 4. Contact and Escalation

| Role | Name | Contact | Escalation Trigger |
|------|------|---------|--------------------|
| On-Call Engineer | _TBD_ | _TBD_ | P2/P3 incidents |
| Incident Commander | _TBD_ | _TBD_ | All P0/P1 incidents |
| Platform Lead | _TBD_ | _TBD_ | P0 lasting > 30 min |
| Security Lead | _TBD_ | _TBD_ | Credential leaks, mesh compromise |

**Escalation path**: On-Call Engineer (5 min) -> Incident Commander (15 min) -> Platform Lead (30 min).

Update this table with actual contacts before deploying to production.

---

## 5. Post-Incident Checklist

After every P0 or P1 incident, complete the following within 48 hours:

- [ ] **Timeline** -- Document exact sequence of events with timestamps from audit logs
- [ ] **Root cause** -- Identify the underlying cause (misconfiguration, missing detection rule, software bug, external attack)
- [ ] **Impact assessment** -- What data was accessed? What systems were affected? What was the cost?
- [ ] **Detection gap** -- How long between incident start and detection? Why?
- [ ] **Update detection rules** -- Add new patterns to the prompt injection detector, anomaly detector, or rate limiter as needed
- [ ] **Update this runbook** -- Add the incident as a case study if it reveals a new attack vector or response gap
- [ ] **Update `docs/LESSONS_LEARNED.md`** -- Record the pitfall and resolution for future reference
- [ ] **Verify preventive controls** -- Confirm that the fix prevents recurrence (write a test if possible)
- [ ] **Notify stakeholders** -- Brief relevant parties on what happened and what changed
- [ ] **Close the incident** -- Mark resolved in the tracking system with a link to the post-mortem

---

## 6. Preventive Controls Summary

| Threat | Existing Control | Location |
|--------|-----------------|----------|
| Unauthorized tool execution | PreToolUse hook with blocked command patterns | `agent-worker/src/hooks/pre-tool-use.ts` |
| Prompt injection | 7-pattern detector with homoglyph normalization and base64 decoding | `agent-worker/src/hooks/prompt-injection-detector.ts` |
| Tool call flooding | Sliding-window rate limiter (120/min, 3600/hr per agent) | `agent-worker/src/hooks/tool-rate-limiter.ts` |
| Anomalous tool usage | Baseline learning + 3 anomaly types (new_tool, frequency_spike, suspicious_combination) | `agent-worker/src/hooks/anomaly-detector.ts` |
| Rogue agent | Emergency stop API (single agent and fleet-wide) | `control-plane/src/api/routes/emergency-stop.ts` |
| Audit tampering | SHA-256 hash chain on NDJSON audit logs with integrity verification | `agent-worker/src/hooks/audit-logger.ts` |
| Session forensics | Session replay with timeline, filtering, summary, and suspicious pattern detection | `control-plane/src/audit/session-replay.ts` |
| Cost overrun | Cost alerts, per-run cost tracking, LiteLLM budget tier fallback | `agent-worker/src/hooks/cost-alert.ts`, LiteLLM config |
| Container escape | gVisor runtime, `--cap-drop=ALL`, `--network=none`, seccomp + AppArmor | Docker configs in `infra/docker/` |
| Network intrusion | Tailscale WireGuard mesh with ACL policies restricting port access per tag | `infra/tailscale/` ACL config |
| Credential exposure | `.env` excluded from containers, gitleaks in CI, secrets in Tailscale env vars only | `.claude/rules/security.md`, CI pipeline |
| Webhook failure | Retry with exponential backoff, delivery tracking, failure notifications | `control-plane/src/notifications/webhook-dispatcher.ts` |
| Memory poisoning | Per-agent memory namespacing in Mem0, manual purge capability | Mem0 API scoping by `agent_id` |
| Log data loss | Daily rotation of audit files, Vector pipeline to ClickHouse for durable storage | `infra/vector/` config |
