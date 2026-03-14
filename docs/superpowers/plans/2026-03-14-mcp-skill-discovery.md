# MCP Server & Skill Auto-Discovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runtime-aware auto-discovery of MCP servers and skills from machine configs, with machine-level defaults and per-agent opt-out overrides, unified picker UX in both create and edit flows.

**Architecture:** Bottom-up — shared types first (per shared package rule), then worker discovery logic, then CP proxies, then frontend pickers. Each layer is independently testable. Override resolution is a pure function in shared package.

**Tech Stack:** TypeScript, Vitest, smol-toml (TOML parser), React Query, Fastify, Playwright

**Spec:** `docs/superpowers/specs/2026-03-14-mcp-skill-discovery-design.md`

---

## Chunk 1: Shared Types + Dependencies

This chunk establishes the type foundation used by all subsequent chunks. Must be merged first per the shared package rule.

### Task 1: Add `smol-toml` dependency to agent-worker

**Files:**
- Modify: `packages/agent-worker/package.json`

- [ ] **Step 1: Install smol-toml**

```bash
cd packages/agent-worker && pnpm add smol-toml
```

- [ ] **Step 2: Verify install**

```bash
cd /Users/hahaschool/agentctl && pnpm install && node -e "import('smol-toml').then(() => console.log('ok'))"
```
Expected: no error

- [ ] **Step 3: Commit**

```bash
git add packages/agent-worker/package.json pnpm-lock.yaml
git commit -m "chore: add smol-toml dependency for Codex TOML parsing"
```

---

### Task 2: Extend `MachineCapabilities` with discovery provenance

**Files:**
- Modify: `packages/shared/src/types/machine.ts`
- Test: `packages/shared/src/types/machine.test.ts`

- [ ] **Step 1: Check for existing test file and write the failing test**

The file `packages/shared/src/types/machine.test.ts` already exists (tests for execution environment capabilities). APPEND the new tests to it — do NOT overwrite.

Add to `packages/shared/src/types/machine.test.ts`:

```typescript
// APPEND to existing file — do not overwrite

describe('MachineCapabilities - discovery provenance', () => {
  it('supports discovery provenance fields', () => {
    const caps: MachineCapabilities = {
      gpu: false,
      docker: true,
      maxConcurrentAgents: 4,
      mcpServerSources: {
        filesystem: 'discovered',
        'custom-server': 'manual',
      },
      skillSources: {
        'systematic-debugging': 'discovered',
      },
      lastDiscoveredAt: '2026-03-14T12:00:00Z',
    };

    expect(caps.mcpServerSources?.filesystem).toBe('discovered');
    expect(caps.skillSources?.['systematic-debugging']).toBe('discovered');
    expect(caps.lastDiscoveredAt).toBe('2026-03-14T12:00:00Z');
  });

  it('is backward compatible when provenance fields are absent', () => {
    const caps: MachineCapabilities = {
      gpu: false,
      docker: false,
      maxConcurrentAgents: 2,
    };

    expect(caps.mcpServerSources).toBeUndefined();
    expect(caps.skillSources).toBeUndefined();
    expect(caps.lastDiscoveredAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && pnpm vitest run src/types/machine.test.ts
```
Expected: FAIL — `mcpServerSources` not assignable to `MachineCapabilities`

- [ ] **Step 3: Add provenance fields to MachineCapabilities**

In `packages/shared/src/types/machine.ts`, add after existing fields:

```typescript
type MachineCapabilities = {
  gpu: boolean;
  docker: boolean;
  maxConcurrentAgents: number;
  executionEnvironments?: ExecutionEnvironmentCapability[];
  defaultExecutionEnvironment?: ExecutionEnvironmentId | null;
  // Discovery provenance
  mcpServerSources?: Record<string, 'discovered' | 'manual'>;
  skillSources?: Record<string, 'discovered' | 'manual'>;
  lastDiscoveredAt?: string;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/shared && pnpm vitest run src/types/machine.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/machine.ts packages/shared/src/types/machine.test.ts
git commit -m "feat: extend MachineCapabilities with discovery provenance fields"
```

---

### Task 3: Extend `ManagedSkill` with display metadata

**Files:**
- Modify: `packages/shared/src/types/runtime-management.ts`
- Test: `packages/shared/src/types/runtime-management.test.ts` (if exists, add tests; otherwise create)

- [ ] **Step 1: Check for existing test file**

```bash
ls packages/shared/src/types/runtime-management.test.ts 2>/dev/null || echo "no existing test"
```

- [ ] **Step 2: Write the failing test**

Add to existing test file or create new one:

```typescript
import { describe, it, expect } from 'vitest';
import type { ManagedSkill } from './runtime-management.js';

describe('ManagedSkill', () => {
  it('supports display metadata fields', () => {
    const skill: ManagedSkill = {
      id: 'systematic-debugging',
      path: '/skills/systematic-debugging/SKILL.md',
      enabled: true,
      name: 'Systematic Debugging',
      description: 'Use when encountering any bug or test failure',
      source: 'global',
    };

    expect(skill.name).toBe('Systematic Debugging');
    expect(skill.description).toContain('bug');
    expect(skill.source).toBe('global');
  });

  it('is backward compatible without display metadata', () => {
    const skill: ManagedSkill = {
      id: 'tdd',
      path: '/skills/tdd/SKILL.md',
      enabled: true,
    };

    expect(skill.name).toBeUndefined();
    expect(skill.description).toBeUndefined();
    expect(skill.source).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/shared && pnpm vitest run src/types/runtime-management.test.ts
```
Expected: FAIL — `name` not assignable to `ManagedSkill`

- [ ] **Step 4: Extend ManagedSkill type**

In `packages/shared/src/types/runtime-management.ts`, modify the `ManagedSkill` type:

```typescript
type ManagedSkill = {
  id: string;
  path: string;
  enabled: boolean;
  name?: string;
  description?: string;
  source?: 'global' | 'project';
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/shared && pnpm vitest run src/types/runtime-management.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/runtime-management.ts packages/shared/src/types/runtime-management.test.ts
git commit -m "feat: extend ManagedSkill with name, description, source fields"
```

---

### Task 4: Add `DiscoveredSkill` type and `configFile` to `DiscoveredMcpServer`

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Test: add to existing agent type tests or create

- [ ] **Step 1: Write the failing test**

