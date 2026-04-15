# Fleet Image Attestations (Build Provenance)

Roadmap tracker: [33.11 Fleet Rollout & Peer Auto-Update — Wire build provenance + verification](./ROADMAP.md#3311-fleet-rollout--peer-auto-update-p1-two-topology--in-progress).

## What gets produced

Every GHCR image that `build-images.yml` publishes also ships a signed
[SLSA build-provenance attestation](https://slsa.dev/spec/v1.0/provenance)
produced by [`actions/attest-build-provenance@v2`](https://github.com/actions/attest-build-provenance).
The attestation is:

- **Keyed by the pushed image digest** (not the mutable tag), so it pins an
  immutable artifact.
- **Signed via Sigstore** using an OIDC token minted from the workflow's
  `id-token: write` permission — no long-lived signing key is stored in the
  repo.
- **Published to the repository's attestation store** (visible under
  *Security → Attestations* on GitHub) and mirrored into the OCI registry
  alongside the image (`push-to-registry: true`).

Coverage: both `control-plane` and `agent-worker` images are attested on
every `build-images.yml` run.

## How deploy-fleet enforces it

`deploy-fleet.yml` runs a `Verify build provenance attestation` step in the
`validate` job, which all deploy jobs (`canary-deploy`, `fleet-deploy`)
depend on. The step:

1. Resolves each target image's tag to a digest via
   `docker buildx imagetools inspect`.
2. Runs `gh attestation verify oci://ghcr.io/<owner>/<image>@<digest>
   --repo ${{ github.repository }}`.
3. Fails the workflow if any image is missing an attestation or the
   signature does not verify. `canary-deploy` and `fleet-deploy` never run,
   so no peer pulls the untrusted image.

Because the gate lives in the `validate` job (before any `docker pull`),
a single verification failure blocks the entire fleet rollout.

## Manual verification (for operators)

To verify an image locally before triggering a deploy:

```bash
# Resolve tag -> digest
DIGEST=$(docker buildx imagetools inspect \
  ghcr.io/hahaschool/agentctl/control-plane:v0.3.0 \
  --format '{{json .Manifest}}' | jq -r '.digest')

# Verify the attestation
gh attestation verify \
  "oci://ghcr.io/hahaschool/agentctl/control-plane@${DIGEST}" \
  --repo hahaschool/agentctl
```

A successful verification prints the signer identity (the workflow that
built the image) and the subject digest.

## Emergency escape-hatch: `skip_attestation_verification`

`deploy-fleet.yml` exposes a `workflow_dispatch` boolean input
`skip_attestation_verification` (default `false`). When set to `true`,
the verification step is skipped and the workflow logs a loud warning to
the step summary.

**Legitimate uses (only):**

- Rolling back to a pre-33.11 image tag that was built before attestations
  were wired up.
- Incident recovery where the attestation store is unreachable but the
  operator has independently verified the image (e.g. digest matches a
  previously-deployed, verified-good artifact).

**Illegitimate uses:**

- Routine deploys. If verification fails on a current tag, rebuild via
  `build-images.yml` so a fresh attestation is published — do not bypass.
- Deploying third-party images. This workflow only deploys images built
  by this repository.

Every use of the override is surfaced as a warning in the workflow's
step summary so it shows up in post-incident review.

## Migration gate

Since §33.11, `deploy-fleet.yml` also runs a **migration gate** before
`validate`. It reuses `.github/workflows/migration-check.yml` via
`workflow_call` so the exact same destructive-operation detector that
guards pull requests also guards rollouts.

The gate blocks any deploy whose pending migrations contain destructive
statements (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE TABLE`, `DROP CONSTRAINT`,
`ALTER COLUMN ... TYPE`). To unblock a *legitimate* destructive migration,
the operator re-runs the workflow with
`allow_destructive_migrations=true` in the workflow_dispatch dialog. The
gate still logs every destructive statement to the workflow step summary
for the audit trail even when bypassed.

This complements §33.10's envelope schema-ahead rejection:

- **Envelope compat gate (33.10)** handles *runtime drift between peers*
  (a schema-ahead producer refuses to talk to a lagging consumer).
- **Migration gate (33.11)** handles *deploy-time drift between the
  source tree and the target fleet database* (a schema-ahead deploy
  refuses to roll out until an operator confirms the destructive change
  is intended).

## Rollback

Both topologies support rollback, but the mechanics differ. In both cases
rollback is allowed to bypass the _fresh_ attestation verification because
the target tag was verified at the time it was originally applied — a
record of that verification is what authorises the bypass.

### PM2 topology — `agentctl peer update --rollback`

The PM2 peer-update CLI records every apply in
`~/.agentctl/update-history.json` (cap 100 entries). A rollback consults
that history to decide whether to skip `gh attestation verify`.

```bash
# Roll back to the previous successful tag (auto-target)
pnpm agentctl peer update --rollback

# Roll back to a specific previously-applied tag
pnpm agentctl peer update --tag v0.3.3 --rollback

# Inspect rollback history and mode per entry
cat ~/.agentctl/update-history.json | jq '.[] | {toTag, mode, rolledBackFrom, success, finishedAt}'
```

Key guarantees:

- **`--rollback` without `--tag`** resolves the target to the most recent
  non-dry-run, successful entry whose `toTag` differs from the currently
  checked-out tag. If no such entry exists, the CLI exits non-zero with
  `NO_ROLLBACK_TARGET`.
- **`--tag <v> --rollback`** refuses to proceed unless `<v>` appears in
  `update-history.json` as a previously-successful, non-dry-run entry.
  Exits non-zero with `ROLLBACK_TARGET_NOT_IN_HISTORY` otherwise. This is
  what prevents `--rollback` from being used to downgrade to an unverified
  tag.
- The attestation step is replaced by a warn-level log line ("skipping
  attestation verification: `<tag>` was previously verified-applied…")
  so rollbacks are visible in the operator's console and in the run JSON.
- The persisted history entry for a rollback is tagged with
  `mode: "rollback"` and `rolledBackFrom: "<previous tag>"`, making the
  history file auditable and distinguishable from forward-rolls.
- Forward-rolls via explicit `--tag <v>` (without `--rollback`) always
  run `gh attestation verify` — explicit targeting is not a bypass.

If the rollback itself fails (checkout, build, PM2 reload, or health
poll), the CLI exits non-zero and writes a failed history entry — it
does _not_ attempt a recursive rollback, because by definition we are
already on the "previous known-good" path.

### Docker topology — re-invoke `rollback.yml`

The Docker fleet rollback is already implemented as a manual workflow:
`.github/workflows/rollback.yml` (input: `environment`, `image_tag`).
To roll back:

1. Open the repository's **Actions → Rollback Deployment → Run workflow**.
2. Pick the target `environment` (`dev` or `production`).
3. Enter the prior image tag (e.g. a `sha-<shortsha>` or `vX.Y.Z-1`) that
   was previously deployed successfully.
4. Run the workflow.

Image attestation enforcement for rollback deploys is handled by
`deploy-fleet.yml`'s `validate` gate (see "How deploy-fleet enforces it"
above). If you need to roll back to a tag that predates 33.11 (and thus
was never attested), use the `skip_attestation_verification` escape
hatch on `deploy-fleet.yml` — see
"[Emergency escape-hatch](#emergency-escape-hatch-skip_attestation_verification)".
`rollback.yml` itself does not accept a skip-attestation input; the
trust decision lives in `deploy-fleet.yml`.

## Related

- Build workflow: `.github/workflows/build-images.yml`
- Deploy workflow: `.github/workflows/deploy-fleet.yml`
- Migration gate reusable workflow: `.github/workflows/migration-check.yml`
- Docker rollback workflow: `.github/workflows/rollback.yml`
- PM2 peer-update CLI: `scripts/peer-update.ts` (entrypoint: `pnpm peer-update`)
- Roadmap section: [33.11](./ROADMAP.md#3311-fleet-rollout--peer-auto-update-p1-two-topology--in-progress)
- Mesh schema/protocol compat (separate but adjacent trust gate): [MESH_COMPAT.md](./MESH_COMPAT.md)
