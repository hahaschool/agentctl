#!/usr/bin/env npx tsx

/**
 * Import Claude Code JSONL session history into Mem0.
 *
 * Usage:
 *   pnpm tsx scripts/import-claude-history.ts <projects-dir> [--mem0-url http://localhost:8000]
 *
 * Scans the given directory (typically ~/.claude/projects/) for session JSONL files.
 * For each session:
 *   1. Reads the JSONL file line by line
 *   2. Extracts user prompts (type: 'human') and assistant responses (type: 'assistant')
 *   3. Computes a session summary from first + last messages
 *   4. Posts to Mem0 with metadata: source='claude-code', sessionId, projectPath
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

type JsonlMessage = {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  parentMessageId?: string;
  sessionId?: string;
};

type ExtractedMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function parseArgs(argv: string[]): { projectsDir: string; mem0Url: string } {
  const args = argv.slice(2);
  let projectsDir = '';
  let mem0Url = 'http://localhost:8000';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mem0-url' && i + 1 < args.length) {
      mem0Url = args[i + 1]!;
      i++;
    } else if (!args[i]!.startsWith('--')) {
      projectsDir = args[i]!;
    }
  }

  if (!projectsDir) {
    console.error('Usage: pnpm tsx scripts/import-claude-history.ts <projects-dir> [--mem0-url URL]');
    console.error('');
    console.error('Arguments:');
    console.error('  <projects-dir>  Path to Claude Code projects dir (e.g., ~/.claude/projects/)');
    console.error('  --mem0-url      Mem0 API base URL (default: http://localhost:8000)');
    process.exit(1);
  }

  return { projectsDir: path.resolve(projectsDir), mem0Url };
}

function findJsonlFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files.sort();
}

async function readJsonlMessages(filePath: string): Promise<ExtractedMessage[]> {
  const messages: ExtractedMessage[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: JsonlMessage;
    try {
      parsed = JSON.parse(trimmed) as JsonlMessage;
    } catch {
      // Skip malformed lines
      continue;
    }

    const role = parsed.type === 'human' ? 'user' as const : parsed.type === 'assistant' ? 'assistant' as const : null;
    if (!role || !parsed.message) continue;

    let content = '';
    if (typeof parsed.message.content === 'string') {
      content = parsed.message.content;
    } else if (Array.isArray(parsed.message.content)) {
      // Claude messages can have content blocks; extract text blocks
      content = parsed.message.content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text!)
        .join('\n');
    }

    if (content.trim()) {
      messages.push({ role, content: content.trim() });
    }
  }

  return messages;
}

function buildSessionSummary(messages: ExtractedMessage[]): string {
  if (messages.length === 0) return '';

  const parts: string[] = [];

  // Take the first user message as context for what the session was about
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser) {
    const truncated = firstUser.content.slice(0, 500);
    parts.push(`User started with: ${truncated}`);
  }

  // Take the last assistant message as the outcome
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) {
    const truncated = lastAssistant.content.slice(0, 500);
    parts.push(`Assistant concluded with: ${truncated}`);
  }

  parts.push(`Total messages: ${messages.length}`);

  return parts.join('\n\n');
}

function extractProjectPath(filePath: string, projectsDir: string): string {
  // JSONL files are at <projectsDir>/<url-encoded-path>/<session-uuid>.jsonl
  const relative = path.relative(projectsDir, filePath);
  const parentDir = path.dirname(relative);

  // The parent directory name is a URL-encoded project path
  try {
    return decodeURIComponent(parentDir);
  } catch {
    return parentDir;
  }
}

function extractSessionId(filePath: string): string {
  // The filename (without extension) is the session UUID
  return path.basename(filePath, '.jsonl');
}

async function addMemory(
  mem0Url: string,
  messages: Array<{ role: string; content: string }>,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const url = `${mem0Url.replace(/\/+$/, '')}/v1/memories/`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        user_id: 'system',
        metadata,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      console.error(`  Mem0 API error (${response.status}): ${body.slice(0, 200)}`);
      return false;
    }

    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  Connection error: ${message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const { projectsDir, mem0Url } = parseArgs(process.argv);

  if (!fs.existsSync(projectsDir)) {
    console.error(`Error: Projects directory not found: ${projectsDir}`);
    process.exit(1);
  }

  console.log(`Scanning:   ${projectsDir}`);
  console.log(`Mem0 URL:   ${mem0Url}`);
  console.log('');

  // Verify Mem0 is reachable
  try {
    const healthResponse = await fetch(`${mem0Url.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!healthResponse.ok) {
      console.error(`Warning: Mem0 health check returned ${healthResponse.status}. Proceeding anyway.`);
    } else {
      console.log('Mem0 health check: OK');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: Cannot reach Mem0 at ${mem0Url}: ${message}`);
    console.error('Make sure Mem0 is running (e.g., docker run -p 8000:8000 mem0/mem0:latest)');
    process.exit(1);
  }

  const jsonlFiles = findJsonlFiles(projectsDir);
  console.log(`\nFound ${jsonlFiles.length} session file(s) to import.\n`);

  if (jsonlFiles.length === 0) {
    console.log('Nothing to import.');
    return;
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const filePath of jsonlFiles) {
    const sessionId = extractSessionId(filePath);
    const projectPath = extractProjectPath(filePath, projectsDir);

    process.stdout.write(`Processing session ${sessionId.slice(0, 8)}... `);

    const messages = await readJsonlMessages(filePath);

    if (messages.length === 0) {
      console.log('skipped (no messages)');
      skipped++;
      continue;
    }

    const summary = buildSessionSummary(messages);
    if (!summary.trim()) {
      console.log('skipped (empty summary)');
      skipped++;
      continue;
    }

    // Send the summary as a memory entry
    const metadata: Record<string, unknown> = {
      source: 'claude-code',
      sessionId,
      projectPath,
      messageCount: messages.length,
      importedAt: new Date().toISOString(),
    };

    // Build the messages to send: use summary as assistant message with
    // the first user prompt for context
    const mem0Messages: Array<{ role: string; content: string }> = [];

    const firstUser = messages.find((m) => m.role === 'user');
    if (firstUser) {
      mem0Messages.push({ role: 'user', content: firstUser.content.slice(0, 2000) });
    }

    mem0Messages.push({ role: 'assistant', content: summary });

    const success = await addMemory(mem0Url, mem0Messages, metadata);

    if (success) {
      imported++;
      console.log(`OK (${messages.length} messages)`);
    } else {
      failed++;
      console.log('FAILED');
    }
  }

  console.log('');
  console.log('=== Import complete ===');
  console.log(`Sessions imported: ${imported}`);
  console.log(`Sessions skipped:  ${skipped}`);
  console.log(`Sessions failed:   ${failed}`);
  console.log(`Total files:       ${jsonlFiles.length}`);

  if (failed > 0) {
    console.warn(`\nWarning: ${failed} session(s) failed to import. Check the output above for details.`);
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