Create or extend `packages/shared/src/types/agent-discovery.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { DiscoveredMcpServer, DiscoveredSkill } from './agent.js';

describe('DiscoveredMcpServer', () => {
  it('supports configFile field for provenance', () => {
    const server: DiscoveredMcpServer = {
      name: 'filesystem',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      source: 'global',
      configFile: '~/.claude.json',
    };

    expect(server.configFile).toBe('~/.claude.json');
  });

  it('is backward compatible without configFile', () => {
    const server: DiscoveredMcpServer = {
      name: 'filesystem',
      config: { command: 'npx' },
      source: 'global',
    };

    expect(server.configFile).toBeUndefined();
  });
});

describe('DiscoveredSkill', () => {
  it('holds all required fields from SKILL.md frontmatter', () => {
    const skill: DiscoveredSkill = {
      id: 'systematic-debugging',
      name: 'Systematic Debugging',
      description: 'Use when encountering any bug',
      path: '/Users/user/.claude/skills/systematic-debugging/SKILL.md',
      source: 'global',
      runtime: 'claude-code',
      userInvokable: true,
      args: 'optional args description',
    };

    expect(skill.id).toBe('systematic-debugging');
    expect(skill.runtime).toBe('claude-code');
    expect(skill.userInvokable).toBe(true);
  });

  it('works with minimal fields', () => {
    const skill: DiscoveredSkill = {
      id: 'my-skill',
      name: 'My Skill',
      description: 'Does things',
      path: '/path/to/SKILL.md',
      source: 'project',
      runtime: 'codex',
    };

    expect(skill.userInvokable).toBeUndefined();
    expect(skill.args).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && pnpm vitest run src/types/agent-discovery.test.ts
```
Expected: FAIL — `configFile` and `DiscoveredSkill` don't exist

- [ ] **Step 3: Add types to agent.ts**

In `packages/shared/src/types/agent.ts`:

Add `configFile` to `DiscoveredMcpServer`:
```typescript
type DiscoveredMcpServer = {
  name: string;
  config: McpServerConfig;
  source: McpServerSource;
  description?: string;
  configFile?: string;
};
```

Add new `DiscoveredSkill` type:
```typescript
type DiscoveredSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'global' | 'project';
  runtime: 'claude-code' | 'codex';
  userInvokable?: boolean;
  args?: string;
};
```

Export the new type from the file.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/shared && pnpm vitest run src/types/agent-discovery.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/agent-discovery.test.ts
git commit -m "feat: add DiscoveredSkill type and configFile to DiscoveredMcpServer"
```

---

### Task 5: Add `AgentMcpOverride` and `AgentSkillOverride` types

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Test: extend `packages/shared/src/types/agent-discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/types/agent-discovery.test.ts`:

```typescript
import type { AgentMcpOverride, AgentSkillOverride } from './agent.js';

describe('AgentMcpOverride', () => {
  it('represents opt-out override model', () => {
    const override: AgentMcpOverride = {
      excluded: ['filesystem', 'memory'],
      custom: [
        { name: 'my-server', command: 'npx', args: ['-y', 'my-server'] },
      ],
    };

    expect(override.excluded).toHaveLength(2);
    expect(override.custom).toHaveLength(1);
  });

  it('works with empty lists', () => {
    const override: AgentMcpOverride = {
      excluded: [],
      custom: [],
    };

    expect(override.excluded).toHaveLength(0);
    expect(override.custom).toHaveLength(0);
  });
});

