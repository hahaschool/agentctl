import { expect, type Page, type Route, test } from '@playwright/test';
import type { MemoryFact } from '@agentctl/shared';

const SESSION_ID = 'session-detail-e2e';
const CLAUDE_SESSION_ID = 'claude-session-detail-e2e';
const MACHINE_ID = 'machine-dev-1';
const PROJECT_PATH = '/Users/hahaschool/agentctl';
const NOW = '2026-04-15T09:00:00.000Z';
const ASSISTANT_MESSAGE = 'Route-level session detail smoke renders assistant output.';
const MEMORY_FACT = 'Session detail E2E should keep the route smoke thin and backend-independent.';

type ApiAccount = {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
  lastUsedAt: string | null;
};

const session = {
  id: SESSION_ID,
  agentId: 'agent-session-detail-e2e',
  agentName: 'Session Detail Auditor',
  machineId: MACHINE_ID,
  sessionUrl: null,
  claudeSessionId: CLAUDE_SESSION_ID,
  status: 'ended',
  projectPath: PROJECT_PATH,
  pid: null,
  startedAt: '2026-04-15T08:50:00.000Z',
  lastHeartbeat: '2026-04-15T08:59:00.000Z',
  endedAt: NOW,
  metadata: {
    costUsd: 0.125,
    inputTokens: 1200,
    outputTokens: 340,
  },
  accountId: 'acct-session-detail',
  model: 'gpt-5.4',
};

const account: ApiAccount = {
  id: 'acct-session-detail',
  provider: 'openai',
  name: 'Codex E2E Account',
  isActive: true,
  priority: 1,
  createdAt: '2026-04-01T00:00:00.000Z',
  lastUsedAt: NOW,
};

const fact: MemoryFact = {
  id: 'fact-session-detail-e2e',
  scope: 'session:session-detail-e2e',
  content: MEMORY_FACT,
  content_model: 'text-embedding-3-small',
  entity_type: 'decision',
  confidence: 0.93,
  strength: 0.81,
  source: {
    session_id: SESSION_ID,
    agent_id: 'agent-session-detail-e2e',
    machine_id: MACHINE_ID,
    turn_index: 2,
    extraction_method: 'manual',
  },
  valid_from: NOW,
  valid_until: null,
  created_at: NOW,
  accessed_at: NOW,
  tags: ['e2e', 'sessions'],
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockSessionDetailApis(page: Page): Promise<{
  readonly memoryFactRequests: URLSearchParams[];
}> {
  const memoryFactRequests: URLSearchParams[] = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const { pathname, searchParams } = url;

    if (method === 'GET' && pathname === '/api/sync/conflicts/count') {
      await fulfillJson(route, { count: 0 });
      return;
    }

    if (method === 'GET' && pathname === '/api/permission-requests') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'GET' && pathname === `/api/sessions/${SESSION_ID}`) {
      await fulfillJson(route, session);
      return;
    }

    if (
      method === 'GET' &&
      pathname === `/api/sessions/content/${encodeURIComponent(CLAUDE_SESSION_ID)}`
    ) {
      expect(searchParams.get('machineId')).toBe(MACHINE_ID);
      expect(searchParams.get('projectPath')).toBe(PROJECT_PATH);
      expect(searchParams.get('limit')).toBe('2000');

      await fulfillJson(route, {
        sessionId: CLAUDE_SESSION_ID,
        totalMessages: 2,
        messages: [
          {
            type: 'human',
            content: 'Summarize the session detail route coverage gap.',
            timestamp: '2026-04-15T08:55:00.000Z',
          },
          {
            type: 'assistant',
            content: ASSISTANT_MESSAGE,
            timestamp: '2026-04-15T08:56:00.000Z',
          },
        ],
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/settings/accounts') {
      await fulfillJson(route, [account]);
      return;
    }

    if (method === 'GET' && pathname === `/api/machines/${MACHINE_ID}/git/status`) {
      expect(searchParams.get('path')).toBe(PROJECT_PATH);
      await fulfillJson(route, {
        branch: 'codex/528-session-detail-e2e',
        worktree: PROJECT_PATH,
        isWorktree: true,
        bareRepo: null,
        status: {
          clean: true,
          staged: 0,
          modified: 0,
          untracked: 0,
          ahead: 0,
          behind: 0,
        },
        lastCommit: {
          hash: '56ae0b2',
          message: 'docs: sync roadmap after keyboard shortcut update',
          author: 'hahaschool',
          date: NOW,
        },
        worktrees: [{ path: PROJECT_PATH, branch: 'codex/528-session-detail-e2e', isMain: false }],
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/memory/facts') {
      memoryFactRequests.push(new URLSearchParams(searchParams));
      expect(searchParams.get('sessionId')).toBe(SESSION_ID);
      await fulfillJson(route, { ok: true, facts: [fact], total: 1 });
      return;
    }

    throw new Error(`Unhandled API request in session-detail e2e mock: ${method} ${pathname}`);
  });

  return { memoryFactRequests };
}

test.describe('Session detail route smoke', () => {
  test('renders ended session messages and session-scoped memory facts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await mockSessionDetailApis(page);

    await page.goto(`/sessions/${SESSION_ID}`);

    await expect(page.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      '/sessions',
    );
    await expect(page.getByLabel('ended: Session ended')).toBeVisible();
    await expect(page.getByText('Session Detail Auditor')).toBeVisible();
    await expect(page.getByText(ASSISTANT_MESSAGE)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('2 messages')).toBeVisible();
    await expect(page.getByText('gpt-5.4').first()).toBeVisible();

    await page.getByRole('button', { name: 'Memory', exact: true }).click();

    await expect(page.getByTestId('session-memory-facts')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(MEMORY_FACT)).toBeVisible();
    await expect(page.getByText('session:session-detail-e2e')).toBeVisible();
    await expect
      .poll(() => state.memoryFactRequests.at(-1)?.get('sessionId'), {
        message: 'memory tab requests facts scoped to the current session id',
      })
      .toBe(SESSION_ID);
  });
});
