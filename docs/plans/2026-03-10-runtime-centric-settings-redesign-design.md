# Runtime-centric settings redesign

> Date: 2026-03-10
> Status: Approved
> Scope: Settings IA, runtime-centric access model, multi-machine runtime inventory, and mixed managed/local credential handling

## Summary

The current Settings experience is still organised around provider accounts and a single global default model. That model no longer matches the product:

- managed runtimes already exist for `claude-code` and `codex`
- runtime configuration is already persisted and rendered per runtime
- worker machines can differ in installed runtimes, local authentication, and drift state
- future runtimes should not require another settings rewrite

The recommended design is to make `runtime` the primary settings entity and treat credentials as one possible input into runtime execution, not the top-level object.

## Validated constraints

### Product constraints

- Settings must be runtime-centric rather than provider-centric.
- The system must support multiple worker machines.
- The system must support mixed custody:
  - control-plane-managed credentials
  - worker-local discovered credentials
- Worker-local credentials may be referenced without takeover.
- Worker-local credentials may also be adopted into control-plane custody.
- Runtime switching must be configurable.
- Default automatic switching should be limited to failure failover.

### Existing codebase constraints

- The current web settings IA is grouped as `API Accounts`, `Appearance & Preferences`, and `System`.
- The current preferences UI exposes a single global default model and currently only lists Claude models.
- The current account model is provider-centric and does not include an OpenAI/Codex-specific access path.
- Managed runtime infrastructure already exists for `claude-code` and `codex`.
- Runtime config persistence already supports runtime-specific overrides such as `.claude/...` and `.codex/config.toml`.
- A full backend re-architecture is larger than the first UI redesign slice; the first implementation should align the UI and shared types with the runtime-centric model while staying reviewable.

## Problems with the current Settings model

### 1. Wrong top-level object

The UI assumes the operator thinks in terms of provider accounts. In reality they think in terms of:

- which runtime to use
- where that runtime can run
- how that runtime gets access
- how that runtime should fail over

### 2. No multi-machine mental model

The current settings flow does not show:

- which worker has which runtime installed
- which worker is authenticated
- which worker has locally discovered credentials
- which worker has drifted from the managed config

### 3. No mixed-custody model

The current account list cannot distinguish between:

- credentials stored in the control plane
- credentials discovered on a worker and kept local
- credentials mirrored from control plane to worker
- credentials pending takeover

### 4. Model defaults are not runtime-aware

`codex` and `claude-code` should not share a single default model selector. Each runtime has distinct model families, auth flows, and native config files.

## Approaches considered

### 1. Patch the current provider-centric page

Add `OpenAI` and `Codex` to the current account flow and expand the model dropdown.

Pros:

- small diff
- fast to ship

Cons:

- preserves the wrong mental model
- does not solve multi-machine visibility
- does not solve mixed custody
- does not scale to more runtimes

### 2. Runtime control center (recommended)

Make runtime profiles the primary settings entity and organise credentials, workers, sync, and switching policy around them.

Pros:

- matches the existing runtime-management backend
- naturally supports `claude-code`, `codex`, and future runtimes
- provides a place for multi-machine status and discovery flows
- keeps credential handling as a subordinate concern

Cons:

- larger UI redesign
- requires some shared type and API surface expansion

### 3. Full orchestration console

Split settings into separate consoles for runtimes, workers, credentials, routing, and automation policies.

Pros:

- strongest long-term operability

Cons:

- too heavy for the first redesign slice
- introduces avoidable complexity before the runtime-centric model is validated

## Recommended information architecture

Settings should become a control plane for runtime execution with four first-class sections.

### Runtime Profiles

Each runtime gets its own profile card, starting with:

- `claude-code`
- `codex`

Each profile owns:

- default model
- access source preference
- allowed machine scope
- sandbox and approval defaults
- runtime switching policy
- runtime-specific overrides

### Credentials & Access

Credentials are listed as runtime-usable access records, not raw provider accounts.

Each record must display:

- compatible runtime(s)
- provider
- source
- custody
- origin machine
- health state
- available actions

Recommended source states:

- `managed`
- `discovered-local`
- `managed-mirrored-to-worker`
- `takeover-pending`

### Workers & Sync

Each worker shows runtime-by-runtime readiness:

- installed
- authenticated
- discovered local access records
- mirrored managed credentials
- effective model
- drift state
- last sync / last health check

### Routing & Autonomy

