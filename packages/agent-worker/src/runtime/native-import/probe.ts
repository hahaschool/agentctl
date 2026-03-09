import { access, readFile, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { HandoffSnapshot, ManagedRuntime, NativeImportAttemptReason } from '@agentctl/shared';

import { readNativeSourceSessionSummary } from './source-session.js';

const execFileAsync = promisify(execFile);

export type NativeImportProbePrerequisites = {
  targetCli: {
    command: string;
    available: boolean;
    version: string | null;
  };
  sourceStorage: {
    rootPath: string;
    exists: boolean;
    sessionLocated: boolean;
    sessionPath: string | null;
    lookup: 'direct-file' | 'session-index' | 'session-tree';
  };
  prerequisitesMet: boolean;
};

export async function probeNativeImportPrerequisites(input: {
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  projectPath: string;
  snapshot: HandoffSnapshot;
}): Promise<{ reason: NativeImportAttemptReason; metadata: Record<string, unknown> }> {
  const targetCli = await detectTargetCli(input.targetRuntime);
  const sourceStorage = await detectSourceStorage(input.sourceRuntime, input.projectPath, input.snapshot);
  const sourceSessionSummary =
    sourceStorage.sessionPath !== null
      ? await readSourceSessionSummary(input.sourceRuntime, sourceStorage.sessionPath)
      : null;

  const metadata: Record<string, unknown> = {
    targetCli,
    sourceStorage,
    prerequisitesMet: targetCli.available && sourceStorage.exists && sourceStorage.sessionLocated,
    ...(sourceSessionSummary ? { sourceSessionSummary } : {}),
  };

  if (!targetCli.available) {
    return { reason: 'target_cli_unavailable', metadata };
  }

  if (!sourceStorage.exists) {
    return { reason: 'source_storage_missing', metadata };
  }

  if (!sourceStorage.sessionLocated) {
    return { reason: 'source_session_missing', metadata };
  }

  return { reason: 'not_implemented', metadata };
}

async function detectTargetCli(targetRuntime: ManagedRuntime): Promise<NativeImportProbePrerequisites['targetCli']> {
  const command = targetRuntime === 'codex' ? 'codex' : 'claude';
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version']);
    return {
      command,
      available: true,
      version: (stdout || stderr || '').trim() || null,
    };
  } catch {
    return {
      command,
      available: false,
      version: null,
    };
  }
}

async function detectSourceStorage(
  sourceRuntime: ManagedRuntime,
  projectPath: string,
  snapshot: HandoffSnapshot,
): Promise<NativeImportProbePrerequisites['sourceStorage']> {
  if (sourceRuntime === 'claude-code') {
    const rootPath = join(homedir(), '.claude', 'projects');
    const projectFolder = projectPath.replace(/[\\/]/g, '-');
    const sessionPath = join(rootPath, projectFolder, `${snapshot.sourceSessionId}.jsonl`);
    const exists = await pathExists(rootPath);
    const sessionLocated = exists ? await pathExists(sessionPath) : false;
    return {
      rootPath,
      exists,
      sessionLocated,
      sessionPath: sessionLocated ? sessionPath : null,
      lookup: 'direct-file',
    };
  }

  const rootPath = join(homedir(), '.codex');
  const indexPath = join(rootPath, 'session_index.jsonl');
  const sessionsRoot = join(rootPath, 'sessions');
  const indexExists = await pathExists(indexPath);
  const sessionsRootExists = await pathExists(sessionsRoot);
  const fromIndex = indexExists ? await findCodexSessionInIndex(indexPath, snapshot.sourceSessionId) : null;
  const fromTree = sessionsRootExists ? await findCodexSessionInTree(sessionsRoot, snapshot.sourceSessionId) : null;
  return {
    rootPath,
    exists: indexExists || sessionsRootExists,
    sessionLocated: Boolean(fromIndex || fromTree),
    sessionPath: fromTree,
    lookup: fromIndex ? 'session-index' : 'session-tree',
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findCodexSessionInIndex(indexPath: string, sourceSessionId: string): Promise<string | null> {
  try {
    const content = await readFile(indexPath, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { id?: string };
        if (parsed.id === sourceSessionId) {
          return sourceSessionId;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function findCodexSessionInTree(rootPath: string, sourceSessionId: string): Promise<string | null> {
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.includes(sourceSessionId) && entry.name.endsWith('.jsonl')) {
        return fullPath;
      }
    }
  }

  return null;
}

async function readSourceSessionSummary(
  runtime: ManagedRuntime,
  sessionPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await readNativeSourceSessionSummary({
      runtime,
      sessionPath,
    });
  } catch (error) {
    return {
      sessionPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
