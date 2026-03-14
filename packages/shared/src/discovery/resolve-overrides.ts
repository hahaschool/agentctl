import type { AgentMcpOverride, AgentSkillOverride } from '../types/agent.js';
import type { ManagedMcpServer, ManagedSkill } from '../types/runtime-management.js';

/**
 * Resolves the effective set of MCP servers for an agent by applying
 * opt-out exclusions and appending custom servers to machine defaults.
 *
 * Returns a new array — never mutates the inputs.
 */
export function resolveEffectiveMcpServers(
  defaults: readonly ManagedMcpServer[],
  override: AgentMcpOverride | undefined,
): ManagedMcpServer[] {
  if (!override) {
    return [...defaults];
  }

  const excludedSet = new Set(override.excluded);
  const filtered = defaults.filter((s) => !excludedSet.has(s.name));

  const customAsManaged: ManagedMcpServer[] = override.custom.map((c) => ({
    id: `custom-${c.name}`,
    name: c.name,
    command: c.command,
    args: c.args ?? [],
    env: c.env ?? {},
  }));

  return [...filtered, ...customAsManaged];
}

/**
 * Resolves the effective set of skills for an agent by applying
 * opt-out exclusions and appending custom skills to machine defaults.
 *
 * Returns a new array — never mutates the inputs.
 */
export function resolveEffectiveSkills(
  defaults: readonly ManagedSkill[],
  override: AgentSkillOverride | undefined,
): ManagedSkill[] {
  if (!override) {
    return [...defaults];
  }

  const excludedSet = new Set(override.excluded);
  const filtered = defaults.filter((s) => !excludedSet.has(s.id));

  return [...filtered, ...override.custom];
}