describe('AgentSkillOverride', () => {
  it('represents opt-out override model for skills', () => {
    const override: AgentSkillOverride = {
      excluded: ['systematic-debugging'],
      custom: [
        { id: 'my-skill', path: '/path/SKILL.md', enabled: true },
      ],
    };

    expect(override.excluded).toEqual(['systematic-debugging']);
    expect(override.custom[0].id).toBe('my-skill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && pnpm vitest run src/types/agent-discovery.test.ts
```
Expected: FAIL — `AgentMcpOverride` doesn't exist

- [ ] **Step 3: Add override types to agent.ts**

In `packages/shared/src/types/agent.ts`:

```typescript
// Custom MCP servers require a name for display and matching
type CustomMcpServer = McpServerConfig & { name: string };

type AgentMcpOverride = {
  excluded: string[];
  custom: CustomMcpServer[];
};

type AgentSkillOverride = {
  excluded: string[];
  custom: ManagedSkill[];
};
```

Export `CustomMcpServer` from the file.

Import `ManagedSkill` from `./runtime-management.js`.

Add to `AgentConfig`:
```typescript
type AgentConfig = {
  // ... existing fields
  mcpOverride?: AgentMcpOverride;
  skillOverride?: AgentSkillOverride;
};
```

Export all new types (`AgentMcpOverride`, `AgentSkillOverride`, `CustomMcpServer`).

Also update `packages/shared/src/types/index.ts` barrel file to re-export the new types alongside existing exports like `DiscoveredMcpServer`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/shared && pnpm vitest run src/types/agent-discovery.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/agent-discovery.test.ts
git commit -m "feat: add AgentMcpOverride and AgentSkillOverride types"
```

---

### Task 6: Add override resolution utility

**Files:**
- Create: `packages/shared/src/discovery/resolve-overrides.ts`
- Test: `packages/shared/src/discovery/resolve-overrides.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/discovery/resolve-overrides.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveEffectiveMcpServers, resolveEffectiveSkills } from './resolve-overrides.js';
import type { ManagedMcpServer } from '../types/runtime-management.js';
import type { AgentMcpOverride, AgentSkillOverride } from '../types/agent.js';
import type { ManagedSkill } from '../types/runtime-management.js';

describe('resolveEffectiveMcpServers', () => {
  const defaults: ManagedMcpServer[] = [
    { id: '1', name: 'filesystem', command: 'npx', args: ['-y', 'fs-server'], env: {} },
    { id: '2', name: 'memory', command: 'npx', args: ['-y', 'mem-server'], env: {} },
    { id: '3', name: 'github', command: 'npx', args: ['-y', 'gh-server'], env: {} },
  ];

  it('returns all defaults when override is undefined', () => {
    const result = resolveEffectiveMcpServers(defaults, undefined);
    expect(result).toHaveLength(3);
    expect(result.map(s => s.name)).toEqual(['filesystem', 'memory', 'github']);
  });

  it('excludes servers in excluded list', () => {
    const override: AgentMcpOverride = { excluded: ['memory'], custom: [] };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['filesystem', 'github']);
  });

  it('appends custom servers after defaults', () => {
    const override: AgentMcpOverride = {
      excluded: [],
      custom: [{ name: 'my-server', command: 'my-cmd', args: ['--flag'] }],
    };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(4);
    expect(result[3].name).toBe('my-server');
    expect(result[3].command).toBe('my-cmd');
  });

  it('handles all-excluded with custom only', () => {
    const override: AgentMcpOverride = {
      excluded: ['filesystem', 'memory', 'github'],
      custom: [{ name: 'solo', command: 'solo', args: [] }],
    };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('solo');
  });

  it('handles empty defaults', () => {
    const override: AgentMcpOverride = {
      excluded: [],
      custom: [{ name: 'solo', command: 'solo', args: [] }],
    };
    const result = resolveEffectiveMcpServers([], override);
    expect(result).toHaveLength(1);
  });

  it('ignores excluded names not in defaults (no-op)', () => {
    const override: AgentMcpOverride = { excluded: ['nonexistent'], custom: [] };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(3);
  });
});

describe('resolveEffectiveSkills', () => {
  const defaults: ManagedSkill[] = [
    { id: 'tdd', path: '/skills/tdd/SKILL.md', enabled: true },
    { id: 'debug', path: '/skills/debug/SKILL.md', enabled: true },
  ];

  it('returns all defaults when override is undefined', () => {
    const result = resolveEffectiveSkills(defaults, undefined);
    expect(result).toHaveLength(2);
  });

  it('excludes skills by id', () => {
    const override: AgentSkillOverride = { excluded: ['debug'], custom: [] };
    const result = resolveEffectiveSkills(defaults, override);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tdd');
  });

  it('appends custom skills', () => {
    const override: AgentSkillOverride = {
      excluded: [],
      custom: [{ id: 'custom', path: '/custom/SKILL.md', enabled: true }],
    };
    const result = resolveEffectiveSkills(defaults, override);
    expect(result).toHaveLength(3);
    expect(result[2].id).toBe('custom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/shared && pnpm vitest run src/discovery/resolve-overrides.test.ts
```
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement resolve functions**

Create `packages/shared/src/discovery/resolve-overrides.ts`:

```typescript
import type { ManagedMcpServer, ManagedSkill } from '../types/runtime-management.js';
import type { AgentMcpOverride, AgentSkillOverride } from '../types/agent.js';

export function resolveEffectiveMcpServers(
  defaults: ManagedMcpServer[],
  override: AgentMcpOverride | undefined,
): ManagedMcpServer[] {
  if (!override) {
    return [...defaults];
  }

  const excludedSet = new Set(override.excluded);
  const filtered = defaults.filter((s) => !excludedSet.has(s.name));

  // CustomMcpServer has `name` (required), so we can map directly
  const customAsManaged: ManagedMcpServer[] = override.custom.map((c) => ({
    id: `custom-${c.name}`,
    name: c.name,
    command: c.command,
    args: c.args ?? [],
    env: c.env ?? {},
  }));

  return [...filtered, ...customAsManaged];
}

export function resolveEffectiveSkills(
  defaults: ManagedSkill[],
  override: AgentSkillOverride | undefined,
): ManagedSkill[] {
  if (!override) {
    return [...defaults];
  }

  const excludedSet = new Set(override.excluded);
  const filtered = defaults.filter((s) => !excludedSet.has(s.id));

  return [...filtered, ...override.custom];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/shared && pnpm vitest run src/discovery/resolve-overrides.test.ts
```
Expected: PASS

- [ ] **Step 5: Create barrel file and export from shared package index**

Create `packages/shared/src/discovery/index.ts`:

```typescript
export { resolveEffectiveMcpServers, resolveEffectiveSkills } from './resolve-overrides.js';
```

Add to `packages/shared/src/index.ts` (following the existing `export *` pattern):

```typescript
export * from './discovery/index.js';
```

- [ ] **Step 6: Verify build passes**

```bash
cd packages/shared && pnpm build
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/discovery/ packages/shared/src/index.ts
git commit -m "feat: add override resolution utilities for MCP servers and skills"
```

---

### Task 7: Verify full shared package build + lint

- [ ] **Step 1: Run build**

```bash
cd packages/shared && pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run lint**

```bash
cd packages/shared && pnpm lint
```
Expected: 0 errors

- [ ] **Step 3: Run all shared tests**

```bash
cd packages/shared && pnpm vitest run
```
Expected: all tests pass (existing + new)

---

## Chunk 2: Worker Backend — Discovery

This chunk adds Codex TOML MCP parsing, skill discovery for both runtimes, extends the existing MCP discovery route with `runtime` param, adds the skill discovery route, and implements discovery caching.

### Task 8: Codex TOML MCP discovery parser

**Files:**
- Create: `packages/agent-worker/src/runtime/discovery/codex-mcp-discovery.ts`
- Test: `packages/agent-worker/src/runtime/discovery/codex-mcp-discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-worker/src/runtime/discovery/codex-mcp-discovery.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverCodexMcpServers } from './codex-mcp-discovery.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

import { readFile, access } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

describe('discoverCodexMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid TOML with mcp_servers section', async () => {
    const toml = `
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]

[mcp_servers.filesystem.env]
ROOT = "/workspace"

[mcp_servers.memory]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-memory"]
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    const result = await discoverCodexMcpServers('/home/user');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('filesystem');
    expect(result[0].config.command).toBe('npx');
    expect(result[0].config.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
    expect(result[0].config.env).toEqual({ ROOT: '/workspace' });
    expect(result[0].source).toBe('global');
    expect(result[0].configFile).toContain('.codex/config.toml');

    expect(result[1].name).toBe('memory');
    expect(result[1].config.env).toEqual({});
  });

  it('returns empty array when config.toml does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('returns empty array for TOML without mcp_servers section', async () => {
    const toml = `
model = "gpt-5"
reasoning_effort = "high"
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('handles malformed TOML gracefully', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('invalid [[[toml content');

    const result = await discoverCodexMcpServers('/home/user');
    expect(result).toEqual([]);
  });

  it('discovers from project path with project source', async () => {
    const toml = `
[mcp_servers.db]
command = "npx"
args = ["-y", "pg-server"]
`;
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(toml);

    const result = await discoverCodexMcpServers('/project', 'project');

    expect(result[0].source).toBe('project');
    expect(result[0].configFile).toContain('.codex/config.toml');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/discovery/codex-mcp-discovery.test.ts
```
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Create the discovery directory if needed**

```bash
mkdir -p packages/agent-worker/src/runtime/discovery
```

- [ ] **Step 4: Implement Codex TOML MCP discovery**

Create `packages/agent-worker/src/runtime/discovery/codex-mcp-discovery.ts`:

```typescript
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import type { DiscoveredMcpServer, McpServerSource } from '@agentctl/shared';

type CodexTomlConfig = {
  mcp_servers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
};

export async function discoverCodexMcpServers(
  basePath: string,
  sourceType: McpServerSource = 'global',
): Promise<DiscoveredMcpServer[]> {
  const configPath = join(basePath, '.codex', 'config.toml');

  try {
    await access(configPath);
  } catch {
    return [];
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = parse(content) as CodexTomlConfig;

    if (!parsed.mcp_servers) {
      return [];
    }

    return Object.entries(parsed.mcp_servers).map(([name, server]) => ({
      name,
      config: {
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? {},
      },
      source: sourceType,
      configFile: configPath,
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/discovery/codex-mcp-discovery.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-worker/src/runtime/discovery/
git commit -m "feat: add Codex TOML MCP server discovery parser"
```

---

### Task 9: Skill discovery for both runtimes

**Files:**
- Create: `packages/agent-worker/src/runtime/discovery/skill-discovery.ts`
- Test: `packages/agent-worker/src/runtime/discovery/skill-discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-worker/src/runtime/discovery/skill-discovery.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverSkills } from './skill-discovery.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
}));

import { readdir, readFile, access } from 'node:fs/promises';

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

describe('discoverSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers claude-code global skills from ~/.claude/skills/', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'systematic-debugging', isDirectory: () => true },
      { name: 'tdd', isDirectory: () => true },
    ] as any);
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('systematic-debugging')) {
        return `---
name: Systematic Debugging
description: Use when encountering any bug or test failure
---
Content here`;
      }
      if (String(path).includes('tdd')) {
        return `---
name: Test-Driven Development
description: Use when implementing features
user-invokable: true
args: optional feature name
---
TDD content`;
      }
      throw new Error('ENOENT');
    });

    const result = await discoverSkills('claude-code', '/home/user');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('systematic-debugging');
    expect(result[0].name).toBe('Systematic Debugging');
    expect(result[0].source).toBe('global');
    expect(result[0].runtime).toBe('claude-code');

    expect(result[1].id).toBe('tdd');
    expect(result[1].userInvokable).toBe(true);
    expect(result[1].args).toBe('optional feature name');
  });

  it('discovers codex skills from ~/.agents/skills/', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'code-review', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue(`---
name: Code Review
description: Automated code review
---
Content`);

    const result = await discoverSkills('codex', '/home/user');

    expect(result).toHaveLength(1);
    expect(result[0].runtime).toBe('codex');
  });

  it('returns empty when skills directory does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toEqual([]);
  });

  it('skips entries without SKILL.md', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'valid-skill', isDirectory: () => true },
      { name: 'no-skill-md', isDirectory: () => true },
    ] as any);
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('valid-skill')) {
        return `---
name: Valid
description: A valid skill
---
Content`;
      }
      throw new Error('ENOENT');
    });

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid-skill');
  });

  it('skips skills with missing frontmatter', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'no-frontmatter', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue('Just content, no frontmatter');

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toEqual([]);
  });

  it('discovers project-scoped skills when projectPath provided', async () => {
    mockAccess.mockImplementation(async (path) => {
      // Global path fails, project path succeeds
      if (String(path).includes('/home/user')) {
        throw new Error('ENOENT');
      }
    });
    mockReaddir.mockResolvedValue([
      { name: 'project-skill', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue(`---
name: Project Skill
description: A project skill
---
Content`);

    const result = await discoverSkills('claude-code', '/home/user', '/project');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('project');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/discovery/skill-discovery.test.ts
```
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement skill discovery**

Create `packages/agent-worker/src/runtime/discovery/skill-discovery.ts`:

```typescript
import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscoveredSkill } from '@agentctl/shared';
import type { ManagedRuntime } from '@agentctl/shared';

const SKILLS_PATHS: Record<ManagedRuntime, { global: string; project: string }> = {
  'claude-code': { global: '.claude/skills', project: '.claude/skills' },
  codex: { global: '.agents/skills', project: '.agents/skills' },
};

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
      if (!frontmatter || !frontmatter.name || !frontmatter.description) continue;

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/discovery/skill-discovery.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/discovery/skill-discovery.ts packages/agent-worker/src/runtime/discovery/skill-discovery.test.ts
git commit -m "feat: add skill discovery for claude-code and codex runtimes"
```

---

### Task 10: Discovery cache

**Files:**
- Create: `packages/agent-worker/src/runtime/discovery/discovery-cache.ts`
- Test: `packages/agent-worker/src/runtime/discovery/discovery-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-worker/src/runtime/discovery/discovery-cache.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscoveryCache } from './discovery-cache.js';

describe('DiscoveryCache', () => {
  let cache: DiscoveryCache<string[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new DiscoveryCache<string[]>(60_000); // 60s TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for cache miss', () => {
    expect(cache.get('key')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    cache.set('key', ['a', 'b']);
    expect(cache.get('key')).toEqual(['a', 'b']);
  });

  it('returns undefined after TTL expires', () => {
    cache.set('key', ['a']);
    vi.advanceTimersByTime(61_000);
    expect(cache.get('key')).toBeUndefined();
  });

  it('returns value before TTL expires', () => {
    cache.set('key', ['a']);
    vi.advanceTimersByTime(59_000);
    expect(cache.get('key')).toEqual(['a']);
  });

  it('invalidates a specific key', () => {
    cache.set('key1', ['a']);
    cache.set('key2', ['b']);
    cache.invalidate('key1');
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toEqual(['b']);
  });

  it('invalidates all keys', () => {
    cache.set('key1', ['a']);
    cache.set('key2', ['b']);
    cache.invalidateAll();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/discovery/discovery-cache.test.ts
```
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement the cache**

Create `packages/agent-worker/src/runtime/discovery/discovery-cache.ts`:

```typescript
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class DiscoveryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agent-worker && pnpm vitest run src/runtime/discovery/discovery-cache.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/discovery/discovery-cache.ts packages/agent-worker/src/runtime/discovery/discovery-cache.test.ts
git commit -m "feat: add in-memory discovery cache with TTL"
```

---

### Task 11: Extend MCP discovery route with `runtime` param

**Files:**
- Modify: `packages/agent-worker/src/api/routes/mcp-discover.ts`
- Test: `packages/agent-worker/src/api/routes/mcp-discover.test.ts` (create or extend)

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-worker/src/api/routes/mcp-discover.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Test the route with runtime=codex queries the Codex discovery
// Test the route with runtime=claude-code uses existing logic
// Test the route without runtime defaults to claude-code
// Test caching: second call within 60s returns same results without re-scanning

// These tests verify the route handler correctly delegates to the right
// discovery function based on the runtime query parameter.
// Detailed tests for each discovery function are in their own test files.

describe('GET /api/mcp/discover', () => {
  it('defaults to claude-code when runtime param is missing', async () => {
    // Route should call discoverAllMcpServers (existing claude-code logic)
    // Verify by checking the response includes Claude-format sources
  });

  it('calls Codex discovery when runtime=codex', async () => {
    // Route should call discoverCodexMcpServers
    // Verify by checking response includes codex-format configFile paths
  });

  it('returns 400 for invalid runtime value', async () => {
    // runtime=invalid should return 400
  });

  it('uses cached results on second call within TTL', async () => {
    // First call triggers discovery, second call within 60s returns cached
    // Verify by checking discovery function call count
  });
});
```

NOTE: The exact test implementation depends on how the existing route is structured and what test helpers are available. The implementer should follow the patterns in existing worker route tests (using `app.inject()`, `createSilentLogger()` from test-helpers).

- [ ] **Step 2: Extend the route handler**

In `packages/agent-worker/src/api/routes/mcp-discover.ts`:

1. Import `discoverCodexMcpServers` from `../../runtime/discovery/codex-mcp-discovery.js` (two levels up from `api/routes/` to `src/`)
2. Import `DiscoveryCache` from `../../runtime/discovery/discovery-cache.js`
3. Add `runtime` to Fastify `Querystring` generic: `{ projectPath?: string; runtime?: string }`
4. Default `runtime` to `'claude-code'`, validate against `MANAGED_RUNTIMES`
5. Branch discovery logic based on runtime:
   - `claude-code`: existing `discoverAllMcpServers()` logic
   - `codex`: call `discoverCodexMcpServers(homedir(), 'global')` + `discoverCodexMcpServers(projectPath, 'project')` if projectPath set, then merge (mirroring how the existing code calls both global and project discovery)
6. Add `configFile` to each returned `DiscoveredMcpServer`. Replace existing `description: 'From ${filePath}'` pattern with `configFile: filePath` — update `extractMcpServers()` and `objectToDiscoveredServers()` helpers accordingly
7. Wrap in cache: key = `mcp:${runtime}:${projectPath || 'global'}`, TTL = 60s. Export cache instance so sync-capabilities can call `invalidateAll()`

- [ ] **Step 3: Run tests**

```bash
cd packages/agent-worker && pnpm vitest run src/api/routes/mcp-discover.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agent-worker/src/api/routes/mcp-discover.ts packages/agent-worker/src/api/routes/mcp-discover.test.ts
git commit -m "feat: extend MCP discovery route with runtime param and caching"
```

---

### Task 12: Add skill discovery route

**Files:**
- Create: `packages/agent-worker/src/api/routes/skill-discover.ts`
- Test: `packages/agent-worker/src/api/routes/skill-discover.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/agent-worker/src/api/routes/skill-discover.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test: GET /api/skills/discover?runtime=claude-code returns skills from ~/.claude/skills/
// Test: GET /api/skills/discover?runtime=codex returns skills from ~/.agents/skills/
// Test: projectPath param adds project-scoped skills
// Test: returns 400 for invalid runtime
// Test: caching works (second call within TTL returns cached)
// Test: returns empty array when no skills found

describe('GET /api/skills/discover', () => {
  it('returns discovered skills for claude-code runtime', async () => {
    // Mock discoverSkills to return test data
    // Verify response shape matches DiscoveredSkill[]
  });

  it('returns 400 for invalid runtime', async () => {
    // runtime=invalid should return 400
  });

  it('includes project skills when projectPath provided', async () => {
    // Verify both global and project skills are returned
  });
});
```

NOTE: The implementer should follow the pattern established in Task 11 and existing worker route tests.

- [ ] **Step 2: Implement the route**

Create `packages/agent-worker/src/api/routes/skill-discover.ts`:

```typescript
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';
import { homedir } from 'node:os';
import { discoverSkills } from '../../runtime/discovery/skill-discovery.js';
import { DiscoveryCache } from '../../runtime/discovery/discovery-cache.js';
import { MANAGED_RUNTIMES } from '@agentctl/shared';
import type { ManagedRuntime, DiscoveredSkill } from '@agentctl/shared';

type SkillDiscoverRouteOptions = FastifyPluginOptions & { logger: Logger };

export const skillDiscoverCache = new DiscoveryCache<DiscoveredSkill[]>(60_000);

export async function skillDiscoverRoutes(
  app: FastifyInstance,
  options: SkillDiscoverRouteOptions,
): Promise<void> {
  const { logger } = options;

  // Use relative path '/discover' — registered with prefix '/api/skills'
  app.get<{
    Querystring: { runtime?: string; projectPath?: string };
  }>('/discover', async (request, reply) => {
    const runtime = (request.query.runtime ?? 'claude-code') as string;

    if (!MANAGED_RUNTIMES.includes(runtime as ManagedRuntime)) {
      return reply.status(400).send({
        ok: false,
        error: `Invalid runtime: ${runtime}. Must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
      });
    }

    const projectPath = request.query.projectPath;
    const cacheKey = `skills:${runtime}:${projectPath ?? 'global'}`;

    const cached = skillDiscoverCache.get(cacheKey);
    if (cached) {
      return reply.send({ ok: true, discovered: cached, cached: true });
    }

    const discovered = await discoverSkills(
      runtime as ManagedRuntime,
      homedir(),
      projectPath,
    );

    skillDiscoverCache.set(cacheKey, discovered);

    logger.info({ runtime, count: discovered.length }, 'Skills discovered');

    return reply.send({ ok: true, discovered, cached: false });
  });
}
```

- [ ] **Step 3: Register route in worker app**

In `packages/agent-worker/src/api/server.ts`, add alongside the existing `mcpDiscoverRoutes` registration:

```typescript
import { skillDiscoverRoutes } from './routes/skill-discover.js';
// ...
await app.register(skillDiscoverRoutes, { prefix: '/api/skills', logger });
```

- [ ] **Step 4: Run tests**

```bash
cd packages/agent-worker && pnpm vitest run src/api/routes/skill-discover.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-worker/src/api/routes/skill-discover.ts packages/agent-worker/src/api/routes/skill-discover.test.ts
git commit -m "feat: add skill discovery route for worker"
```

---

### Task 13: Verify worker build + existing tests

- [ ] **Step 1: Run build**

```bash
cd packages/agent-worker && pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run all worker tests**

```bash
cd packages/agent-worker && pnpm vitest run
```
Expected: all tests pass (existing + new)

- [ ] **Step 3: Commit any fixes if needed**

---

## Chunk 3: Control Plane Backend — Proxies + Sync

### Task 14: Extend MCP discover proxy with `runtime` param

**Files:**
- Modify: `packages/control-plane/src/api/routes/mcp-templates.ts` (lines 138-207)
- Test: extend existing route tests

- [ ] **Step 1: Write the failing test**

Add test for runtime parameter forwarding:

```typescript
describe('GET /api/mcp/discover', () => {
  it('forwards runtime param to worker', async () => {
    // Mock worker fetch to capture the URL
    // Call CP proxy with ?machineId=...&runtime=codex
    // Verify worker URL includes runtime=codex
  });

  it('defaults runtime to claude-code when not provided', async () => {
    // Call without runtime param
    // Verify worker URL includes runtime=claude-code
  });
});
```

- [ ] **Step 2: Modify the proxy route**

In `packages/control-plane/src/api/routes/mcp-templates.ts`, update the discover route handler:

1. Update the Fastify `Querystring` generic at line 141 to include `runtime?: string` alongside existing `machineId` and `projectPath`
2. Read `runtime` from query params (default: `'claude-code'`), validate against `MANAGED_RUNTIMES`
3. Forward `runtime` param to worker URL: `${workerUrl}/api/mcp/discover?runtime=${runtime}&projectPath=${projectPath}`

- [ ] **Step 3: Run tests**

```bash
cd packages/control-plane && pnpm vitest run src/api/routes/mcp-templates.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/api/routes/mcp-templates.ts
git commit -m "feat: forward runtime param in MCP discover proxy"
```

---

### Task 15: Add skill discover proxy route

**Files:**
- Create: `packages/control-plane/src/api/routes/skill-discover.ts`
- Test: `packages/control-plane/src/api/routes/skill-discover.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/control-plane/src/api/routes/skill-discover.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('GET /api/skills/discover', () => {
  it('returns 400 when machineId is missing', async () => {
    // Verify 400 response
  });

  it('proxies to worker skill discover endpoint', async () => {
    // Mock resolveWorkerUrlByMachineId
    // Mock fetch to worker
    // Verify response forwarded correctly
  });

  it('forwards runtime and projectPath params', async () => {
    // Verify all params forwarded to worker URL
  });

  it('returns 502 when worker is unreachable', async () => {
    // Mock fetch to throw
    // Verify 502 response
  });
});
```

NOTE: Follow the pattern in `mcp-templates.ts` lines 138-207 for the proxy implementation.

- [ ] **Step 2: Implement the proxy route**

Create `packages/control-plane/src/api/routes/skill-discover.ts`. Mirror the MCP discover proxy pattern:

1. Require `machineId` query param
2. Resolve worker URL via `resolveWorkerUrlByMachineId()`
3. Forward to `${workerUrl}/api/skills/discover?runtime=${runtime}&projectPath=${projectPath}`
4. Return worker response or 502 on failure

- [ ] **Step 3: Register route in CP app**

In `packages/control-plane/src/api/server.ts`, register with prefix:
```typescript
import { skillDiscoverRoutes } from './routes/skill-discover.js';
await app.register(skillDiscoverRoutes, { prefix: '/api/skills' });
```

Use relative path `/discover` in the route handler (matching MCP pattern).

- [ ] **Step 4: Run tests**

```bash
cd packages/control-plane && pnpm vitest run src/api/routes/skill-discover.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/skill-discover.ts packages/control-plane/src/api/routes/skill-discover.test.ts
git commit -m "feat: add skill discover proxy route to control plane"
```

---

### Task 16: Add sync-capabilities endpoint

**Files:**
- Create: `packages/control-plane/src/api/routes/machine-capabilities.ts`
- Test: `packages/control-plane/src/api/routes/machine-capabilities.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe('POST /api/machines/:machineId/sync-capabilities', () => {
  it('calls MCP and skill discovery on the target machine', async () => {
    // Mock both discovery proxy calls
    // Verify both are called
  });

  it('updates machine capabilities with discovery provenance', async () => {
    // Verify machine record updated with mcpServerSources, skillSources, lastDiscoveredAt
  });

  it('preserves manual entries when syncing', async () => {
    // Pre-existing manual entries should not be overwritten
  });

  it('returns 404 when machine not found', async () => {
    // Verify 404 response
  });
});
```

- [ ] **Step 2: Implement the endpoint**

Create `packages/control-plane/src/api/routes/machine-capabilities.ts`:

1. `POST /api/machines/:machineId/sync-capabilities`
2. Fetch machine from DB
3. Call both discovery endpoints (MCP + skills) for each managed runtime the machine supports
4. Update `ManagedRuntimeConfig.mcpServers` and `skills` with discovered items
5. Update `machine.capabilities.mcpServerSources` and `skillSources`
6. Set `machine.capabilities.lastDiscoveredAt` to current ISO timestamp
7. Preserve entries tagged as `'manual'`

- [ ] **Step 3: Run tests**

```bash
cd packages/control-plane && pnpm vitest run src/api/routes/machine-capabilities.test.ts
```
Expected: PASS

- [ ] **Step 4: Register route in CP app**

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/machine-capabilities.ts packages/control-plane/src/api/routes/machine-capabilities.test.ts
git commit -m "feat: add sync-capabilities endpoint for machine discovery"
```

---

### Task 17: Verify CP build + existing tests

- [ ] **Step 1: Run build**

```bash
cd packages/control-plane && pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run all CP tests**

```bash
cd packages/control-plane && pnpm vitest run
```
Expected: all tests pass

---

## Chunk 4: Frontend — API Layer + Pickers

### Task 18: Add skill discovery to web API layer

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add response type and API method**

In `packages/web/src/lib/api.ts`:

```typescript
// Add import for DiscoveredSkill at the top of api.ts
import type { DiscoveredSkill } from '@agentctl/shared';

// Add response type (alongside existing McpDiscoverResponse)
type SkillDiscoverResponse = {
  ok: boolean;
  discovered: DiscoveredSkill[];
  cached: boolean;
};

// Add API method to the `api` object literal (follows existing pattern using `request<>()`)
discoverSkills(machineId: string, runtime: string, projectPath?: string): Promise<SkillDiscoverResponse> {
  const params = new URLSearchParams({ machineId, runtime });
  if (projectPath) params.set('projectPath', projectPath);
  return request<SkillDiscoverResponse>(`/api/skills/discover?${params}`);
},
```

Also add `runtime: string` param to existing `discoverMcpServers` method and update the query string it builds. This is a **breaking change** — update all callers (McpServerPicker in Task 19) in the same commit to avoid intermediate build breakage.

- [ ] **Step 2: Add query key and query options**

In `packages/web/src/lib/queries.ts`:

```typescript
// Query keys
skillDiscover: (machineId: string, runtime: string, projectPath?: string) =>
  projectPath
    ? (['skills', 'discover', machineId, runtime, projectPath] as const)
    : (['skills', 'discover', machineId, runtime] as const),

// Also update mcpDiscover key to include runtime
mcpDiscover: (machineId: string, runtime: string, projectPath?: string) =>
  projectPath
    ? (['mcp', 'discover', machineId, runtime, projectPath] as const)
    : (['mcp', 'discover', machineId, runtime] as const),
```

Add query option functions with `staleTime: 30_000`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat: add skill discovery API and query hooks to web layer"
```

---

### Task 19: Refactor McpServerPicker for override model

**Files:**
- Modify: `packages/web/src/components/McpServerPicker.tsx`
- Test: `packages/web/src/components/McpServerPicker.test.tsx`

- [ ] **Step 1: Write failing tests for new behavior**

Create `packages/web/src/components/McpServerPicker.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpServerPicker } from './McpServerPicker';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Test: renders discovered servers as checked by default (opt-out model)
// Test: unchecking a server adds it to excluded list
// Test: re-checking a server removes it from excluded
// Test: custom servers display with "custom" badge
// Test: shows "machine default" badge for discovered servers
// Test: shows runtime-appropriate grouping
// Test: hidden when runtime is not managed (isManagedRuntime guard)

