# Multi-Account Configuration Design

**Date:** 2026-03-04
**Status:** Approved

## Problem

AgentCTL currently uses a single `ANTHROPIC_API_KEY` environment variable per worker machine. There is no way to:

- Configure multiple API keys or Claude Max subscriptions
- Assign different accounts to different agents, projects, or sessions
- Automatically fail over when one account hits rate limits
- Track cost per account/org

## Goals

1. Register and manage multiple accounts (API keys + Claude Max subscriptions + Bedrock/Vertex)
2. Configurable assignment cascade: session → agent → project → global default
3. Auto-failover across accounts when rate-limited
4. Settings UI for managing accounts, assignments, and failover policy
5. Hybrid architecture: Account Registry for assignment logic, LiteLLM for proxy routing

## Approach: Account Registry + LiteLLM Hybrid

Central `api_accounts` table stores encrypted credentials. Assignment follows a cascade chain. LiteLLM proxy is synced with accounts for routing/failover of proxy-mode requests. Direct SDK usage injects the resolved key into the worker environment.

## Data Model

### `api_accounts` table

```sql
CREATE TABLE api_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,      -- "anthropic_api" | "claude_max" | "bedrock" | "vertex"
  credential    TEXT NOT NULL,      -- AES-256-GCM encrypted
  credential_iv TEXT NOT NULL,
  priority      INT NOT NULL DEFAULT 0,
  rate_limit    JSONB DEFAULT '{}', -- { "itpm": 80000, "otpm": 16000 }
  is_active     BOOLEAN DEFAULT true,
  metadata      JSONB DEFAULT '{}', -- email, org_id, region, etc.
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

### `project_account_mappings` table

```sql
CREATE TABLE project_account_mappings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_path  TEXT NOT NULL UNIQUE,
  account_id    UUID NOT NULL REFERENCES api_accounts(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Existing table changes

- `agents`: add `account_id UUID REFERENCES api_accounts(id)` column
- `rc_sessions`: add `account_id UUID REFERENCES api_accounts(id)` column
- `settings` KV store (or new table): `default_account_id`, `failover_policy`

### Assignment cascade (runtime resolution)

```
session.account_id
  ?? agent.account_id
  ?? project_account_mappings[session.project_path]
  ?? settings.default_account_id
```

### Failover policies

- `none` — use assigned account only, fail if rate limited
- `priority` — on rate limit, try next active account by priority
- `round_robin` — distribute across all active accounts

## API Endpoints

### Account CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/accounts` | List all accounts (credentials masked) |
| POST | `/api/settings/accounts` | Create account |
| PUT | `/api/settings/accounts/:id` | Update account |
| DELETE | `/api/settings/accounts/:id` | Delete (fails if in-use) |
| POST | `/api/settings/accounts/:id/test` | Test connectivity |

### Assignment & Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/defaults` | Get global defaults |
| PUT | `/api/settings/defaults` | Update global defaults |
| GET | `/api/settings/project-accounts` | List project→account mappings |
| PUT | `/api/settings/project-accounts` | Upsert project→account mapping |
| DELETE | `/api/settings/project-accounts/:id` | Remove mapping |

### LiteLLM Sync

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/settings/accounts/:id/sync` | Push account to LiteLLM as deployment |

## Worker Integration

When the control plane dispatches a task to a worker:

1. Resolve account using the cascade chain
2. Decrypt the credential
3. Include `accountId` + decrypted credential in the dispatch payload (over Tailscale, encrypted in transit)
4. Worker sets `ANTHROPIC_API_KEY` (or provider-specific env var) for the subprocess
5. For Claude Max: worker runs `claude login --token <token>` before starting the SDK

For LiteLLM proxy mode:

1. Account is already synced as a LiteLLM deployment
2. Control plane includes `metadata.deployment_id` in the request
3. LiteLLM routes to the correct deployment

## Settings UI

### Accounts section (new in Settings page)

- **Account list**: Card per account with name, provider badge, masked credential, priority, active toggle
- **Add Account dialog**: Provider selector → credential input → name → priority
- **Test button**: Verify credential works before saving

### Assignment section

- **Global default**: Dropdown to select default account
- **Failover policy**: Radio group (none / priority / round_robin)
- **Project mappings**: Table of project_path → account with add/edit/remove

### Integration points

- **Agent detail page**: Account dropdown in info section
- **Session creation dialog**: Optional account override dropdown

## Security

- Credentials encrypted at rest with AES-256-GCM
- Encryption key from `CREDENTIAL_ENCRYPTION_KEY` env var (or derived from machine key)
- API responses never return raw credentials — always masked (`sk-ant-...xxxx`)
- Audit log entry for every account creation, update, deletion, and usage
- Credentials transmitted to workers only over Tailscale (WireGuard encrypted)

## Non-Goals (for now)

- Multi-tenant user auth (this is single-operator, not SaaS)
- OAuth flow for Claude Max login in the browser (use CLI token for now)
- Spending limits per account (rely on provider-side limits)
- Automatic credential rotation
