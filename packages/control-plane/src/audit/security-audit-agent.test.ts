import { ControlPlaneError } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import type { SecurityFinding } from './security-audit-agent.js';
import {
  createDefaultAuditConfig,
  generateAuditPrompt,
  getDefaultSecurityChecks,
  parseAuditResponse,
  summarizeFindings,
} from './security-audit-agent.js';

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

function makeValidJsonResponse(
  findings: SecurityFinding[] = [],
  checksRun = 12,
  checksSkipped = 0,
): string {
  return [
    'Here are the results:',
    '',
    '```json',
    JSON.stringify({ findings, checksRun, checksSkipped }, null, 2),
    '```',
  ].join('\n');
}

// =============================================================================
// getDefaultSecurityChecks
// =============================================================================

describe('getDefaultSecurityChecks', () => {
  it('returns at least 12 checks', () => {
    const checks = getDefaultSecurityChecks();
    expect(checks.length).toBeGreaterThanOrEqual(12);
  });

  it('returns checks with unique IDs', () => {
    const checks = getDefaultSecurityChecks();
    const ids = checks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('includes all required check IDs', () => {
    const checks = getDefaultSecurityChecks();
    const ids = checks.map((c) => c.id);

    const requiredIds = [
      'hardcoded-secrets',
      'sql-injection',
      'command-injection',
      'container-security',
      'dependency-audit',
      'env-file-exposure',
      'cors-config',
      'rate-limiting',
      'auth-bypass',
      'sensitive-logging',
      'tls-config',
      'permission-checks',
    ];

    for (const id of requiredIds) {
      expect(ids).toContain(id);
    }
  });

  it('assigns valid severity levels to all checks', () => {
    const checks = getDefaultSecurityChecks();
    const validSeverities = ['critical', 'high', 'medium', 'low'];

    for (const check of checks) {
      expect(validSeverities).toContain(check.severity);
    }
  });

  it('assigns valid categories to all checks', () => {
    const checks = getDefaultSecurityChecks();
    const validCategories = ['secrets', 'injection', 'container', 'auth', 'dependency', 'config'];

    for (const check of checks) {
      expect(validCategories).toContain(check.category);
    }
  });

  it('enables all checks by default', () => {
    const checks = getDefaultSecurityChecks();
    expect(checks.every((c) => c.enabled)).toBe(true);
  });

  it('includes a non-empty name and description for every check', () => {
    const checks = getDefaultSecurityChecks();

    for (const check of checks) {
      expect(check.name.length).toBeGreaterThan(0);
      expect(check.description.length).toBeGreaterThan(0);
    }
  });

  it('includes at least one check for each category', () => {
    const checks = getDefaultSecurityChecks();
    const categories = new Set(checks.map((c) => c.category));

    expect(categories.has('secrets')).toBe(true);
    expect(categories.has('injection')).toBe(true);
    expect(categories.has('container')).toBe(true);
    expect(categories.has('auth')).toBe(true);
    expect(categories.has('dependency')).toBe(true);
    expect(categories.has('config')).toBe(true);
  });

  it('returns a new array on each call (not a shared reference)', () => {
    const a = getDefaultSecurityChecks();
    const b = getDefaultSecurityChecks();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// =============================================================================
// createDefaultAuditConfig
// =============================================================================

describe('createDefaultAuditConfig', () => {
  it('returns a config with the expected agent ID', () => {
    const config = createDefaultAuditConfig();
    expect(config.agentId).toBe('security-audit-agent');
  });

  it('uses a valid cron schedule', () => {
    const config = createDefaultAuditConfig();
    // 5-field cron: minute hour dom month dow
    const parts = config.schedule.split(' ');
    expect(parts).toHaveLength(5);
  });

  it('restricts tools to read-only', () => {
    const config = createDefaultAuditConfig();
    expect(config.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('disallows write and execute tools', () => {
    const config = createDefaultAuditConfig();
    expect(config.disallowedTools).toContain('Write');
    expect(config.disallowedTools).toContain('Edit');
    expect(config.disallowedTools).toContain('Bash');
  });

  it('sets a 30-minute default duration', () => {
    const config = createDefaultAuditConfig();
    expect(config.maxDurationMs).toBe(30 * 60 * 1000);
  });

  it('sets a $5 default max cost', () => {
    const config = createDefaultAuditConfig();
    expect(config.maxCostUsd).toBe(5);
  });

  it('defaults to json output format', () => {
    const config = createDefaultAuditConfig();
    expect(config.outputFormat).toBe('json');
  });

  it('includes target paths', () => {
    const config = createDefaultAuditConfig();
    expect(config.targetPaths.length).toBeGreaterThan(0);
  });

  it('includes the default security checks', () => {
    const config = createDefaultAuditConfig();
    expect(config.checks.length).toBeGreaterThanOrEqual(12);
  });

  it('returns independent copies on each call', () => {
    const a = createDefaultAuditConfig();
    const b = createDefaultAuditConfig();
    a.allowedTools.push('Write');
    expect(b.allowedTools).not.toContain('Write');
  });
});

// =============================================================================
// generateAuditPrompt
// =============================================================================

describe('generateAuditPrompt', () => {
  it('includes enabled check names in the prompt', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('hardcoded-secrets');
    expect(prompt).toContain('sql-injection');
    expect(prompt).toContain('command-injection');
  });

  it('includes target paths in the prompt', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    for (const path of config.targetPaths) {
      expect(prompt).toContain(path);
    }
  });

  it('includes the JSON output schema', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('"findings"');
    expect(prompt).toContain('"checkId"');
    expect(prompt).toContain('"severity"');
    expect(prompt).toContain('"recommendation"');
  });

  it('specifies read-only constraints', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('Read, Glob, Grep');
    expect(prompt).toContain('MUST NOT modify');
  });

  it('includes maximum duration in seconds', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain(`${config.maxDurationMs / 1000}s`);
  });

  it('includes maximum cost', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain(`$${config.maxCostUsd}`);
  });

  it('excludes disabled checks from the prompt', () => {
    const config = createDefaultAuditConfig();
    config.checks = config.checks.map((c) =>
      c.id === 'tls-config' ? { ...c, enabled: false } : c,
    );

    const prompt = generateAuditPrompt(config);

    expect(prompt).not.toContain('[tls-config]');
    expect(prompt).toContain('[hardcoded-secrets]');
  });

  it('throws ControlPlaneError when no checks are enabled', () => {
    const config = createDefaultAuditConfig();
    config.checks = config.checks.map((c) => ({ ...c, enabled: false }));

    expect(() => generateAuditPrompt(config)).toThrow(ControlPlaneError);
  });

  it('includes the correct error code when no checks are enabled', () => {
    const config = createDefaultAuditConfig();
    config.checks = config.checks.map((c) => ({ ...c, enabled: false }));

    try {
      generateAuditPrompt(config);
      expect.fail('Expected ControlPlaneError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      expect((err as ControlPlaneError).code).toBe('AUDIT_NO_CHECKS');
    }
  });

  it('includes the output format in the prompt', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('json');
  });

  it('works with a single enabled check', () => {
    const config = createDefaultAuditConfig();
    config.checks = config.checks.map((c) =>
      c.id === 'hardcoded-secrets' ? c : { ...c, enabled: false },
    );

    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('[hardcoded-secrets]');
    expect(prompt).not.toContain('[sql-injection]');
  });

  it('numbers checks sequentially starting from 1', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('1. **[');
    expect(prompt).toContain('2. **[');
  });

  it('includes severity for each check', () => {
    const config = createDefaultAuditConfig();
    const prompt = generateAuditPrompt(config);

    expect(prompt).toContain('(critical)');
    expect(prompt).toContain('(high)');
    expect(prompt).toContain('(medium)');
    expect(prompt).toContain('(low)');
  });
});

// =============================================================================
// parseAuditResponse
// =============================================================================

describe('parseAuditResponse', () => {
  it('parses a valid JSON response from a code block', () => {
    const findings = [makeFinding()];
    const response = makeValidJsonResponse(findings, 12, 0);
    const report = parseAuditResponse(response);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].checkId).toBe('hardcoded-secrets');
    expect(report.checksRun).toBe(12);
    expect(report.checksSkipped).toBe(0);
  });

  it('computes summary counts correctly', () => {
    const findings = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'critical', file: 'src/a.ts' }),
      makeFinding({ severity: 'high', checkId: 'sql-injection', file: 'src/b.ts' }),
      makeFinding({ severity: 'medium', checkId: 'cors-config', file: 'src/c.ts' }),
      makeFinding({ severity: 'low', checkId: 'permission-checks', file: 'src/d.ts' }),
    ];

    const response = makeValidJsonResponse(findings, 12, 0);
    const report = parseAuditResponse(response);

    expect(report.summary.critical).toBe(2);
    expect(report.summary.high).toBe(1);
    expect(report.summary.medium).toBe(1);
    expect(report.summary.low).toBe(1);
    expect(report.summary.total).toBe(5);
  });

  it('returns an empty report for completely empty response', () => {
    const report = parseAuditResponse('');

    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.checksRun).toBe(0);
  });

  it('returns an empty report for response with no JSON', () => {
    const report = parseAuditResponse('No security issues were found in the codebase.');

    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
  });

  it('returns an empty report for malformed JSON', () => {
    const response = '```json\n{ invalid json }\n```';
    const report = parseAuditResponse(response);

    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
  });

  it('handles JSON without code fence', () => {
    const json = JSON.stringify({
      findings: [makeFinding()],
      checksRun: 10,
      checksSkipped: 2,
    });
    const report = parseAuditResponse(json);

    expect(report.findings).toHaveLength(1);
    expect(report.checksRun).toBe(10);
    expect(report.checksSkipped).toBe(2);
  });

  it('handles response with text before and after JSON block', () => {
    const json = JSON.stringify({
      findings: [makeFinding()],
      checksRun: 8,
      checksSkipped: 4,
    });
    const response = `Here is the report:\n\n\`\`\`json\n${json}\n\`\`\`\n\nLet me know if you need more details.`;
    const report = parseAuditResponse(response);

    expect(report.findings).toHaveLength(1);
    expect(report.checksRun).toBe(8);
  });

  it('defaults missing finding fields gracefully', () => {
    const response = makeValidJsonResponse(
      [{ checkId: 'hardcoded-secrets', file: 'test.ts' } as unknown as SecurityFinding],
      1,
      0,
    );
    const report = parseAuditResponse(response);

    expect(report.findings[0].severity).toBe('low');
    expect(report.findings[0].description).toBe('No description provided');
    expect(report.findings[0].recommendation).toBe('No recommendation provided');
    expect(report.findings[0].line).toBeUndefined();
    expect(report.findings[0].snippet).toBeUndefined();
  });

  it('handles findings array with non-object entries', () => {
    const response =
      '```json\n{"findings": [null, 42, "bad"], "checksRun": 1, "checksSkipped": 0}\n```';
    const report = parseAuditResponse(response);

    expect(report.findings).toHaveLength(3);
    expect(report.findings[0].checkId).toBe('unknown');
    expect(report.findings[1].checkId).toBe('unknown');
    expect(report.findings[2].checkId).toBe('unknown');
  });

  it('defaults checksRun and checksSkipped when missing', () => {
    const response = '```json\n{"findings": []}\n```';
    const report = parseAuditResponse(response);

    expect(report.checksRun).toBe(0);
    expect(report.checksSkipped).toBe(0);
  });

  it('handles response that is a JSON array (not object)', () => {
    const response = '```json\n[1, 2, 3]\n```';
    const report = parseAuditResponse(response);

    expect(report.findings).toEqual([]);
  });

  it('generates a unique report ID', () => {
    const response = makeValidJsonResponse([], 0, 0);
    const report1 = parseAuditResponse(response);
    const report2 = parseAuditResponse(response);

    expect(report1.id).toMatch(/^audit-\d+$/);
    expect(report2.id).toMatch(/^audit-\d+$/);
  });

  it('sets startedAt and completedAt as Date objects', () => {
    const response = makeValidJsonResponse([], 0, 0);
    const report = parseAuditResponse(response);

    expect(report.startedAt).toBeInstanceOf(Date);
    expect(report.completedAt).toBeInstanceOf(Date);
  });

  it('normalizes invalid severity to low', () => {
    const response =
      '```json\n{"findings": [{"checkId": "test", "severity": "extreme", "file": "a.ts", "description": "bad", "recommendation": "fix"}], "checksRun": 1, "checksSkipped": 0}\n```';
    const report = parseAuditResponse(response);

    expect(report.findings[0].severity).toBe('low');
  });

  it('preserves line numbers when present', () => {
    const findings = [makeFinding({ line: 99 })];
    const response = makeValidJsonResponse(findings);
    const report = parseAuditResponse(response);

    expect(report.findings[0].line).toBe(99);
  });

  it('preserves snippets when present', () => {
    const findings = [makeFinding({ snippet: 'const x = 1;' })];
    const response = makeValidJsonResponse(findings);
    const report = parseAuditResponse(response);

    expect(report.findings[0].snippet).toBe('const x = 1;');
  });

  it('handles findings with missing field being null', () => {
    const json = JSON.stringify({
      findings: [
        {
          checkId: 'test',
          severity: 'high',
          file: 'src/x.ts',
          line: null,
          description: 'issue',
          recommendation: 'fix',
          snippet: null,
        },
      ],
      checksRun: 1,
      checksSkipped: 0,
    });
    const report = parseAuditResponse(`\`\`\`json\n${json}\n\`\`\``);

    expect(report.findings[0].line).toBeUndefined();
    expect(report.findings[0].snippet).toBeUndefined();
  });

  it('handles empty findings array', () => {
    const response = makeValidJsonResponse([], 12, 0);
    const report = parseAuditResponse(response);

    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.checksRun).toBe(12);
  });

  it('handles missing findings key by defaulting to empty', () => {
    const response = '```json\n{"checksRun": 5}\n```';
    const report = parseAuditResponse(response);

    expect(report.findings).toEqual([]);
    expect(report.checksRun).toBe(5);
  });
});

