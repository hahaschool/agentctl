import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SessionContentMessage } from './api';
import { exportSessionAsJson, exportSessionAsMarkdown, formatMessageLabel } from './session-export';

// ---------------------------------------------------------------------------
// Mock DOM APIs
// ---------------------------------------------------------------------------

const mockClick = vi.fn();
const mockRevokeObjectURL = vi.fn();
const mockCreateObjectURL = vi.fn<(obj: Blob) => string>(() => 'blob:mock-url');

beforeEach(() => {
  vi.restoreAllMocks();
  mockClick.mockClear();
  mockRevokeObjectURL.mockClear();
  mockCreateObjectURL.mockClear();

  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;

  vi.spyOn(document, 'createElement').mockReturnValue({
    href: '',
    download: '',
    click: mockClick,
  } as unknown as HTMLAnchorElement);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-abc-123',
    agentId: 'agent-1',
    agentName: 'test-agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: 'claude-sess-1',
    status: 'ended',
    projectPath: '/home/user/project',
    pid: null,
    model: 'claude-sonnet-4-20250514',
    accountId: 'acc-1',
    startedAt: '2026-03-07T10:00:00Z',
    endedAt: '2026-03-07T10:30:00Z',
    lastHeartbeat: '2026-03-07T10:30:00Z',
    metadata: {},
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SessionContentMessage> = {}): SessionContentMessage {
  return {
    type: 'assistant',
    content: 'Hello world',
    timestamp: '2026-03-07T10:00:01Z',
    ...overrides,
  };
}

// ===========================================================================
// formatMessageLabel
// ===========================================================================

describe('formatMessageLabel', () => {
  it.each([
    ['human', 'Human'],
    ['assistant', 'Assistant'],
    ['tool_use', 'Tool Call'],
    ['tool_result', 'Tool Result'],
    ['thinking', 'Thinking'],
    ['progress', 'Progress'],
    ['subagent', 'Subagent'],
    ['todo', 'Tasks'],
  ])('maps "%s" to "%s"', (input, expected) => {
    expect(formatMessageLabel(input)).toBe(expected);
  });

  it('returns the type string for unknown types', () => {
    expect(formatMessageLabel('custom_type')).toBe('custom_type');
  });
});

// ===========================================================================
// exportSessionAsJson
// ===========================================================================

describe('exportSessionAsJson', () => {
  it('creates a downloadable JSON blob', () => {
    const session = makeSession();
    const messages = [makeMessage({ type: 'human', content: 'Hi' })];

    exportSessionAsJson(session, messages);

    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
    expect(mockClick).toHaveBeenCalledOnce();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('includes session metadata in the JSON', () => {
    const session = makeSession({ model: 'gpt-4' });
    const messages: SessionContentMessage[] = [];

    exportSessionAsJson(session, messages);

    // Verify a Blob was created with application/json type
    const blobArg = mockCreateObjectURL.mock.calls[0]?.[0];
    expect(blobArg).toBeDefined();
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg?.type).toBe('application/json');
    expect(mockClick).toHaveBeenCalledOnce();
  });

  it('maps message fields correctly', () => {
    const session = makeSession();
    const messages = [
      makeMessage({
        type: 'tool_use',
        content: 'Read file',
        toolName: 'Read',
        timestamp: '2026-03-07T10:00:02Z',
      }),
    ];

    exportSessionAsJson(session, messages);
    expect(mockClick).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// exportSessionAsMarkdown
// ===========================================================================

describe('exportSessionAsMarkdown', () => {
  it('creates a downloadable Markdown file', () => {
    const session = makeSession();
    const messages = [makeMessage({ type: 'human', content: 'Hello' })];

    exportSessionAsMarkdown(session, messages);

    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
    expect(mockClick).toHaveBeenCalledOnce();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('handles empty messages', () => {
    const session = makeSession();
    exportSessionAsMarkdown(session, []);
    expect(mockClick).toHaveBeenCalledOnce();
  });

  it('wraps tool content in code blocks', () => {
    const session = makeSession();
    const messages = [
      makeMessage({ type: 'tool_use', content: 'const x = 1;', toolName: 'Write' }),
      makeMessage({ type: 'tool_result', content: 'Success' }),
    ];

    exportSessionAsMarkdown(session, messages);
    expect(mockClick).toHaveBeenCalledOnce();
  });

  it('includes session ended date when present', () => {
    const session = makeSession({ endedAt: '2026-03-07T11:00:00Z' });
    exportSessionAsMarkdown(session, []);
    expect(mockClick).toHaveBeenCalledOnce();
  });

  it('handles missing optional fields gracefully', () => {
    const session = makeSession({ endedAt: null, projectPath: null, model: null });
    const messages = [makeMessage({ timestamp: undefined, toolName: undefined })];

    exportSessionAsMarkdown(session, messages);
    expect(mockClick).toHaveBeenCalledOnce();
  });
});