describe('McpServerPicker', () => {
  it('renders discovered servers as checked (inherited)', () => {
    // Render with mock discovery data
    // All discovered servers should have checked checkboxes
  });

  it('adds server to excluded when unchecked', () => {
    // Click checkbox on a discovered server
    // Verify onChange called with server name in excluded[]
  });

  it('removes server from excluded when re-checked', () => {
    // Start with server in excluded
    // Click checkbox
    // Verify onChange called without server in excluded[]
  });

  it('shows inherited/excluded/custom badges', () => {
    // Verify visual states render correctly
  });
});
```

- [ ] **Step 2: Refactor component props**

Change `McpServerPicker` props from:
```typescript
{ value: Record<string, McpServerConfig>; onChange: (servers: Record<string, McpServerConfig>) => void }
```
to:
```typescript
{ runtime: ManagedRuntime; currentOverrides: AgentMcpOverride; onChange: (overrides: AgentMcpOverride) => void }
```

Update internal state to use the override model. Discovered servers are all "included" by default unless in `excluded`. Custom servers come from `currentOverrides.custom`.

- [ ] **Step 3: Update discovery query to pass runtime**

Update the query call to include `runtime` param.

- [ ] **Step 4: Add visual states**

- Inherited (default): checkbox checked, subtle "machine default" badge
- Excluded: checkbox unchecked, strikethrough name
- Custom: checkbox checked, "custom" badge

Group by `configFile` provenance.

- [ ] **Step 5: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/McpServerPicker.test.tsx
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/McpServerPicker.tsx packages/web/src/components/McpServerPicker.test.tsx
git commit -m "refactor: McpServerPicker to override model with runtime-aware discovery"
```

