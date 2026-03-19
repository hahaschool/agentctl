import {
  APPROVALS_DEEP_LINK_URL,
  getApprovalNotificationDeepLink,
  handleInitialApprovalNotificationResponse,
  registerApprovalNotificationResponseListener,
} from './approval-notification-routing.js';

describe('approval notification routing', () => {
  it('maps route=approvals payloads to the approvals deep link', () => {
    expect(getApprovalNotificationDeepLink({ route: 'approvals' })).toBe(APPROVALS_DEEP_LINK_URL);
  });

  it('maps approval.pending notifications to the approvals deep link', () => {
    expect(getApprovalNotificationDeepLink({ type: 'approval.pending' })).toBe(
      APPROVALS_DEEP_LINK_URL,
    );
  });

  it('returns null for unrelated notification payloads', () => {
    expect(getApprovalNotificationDeepLink({ route: 'settings' })).toBeNull();
    expect(getApprovalNotificationDeepLink({ type: 'handoff.pending' })).toBeNull();
    expect(getApprovalNotificationDeepLink(null)).toBeNull();
  });

  it('opens the approvals deep link for the last notification response on startup', async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);

    await handleInitialApprovalNotificationResponse({
      getLastNotificationResponseAsync: async () => ({
        notification: {
          request: {
            content: {
              data: {
                type: 'approval.pending',
                route: 'approvals',
                requestId: 'req-123',
              },
            },
          },
        },
      }),
      openUrl,
    });

    expect(openUrl).toHaveBeenCalledWith(APPROVALS_DEEP_LINK_URL);
  });

  it('registers a notification tap listener that routes approval notifications and unsubscribes cleanly', async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    let listener:
      | ((response: { notification?: { request?: { content?: { data?: unknown } } } }) => void)
      | undefined;
    const remove = vi.fn();

    const unsubscribe = registerApprovalNotificationResponseListener({
      addNotificationResponseReceivedListener: (nextListener) => {
        listener = nextListener;
        return { remove };
      },
      openUrl,
    });

    listener?.({
      notification: {
        request: {
          content: {
            data: {
              route: 'approvals',
            },
          },
        },
      },
    });
    await vi.waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith(APPROVALS_DEEP_LINK_URL);
    });

    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });
});
