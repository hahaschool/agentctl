# Knowledge Sedimentation Rules

## Purpose

Keep project knowledge compact, reusable, and evidence-based. Not every session note
deserves to become permanent guidance.

## Promotion Ladder

1. **Session notes / local scratch**
   Use for one-off observations, work-in-progress reasoning, and temporary reminders.
2. **`docs/LESSONS_LEARNED.md`**
   Use for recurring pitfalls, debugging discoveries, and implementation gotchas.
3. **Topic docs**
   Use subsystem-specific knowledge in files such as `docs/ARCHITECTURE.md`,
   `docs/SECURITY_RUNBOOK.md`, or future focused docs.
4. **`CLAUDE.md`**
   Use only for repo-wide orientation, durable architecture truths, and broad operating
   guidance that most contributors should know up front.
5. **`.claude/rules/*.md`**
   Use for short, actionable rules that should activate for specific task contexts.

## When an Observation Becomes a Lesson

Promote an observation only when at least one of these is true:

- It has appeared in **2 or more sessions**.
- Missing it causes **irreversible damage**, security exposure, or expensive rework.
- It explains a **stable constraint** in the codebase or deployment model.
- It captures a **repeatable debugging pattern** that shortens future incident response.

If none of these are true, keep it in session-local notes.

## What Makes a Good Principle

A principle should be:

- **Falsifiable**: someone can tell when it does not apply.
- **Contextual**: it says where or when it matters.
- **Actionable**: it changes what an engineer should do next.
- **Outcome-linked**: it explains the consequence of ignoring it.

Bad:

- "Be careful with migrations."

Good:

- "Treat destructive database changes as deploy-time operations requiring backup + approval, because the CI migration check only validates generation, not production data safety."

## Routing Rules

### `docs/LESSONS_LEARNED.md`

Put knowledge here when it is:

- recurring,
- operationally useful,
- and still narrow enough that it should not clutter `CLAUDE.md`.

### Topic docs

Put knowledge here when it belongs to one subsystem:

- architecture and data flow → `docs/ARCHITECTURE.md`
- incidents / mitigations → `docs/SECURITY_RUNBOOK.md`
- external references → `docs/REFERENCE_INDEX.md`

### `CLAUDE.md`

Promote only when the guidance is:

- repo-wide,
- durable across multiple tasks,
- and useful as first-read orientation for a new contributor or agent.

### `.claude/rules/*.md`

Promote only when the knowledge can be expressed as:

- a short rule,
- tied to a clear trigger,
- and likely to prevent repeated mistakes during implementation.

Rules should not carry long-form explanation; keep the detail in docs and keep the
rule operational.

## Formatting Rules

Knowledge added to durable docs should be:

- **Atomic**: one lesson or principle per bullet/entry.
- **Standalone**: understandable without session transcript context.
- **Specific**: mention the subsystem, file area, or workflow it applies to.
- **Outcome-included**: say what breaks, regresses, or improves.
- **Deduplicated**: extend or replace an existing entry instead of adding near-duplicates.

## Review Rules

Before adding permanent knowledge:

1. Search whether the same lesson already exists.
2. Prefer updating the existing entry over appending a duplicate.
3. If the related code or workflow has been removed, archive or delete the old guidance.
4. If the lesson is uncertain or new, keep it in a lower layer first.

## Quick Heuristics

- **One-off fix**: keep local.
- **Second occurrence**: promote to `LESSONS_LEARNED.md`.
- **Subsystem truth**: promote to the relevant topic doc.
- **Repo-wide default**: promote to `CLAUDE.md`.
- **Short preventive instruction with a clear trigger**: promote to `.claude/rules/*.md`.
