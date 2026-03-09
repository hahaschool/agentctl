# Cross-machine session transfer

**Status:** Roadmap
**Created:** 2026-03-06

## Problem

When forking a session or creating a new session, the user currently cannot choose a different machine. The new session always runs on the same machine as the source. Users need the ability to transfer/migrate sessions across machines in the fleet (EC2, Mac Mini, Laptop).

## Use cases

1. **Fork to a different machine** — A session on the laptop ran out of resources; fork it to EC2 with the same context
2. **New session on specific machine** — Start a new session targeting a machine with GPU or more CPU
3. **Load balancing** — Manually move work to a less-loaded machine

## Design

### Frontend changes

- Add a **machine selector** dropdown to:
  - The "New Session" form (already has agent/model selectors)
  - The fork dialog / ForkContextPicker modal
  - The resume prompt area (optional — lower priority)
- Machine selector shows: hostname, status (online/offline), OS/arch, and current load
- Offline machines are shown but disabled
- Default: same machine as source session (for fork) or first online machine (for new)

### API changes

- `POST /api/sessions` — already accepts `machineId`, just needs frontend to pass it
- `POST /api/sessions/:id/fork` — add optional `targetMachineId` parameter
- Worker dispatch: control plane routes the create/fork request to the target machine's worker

### Worker changes

- When forking to a different machine:
  1. Control plane creates the new session record with `targetMachineId`
  2. Target worker receives the start command
  3. Context (selected messages) is passed as the initial prompt/system context
  4. Git state: target machine must have the repo; use bare-repo push/pull pattern
  5. If repo is missing on target, return clear error: "Repository not available on {hostname}"

### Edge cases

- Target machine offline → show error, don't allow selection
- Target machine missing the project repo → error on fork attempt with actionable message
- Git worktree conflicts → create a fresh worktree on target machine

## Implementation order

1. Add machine selector to "New Session" form (simplest, just pass machineId)
2. Add machine selector to ForkContextPicker modal
3. Verify worker dispatch routes to correct machine
4. Handle missing-repo error gracefully
