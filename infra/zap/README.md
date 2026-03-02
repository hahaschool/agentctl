# OWASP ZAP DAST Scanning

Dynamic Application Security Testing (DAST) for the AgentCTL control-plane API using [OWASP ZAP](https://www.zaproxy.org/).

## How It Works

The DAST pipeline runs in GitHub Actions (`.github/workflows/dast-zap.yml`) and performs two types of scans:

### 1. ZAP API Baseline Scan

- Generates a minimal OpenAPI 3.0 spec covering all control-plane REST endpoints
- Runs ZAP's [API baseline scan](https://www.zaproxy.org/docs/docker/api-scan/) against the spec
- Checks for common web vulnerabilities: injection flaws, misconfigurations, information leakage, etc.
- Produces SARIF (uploaded to GitHub Security tab) and HTML reports (uploaded as artifacts)

### 2. WebSocket Fuzz Scan

- Connects to the `/api/ws` WebSocket endpoint
- Sends malformed JSON, oversized payloads (up to 1 MB), and injection payloads (SQL, XSS, command injection, prototype pollution)
- Verifies the server does not crash, leak stack traces, or expose sensitive information

## When It Runs

| Trigger | Target |
|---------|--------|
| Weekly (Monday 03:00 UTC) | Locally-built Docker stack |
| After `Deploy to Dev` workflow | Dev environment URL |
| Manual (`workflow_dispatch`) | Custom URL or local stack |

## Running ZAP Locally

### Prerequisites

- Docker installed and running
- The control-plane stack running (see `infra/docker/docker-compose.dev.yml`)

### Quick start

```bash
# 1. Start the backing services
cd infra/docker
docker compose -f docker-compose.dev.yml up -d

# 2. Start the control plane (in a separate terminal)
cd packages/control-plane
pnpm dev

# 3. Run ZAP baseline scan against local API
docker run --rm --network host \
  -v $(pwd)/infra/zap/rules.tsv:/zap/rules.tsv:ro \
  -t zaproxy/zap-stable zap-api-scan.py \
    -t http://localhost:8080/health \
    -f openapi \
    -c rules.tsv \
    -I

# 4. Run with a custom OpenAPI spec
docker run --rm --network host \
  -v $(pwd)/infra/zap/rules.tsv:/zap/rules.tsv:ro \
  -v /path/to/openapi.yaml:/zap/target.yaml:ro \
  -t zaproxy/zap-stable zap-api-scan.py \
    -t /zap/target.yaml \
    -f openapi \
    -c rules.tsv \
    -r /tmp/report.html
```

### Full scan (slower, more thorough)

Replace `zap-api-scan.py` with `zap-full-scan.py` for a comprehensive active scan. This takes significantly longer (30+ minutes) and sends attack payloads, so only run it against local or isolated environments.

```bash
docker run --rm --network host \
  -v $(pwd)/infra/zap/rules.tsv:/zap/rules.tsv:ro \
  -t zaproxy/zap-stable zap-full-scan.py \
    -t http://localhost:8080 \
    -c rules.tsv \
    -r /tmp/full-report.html
```

## Managing False Positives

False positive suppressions are maintained in `infra/zap/rules.tsv`.

### File format

Each line is a tab-separated record:

```
<rule_id>\t<action>\t<parameter>\t<description>
```

| Field | Description |
|-------|-------------|
| `rule_id` | ZAP plugin ID (numeric). Find these in ZAP alert details or the [ZAP Alert Registry](https://www.zaproxy.org/docs/alerts/). |
| `action` | `IGNORE` (suppress), `WARN` (downgrade to warning), or `FAIL` (force failure) |
| `parameter` | Optional regex to match specific parameters. Use `()` for any. |
| `description` | Human-readable justification for the suppression |

### Adding a new suppression

1. Run the ZAP scan locally and identify the false positive alert
2. Note the plugin ID from the alert details (e.g., `10021` for X-Content-Type-Options)
3. Add a line to `rules.tsv` with the rule ID, `IGNORE`, and a clear justification
4. Commit and push — the CI workflow will use the updated rules on the next run

### Reviewing suppressions

Suppressions should be reviewed periodically (at least quarterly) to ensure they are still valid. Remove any suppression where the underlying condition has changed or the false positive no longer applies.

## Reports

| Report | Location | Retention |
|--------|----------|-----------|
| HTML report | GitHub Actions artifact `zap-api-scan-report` | 30 days |
| SARIF | GitHub Security tab (Code scanning alerts) | Persistent |
| WebSocket fuzz | GitHub Actions artifact `ws-fuzz-results` | 30 days |

## Troubleshooting

### Scan times out waiting for health check

The control-plane container may be slow to start. Check:
- PostgreSQL and Redis services are healthy
- The `DATABASE_URL` and `REDIS_URL` environment variables are correct
- Container logs: `docker logs agentctl-dast`

### ZAP reports too many false positives

Update `infra/zap/rules.tsv` to suppress the specific rule IDs. Always include a justification explaining why the finding is a false positive for this application.

### WebSocket fuzz cannot connect

The WebSocket endpoint requires the `@fastify/websocket` plugin to be registered. Ensure the control-plane is fully initialized before the fuzz scan starts. The workflow includes a health check gate to handle this.
