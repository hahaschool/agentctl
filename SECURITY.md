# Security Policy

## Supported Versions

Only the latest version on the `main` branch is supported with security updates.

| Version | Supported          |
|---------|--------------------|
| main    | :white_check_mark: |
| < main  | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Private Vulnerability Reporting](https://github.com/hahaschool/agentctl/security/advisories/new)
to report security vulnerabilities. This ensures the report is only visible to the maintainers.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix target:** within 90 days (severity-dependent)

### What to Expect

1. You will receive an acknowledgment within 48 hours.
2. We will investigate and provide an initial assessment within 7 days.
3. We will work on a fix and coordinate disclosure with you.
4. Once the fix is released, we will publicly disclose the vulnerability.

### Scope

The following are considered security vulnerabilities:

- Authentication or authorization bypasses
- Remote code execution
- SQL injection, XSS, CSRF
- Secrets or credentials exposed in code or logs
- Container escape or sandbox bypass
- Privilege escalation

The following are **not** security vulnerabilities (report as regular issues):

- Denial of service via resource exhaustion (unless trivially exploitable)
- Bugs that require physical access to the machine
- Issues in dependencies (report upstream, but let us know)

## Acknowledgments

We thank the following individuals for responsibly disclosing security issues:

*No reports yet.*