// =============================================================================
// summarizeFindings
// =============================================================================

describe('summarizeFindings', () => {
  it('includes the report header with agent ID and timestamps', () => {
    const report = parseAuditResponse(makeValidJsonResponse([], 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('# Security Audit Report');
    expect(summary).toContain('security-audit-agent');
    expect(summary).toContain('**Started**');
    expect(summary).toContain('**Completed**');
  });

  it('includes the summary table', () => {
    const findings = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high', checkId: 'sql-injection', file: 'src/b.ts' }),
    ];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('| Critical | 1 |');
    expect(summary).toContain('| High     | 1 |');
    expect(summary).toContain('| **Total** | **2** |');
  });

  it('shows "No security findings detected" when report is clean', () => {
    const report = parseAuditResponse(makeValidJsonResponse([], 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('No security findings detected.');
  });

  it('groups findings by severity', () => {
    const findings = [
      makeFinding({ severity: 'critical', file: 'a.ts' }),
      makeFinding({ severity: 'low', checkId: 'permission-checks', file: 'b.ts' }),
      makeFinding({ severity: 'critical', checkId: 'sql-injection', file: 'c.ts' }),
    ];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    const criticalPos = summary.indexOf('### Critical');
    const lowPos = summary.indexOf('### Low');

    expect(criticalPos).toBeGreaterThan(-1);
    expect(lowPos).toBeGreaterThan(-1);
    expect(criticalPos).toBeLessThan(lowPos);
  });

  it('includes file:line for findings with line numbers', () => {
    const findings = [makeFinding({ file: 'src/config.ts', line: 42 })];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('`src/config.ts:42`');
  });

  it('includes file path without line when line is not present', () => {
    const findings = [makeFinding({ file: 'src/config.ts', line: undefined })];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('`src/config.ts`');
    expect(summary).not.toContain('`src/config.ts:`');
  });

  it('includes recommendations in the output', () => {
    const findings = [makeFinding({ recommendation: 'Use env vars instead of hardcoded keys' })];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('Use env vars instead of hardcoded keys');
  });

  it('includes code snippets when present', () => {
    const findings = [makeFinding({ snippet: 'const KEY = "secret"' })];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('const KEY = "secret"');
  });

  it('includes checks run and skipped counts', () => {
    const report = parseAuditResponse(makeValidJsonResponse([], 10, 2));
    const summary = summarizeFindings(report);

    expect(summary).toContain('**Checks run**: 10');
    expect(summary).toContain('**Skipped**: 2');
  });

  it('omits severity sections with zero findings', () => {
    const findings = [makeFinding({ severity: 'critical', file: 'a.ts' })];
    const report = parseAuditResponse(makeValidJsonResponse(findings, 12, 0));
    const summary = summarizeFindings(report);

    expect(summary).toContain('### Critical');
    expect(summary).not.toContain('### High');
    expect(summary).not.toContain('### Medium');
    expect(summary).not.toContain('### Low');
  });
});
