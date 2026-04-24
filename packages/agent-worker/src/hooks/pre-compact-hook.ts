#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PreCompact Hook Script — run by Claude Code CLI as a subprocess
//
// Claude Code invokes this script via the `hooks.PreCompact` entry in
// ~/.claude/settings.json immediately before compacting the context window.
//
// Input:  JSON payload on stdin (Claude Code hook format)
// Output: JSON on stdout with optional `injectedSystemPrompt`
// Exit:   Always 0 — the CLI must not be blocked regardless of worker status
//
// Behaviour:
//   1. Read and parse stdin JSON within 250ms
//   2. Extract relevant fields from the hook payload
//   3. POST to the worker's local HTTP API with a 500ms timeout
//   4. Write an empty JSON object to stdout
//   5. Exit 0 unconditionally
//
// The worker API returns 202 immediately; the actual memory capture happens
// asynchronously there. This script only needs to notify the worker.
//
// Environment variables:
//   AGENTCTL_WORKER_PORT   — port the agent-worker HTTP server is listening on
//   AGENTCTL_SESSION_ID    — the agentctl session ID (not the Claude session ID)
//   AGENTCTL_AGENT_ID      — the agent ID
//   AGENTCTL_MACHINE_ID    — the machine ID
// ---------------------------------------------------------------------------

import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKER_PORT = process.env.AGENTCTL_WORKER_PORT ?? '9000';
const SESSION_ID = process.env.AGENTCTL_SESSION_ID ?? '';
const AGENT_ID = process.env.AGENTCTL_AGENT_ID ?? '';
const MACHINE_ID = process.env.AGENTCTL_MACHINE_ID ?? '';

/** Max ms to wait for stdin to arrive before giving up. */
const STDIN_TIMEOUT_MS = 250;

/** Max ms to wait for the worker HTTP response. */
const WORKER_TIMEOUT_MS = 500;

/** Max number of recent messages to forward to the worker. */
const MAX_MESSAGES = 20;

// ---------------------------------------------------------------------------
// Types for Claude Code's PreCompact hook payload
// ---------------------------------------------------------------------------

type HookMessage = {
  role?: string;
  content?: string | { type?: string; text?: string }[];
};

type PreCompactHookPayload = {
  session_id?: string;
  context_size_tokens?: number;
  messages?: HookMessage[];
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessageText(msg: HookMessage): string {
  const role = msg.role ?? 'unknown';
  let text = '';

  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter(
        (block): block is { type?: string; text?: string } =>
          typeof block === 'object' && block !== null,
      )
      .map((block) => block.text ?? '')
      .filter(Boolean)
      .join(' ');
  }

  return `${role}: ${text.slice(0, 500)}`;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const rl = createInterface({ input: process.stdin });

    const timer = setTimeout(() => {
      rl.close();
      resolve(data);
    }, STDIN_TIMEOUT_MS);

    rl.on('line', (line) => {
      data += line;
    });

    rl.on('close', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function notifyWorker(payload: PreCompactHookPayload): Promise<void> {
  if (!SESSION_ID) {
    // No session ID configured — cannot notify worker
    return;
  }

  const recentMessages = (payload.messages ?? []).slice(-MAX_MESSAGES).map(extractMessageText);

  const body = JSON.stringify({
    agentId: AGENT_ID,
    machineId: MACHINE_ID,
    contextSizeTokens: payload.context_size_tokens,
    recentMessages,
  });

  const url = `http://127.0.0.1:${WORKER_PORT}/api/sessions/${SESSION_ID}/pre-compact`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let payload: PreCompactHookPayload = {};

  try {
    const raw = await readStdin();
    if (raw.trim()) {
      payload = JSON.parse(raw) as PreCompactHookPayload;
    }
  } catch {
    // Malformed stdin — continue with empty payload
  }

  try {
    await notifyWorker(payload);
  } catch {
    // Worker unreachable or timed out — do not block the CLI
  }

  // Write minimal valid JSON to stdout (no injectedSystemPrompt needed)
  process.stdout.write('{}\n');
}

// Run and always report success, but do not force process.exit(). Letting the
// event loop drain avoids truncating stdout when Claude Code reads the hook via a pipe.
main()
  .catch(() => {
    process.stdout.write('{}\n');
  })
  .finally(() => {
    process.exitCode = 0;
  });
