---
triggers:
  - typescript
  - javascript
  - react
  - node
  - testing
always_on: false
last_reviewed: "2026-03-12"
---

# Code Style Rules

On-demand style rules for TypeScript, React, and Node.js code in AgentCTL. Loaded when working on TS/JS files.

## TypeScript

- Use `type` for object shapes, `interface` only when extending is needed
- Prefer `const` declarations, avoid `let`, never use `var`
- Use explicit return types on exported functions
- Use discriminated unions for state machines (agent status, task status)
- Imports: group by external → internal → relative, separated by blank lines

## File Naming

- Source files: `kebab-case.ts` (e.g., `agent-worker.ts`, `task-scheduler.ts`)
- Types/interfaces: `PascalCase` (e.g., `AgentConfig`, `TaskResult`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_CONCURRENT_AGENTS`)
- Directories: `kebab-case` (e.g., `control-plane`, `agent-worker`)

## Testing

- Test files: `*.test.ts` next to source files
- Use `describe/it` blocks with descriptive names
- Test behavior, not implementation
- Mock external services (Redis, PostgreSQL, Claude API) at the boundary
