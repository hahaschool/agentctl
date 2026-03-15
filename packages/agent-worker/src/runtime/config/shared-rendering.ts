import type { ManagedRuntimeConfig, ManagedSkill } from '@agentctl/shared';

export type RenderedConfigFile = {
  scope: 'home' | 'workspace';
  path: string;
  content: string;
};

export type RenderedRuntimeConfig = {
  runtime: 'claude-code' | 'codex';
  files: RenderedConfigFile[];
};

export function renderManagedInstructions(
  runtimeLabel: string,
  config: ManagedRuntimeConfig,
): string {
  const enabledSkills = config.skills.filter((skill) => skill.enabled);
  const skillLines =
    enabledSkills.length > 0
      ? enabledSkills.map((skill) => `- ${skill.id}: ${skill.path}`).join('\n')
      : '- none';

  return [
    `# ${runtimeLabel} Instructions`,
    '',
    '> Managed by AgentCTL. Do not edit by hand unless you intend to override managed defaults.',
    '',
    '## Global Guidance',
    config.instructions.userGlobal,
    '',
    '## Project Guidance',
    config.instructions.projectTemplate,
    '',
    '## Enabled Skills',
    skillLines,
    '',
  ].join('\n');
}

export function hasManagedInstructions(config: ManagedRuntimeConfig): boolean {
  return (
    config.instructions.userGlobal.trim().length > 0 ||
    config.instructions.projectTemplate.trim().length > 0
  );
}

export function renderSkillsManifest(config: ManagedRuntimeConfig): string {
  return JSON.stringify(
    {
      managedBy: 'agentctl',
      generatedFromConfigVersion: config.version,
      generatedFromConfigHash: config.hash,
      skills: config.skills
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          id: skill.id,
          path: skill.path,
        })),
    },
    null,
    2,
  );
}

export function renderMcpServerMap(
  config: ManagedRuntimeConfig,
): Record<string, { command: string; args: string[]; env: Record<string, string> }> {
  return renderMcpServerMapFromServers(config.mcpServers);
}

export function renderMcpServerMapFromServers(
  servers: ReadonlyArray<{
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  }>,
): Record<string, { command: string; args: string[]; env: Record<string, string> }> {
  return Object.fromEntries(
    servers.map((server) => [
      server.name,
      {
        command: server.command,
        args: server.args,
        env: server.env,
      },
    ]),
  );
}

export function renderEnabledSkills(config: ManagedRuntimeConfig): ManagedSkill[] {
  return config.skills.filter((skill) => skill.enabled);
}
