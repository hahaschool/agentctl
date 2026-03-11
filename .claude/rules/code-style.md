---
triggers:
  - typescript
  - javascript
  - react
  - node
  - testing
always_on: false
---

# Code Style Rules

## TypeScript

- Use `type` for object shapes, `interface` only when extending is needed
- Prefer `const` declarations, avoid `let`, never use `var`
- Use explicit return types on exported functions
- Use discriminated unions for state machines (agent status, task status)
- Error handling: use typed error classes with error codes, never bare `throw new Error("msg")`
- Async: always handle promise rejections, use `try/catch` in async functions
- Imports: group by external → internal → relative, separated by blank lines

## Error Pattern

```typescript
class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// Usage:
throw new AgentError('AGENT_TIMEOUT', 'Agent did not respond within 60s', { agentId, timeout: 60 });
```

## Logging

- Use pino, not console.log
- Every log must include: `agentId`, `machineId`, `taskId` where applicable
- Log levels: `error` (needs human attention), `warn` (degraded but working), `info` (business events), `debug` (dev only)
- Never log sensitive data (API keys, user content, file contents)

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
