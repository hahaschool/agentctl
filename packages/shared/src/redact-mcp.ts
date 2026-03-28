import type { McpServerConfigRedacted } from './types/dispatch-config.js';

const SECRET_ARG_PATTERN = /^--?(token|key|secret|password|credential|api[_-]?key)/i;
const LOOKS_LIKE_TOKEN = /^(sk-|xox[bpas]-|ghp_|gho_|Bearer )/;
const INLINE_SECRET = /^[A-Z_]+=.+/;

function basename(cmd: string): string {
  return cmd.split('/').pop() ?? cmd;
}

function redactArg(arg: string, prevArg: string | undefined): string {
  if (prevArg && SECRET_ARG_PATTERN.test(prevArg)) return '[REDACTED]';
  if (LOOKS_LIKE_TOKEN.test(arg)) return '[REDACTED]';
  if (SECRET_ARG_PATTERN.test(arg) && arg.includes('=')) {
    return `${arg.split('=')[0]}=[REDACTED]`;
  }
  if (INLINE_SECRET.test(arg)) {
    return `${arg.split('=')[0]}=[REDACTED]`;
  }
  return arg;
}

export function redactMcpServers(
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Record<string, McpServerConfigRedacted> {
  const result: Record<string, McpServerConfigRedacted> = {};
  for (const [name, config] of Object.entries(servers)) {
    result[name] = {
      command: basename(config.command),
      args: config.args?.map((arg, i, arr) => redactArg(arg, i > 0 ? arr[i - 1] : undefined)),
      envKeys: config.env ? Object.keys(config.env) : undefined,
    };
  }
  return result;
}
