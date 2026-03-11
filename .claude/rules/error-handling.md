---
triggers:
  - typescript
  - javascript
  - error
  - exception
  - logging
  - pino
always_on: true
last_reviewed: "2026-03-12"
---

# Error Handling and Logging Rules

Critical guardrails for error handling and logging in AgentCTL code. These rules are always active.

## Error Pattern

Always use typed error classes with error codes, never bare `throw new Error("msg")`:

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

## Async Error Handling

- Always handle promise rejections
- Use `try/catch` in every async function
- Never let unhandled rejections propagate silently

## Logging

- Use pino, not console.log
- Every log must include: `agentId`, `machineId`, `taskId` where applicable
- Log levels: `error` (needs human attention), `warn` (degraded but working), `info` (business events), `debug` (dev only)
- Never log sensitive data (API keys, user content, file contents)
