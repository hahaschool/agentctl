import type { MobilePushDevice } from '@agentctl/shared';

const DEFAULT_EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const DEFAULT_TIMEOUT_MS = 10_000;

export type ExpoPushDispatcherOptions = {
  fetch?: typeof fetch;
  endpoint?: string;
  accessToken?: string;
  timeoutMs?: number;
};

export type ExpoPushApprovalPendingInput = {
  requestId: string;
  devices: ReadonlyArray<Pick<MobilePushDevice, 'id' | 'platform' | 'provider' | 'pushToken'>>;
};

export type ExpoPushDelivery = {
  token: string;
  ticketId?: string;
};

export type ExpoPushFailure = {
  token: string;
  message: string;
  details?: Record<string, unknown>;
  permanent: boolean;
};

export type ExpoPushDispatchResult = {
  deliveries: ExpoPushDelivery[];
  failures: ExpoPushFailure[];
};

type ExpoPushTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
};

type ExpoPushResponseBody = {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: unknown;
};

export class ExpoPushDispatcher {
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;

  constructor(options: ExpoPushDispatcherOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.endpoint = options.endpoint ?? DEFAULT_EXPO_PUSH_URL;
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async dispatchApprovalPending(
    input: ExpoPushApprovalPendingInput,
  ): Promise<ExpoPushDispatchResult> {
    if (input.devices.length === 0) {
      return { deliveries: [], failures: [] };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify(
          input.devices.map((device) => ({
            to: device.pushToken,
            sound: 'default',
            title: 'Approval required',
            body: 'Open AgentCTL to review a pending approval request.',
            data: {
              type: 'approval.pending',
              requestId: input.requestId,
              route: 'approvals',
            },
          })),
        ),
      });

      const body = await safeParseJson(response);

      if (!response.ok) {
        return {
          deliveries: [],
          failures: input.devices.map((device) => ({
            token: device.pushToken,
            message: `Expo push request failed with HTTP ${response.status}`,
            details: isRecord(body) ? body : undefined,
            permanent: false,
          })),
        };
      }

      const tickets = normalizeTickets(body);
      const deliveries: ExpoPushDelivery[] = [];
      const failures: ExpoPushFailure[] = [];

      for (const [index, device] of input.devices.entries()) {
        const ticket = tickets[index];

        if (ticket?.status === 'ok') {
          deliveries.push({
            token: device.pushToken,
            ticketId: typeof ticket.id === 'string' ? ticket.id : undefined,
          });
          continue;
        }

        const details = isRecord(ticket?.details) ? ticket.details : undefined;
        failures.push({
          token: device.pushToken,
          message: typeof ticket?.message === 'string' ? ticket.message : 'Expo push ticket failed',
          details,
          permanent: details?.error === 'DeviceNotRegistered',
        });
      }

      return { deliveries, failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        deliveries: [],
        failures: input.devices.map((device) => ({
          token: device.pushToken,
          message,
          permanent: false,
        })),
      };
    }
  }
}

async function safeParseJson(response: Response): Promise<ExpoPushResponseBody | undefined> {
  try {
    return (await response.json()) as ExpoPushResponseBody;
  } catch {
    return undefined;
  }
}

function normalizeTickets(body: ExpoPushResponseBody | undefined): ExpoPushTicket[] {
  if (!body?.data) {
    return [];
  }

  return Array.isArray(body.data) ? body.data : [body.data];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