---

### Task 20: Create SkillPicker component

**Files:**
- Create: `packages/web/src/components/SkillPicker.tsx`
- Test: `packages/web/src/components/SkillPicker.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `packages/web/src/components/SkillPicker.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Test: renders discovered skills with name + description
// Test: all skills checked by default (opt-out)
// Test: unchecking adds to excluded
// Test: shows source badge (global/project)
// Test: custom skills section works
// Test: hidden for non-managed runtimes

describe('SkillPicker', () => {
  it('renders discovered skills with metadata', () => {
    // Verify name and description from frontmatter display
  });

  it('toggles skill exclusion', () => {
    // Click checkbox, verify onChange called with excluded
  });

  it('shows source badges', () => {
    // Verify global/project badges render
  });
});
```

- [ ] **Step 2: Implement SkillPicker**

Create `packages/web/src/components/SkillPicker.tsx` mirroring `McpServerPicker` pattern:

```typescript
type SkillPickerProps = {
  machineId: string;
  runtime: ManagedRuntime;
  projectPath?: string;
  currentOverrides: AgentSkillOverride;
  onChange: (overrides: AgentSkillOverride) => void;
  disabled?: boolean;
};
```

Features:
- Collapsible section with "Skills" label + enabled count
- Queries skill discovery endpoint
- Checkbox list with inherited/excluded/custom visual states
- Grouped by source (Global / Project)
- Custom skill form at bottom (id + path)
- Loading/error states

- [ ] **Step 3: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/SkillPicker.test.tsx
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/SkillPicker.tsx packages/web/src/components/SkillPicker.test.tsx
git commit -m "feat: add SkillPicker component with runtime-aware discovery"
```

