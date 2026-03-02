import { ControlPlaneError } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_ID = 'security-audit-agent';
const DEFAULT_SCHEDULE = '0 2 * * *';
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_COST_USD = 5;
const DEFAULT_OUTPUT_FORMAT = 'json' as const;
const DEFAULT_TARGET_PATHS = ['packages/', 'infra/', 'scripts/'];
const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'Bash', 'WebFetch', 'NotebookEdit'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityAuditConfig = {
  agentId: string;
  schedule: string;
  allowedTools: string[];
  disallowedTools: string[];
  maxDurationMs: number;
  maxCostUsd: number;
  outputFormat: 'json' | 'markdown';
  targetPaths: string[];
  checks: SecurityCheck[];
};

export type SecurityCheck = {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'secrets' | 'injection' | 'container' | 'auth' | 'dependency' | 'config';
  enabled: boolean;
};

export type SecurityFinding = {
  checkId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  description: string;
  recommendation: string;
  snippet?: string;
};

export type SecurityAuditReport = {
  id: string;
  agentId: string;
  startedAt: Date;
  completedAt: Date;
  findings: SecurityFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  checksRun: number;
  checksSkipped: number;
};

// ---------------------------------------------------------------------------
// Default checks
// ---------------------------------------------------------------------------

export function getDefaultSecurityChecks(): SecurityCheck[] {
  return [
    {
      id: 'hardcoded-secrets',
      name: 'Hardcoded Secrets Detection',
      description:
        'Scan source files for hardcoded API keys, tokens, passwords, and other credentials using pattern matching against common secret formats (e.g. AKIA, ghp_, sk-live_, password=).',
      severity: 'critical',
      category: 'secrets',
      enabled: true,
    },
    {
      id: 'sql-injection',
      name: 'SQL Injection Vulnerability',
      description:
        'Check for string interpolation or concatenation in SQL queries. Verify that all database queries use parameterized statements or an ORM query builder.',
      severity: 'critical',
      category: 'injection',
      enabled: true,
    },
    {
      id: 'command-injection',
      name: 'Command Injection Vulnerability',
      description:
        'Check for unsanitized user input passed to shell execution functions such as exec(), spawn(), or execSync(). Verify all external commands use argument arrays rather than interpolated strings.',
      severity: 'critical',
      category: 'injection',
      enabled: true,
    },
    {
      id: 'container-security',
      name: 'Container Security Configuration',
      description:
        'Verify Dockerfiles use non-root USER directive, --cap-drop=ALL is present in compose files, no --privileged flag, and gVisor/seccomp profiles are configured.',
      severity: 'high',
      category: 'container',
      enabled: true,
    },
    {
      id: 'dependency-audit',
      name: 'Vulnerable Dependencies',
      description:
        'Check package.json and lock files for packages with known vulnerabilities. Look for outdated critical dependencies and deprecated packages.',
      severity: 'high',
      category: 'dependency',
      enabled: true,
    },
    {
      id: 'env-file-exposure',
      name: 'Environment File Exposure',
      description:
        'Ensure .env files are listed in .gitignore and not tracked in the repository. Verify .env.example does not contain real credentials.',
      severity: 'high',
      category: 'secrets',
      enabled: true,
    },
    {
      id: 'cors-config',
      name: 'CORS Configuration',
      description:
        'Verify CORS configuration restricts origins in production. Check that wildcard (*) origins are not used outside of development mode.',
      severity: 'medium',
      category: 'config',
      enabled: true,
    },
    {
      id: 'rate-limiting',
      name: 'Rate Limiting',
      description:
        'Verify rate limiting middleware is registered on all API routes. Check that rate limit configuration values are present and reasonable.',
      severity: 'medium',
      category: 'config',
      enabled: true,
    },
    {
      id: 'auth-bypass',
      name: 'Authentication Bypass',
      description:
        'Check for API routes that are missing authentication middleware. Verify that public routes are intentionally listed in an allow-list.',
      severity: 'high',
      category: 'auth',
      enabled: true,
    },
    {
      id: 'sensitive-logging',
      name: 'Sensitive Data in Logs',
      description:
        'Check that logging statements do not output full API keys, tokens, passwords, or personally identifiable information. Verify that only the last 4 characters of secrets are logged.',
      severity: 'medium',
      category: 'secrets',
      enabled: true,
    },
    {
      id: 'tls-config',
      name: 'TLS/Encryption Settings',
      description:
        'Verify TLS is enforced for external connections. Check that encryption keys use adequate strength (>= 256-bit). Verify TweetNaCl/libsodium is used for custom encryption.',
      severity: 'medium',
      category: 'config',
      enabled: true,
    },
    {
      id: 'permission-checks',
      name: 'File and Directory Permissions',
      description:
        'Verify shell scripts do not set overly permissive file modes (e.g. chmod 777). Check that sensitive directories (.ssh, .gnupg, .aws) are excluded from container mounts.',
      severity: 'low',
      category: 'config',
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

export function createDefaultAuditConfig(): SecurityAuditConfig {
  return {
    agentId: DEFAULT_AGENT_ID,
    schedule: DEFAULT_SCHEDULE,
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...DISALLOWED_TOOLS],
    maxDurationMs: DEFAULT_MAX_DURATION_MS,
    maxCostUsd: DEFAULT_MAX_COST_USD,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    targetPaths: [...DEFAULT_TARGET_PATHS],
    checks: getDefaultSecurityChecks(),
  };
}

// ---------------------------------------------------------------------------
// Prompt generation
// ---------------------------------------------------------------------------

export function generateAuditPrompt(config: SecurityAuditConfig): string {
  const enabledChecks = config.checks.filter((c) => c.enabled);

  if (enabledChecks.length === 0) {
    throw new ControlPlaneError('AUDIT_NO_CHECKS', 'No security checks are enabled', {
      agentId: config.agentId,
    });
  }

  const checksSection = enabledChecks
    .map(
      (check, i) =>
        `${i + 1}. **[${check.id}]** (${check.severity}) — ${check.name}\n   ${check.description}`,
    )
    .join('\n');

  const pathsList = config.targetPaths.map((p) => `- ${p}`).join('\n');

  const findingsSchema = [
    '{',
    '  "findings": [',
    '    {',
    '      "checkId": "string (must match one of the check IDs above)",',
    '      "severity": "critical | high | medium | low",',
    '      "file": "string (relative file path)",',
    '      "line": "number | null (line number if applicable)",',
    '      "description": "string (what was found)",',
    '      "recommendation": "string (how to fix it)",',
    '      "snippet": "string | null (relevant code snippet, max 3 lines)"',
    '    }',
    '  ],',
    '  "checksRun": "number (how many checks were executed)",',
    '  "checksSkipped": "number (how many checks were skipped)"',
    '}',
  ].join('\n');

  return [
    '# Security Audit',
    '',
    'You are a security auditor for the AgentCTL codebase. Your task is to perform a comprehensive security audit using ONLY read-only tools (Read, Glob, Grep). You MUST NOT modify any files.',
    '',
    '## Constraints',
    '',
    '- You have access ONLY to: Read, Glob, Grep',
    '- Do NOT attempt to write, edit, or execute any files',
    '- Do NOT suggest fixes inline — only report findings',
    `- Maximum duration: ${config.maxDurationMs / 1000}s`,
    `- Maximum cost: $${config.maxCostUsd}`,
    '',
    '## Target Paths',
    '',
    pathsList,
    '',
    '## Security Checks',
    '',
    'Perform each of the following checks:',
    '',
    checksSection,
    '',
    '## Output Format',
    '',
    `Respond with a single JSON code block in the following schema (output format: ${config.outputFormat}):`,
    '',
    '```json',
    findingsSchema,
    '```',
    '',
    '## Instructions',
    '',
    '1. Systematically scan the target paths for each enabled check.',
    '2. For each finding, include the file path, line number (when available), a description of the issue, and a recommended remediation.',
    '3. Include a brief code snippet (max 3 lines) showing the problematic code when relevant.',
    '4. Report checksRun as the number of checks you actually performed and checksSkipped for any you could not complete.',
    '5. If no issues are found for a check, do NOT include a finding for it — only report actual problems.',
    '6. Wrap your entire response in a single ```json code block.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export function parseAuditResponse(response: string): SecurityAuditReport {
  const now = new Date();
  const emptyReport: SecurityAuditReport = {
    id: `audit-${now.getTime()}`,
    agentId: DEFAULT_AGENT_ID,
    startedAt: now,
    completedAt: now,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    checksRun: 0,
    checksSkipped: 0,
  };

  const jsonBlock = extractJsonBlock(response);
  if (jsonBlock === null) {
    return emptyReport;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return emptyReport;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return emptyReport;
  }

  const obj = parsed as Record<string, unknown>;

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: SecurityFinding[] = rawFindings.map((f: unknown) => normalizeFinding(f));

  const checksRun = typeof obj.checksRun === 'number' ? obj.checksRun : 0;
  const checksSkipped = typeof obj.checksSkipped === 'number' ? obj.checksSkipped : 0;

  const summary = computeSummary(findings);

  return {
    id: `audit-${now.getTime()}`,
    agentId: DEFAULT_AGENT_ID,
    startedAt: now,
    completedAt: now,
    findings,
    summary,
    checksRun,
    checksSkipped,
  };
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

export function summarizeFindings(report: SecurityAuditReport): string {
  const lines: string[] = [];

  lines.push('# Security Audit Report');
  lines.push('');
  lines.push(`**Agent**: ${report.agentId}`);
  lines.push(`**Started**: ${report.startedAt.toISOString()}`);
  lines.push(`**Completed**: ${report.completedAt.toISOString()}`);
  lines.push(`**Checks run**: ${report.checksRun} | **Skipped**: ${report.checksSkipped}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Critical | ${report.summary.critical} |`);
  lines.push(`| High     | ${report.summary.high} |`);
  lines.push(`| Medium   | ${report.summary.medium} |`);
  lines.push(`| Low      | ${report.summary.low} |`);
  lines.push(`| **Total** | **${report.summary.total}** |`);
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('No security findings detected.');
    return lines.join('\n');
  }

  lines.push('## Findings');
  lines.push('');

  const grouped = groupFindingsBySeverity(report.findings);

  for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
    const items = grouped[severity];
    if (items.length === 0) {
      continue;
    }

    lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)}`);
    lines.push('');

    for (const finding of items) {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- **[${finding.checkId}]** \`${location}\``);
      lines.push(`  ${finding.description}`);
      lines.push(`  *Recommendation*: ${finding.recommendation}`);
      if (finding.snippet) {
        lines.push('  ```');
        lines.push(`  ${finding.snippet}`);
        lines.push('  ```');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function extractJsonBlock(text: string): string | null {
  // Try to extract from markdown code fence
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const match = fenceRegex.exec(text);
  if (match) {
    return match[1].trim();
  }

  // Try to find raw JSON object
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return null;
}

function normalizeFinding(raw: unknown): SecurityFinding {
  if (typeof raw !== 'object' || raw === null) {
    return {
      checkId: 'unknown',
      severity: 'low',
      file: 'unknown',
      description: 'Malformed finding entry',
      recommendation: 'Review the raw audit output',
    };
  }

  const obj = raw as Record<string, unknown>;

  return {
    checkId: typeof obj.checkId === 'string' ? obj.checkId : 'unknown',
    severity: isValidSeverity(obj.severity) ? obj.severity : 'low',
    file: typeof obj.file === 'string' ? obj.file : 'unknown',
    line: typeof obj.line === 'number' ? obj.line : undefined,
    description: typeof obj.description === 'string' ? obj.description : 'No description provided',
    recommendation:
      typeof obj.recommendation === 'string' ? obj.recommendation : 'No recommendation provided',
    snippet: typeof obj.snippet === 'string' ? obj.snippet : undefined,
  };
}

function isValidSeverity(value: unknown): value is SecurityFinding['severity'] {
  return typeof value === 'string' && ['critical', 'high', 'medium', 'low'].includes(value);
}

function computeSummary(findings: SecurityFinding[]): SecurityAuditReport['summary'] {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

  for (const f of findings) {
    summary[f.severity]++;
    summary.total++;
  }

  return summary;
}

function groupFindingsBySeverity(
  findings: SecurityFinding[],
): Record<SecurityFinding['severity'], SecurityFinding[]> {
  const groups: Record<SecurityFinding['severity'], SecurityFinding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  for (const f of findings) {
    groups[f.severity].push(f);
  }

  return groups;
}
