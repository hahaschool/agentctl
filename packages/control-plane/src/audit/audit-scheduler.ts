import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { RepeatableJobManager } from '../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData } from '../scheduler/task-queue.js';
import type { SecurityAuditConfig, SecurityAuditReport } from './security-audit-agent.js';
import {
  createDefaultAuditConfig,
  generateAuditPrompt,
  parseAuditResponse,
  summarizeFindings,
} from './security-audit-agent.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_MACHINE_ID = 'control-plane';
const AUDIT_MODEL = 'claude-sonnet-4-20250514';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditSchedulerDeps = {
  jobManager: RepeatableJobManager;
  logger: Logger;
};

export type AuditScheduler = {
  schedule(): Promise<void>;
  unschedule(): Promise<void>;
  isScheduled(): Promise<boolean>;
  getNextRunTime(): Promise<number | null>;
  reschedule(cronExpression: string): Promise<void>;
  processAuditResult(response: string): SecurityAuditReport;
  shouldAlert(report: SecurityAuditReport): boolean;
  formatAlertMessage(report: SecurityAuditReport): string;
};

// ---------------------------------------------------------------------------
// Job data builder
// ---------------------------------------------------------------------------

function buildAuditJobData(config: SecurityAuditConfig): AgentTaskJobData {
  return {
    agentId: config.agentId,
    machineId: AUDIT_MACHINE_ID,
    prompt: generateAuditPrompt(config),
    model: AUDIT_MODEL,
    trigger: 'schedule',
    allowedTools: [...config.allowedTools],
    resumeSession: null,
    createdAt: new Date().toISOString(),
    sessionMode: 'fresh',
  };
}

// ---------------------------------------------------------------------------
// Cron validation
// ---------------------------------------------------------------------------

function isValidCronExpression(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  return parts.length === 5;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAuditScheduler(
  deps: AuditSchedulerDeps,
  configOverrides?: Partial<SecurityAuditConfig>,
): AuditScheduler {
  const { jobManager, logger } = deps;
  const config: SecurityAuditConfig = {
    ...createDefaultAuditConfig(),
    ...configOverrides,
  };

  return {
    // -----------------------------------------------------------------------
    // schedule
    // -----------------------------------------------------------------------
    async schedule(): Promise<void> {
      const already = await this.isScheduled();
      if (already) {
        throw new ControlPlaneError(
          'AUDIT_ALREADY_SCHEDULED',
          `Audit job for agent ${config.agentId} is already scheduled`,
          { agentId: config.agentId },
        );
      }

      const jobData = buildAuditJobData(config);

      await jobManager.addCronJob(config.agentId, config.schedule, jobData);

      logger.info(
        { agentId: config.agentId, schedule: config.schedule },
        'Scheduled security audit cron job',
      );
    },

    // -----------------------------------------------------------------------
    // unschedule
    // -----------------------------------------------------------------------
    async unschedule(): Promise<void> {
      const removed = await jobManager.removeJobsByAgentId(config.agentId);

      if (removed === 0) {
        throw new ControlPlaneError(
          'AUDIT_NOT_SCHEDULED',
          `No audit job found for agent ${config.agentId}`,
          { agentId: config.agentId },
        );
      }

      logger.info(
        { agentId: config.agentId, removedCount: removed },
        'Unscheduled security audit cron job',
      );
    },

    // -----------------------------------------------------------------------
    // isScheduled
    // -----------------------------------------------------------------------
    async isScheduled(): Promise<boolean> {
      const jobs = await jobManager.listRepeatableJobs();
      return jobs.some((job) => job.key.includes(config.agentId));
    },

    // -----------------------------------------------------------------------
    // getNextRunTime
    // -----------------------------------------------------------------------
    async getNextRunTime(): Promise<number | null> {
      const jobs = await jobManager.listRepeatableJobs();
      const auditJob = jobs.find((job) => job.key.includes(config.agentId));
      return auditJob?.next ?? null;
    },

    // -----------------------------------------------------------------------
    // reschedule
    // -----------------------------------------------------------------------
    async reschedule(cronExpression: string): Promise<void> {
      if (!isValidCronExpression(cronExpression)) {
        throw new ControlPlaneError(
          'AUDIT_INVALID_CRON',
          `Invalid cron expression: "${cronExpression}"`,
          { agentId: config.agentId, cronExpression },
        );
      }

      // Remove existing job(s) if any — ignore if none exist
      const jobs = await jobManager.listRepeatableJobs();
      const hasExisting = jobs.some((job) => job.key.includes(config.agentId));
      if (hasExisting) {
        await jobManager.removeJobsByAgentId(config.agentId);
      }

      // Update the internal config schedule
      config.schedule = cronExpression;

      const jobData = buildAuditJobData(config);
      await jobManager.addCronJob(config.agentId, cronExpression, jobData);

      logger.info(
        { agentId: config.agentId, schedule: cronExpression },
        'Rescheduled security audit cron job',
      );
    },

    // -----------------------------------------------------------------------
    // processAuditResult
    // -----------------------------------------------------------------------
    processAuditResult(response: string): SecurityAuditReport {
      const report = parseAuditResponse(response);
      const summary = summarizeFindings(report);

      logger.info(
        {
          agentId: config.agentId,
          reportId: report.id,
          totalFindings: report.summary.total,
          critical: report.summary.critical,
          high: report.summary.high,
        },
        'Processed security audit result',
      );

      logger.debug({ agentId: config.agentId, summary }, 'Audit report summary generated');

      return report;
    },

    // -----------------------------------------------------------------------
    // shouldAlert
    // -----------------------------------------------------------------------
    shouldAlert(report: SecurityAuditReport): boolean {
      return report.summary.critical > 0 || report.summary.high > 0;
    },

    // -----------------------------------------------------------------------
    // formatAlertMessage
    // -----------------------------------------------------------------------
    formatAlertMessage(report: SecurityAuditReport): string {
      const lines: string[] = [];

      lines.push(`Security Audit Alert — ${report.summary.total} finding(s)`);
      lines.push('');

      if (report.summary.critical > 0) {
        lines.push(`CRITICAL: ${report.summary.critical}`);
      }
      if (report.summary.high > 0) {
        lines.push(`HIGH: ${report.summary.high}`);
      }
      if (report.summary.medium > 0) {
        lines.push(`MEDIUM: ${report.summary.medium}`);
      }
      if (report.summary.low > 0) {
        lines.push(`LOW: ${report.summary.low}`);
      }

      lines.push('');

      const criticalAndHigh = report.findings.filter(
        (f) => f.severity === 'critical' || f.severity === 'high',
      );

      for (const finding of criticalAndHigh.slice(0, 5)) {
        const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
        lines.push(`- [${finding.severity.toUpperCase()}] ${finding.checkId}: ${location}`);
        lines.push(`  ${finding.description}`);
      }

      if (criticalAndHigh.length > 5) {
        lines.push(`  ... and ${criticalAndHigh.length - 5} more critical/high finding(s)`);
      }

      lines.push('');
      lines.push(`Agent: ${report.agentId} | Report: ${report.id}`);

      return lines.join('\n');
    },
  };
}