---

### Task 21: Update McpServersTab to use picker

**Files:**
- Modify: `packages/web/src/components/agent-settings/McpServersTab.tsx`
- Test: `packages/web/src/components/agent-settings/McpServersTab.test.tsx`

- [ ] **Step 1: Write failing tests for new behavior**

```typescript
describe('McpServersTab', () => {
  it('renders McpServerPicker instead of manual form', () => {
    // Verify picker is rendered
    // Verify old manual form is gone
  });

  it('passes agent runtime and overrides to picker', () => {
    // Verify correct props
  });

  it('saves override changes to agent config', () => {
    // Verify save mutation includes mcpOverride
  });
});
```

- [ ] **Step 2: Replace manual form with McpServerPicker**

Add `isManagedRuntime` guard (same as SkillsTab):
```tsx
import { isManagedRuntime } from '@agentctl/shared';

// Early return for non-managed runtimes
if (!agent.runtime || !isManagedRuntime(agent.runtime)) {
  return <div>MCP discovery is only available for managed runtimes (claude-code, codex).</div>;
}
```

Replace the manual entry form with:
```tsx
<McpServerPicker
  machineId={agent.machineId}
  runtime={agent.runtime}  // safe after isManagedRuntime guard above
  projectPath={agent.projectPath}
  currentOverrides={agent.config?.mcpOverride ?? { excluded: [], custom: [] }}
  onChange={handleOverrideChange}
/>
```

