import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ManagedRuntime } from '@agentctl/shared';

import type { DiscoveredSkill } from './_type-stubs.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS_PATHS: Record<ManagedRuntime, { global: string; project: string }> = {
  'claude-code': { global: '.claude/skills', project: '.claude/skills' },
  codex: { global: '.agents/skills', project: '.agents/skills' },
};

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML-style frontmatter from SKILL.md content.
 * Returns null when no frontmatter block is found.
 */
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

async function scanSkillsDir(
  dirPath: string,
  source: 'global' | 'project',
  runtime: ManagedRuntime,
): Promise<DiscoveredSkill[]> {
  try {
    await access(dirPath);
  } catch {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const skills: DiscoveredSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = join(dirPath, entry.name, 'SKILL.md');
    try {
      const content = await readFile(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter?.name || !frontmatter.description) continue;

      skills.push({
        id: entry.name,
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillMdPath,
        source,
        runtime,
        userInvokable: frontmatter['user-invokable'] === 'true' ? true : undefined,
        args: frontmatter.args ?? undefined,
      });
    } catch {
      // SKILL.md doesn't exist or can't be read — skip
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover skills for a given runtime by scanning the conventional
 * skill directories (global and optionally project-scoped).
 *
 * Each skill directory must contain a `SKILL.md` with YAML frontmatter
 * including at minimum `name` and `description`.
 */
export async function discoverSkills(
  runtime: ManagedRuntime,
  homePath: string,
  projectPath?: string,
): Promise<DiscoveredSkill[]> {
  const paths = SKILLS_PATHS[runtime];
  const results: DiscoveredSkill[] = [];

  // Global skills
  const globalDir = join(homePath, paths.global);
  const globalSkills = await scanSkillsDir(globalDir, 'global', runtime);
  results.push(...globalSkills);

  // Project skills
  if (projectPath) {
    const projectDir = join(projectPath, paths.project);
    const projectSkills = await scanSkillsDir(projectDir, 'project', runtime);
    results.push(...projectSkills);
  }

  return results;
}
