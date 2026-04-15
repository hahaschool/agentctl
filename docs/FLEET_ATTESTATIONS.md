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

## Related

- Build workflow: `.github/workflows/build-images.yml`
- Deploy workflow: `.github/workflows/deploy-fleet.yml`
- Migration gate reusable workflow: `.github/workflows/migration-check.yml`
- Roadmap section: [33.11](./ROADMAP.md#3311-fleet-rollout--peer-auto-update-p1-two-topology--in-progress)
- Mesh schema/protocol compat (separate but adjacent trust gate): [MESH_COMPAT.md](./MESH_COMPAT.md)