Keep the save button. On save, write `mcpOverride` to agent config.

For agents with existing `mcpServers` (flat record, pre-migration), convert to `mcpOverride.custom` on load. Migration helper:
```typescript
function migrateToOverride(legacy: Record<string, McpServerConfig> | undefined): AgentMcpOverride {
  if (!legacy || Object.keys(legacy).length === 0) return { excluded: [], custom: [] };
  return {
    excluded: [],
    custom: Object.entries(legacy).map(([name, config]) => ({ name, ...config })),
  };
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/agent-settings/McpServersTab.test.tsx
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/agent-settings/McpServersTab.tsx packages/web/src/components/agent-settings/McpServersTab.test.tsx
git commit -m "refactor: replace McpServersTab manual form with McpServerPicker"
```

---

### Task 22: Create SkillsTab component

**Files:**
- Create: `packages/web/src/components/agent-settings/SkillsTab.tsx`
- Test: `packages/web/src/components/agent-settings/SkillsTab.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
describe('SkillsTab', () => {
  it('renders SkillPicker for managed runtime agents', () => {
    // Verify picker renders
  });

  it('shows message for non-managed runtime agents', () => {
    // Agent with runtime=nanoclaw should see disabled state
  });

  it('saves skill overrides to agent config', () => {
    // Verify save mutation includes skillOverride
  });
});
```

- [ ] **Step 2: Implement SkillsTab**

Create `packages/web/src/components/agent-settings/SkillsTab.tsx`:

```tsx
import { SkillPicker } from '../SkillPicker';
import { isManagedRuntime } from '@agentctl/shared';
// ... standard agent-settings tab pattern

export function SkillsTab({ agent }: { agent: Agent }) {
  if (!agent.runtime || !isManagedRuntime(agent.runtime)) {
    return <div>Skill discovery is only available for managed runtimes.</div>;
  }

  // State, save handler, SkillPicker integration
  // Follow McpServersTab save pattern
}
```

- [ ] **Step 3: Register tab in agent settings**

In `packages/web/src/app/agents/[id]/settings/page.tsx`:
1. Import `SkillsTab` from `@/components/agent-settings/SkillsTab`
2. Add `{ value: 'skills', label: 'Skills' }` to the `TABS` array (after the MCP tab)
3. Add `<TabsContent value="skills"><SkillsTab agent={data} /></TabsContent>` in the render
4. Include this file in the commit below

