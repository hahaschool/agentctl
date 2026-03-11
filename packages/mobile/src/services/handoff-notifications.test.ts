import { describe, expect, it, vi } from 'vitest';
import type { HandoffNotificationEvent } from './handoff-notifications.js';
import { HandoffNotificationService } from './handoff-notifications.js';

function makeEvent(partial: Partial<HandoffNotificationEvent> = {}): HandoffNotificationEvent {
  return {
    handoffId: 'handoff-1',
    sourceRuntime: 'claude-code',
    targetRuntime: 'codex',
    reason: 'manual',
    status: 'succeeded',
    sessionId: 'session-1',
    ...partial,
  };
}

describe('HandoffNotificationService', () => {
  it('fires notifications for new handoff events', async () => {
    const scheduleNotification = vi.fn().mockResolvedValue('notif-1');
    const requestPermissions = vi.fn().mockResolvedValue('granted');
    const service = new HandoffNotificationService({ scheduleNotification, requestPermissions });
    await service.initialize();

    const ids = await service.processHandoffEvents([makeEvent()]);
    expect(ids).toEqual(['notif-1']);
    expect(scheduleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Handoff'),
        body: expect.stringContaining('Codex'),
        data: expect.objectContaining({ handoffId: 'handoff-1' }),
      }),
    );
  });

  it('does not fire duplicate notifications for the same handoff', async () => {
    const scheduleNotification = vi.fn().mockResolvedValue('notif-1');
    const requestPermissions = vi.fn().mockResolvedValue('granted');
    const service = new HandoffNotificationService({ scheduleNotification, requestPermissions });
    await service.initialize();

    await service.processHandoffEvents([makeEvent()]);
    await service.processHandoffEvents([makeEvent()]);
    expect(scheduleNotification).toHaveBeenCalledTimes(1);
  });

  it('skips notifications when permissions are denied', async () => {
    const scheduleNotification = vi.fn();
    const requestPermissions = vi.fn().mockResolvedValue('denied');
    const service = new HandoffNotificationService({ scheduleNotification, requestPermissions });
    await service.initialize();

    const ids = await service.processHandoffEvents([makeEvent()]);
    expect(ids).toEqual([]);
    expect(scheduleNotification).not.toHaveBeenCalled();
  });

  it('respects markSeen to skip already-known handoffs', async () => {
    const scheduleNotification = vi.fn().mockResolvedValue('notif-1');
    const requestPermissions = vi.fn().mockResolvedValue('granted');
    const service = new HandoffNotificationService({ scheduleNotification, requestPermissions });
    await service.initialize();

    service.markSeen(['handoff-1']);
    const ids = await service.processHandoffEvents([makeEvent()]);
    expect(ids).toEqual([]);
    expect(scheduleNotification).not.toHaveBeenCalled();
  });

  it('builds correct title for failed handoffs', async () => {
    const scheduleNotification = vi.fn().mockResolvedValue('notif-1');
    const requestPermissions = vi.fn().mockResolvedValue('granted');
    const service = new HandoffNotificationService({ scheduleNotification, requestPermissions });
    await service.initialize();

    await service.processHandoffEvents([makeEvent({ status: 'failed', handoffId: 'h-fail' })]);
    expect(scheduleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Failed'),
      }),
    );
  });
});
