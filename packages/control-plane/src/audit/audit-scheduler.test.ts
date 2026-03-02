import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepeatableJobInfo, RepeatableJobManager } from '../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData } from '../scheduler/task-queue.js';
import type { AuditScheduler, AuditSchedulerDeps } from './audit-scheduler.js';
import { createAuditScheduler } from './audit-scheduler.js';
import type { SecurityAuditReport, SecurityFinding } from './security-audit-agent.js';
import { createDefaultAuditConfig } from './security-audit-agent.js';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    child: () => makeLogger(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Mock RepeatableJobManager
// ---------------------------------------------------------------------------

function makeJobManager(overrides: Partial<RepeatableJobManager> = {}): RepeatableJobManager {
  return {
    addCronJob: vi.fn().mockResolvedValue(undefined),
    addHeartbeatJob: vi.fn().mockResolvedValue(undefined),
    removeJobsByAgentId: vi.fn().mockResolvedValue(0),
    listRepeatableJobs: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    checkId: 'hardcoded-secrets',
    severity: 'critical',
    file: 'src/config.ts',
    line: 42,
    description: 'Hardcoded API key found',
    recommendation: 'Use environment variables instead',
    snippet: 'const API_KEY = "sk-live-abc123"',
    ...overrides,
  };
}

function makeReport(overrides: Partial<SecurityAuditReport> = {}): SecurityAuditReport {
  const findings = overrides.findings ?? [];
  const summary = overrides.summary ?? {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
    total: findings.length,
  };

  return {
    id: 'audit-1234567890',
    agentId: 'security-audit-agent',
    startedAt: new Date('2026-03-01T02:00:00Z'),
    completedAt: new Date('2026-03-01T02:15:00Z'),
    findings,
    summary,
    checksRun: 12,
    checksSkipped: 0,
    ...overrides,
  };
}

function makeScheduledJobInfo(agentId = 'security-audit-agent'): RepeatableJobInfo {
  return {
    key: `cron:${agentId}::0 2 * * *`,
    name: 'agent:cron',
    pattern: '0 2 * * *',
    every: null,
    next: 1709344800000,
  };
}

// =============================================================================
// createAuditScheduler — factory
// =============================================================================

describe('createAuditScheduler', () => {
  let logger: Logger;
  let jobManager: RepeatableJobManager;
  let deps: AuditSchedulerDeps;
  let scheduler: AuditScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    jobManager = makeJobManager();
    deps = { jobManager, logger };
    scheduler = createAuditScheduler(deps);
  });

  it('returns an object with all expected methods', () => {
    expect(typeof scheduler.schedule).toBe('function');
    expect(typeof scheduler.unschedule).toBe('function');
    expect(typeof scheduler.isScheduled).toBe('function');
    expect(typeof scheduler.getNextRunTime).toBe('function');
    expect(typeof scheduler.reschedule).toBe('function');
    expect(typeof scheduler.processAuditResult).toBe('function');
    expect(typeof scheduler.shouldAlert).toBe('function');
    expect(typeof scheduler.formatAlertMessage).toBe('function');
  });

  it('accepts partial config overrides', () => {
    const custom = createAuditScheduler(deps, { schedule: '0 3 * * *' });
    expect(custom).toBeDefined();
  });

  it('uses default config when no overrides are provided', () => {
    const s = createAuditScheduler(deps);
    expect(s).toBeDefined();
  });

  // ===========================================================================
  // schedule()
  // ===========================================================================

  describe('schedule()', () => {
    it('calls addCronJob with the default agent ID', async () => {
      await scheduler.schedule();

      expect(jobManager.addCronJob).toHaveBeenCalledOnce();
      const [agentId] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentId).toBe('security-audit-agent');
    });

    it('calls addCronJob with the default schedule', async () => {
      await scheduler.schedule();

      const [, cronExpression] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(cronExpression).toBe('0 2 * * *');
    });

    it('calls addCronJob with a custom schedule when overridden', async () => {
      const custom = createAuditScheduler(deps, { schedule: '0 4 * * 1' });
      await custom.schedule();

      const [, cronExpression] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(cronExpression).toBe('0 4 * * 1');
    });

    it('passes job data with trigger set to "schedule"', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.trigger).toBe('schedule');
    });

    it('passes job data with sessionMode set to "fresh"', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.sessionMode).toBe('fresh');
    });

    it('passes job data with allowedTools set to read-only tools', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });

    it('passes job data with a non-null prompt', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.prompt).toBeTruthy();
      expect(typeof jobData.prompt).toBe('string');
    });

    it('passes job data with the prompt containing audit instructions', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.prompt).toContain('Security Audit');
      expect(jobData.prompt).toContain('hardcoded-secrets');
    });

    it('passes job data with the correct agentId', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.agentId).toBe('security-audit-agent');
    });

    it('passes job data with machineId set to "control-plane"', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.machineId).toBe('control-plane');
    });

    it('passes job data with a non-null model', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.model).toBeTruthy();
      expect(typeof jobData.model).toBe('string');
    });

    it('passes job data with resumeSession set to null', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.resumeSession).toBeNull();
    });

    it('passes job data with a valid ISO createdAt timestamp', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(() => new Date(jobData.createdAt)).not.toThrow();
      expect(new Date(jobData.createdAt).toISOString()).toBe(jobData.createdAt);
    });

    it('logs info after scheduling', async () => {
      await scheduler.schedule();

      expect(logger.info).toHaveBeenCalled();
      const [context, message] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((context as Record<string, unknown>).agentId).toBe('security-audit-agent');
      expect(typeof message).toBe('string');
    });

    it('throws AUDIT_ALREADY_SCHEDULED if the job already exists', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      await expect(scheduler.schedule()).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'AUDIT_ALREADY_SCHEDULED',
      });
    });

    it('includes agentId in error context when already scheduled', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      let thrown: ControlPlaneError | null = null;
      try {
        await scheduler.schedule();
      } catch (err) {
        thrown = err as ControlPlaneError;
      }

      expect(thrown).not.toBeNull();
      expect(thrown?.context?.agentId).toBe('security-audit-agent');
    });

    it('does not call addCronJob when already scheduled', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      try {
        await scheduler.schedule();
      } catch {
        // expected
      }

      expect(jobManager.addCronJob).not.toHaveBeenCalled();
    });

    it('propagates errors from addCronJob', async () => {
      (jobManager.addCronJob as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('CRON_JOB_ADD_FAILED', 'Redis down', {}),
      );

      await expect(scheduler.schedule()).rejects.toMatchObject({
        code: 'CRON_JOB_ADD_FAILED',
      });
    });

    it('uses custom agentId from config overrides', async () => {
      const custom = createAuditScheduler(deps, { agentId: 'custom-audit' });
      await custom.schedule();

      const [agentId] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentId).toBe('custom-audit');
    });

    it('uses custom allowedTools from config overrides in job data', async () => {
      const custom = createAuditScheduler(deps, {
        allowedTools: ['Read', 'Glob'],
      });
      await custom.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.allowedTools).toEqual(['Read', 'Glob']);
    });
  });

  // ===========================================================================
  // unschedule()
  // ===========================================================================

  describe('unschedule()', () => {
    it('calls removeJobsByAgentId with the correct agentId', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await scheduler.unschedule();

      expect(jobManager.removeJobsByAgentId).toHaveBeenCalledWith('security-audit-agent');
    });

    it('throws AUDIT_NOT_SCHEDULED when no jobs are removed', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await expect(scheduler.unschedule()).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'AUDIT_NOT_SCHEDULED',
      });
    });

    it('includes agentId in error context when not scheduled', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      let thrown: ControlPlaneError | null = null;
      try {
        await scheduler.unschedule();
      } catch (err) {
        thrown = err as ControlPlaneError;
      }

      expect(thrown).not.toBeNull();
      expect(thrown?.context?.agentId).toBe('security-audit-agent');
    });

    it('succeeds when removeJobsByAgentId returns a positive count', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await expect(scheduler.unschedule()).resolves.toBeUndefined();
    });

    it('logs info after successful unschedule', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await scheduler.unschedule();

      expect(logger.info).toHaveBeenCalled();
      const [context] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((context as Record<string, unknown>).agentId).toBe('security-audit-agent');
    });

    it('logs the removed count', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(2);

      await scheduler.unschedule();

      const [context] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((context as Record<string, unknown>).removedCount).toBe(2);
    });

    it('propagates errors from removeJobsByAgentId', async () => {
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('REPEATABLE_JOB_REMOVE_FAILED', 'Redis error', {}),
      );

      await expect(scheduler.unschedule()).rejects.toMatchObject({
        code: 'REPEATABLE_JOB_REMOVE_FAILED',
      });
    });

    it('uses custom agentId from config overrides', async () => {
      const custom = createAuditScheduler(deps, { agentId: 'my-audit' });
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await custom.unschedule();

      expect(jobManager.removeJobsByAgentId).toHaveBeenCalledWith('my-audit');
    });
  });

  // ===========================================================================
  // isScheduled()
  // ===========================================================================

  describe('isScheduled()', () => {
    it('returns false when no repeatable jobs exist', async () => {
      const result = await scheduler.isScheduled();
      expect(result).toBe(false);
    });

    it('returns true when a matching job exists', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      const result = await scheduler.isScheduled();
      expect(result).toBe(true);
    });

    it('returns false when only other agents have jobs', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo('other-agent'),
      ]);

      const result = await scheduler.isScheduled();
      expect(result).toBe(false);
    });

    it('calls listRepeatableJobs once', async () => {
      await scheduler.isScheduled();
      expect(jobManager.listRepeatableJobs).toHaveBeenCalledOnce();
    });

    it('returns true among multiple jobs when one matches', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo('other-agent'),
        makeScheduledJobInfo('security-audit-agent'),
      ]);

      const result = await scheduler.isScheduled();
      expect(result).toBe(true);
    });

    it('propagates errors from listRepeatableJobs', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('REPEATABLE_JOB_LIST_FAILED', 'Redis gone', {}),
      );

      await expect(scheduler.isScheduled()).rejects.toMatchObject({
        code: 'REPEATABLE_JOB_LIST_FAILED',
      });
    });
  });

  // ===========================================================================
  // getNextRunTime()
  // ===========================================================================

  describe('getNextRunTime()', () => {
    it('returns null when no repeatable jobs exist', async () => {
      const result = await scheduler.getNextRunTime();
      expect(result).toBeNull();
    });

    it('returns the next timestamp when a matching job exists', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      const result = await scheduler.getNextRunTime();
      expect(result).toBe(1709344800000);
    });

    it('returns null when only other agents have jobs', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo('other-agent'),
      ]);

      const result = await scheduler.getNextRunTime();
      expect(result).toBeNull();
    });

    it('returns null when the matching job has a null next field', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        { ...makeScheduledJobInfo(), next: null },
      ]);

      const result = await scheduler.getNextRunTime();
      expect(result).toBeNull();
    });

    it('calls listRepeatableJobs once', async () => {
      await scheduler.getNextRunTime();
      expect(jobManager.listRepeatableJobs).toHaveBeenCalledOnce();
    });

    it('returns the correct timestamp when multiple jobs exist', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo('other-agent'),
        { ...makeScheduledJobInfo(), next: 9999999999999 },
      ]);

      const result = await scheduler.getNextRunTime();
      expect(result).toBe(9999999999999);
    });

    it('propagates errors from listRepeatableJobs', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('REPEATABLE_JOB_LIST_FAILED', 'Redis gone', {}),
      );

      await expect(scheduler.getNextRunTime()).rejects.toMatchObject({
        code: 'REPEATABLE_JOB_LIST_FAILED',
      });
    });
  });

  // ===========================================================================
  // reschedule()
  // ===========================================================================

  describe('reschedule()', () => {
    it('removes existing jobs and adds a new one with the updated cron', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await scheduler.reschedule('0 3 * * *');

      expect(jobManager.removeJobsByAgentId).toHaveBeenCalledWith('security-audit-agent');
      expect(jobManager.addCronJob).toHaveBeenCalledOnce();
    });

    it('passes the new cron expression to addCronJob', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await scheduler.reschedule('*/30 * * * *');

      const [, cronExpression] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(cronExpression).toBe('*/30 * * * *');
    });

    it('throws AUDIT_INVALID_CRON for an invalid cron expression', async () => {
      await expect(scheduler.reschedule('not a cron')).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'AUDIT_INVALID_CRON',
      });
    });

    it('includes the invalid expression in error context', async () => {
      let thrown: ControlPlaneError | null = null;
      try {
        await scheduler.reschedule('bad');
      } catch (err) {
        thrown = err as ControlPlaneError;
      }

      expect(thrown).not.toBeNull();
      expect(thrown?.context?.cronExpression).toBe('bad');
    });

    it('throws AUDIT_INVALID_CRON for empty string', async () => {
      await expect(scheduler.reschedule('')).rejects.toMatchObject({
        code: 'AUDIT_INVALID_CRON',
      });
    });

    it('throws AUDIT_INVALID_CRON for 6-field cron (seconds)', async () => {
      await expect(scheduler.reschedule('0 0 2 * * *')).rejects.toMatchObject({
        code: 'AUDIT_INVALID_CRON',
      });
    });

    it('throws AUDIT_INVALID_CRON for 4-field partial cron', async () => {
      await expect(scheduler.reschedule('0 2 * *')).rejects.toMatchObject({
        code: 'AUDIT_INVALID_CRON',
      });
    });

    it('does not call removeJobsByAgentId for an invalid cron', async () => {
      try {
        await scheduler.reschedule('bad cron');
      } catch {
        // expected
      }

      expect(jobManager.removeJobsByAgentId).not.toHaveBeenCalled();
    });

    it('succeeds even when no existing job is scheduled', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await scheduler.reschedule('0 5 * * *');

      expect(jobManager.removeJobsByAgentId).not.toHaveBeenCalled();
      expect(jobManager.addCronJob).toHaveBeenCalledOnce();
    });

    it('logs info after rescheduling', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await scheduler.reschedule('0 6 * * *');

      expect(logger.info).toHaveBeenCalled();
      const [context] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((context as Record<string, unknown>).schedule).toBe('0 6 * * *');
    });

    it('passes updated job data with the new prompt after rescheduling', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await scheduler.reschedule('0 8 * * *');

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      expect(jobData.prompt).toBeTruthy();
      expect(jobData.trigger).toBe('schedule');
    });

    it('propagates errors from addCronJob', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (jobManager.addCronJob as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('CRON_JOB_ADD_FAILED', 'queue full', {}),
      );

      await expect(scheduler.reschedule('0 9 * * *')).rejects.toMatchObject({
        code: 'CRON_JOB_ADD_FAILED',
      });
    });

    it('propagates errors from removeJobsByAgentId', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ControlPlaneError('REPEATABLE_JOB_REMOVE_FAILED', 'fail', {}),
      );

      await expect(scheduler.reschedule('0 10 * * *')).rejects.toMatchObject({
        code: 'REPEATABLE_JOB_REMOVE_FAILED',
      });
    });

    it('accepts valid 5-field cron with wildcards', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await expect(scheduler.reschedule('* * * * *')).resolves.toBeUndefined();
    });

    it('accepts valid 5-field cron with ranges and lists', async () => {
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await expect(scheduler.reschedule('0 9 * * 1-5')).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // processAuditResult()
  // ===========================================================================

  describe('processAuditResult()', () => {
    it('returns a SecurityAuditReport from a valid JSON response', () => {
      const json = JSON.stringify({
        findings: [
          {
            checkId: 'hardcoded-secrets',
            severity: 'critical',
            file: 'src/config.ts',
            line: 42,
            description: 'Hardcoded API key',
            recommendation: 'Use env vars',
          },
        ],
        checksRun: 12,
        checksSkipped: 0,
      });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      const report = scheduler.processAuditResult(response);

      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].checkId).toBe('hardcoded-secrets');
      expect(report.checksRun).toBe(12);
    });

    it('returns an empty report for empty response', () => {
      const report = scheduler.processAuditResult('');

      expect(report.findings).toEqual([]);
      expect(report.summary.total).toBe(0);
    });

    it('returns an empty report for malformed JSON', () => {
      const report = scheduler.processAuditResult('```json\n{invalid}\n```');

      expect(report.findings).toEqual([]);
    });

    it('computes summary counts correctly', () => {
      const findings = [
        {
          checkId: 'a',
          severity: 'critical',
          file: '1.ts',
          description: 'd',
          recommendation: 'r',
        },
        { checkId: 'b', severity: 'high', file: '2.ts', description: 'd', recommendation: 'r' },
        { checkId: 'c', severity: 'medium', file: '3.ts', description: 'd', recommendation: 'r' },
      ];
      const json = JSON.stringify({ findings, checksRun: 3, checksSkipped: 0 });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      const report = scheduler.processAuditResult(response);

      expect(report.summary.critical).toBe(1);
      expect(report.summary.high).toBe(1);
      expect(report.summary.medium).toBe(1);
      expect(report.summary.total).toBe(3);
    });

    it('logs info with report ID and finding counts', () => {
      const json = JSON.stringify({
        findings: [
          {
            checkId: 'a',
            severity: 'critical',
            file: 'x.ts',
            description: 'd',
            recommendation: 'r',
          },
        ],
        checksRun: 1,
        checksSkipped: 0,
      });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      scheduler.processAuditResult(response);

      expect(logger.info).toHaveBeenCalled();
      const [context] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((context as Record<string, unknown>).reportId).toMatch(/^audit-/);
      expect((context as Record<string, unknown>).totalFindings).toBe(1);
    });

    it('logs debug with the generated summary', () => {
      const json = JSON.stringify({ findings: [], checksRun: 0, checksSkipped: 0 });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      scheduler.processAuditResult(response);

      expect(logger.debug).toHaveBeenCalled();
      const [context] = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((context as Record<string, unknown>).summary).toBeDefined();
      expect(typeof (context as Record<string, unknown>).summary).toBe('string');
    });

    it('handles response with text surrounding the JSON block', () => {
      const json = JSON.stringify({
        findings: [
          {
            checkId: 'test',
            severity: 'low',
            file: 'a.ts',
            description: 'd',
            recommendation: 'r',
          },
        ],
        checksRun: 1,
        checksSkipped: 0,
      });
      const response = `Here are the results:\n\n\`\`\`json\n${json}\n\`\`\`\n\nDone.`;

      const report = scheduler.processAuditResult(response);

      expect(report.findings).toHaveLength(1);
    });

    it('returns a report with Date objects for startedAt and completedAt', () => {
      const json = JSON.stringify({ findings: [], checksRun: 0, checksSkipped: 0 });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      const report = scheduler.processAuditResult(response);

      expect(report.startedAt).toBeInstanceOf(Date);
      expect(report.completedAt).toBeInstanceOf(Date);
    });
  });

  // ===========================================================================
  // shouldAlert()
  // ===========================================================================

  describe('shouldAlert()', () => {
    it('returns true when report has critical findings', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });

      expect(scheduler.shouldAlert(report)).toBe(true);
    });

    it('returns true when report has high findings', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'high', checkId: 'container-security' })],
      });

      expect(scheduler.shouldAlert(report)).toBe(true);
    });

    it('returns true when report has both critical and high findings', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical' }),
          makeFinding({ severity: 'high', checkId: 'container-security', file: 'b.ts' }),
        ],
      });

      expect(scheduler.shouldAlert(report)).toBe(true);
    });

    it('returns false when report has only medium findings', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'medium', checkId: 'cors-config' })],
      });

      expect(scheduler.shouldAlert(report)).toBe(false);
    });

    it('returns false when report has only low findings', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'low', checkId: 'permission-checks' })],
      });

      expect(scheduler.shouldAlert(report)).toBe(false);
    });

    it('returns false when report has no findings', () => {
      const report = makeReport({ findings: [] });

      expect(scheduler.shouldAlert(report)).toBe(false);
    });

    it('returns false when report has medium and low but no critical or high', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'medium', checkId: 'cors-config' }),
          makeFinding({ severity: 'low', checkId: 'permission-checks', file: 'b.ts' }),
        ],
      });

      expect(scheduler.shouldAlert(report)).toBe(false);
    });

    it('returns true with a single critical finding among many low findings', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'low', checkId: 'permission-checks', file: 'a.ts' }),
          makeFinding({ severity: 'low', checkId: 'permission-checks', file: 'b.ts' }),
          makeFinding({ severity: 'critical', file: 'c.ts' }),
        ],
      });

      expect(scheduler.shouldAlert(report)).toBe(true);
    });

    it('relies on summary counts, not individual finding inspection', () => {
      // Craft a report with zero-length findings array but nonzero summary
      const report = makeReport({
        findings: [],
        summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 },
      });

      expect(scheduler.shouldAlert(report)).toBe(true);
    });
  });

  // ===========================================================================
  // formatAlertMessage()
  // ===========================================================================

  describe('formatAlertMessage()', () => {
    it('includes "Security Audit Alert" in the message', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('Security Audit Alert');
    });

    it('includes the total finding count', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical' }),
          makeFinding({ severity: 'high', checkId: 'sql-injection', file: 'b.ts' }),
        ],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('2 finding(s)');
    });

    it('includes the CRITICAL count when present', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('CRITICAL: 1');
    });

    it('includes the HIGH count when present', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'high', checkId: 'container-security' })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('HIGH: 1');
    });

    it('includes MEDIUM count when present', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical' }),
          makeFinding({ severity: 'medium', checkId: 'cors-config', file: 'b.ts' }),
        ],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('MEDIUM: 1');
    });

    it('includes LOW count when present', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical' }),
          makeFinding({ severity: 'low', checkId: 'permission-checks', file: 'c.ts' }),
        ],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('LOW: 1');
    });

    it('omits severity lines with zero count', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).not.toContain('HIGH:');
      expect(message).not.toContain('MEDIUM:');
      expect(message).not.toContain('LOW:');
    });

    it('includes the file path for critical/high findings', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical', file: 'src/secrets.ts', line: 10 })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('src/secrets.ts:10');
    });

    it('includes file path without line number when line is not set', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical', file: 'src/config.ts', line: undefined })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('src/config.ts');
      expect(message).not.toContain('src/config.ts:');
    });

    it('includes the checkId for each listed finding', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical', checkId: 'hardcoded-secrets' })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('hardcoded-secrets');
    });

    it('includes the description for critical/high findings', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical', description: 'Found AWS access key in source' }),
        ],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('Found AWS access key in source');
    });

    it('limits listed findings to 5', () => {
      const findings = Array.from({ length: 7 }, (_, i) =>
        makeFinding({
          severity: 'critical',
          checkId: `check-${i}`,
          file: `file-${i}.ts`,
          description: `Finding ${i}`,
        }),
      );
      const report = makeReport({ findings });

      const message = scheduler.formatAlertMessage(report);

      // Should show first 5
      expect(message).toContain('check-0');
      expect(message).toContain('check-4');
      // Should not show 6th and 7th
      expect(message).not.toContain('check-5');
      expect(message).not.toContain('check-6');
    });

    it('shows a "... and N more" message when findings exceed 5', () => {
      const findings = Array.from({ length: 8 }, (_, i) =>
        makeFinding({
          severity: 'critical',
          checkId: `check-${i}`,
          file: `file-${i}.ts`,
        }),
      );
      const report = makeReport({ findings });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('... and 3 more');
    });

    it('does not show "... and N more" when findings are exactly 5', () => {
      const findings = Array.from({ length: 5 }, (_, i) =>
        makeFinding({
          severity: 'critical',
          checkId: `check-${i}`,
          file: `file-${i}.ts`,
        }),
      );
      const report = makeReport({ findings });

      const message = scheduler.formatAlertMessage(report);
      expect(message).not.toContain('... and');
    });

    it('does not list medium/low findings in the detail section', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical', file: 'a.ts' }),
          makeFinding({
            severity: 'medium',
            checkId: 'cors-config',
            file: 'b.ts',
            description: 'CORS misconfigured',
          }),
        ],
      });

      const message = scheduler.formatAlertMessage(report);
      // The critical finding should be listed
      expect(message).toContain('[CRITICAL]');
      // The medium finding description should not appear as a listed item
      expect(message).not.toContain('[MEDIUM]');
    });

    it('includes the agentId in the footer', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('Agent: security-audit-agent');
    });

    it('includes the report ID in the footer', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
        id: 'audit-9876543210',
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('Report: audit-9876543210');
    });

    it('formats an alert for a report with no findings', () => {
      const report = makeReport({ findings: [] });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('0 finding(s)');
      expect(message).toContain('Agent: security-audit-agent');
    });

    it('uses uppercase severity tags in finding list items', () => {
      const report = makeReport({
        findings: [
          makeFinding({ severity: 'critical', file: 'a.ts' }),
          makeFinding({
            severity: 'high',
            checkId: 'container-security',
            file: 'b.ts',
          }),
        ],
      });

      const message = scheduler.formatAlertMessage(report);
      expect(message).toContain('[CRITICAL]');
      expect(message).toContain('[HIGH]');
    });
  });

  // ===========================================================================
  // Job data construction (integration-style)
  // ===========================================================================

  describe('job data construction', () => {
    it('builds job data that conforms to AgentTaskJobData shape', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];

      // Verify all required fields exist
      expect(jobData).toHaveProperty('agentId');
      expect(jobData).toHaveProperty('machineId');
      expect(jobData).toHaveProperty('prompt');
      expect(jobData).toHaveProperty('model');
      expect(jobData).toHaveProperty('trigger');
      expect(jobData).toHaveProperty('allowedTools');
      expect(jobData).toHaveProperty('resumeSession');
      expect(jobData).toHaveProperty('createdAt');
      expect(jobData).toHaveProperty('sessionMode');
    });

    it('generates a prompt that includes all default checks', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      const prompt = jobData.prompt as string;

      const defaultConfig = createDefaultAuditConfig();
      for (const check of defaultConfig.checks) {
        expect(prompt).toContain(check.id);
      }
    });

    it('generates a prompt that excludes disabled checks from config overrides', async () => {
      const checks = createDefaultAuditConfig().checks.map((c) =>
        c.id === 'tls-config' ? { ...c, enabled: false } : c,
      );
      const custom = createAuditScheduler(deps, { checks });
      await custom.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];
      const prompt = jobData.prompt as string;

      expect(prompt).not.toContain('[tls-config]');
    });

    it('does not include write tools in the allowedTools', async () => {
      await scheduler.schedule();

      const [, , jobData] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];

      expect(jobData.allowedTools).not.toContain('Write');
      expect(jobData.allowedTools).not.toContain('Edit');
      expect(jobData.allowedTools).not.toContain('Bash');
    });

    it('allowedTools in job data is a copy, not a shared reference', async () => {
      await scheduler.schedule();

      const [, , jobData1] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];

      // Clear mock and schedule again
      (jobManager.addCronJob as ReturnType<typeof vi.fn>).mockClear();
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const scheduler2 = createAuditScheduler(deps);
      await scheduler2.schedule();

      const [, , jobData2] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        AgentTaskJobData,
      ];

      expect(jobData1.allowedTools).not.toBe(jobData2.allowedTools);
      expect(jobData1.allowedTools).toEqual(jobData2.allowedTools);
    });
  });

  // ===========================================================================
  // End-to-end scenario tests
  // ===========================================================================

  describe('end-to-end scenarios', () => {
    it('schedule then unschedule succeeds', async () => {
      // Schedule
      await scheduler.schedule();
      expect(jobManager.addCronJob).toHaveBeenCalledOnce();

      // Now the job exists
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      // Unschedule
      await scheduler.unschedule();
      expect(jobManager.removeJobsByAgentId).toHaveBeenCalledWith('security-audit-agent');
    });

    it('schedule then reschedule updates the cron', async () => {
      await scheduler.schedule();

      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);
      (jobManager.removeJobsByAgentId as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (jobManager.addCronJob as ReturnType<typeof vi.fn>).mockClear();

      await scheduler.reschedule('0 4 * * *');

      const [, cronExpression] = (jobManager.addCronJob as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(cronExpression).toBe('0 4 * * *');
    });

    it('process result and check alert for critical findings', () => {
      const json = JSON.stringify({
        findings: [
          {
            checkId: 'hardcoded-secrets',
            severity: 'critical',
            file: 'src/config.ts',
            line: 10,
            description: 'API key exposed',
            recommendation: 'Use env vars',
          },
        ],
        checksRun: 12,
        checksSkipped: 0,
      });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      const report = scheduler.processAuditResult(response);
      expect(scheduler.shouldAlert(report)).toBe(true);

      const alert = scheduler.formatAlertMessage(report);
      expect(alert).toContain('CRITICAL: 1');
      expect(alert).toContain('hardcoded-secrets');
    });

    it('process result and check no alert for clean report', () => {
      const json = JSON.stringify({
        findings: [],
        checksRun: 12,
        checksSkipped: 0,
      });
      const response = `\`\`\`json\n${json}\n\`\`\``;

      const report = scheduler.processAuditResult(response);
      expect(scheduler.shouldAlert(report)).toBe(false);
    });

    it('isScheduled reflects state before and after scheduling', async () => {
      // Not scheduled initially
      expect(await scheduler.isScheduled()).toBe(false);

      // After scheduling
      await scheduler.schedule();
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      expect(await scheduler.isScheduled()).toBe(true);
    });

    it('getNextRunTime reflects state before and after scheduling', async () => {
      // No next run time initially
      expect(await scheduler.getNextRunTime()).toBeNull();

      // After scheduling
      await scheduler.schedule();
      (jobManager.listRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeScheduledJobInfo(),
      ]);

      const nextRun = await scheduler.getNextRunTime();
      expect(nextRun).toBe(1709344800000);
    });
  });
});