- [ ] **Step 4: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/agent-settings/SkillsTab.test.tsx
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agent-settings/SkillsTab.tsx packages/web/src/components/agent-settings/SkillsTab.test.tsx packages/web/src/app/agents/\[id\]/settings/page.tsx
git commit -m "feat: add SkillsTab with skill discovery picker"
```

---

### Task 23: Update AgentFormDialog to use new picker APIs

**Files:**
- Modify: `packages/web/src/components/AgentFormDialog.tsx`
- Test: extend existing tests

- [ ] **Step 1: Update McpServerPicker usage**

Replace current integration (lines 542-548):
```tsx
<McpServerPicker
  machineId={machineId}
  runtime={(runtime || 'claude-code') as ManagedRuntime}
  currentOverrides={mcpOverride}
  onChange={setMcpOverride}
  disabled={isPending}
/>
```

- [ ] **Step 2: Add SkillPicker to form**

Add a SkillPicker section after the MCP section:
```tsx
<SkillPicker
  machineId={machineId}
  runtime={(runtime || 'claude-code') as ManagedRuntime}
  currentOverrides={skillOverride}
  onChange={setSkillOverride}
  disabled={isPending}
/>
```

- [ ] **Step 3: Add runtime state variable**

The current `AgentFormDialog` does not have a `runtime` state variable. The agent's runtime type (claude-code vs codex) is needed for the pickers. Add:

```typescript
const [runtime, setRuntime] = useState<ManagedRuntime>('claude-code');
```

In edit mode, populate from `agent.runtime` (guarded by `isManagedRuntime`). The pickers should only render when `isManagedRuntime(runtime)` is true.

NOTE: If there is already a runtime selector in the form (check `AgentFormDialog` for a "Runtime" or "Agent Type" dropdown), use that state instead of creating a new one. The implementer should verify the exact current form structure.

- [ ] **Step 4: Update state management**

Change state from:
```typescript
const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({});
```
to:
```typescript
const [mcpOverride, setMcpOverride] = useState<AgentMcpOverride>({ excluded: [], custom: [] });
const [skillOverride, setSkillOverride] = useState<AgentSkillOverride>({ excluded: [], custom: [] });
```

For edit mode, populate from `agent.config?.mcpOverride` and `agent.config?.skillOverride`. If agent has legacy `mcpServers` (flat record), convert to `custom` entries using the same `migrateToOverride()` helper from Task 21.

- [ ] **Step 5: Update form submission**

Include `mcpOverride` and `skillOverride` in the submitted agent config instead of `mcpServers`.

- [ ] **Step 6: Run tests**

```bash
cd packages/web && pnpm vitest run src/components/AgentFormDialog.test.tsx
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/AgentFormDialog.tsx packages/web/src/components/AgentFormDialog.test.tsx
git commit -m "feat: integrate override-model pickers into AgentFormDialog"
```

---

### Task 24: Verify full web build + tests

- [ ] **Step 1: Run build**

```bash
cd packages/web && pnpm build
```
Expected: 0 errors

- [ ] **Step 2: Run all web tests**

```bash
cd packages/web && pnpm vitest run
```
Expected: all tests pass

---

## Chunk 5: Integration + E2E Tests

### Task 25: Full monorepo build verification

- [ ] **Step 1: Run full build**

```bash
cd /Users/hahaschool/agentctl && pnpm build
```
Expected: 0 errors across all packages

- [ ] **Step 2: Run full lint**

```bash
pnpm lint
```
Expected: 0 errors

- [ ] **Step 3: Run all unit tests**

```bash
pnpm vitest run
```
Expected: all tests pass

---

### Task 26: E2E tests

**Files:**
- Create: `packages/web/e2e/mcp-skill-discovery.spec.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
import { test, expect } from '@playwright/test';

test.describe('MCP & Skill Discovery', () => {
  test('create agent shows MCP picker with discovered servers', async ({ page }) => {
    // Navigate to create agent
    // Select a machine
    // Verify MCP picker loads with discovered servers
    // Toggle a server off
    // Save agent
    // Verify agent config has correct mcpOverride
  });

  test('edit agent MCP tab shows picker instead of manual form', async ({ page }) => {
    // Navigate to agent settings > MCP tab
    // Verify picker renders (not manual form)
    // Modify overrides
    // Save
    // Verify changes persisted
  });

  test('edit agent shows new Skills tab', async ({ page }) => {
    // Navigate to agent settings
    // Click Skills tab
    // Verify skills are discovered
    // Toggle a skill off
    // Save
    // Verify changes persisted
  });

  test('switching runtime refreshes picker with new discovery results', async ({ page }) => {
    // Create agent with claude-code runtime
    // Verify MCP picker shows Claude config sources
    // Switch runtime to codex
    // Verify picker refreshes with Codex config sources
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
cd packages/web && pnpm exec playwright test e2e/mcp-skill-discovery.spec.ts --headed
```
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/web/e2e/mcp-skill-discovery.spec.ts
git commit -m "test: add E2E tests for MCP and skill discovery"
```

---

### Task 27: Final cleanup and push

- [ ] **Step 1: Run complete verification**

```bash
pnpm build && pnpm lint && pnpm vitest run
```
Expected: all pass

- [ ] **Step 2: Push branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --title "feat: MCP server & skill auto-discovery" --body "$(cat <<'EOF'
## Summary
- Runtime-aware auto-discovery of MCP servers (Claude Code JSON + Codex TOML) and skills (SKILL.md frontmatter)
- Machine-level defaults with per-agent opt-out overrides
- Unified picker UX in both create and edit agent flows
- New SkillPicker component and SkillsTab in agent settings
- Discovery caching (60s TTL) to avoid redundant filesystem scans

## Test plan
- [ ] Unit tests for TOML parser, skill discovery, override resolution, cache
- [ ] Integration tests for discovery routes (worker + CP proxy)
- [ ] Component tests for McpServerPicker, SkillPicker, McpServersTab, SkillsTab
- [ ] E2E: create agent with discovery, edit agent MCP/Skills tabs, runtime switching
- [ ] Manual: verify on machine with both Claude Code and Codex configs

## Spec
`docs/superpowers/specs/2026-03-14-mcp-skill-discovery-design.md`
EOF
)"
```

---

## Deferred Items

The following spec requirements are intentionally deferred from this plan to a follow-up:

1. **Online-transition trigger**: Auto-triggering `sync-capabilities` when a machine transitions from offline → online (requires heartbeat handler integration)
2. **Runtime mismatch auto-clear**: Auto-clearing overrides + notifying user when an agent switches runtime (can be added as UX polish after core flow works)
3. **Picker-triggered re-sync**: Picker triggering `sync-capabilities` when cached results are older than 5 minutes (current React Query `staleTime: 30s` covers HTTP-level freshness; deeper re-sync is a nice-to-have)