Global policy section for:

- runtime selection resolution chain
- failure failover policy
- optional optimization-based runtime switching
- handoff and fallback reasoning

## Recommended configuration model

The system should evolve toward two layers:

### 1. Desired state

- runtime profiles
- project/runtime overrides
- machine/runtime defaults
- managed credentials
- machine credential bindings

### 2. Observed state

- machine runtime inventory
- discovered local credentials
- authentication state
- drift state
- applied config revision

This separates what the control plane wants from what each worker actually has.

## Proposed entities

### `runtime_profile`

Fields:

- `runtime`
- `defaultModel`
- `accessStrategy`
- `allowedMachineIds`
- `sandbox`
- `approvalPolicy`
- `switchingPolicy`
- `runtimeOverrides`

### `runtime_credential`

Represents a runtime-usable credential rather than just a provider account.

Fields:

- `id`
- `provider`
- `runtimeCompatibility`
- `source`
- `custody`
- `status`
- `maskedDisplay`
- `fingerprint`
- `metadata`
- `originMachineId`

### `machine_runtime_inventory`

Observed per-machine runtime state.

Fields:

- `machineId`
- `runtime`
- `installed`
- `authenticated`
- `effectiveModel`
- `lastAppliedConfigVersion`
- `driftStatus`
- `discoveredCredentialIds`
- `mirroredCredentialIds`
- `lastHealthCheckAt`

### `machine_credential_binding`

Desired machine/runtime access binding.

Modes:

- `mirror-managed`
- `reference-local`
- `disabled`

## Resolution chain

The default resolution chain should be:

`session override -> agent runtime profile -> project override -> machine runtime default -> global runtime default`

This resolves to:

- runtime
- model
- selected machine
- access source strategy
- concrete credential binding

It should not resolve directly to a raw provider account.

## Runtime switching policy

Runtime switching must be configurable at profile level, with optional narrower overrides at the agent or session level.

Supported modes:

- `locked`
- `failover-only`
- `optimization-enabled`

Default:

- `failover-only`

Optimization reasons may include:

- cost
- latency
- model affinity

Failure reasons may include:

- auth failure
- rate limit
- machine unavailable
- runtime unavailable

## Key flows

### Discover local credentials

Worker scans local runtime config and auth state, then reports:

- masked identifier
- fingerprint
- compatible runtime
- origin machine
- auth state

By default, the raw secret stays on the worker.

### Reference a local credential

The operator can bind a discovered local credential to a runtime profile or a specific machine without taking custody of the secret.

### Adopt a local credential

The operator can explicitly take over a discovered local credential. This imports the secret into encrypted control-plane storage and converts it into a managed credential while retaining provenance to the original local record.

### Mirror a managed credential

The control plane can push a managed credential to a target worker for a specific runtime. The worker reports the files written, auth result, and resulting drift state.

## Settings page interaction design

Use a left-side section nav and a right-side working canvas instead of one long vertical form.

Recommended sections:

1. `Overview`
2. `Runtime Profiles`
3. `Credentials & Access`
4. `Workers & Sync`
5. `Routing & Autonomy`

Credential creation should be split into three explicit actions:

- `Add managed credential`
- `Adopt discovered credential`
- `Reference local credential`

This avoids conflating secret creation, takeover, and local-only usage.

## First implementation slice

### In scope

- Replace the old provider-centric settings IA with a runtime-centric layout
- Add explicit runtime profile panels for `claude-code` and `codex`
- Make model defaults runtime-specific
- Add worker/runtime inventory panels
- Surface discovered-local vs managed access states in the UI
- Add runtime switching policy controls with `failover-only` as the default
- Keep the first iteration compatible with existing backend data where possible

### Out of scope

- Full backend data-model migration in one slice
- Batch orchestration for mass credential rollout
- Full agent-editing redesign
- Automatically enabling credential takeover by default

## Testing expectations

The redesign should be verified with:

- view-level unit tests for the new settings IA
- interaction tests for runtime selection, access strategy, and switching policy controls
- regression coverage for existing account CRUD where preserved
- page-load and settings smoke coverage

## Recommendation

Ship the runtime-centric settings redesign in an incremental slice:

1. Introduce runtime-centric UI and shared view model
2. Preserve compatibility with current account and runtime-config APIs where practical
3. Expand backend APIs after the new operating model is stable in the UI

This gives the product the correct mental model immediately without forcing a full platform migration in one change.
