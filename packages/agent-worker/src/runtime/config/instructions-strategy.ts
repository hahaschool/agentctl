import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { AgentConfig } from '@agentctl/shared';

export type InstructionsStrategy = NonNullable<AgentConfig['instructionsStrategy']>;

export type InstructionRenderOptions = {
  instructionsStrategy?: AgentConfig['instructionsStrategy'];
  projectPath?: string | null;
  fileName: 'CLAUDE.md' | 'AGENTS.md';
  managedContent: string;
};

const MANAGED_SECTION_START = '<!-- agentctl:managed-instructions:start -->';
const MANAGED_SECTION_END = '<!-- agentctl:managed-instructions:end -->';

export function resolveInstructionStrategy(
  strategy?: AgentConfig['instructionsStrategy'],
): InstructionsStrategy {
  return strategy ?? 'project';
}

export function resolveInstructionContent(options: InstructionRenderOptions): string | null {
  if (!options.managedContent.trim()) {
    return null;
  }

  const strategy = resolveInstructionStrategy(options.instructionsStrategy);

  if (strategy === 'project') {
    return null;
  }

  if (strategy === 'managed') {
    return options.managedContent;
  }

  const existing = readProjectInstructionFile(options.projectPath, options.fileName) ?? '';
  return mergeManagedInstructions(existing, options.managedContent);
}

function readProjectInstructionFile(
  projectPath: string | null | undefined,
  fileName: 'CLAUDE.md' | 'AGENTS.md',
): string | null {
  if (!projectPath) {
    return null;
  }

  const instructionPath = path.resolve(projectPath, fileName);

  if (!existsSync(instructionPath)) {
    return null;
  }

  try {
    return readFileSync(instructionPath, 'utf-8');
  } catch {
    return null;
  }
}

function mergeManagedInstructions(existingContent: string, managedContent: string): string {
  const stripped = stripManagedInstructionsSection(existingContent).trimEnd();
  const managedBlock = [MANAGED_SECTION_START, managedContent.trimEnd(), MANAGED_SECTION_END].join(
    '\n',
  );

  return stripped ? `${stripped}\n\n${managedBlock}\n` : `${managedBlock}\n`;
}

function stripManagedInstructionsSection(content: string): string {
  const start = content.indexOf(MANAGED_SECTION_START);
  if (start === -1) {
    return content;
  }

  const end = content.indexOf(MANAGED_SECTION_END, start);
  if (end === -1) {
    return content.slice(0, start);
  }

  return `${content.slice(0, start)}${content.slice(end + MANAGED_SECTION_END.length)}`;
}
