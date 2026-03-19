import { expect, type Page, test } from '@playwright/test';

const THREAD_ID = 'thread-playwright-approval';
const CREATED_AT = '2026-03-20T00:00:00.000Z';
const DECIDED_AT = '2026-03-20T00:05:00.000Z';

type DecisionAction = 'approved' | 'rejected';
type ApprovalGateStatus = 'pending' | 'approved' | 'rejected';

type ApprovalGate = {
  id: string;
  taskDefinitionId: string;
  taskRunId: string | null;
  threadId: string | null;
  requiredApprovers: string[];
  requiredCount: number;
  timeoutMs: number;
  timeoutPolicy: 'pause';
  contextArtifactIds: string[];
  status: ApprovalGateStatus;
  createdAt: string;
};

type ApprovalDecision = {
  id: string;
  gateId: string;
  decidedBy: string;
  action: DecisionAction;
  comment: string | null;
  viaTimeout: boolean;
  decidedAt: string;
};

function createGate(overrides: Partial<ApprovalGate>): ApprovalGate {
  return {
    id: 'gate-default',
    taskDefinitionId: 'deploy-release',
    taskRunId: 'task-run-1',
    threadId: THREAD_ID,
    requiredApprovers: ['ops', 'security'],
    requiredCount: 1,
    timeoutMs: 300_000,
    timeoutPolicy: 'pause',
    contextArtifactIds: ['artifact-1'],
    status: 'pending',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function createDecision(overrides: Partial<ApprovalDecision>): ApprovalDecision {
  return {
    id: 'decision-default',
    gateId: 'gate-default',
    decidedBy: 'operator',
    action: 'approved',
    comment: null,
    viaTimeout: false,
    decidedAt: DECIDED_AT,
    ...overrides,
  };
}

async function interceptApprovalsApi(
  page: Page,
  handler: (request: {
    method: string;
    pathname: string;
    searchParams: URLSearchParams;
    body: unknown;
  }) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (!url.pathname.startsWith('/api/approvals')) {
      await route.abort();
      return;
    }

    const postData = request.postData();
    const body = postData ? JSON.parse(postData) : undefined;
    const response = await handler({
      method: request.method(),
      pathname: url.pathname,
      searchParams: url.searchParams,
      body,
    });

    await route.fulfill({
      status: response.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
}

test.describe('Approvals page', () => {
  test('loads a thread and renders pending approval controls', async ({ page }) => {
    let releaseListResponse: (() => void) | null = null;
    const listResponseGate = new Promise<void>((resolve) => {
      releaseListResponse = resolve;
    });

    await interceptApprovalsApi(page, async ({ method, pathname, searchParams }) => {
      if (method === 'GET' && pathname === '/api/approvals') {
        expect(searchParams.get('threadId')).toBe(THREAD_ID);
        await listResponseGate;
        return {
          body: [
            createGate({
              id: 'gate-pending',
              taskDefinitionId: 'deploy-release',
              status: 'pending',
            }),
            createGate({
              id: 'gate-approved',
              taskDefinitionId: 'publish-changelog',
              status: 'approved',
            }),
          ],
        };
      }

      if (method === 'GET' && pathname === '/api/approvals/gate-pending') {
        return {
          body: {
            ...createGate({
              id: 'gate-pending',
              taskDefinitionId: 'deploy-release',
              status: 'pending',
            }),
            decisions: [],
          },
        };
      }

      if (method === 'GET' && pathname === '/api/approvals/gate-approved') {
        return {
          body: {
            ...createGate({
              id: 'gate-approved',
              taskDefinitionId: 'publish-changelog',
              status: 'approved',
            }),
            decisions: [
              createDecision({
                id: 'decision-approved',
                gateId: 'gate-approved',
                decidedBy: 'release-bot',
              }),
            ],
          },
        };
      }

      return { status: 404, body: { error: 'NOT_FOUND', message: 'Not found' } };
    });

    await page.goto('/approvals');

    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Enter a thread ID above to load approval gates.')).toBeVisible();

    const loadButton = page.getByRole('button', { name: 'Load' });
    await page.getByLabel('Thread ID').fill(THREAD_ID);
    await loadButton.click();

    await expect(loadButton).toBeDisabled();
    releaseListResponse?.();

    await expect(page.getByText(`Showing gates for thread: ${THREAD_ID}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
    await expect(page.getByRole('button', { name: /deploy-release/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Resolved \(1\)/ })).toBeVisible();

    await page.getByRole('button', { name: /deploy-release/i }).click();

    await expect(page.getByText('Required approvers')).toBeVisible();
    await expect(page.getByText('ops, security')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
  });

  test('approving a pending gate refreshes the page into a resolved state', async ({ page }) => {
    let gateStatus: ApprovalGateStatus = 'pending';
    let decisions: ApprovalDecision[] = [];
    let postedDecision: { decidedBy: string; action: DecisionAction } | null = null;

    await interceptApprovalsApi(page, ({ method, pathname, searchParams, body }) => {
      if (method === 'GET' && pathname === '/api/approvals') {
        expect(searchParams.get('threadId')).toBe(THREAD_ID);
        return {
          body: [
            createGate({
              id: 'gate-pending',
              taskDefinitionId: 'deploy-release',
              status: gateStatus,
            }),
          ],
        };
      }

      if (method === 'GET' && pathname === '/api/approvals/gate-pending') {
        return {
          body: {
            ...createGate({
              id: 'gate-pending',
              taskDefinitionId: 'deploy-release',
              status: gateStatus,
            }),
            decisions,
          },
        };
      }

      if (method === 'POST' && pathname === '/api/approvals/gate-pending/decisions') {
        postedDecision = body as { decidedBy: string; action: DecisionAction };
        gateStatus = postedDecision.action === 'approved' ? 'approved' : 'rejected';
        decisions = [
          createDecision({
            id: 'decision-after-click',
            gateId: 'gate-pending',
            decidedBy: postedDecision.decidedBy,
            action: postedDecision.action,
          }),
        ];

        return {
          body: decisions[0],
        };
      }

      return { status: 404, body: { error: 'NOT_FOUND', message: 'Not found' } };
    });

    await page.goto('/approvals');

    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByLabel('Thread ID').fill(THREAD_ID);
    await page.getByRole('button', { name: 'Load' }).click();

    await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();

    await page.getByRole('button', { name: /deploy-release/i }).click();
    await page.getByRole('button', { name: 'Approve' }).click();

    await expect
      .poll(() => postedDecision)
      .toEqual({
        decidedBy: 'operator',
        action: 'approved',
      });

    await expect(page.getByText('All gates resolved. No pending approvals.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending (1)' })).toHaveCount(0);

    const resolvedToggle = page.getByRole('button', { name: /Resolved \(1\)/ });
    await expect(resolvedToggle).toBeVisible();
    await resolvedToggle.click();
    await page.getByRole('button', { name: /deploy-release/i }).click();

    await expect(page.getByText('operator')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  });
});
