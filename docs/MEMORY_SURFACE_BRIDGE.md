# MEMORY.md Surface Bridge

The Surface A bridge promotes reviewed PostgreSQL memory facts into Claude
Code's project `MEMORY.md` file without editing human-curated lines directly.

## Dry Run

Generate a proposal first:

```bash
pnpm tsx scripts/generate-memory-md.ts \
  --project-path /Users/hahaschool/agentctl \
  --control-plane-url http://127.0.0.1:4111
```

The dry run prints:

- the target `MEMORY.md` path
- scoped and reviewed fact counts
- a unified diff
- the full proposed `MEMORY.md`
- a write approval token

The token is deterministic for the exact target path, current file hash, scope,
and proposed generated block. If the source facts or existing `MEMORY.md` change,
the token changes.

## Request Approval

After reviewing the dry-run diff, create a durable approval gate:

```bash
pnpm tsx scripts/generate-memory-md.ts \
  --project-path /Users/hahaschool/agentctl \
  --control-plane-url http://127.0.0.1:4111 \
  --request-approval
```

The approval gate uses `taskDefinitionId=memory.surface-a.write` and binds
`taskRunId` to the write approval token. The write step refuses any gate that is
pending, rejected, for another task definition, or bound to a stale token.

## Approved Write

After the gate is approved through `/api/approvals`, write the proposal:

```bash
pnpm tsx scripts/generate-memory-md.ts \
  --project-path /Users/hahaschool/agentctl \
  --control-plane-url http://127.0.0.1:4111 \
  --write \
  --approval-token <token-from-dry-run> \
  --approval-gate-id <approved-gate-id>
```

Write mode recomputes the proposal before touching disk. A stale token,
mismatched approval gate, or unapproved gate fails without modifying
`MEMORY.md`.

## Safety

- The generated proposal changes only the managed block between
  `<!-- agentctl-memory-md:start -->` and `<!-- agentctl-memory-md:end -->`.
- Manual content outside that block is preserved.
- Incomplete or malformed generated markers stop the run and require manual
  reconciliation.
- Reviewed facts remain explicit by default: `reviewed=true`,
  `metadata.reviewed=true`, `source.reviewed=true`, or a `reviewed` /
  `surface-a-reviewed` tag.
