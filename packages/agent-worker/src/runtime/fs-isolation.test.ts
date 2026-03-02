import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BLOCKED_FILENAME_PATTERNS,
  BLOCKED_FILENAME_PREFIXES,
  BLOCKED_SYSCALLS,
  createFsIsolation,
  DEFAULT_BLOCKED_PATHS,
  DEFAULT_MAX_FILE_SIZE,
  type FsIsolationConfig,
} from './fs-isolation.js';

// ── Helpers ─────────────────────────────────────────────────────────

const HOME = homedir();

/** Creates isolation with sensible defaults for testing. */
function makeIsolation(overrides?: Partial<FsIsolationConfig>) {
  return createFsIsolation({
    workDir: '/home/agent/project',
    readOnlyPaths: ['/usr/share/common'],
    blockedPaths: [],
    writableDirs: [],
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    allowSymlinks: false,
    ...overrides,
  });
}

// ── Temporary directory for symlink tests ───────────────────────────

let tmpBase: string;
let tmpWorkDir: string;

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), 'fs-isolation-test-'));
  tmpWorkDir = join(tmpBase, 'workdir');
  mkdirSync(tmpWorkDir, { recursive: true });
  mkdirSync(join(tmpWorkDir, 'src'), { recursive: true });
  writeFileSync(join(tmpWorkDir, 'src', 'index.ts'), 'export {}');

  // Create a symlink inside workdir pointing within workdir
  symlinkSync(join(tmpWorkDir, 'src', 'index.ts'), join(tmpWorkDir, 'link-good.ts'));

  // Create a symlink that escapes workdir
  const outsideFile = join(tmpBase, 'outside.txt');
  writeFileSync(outsideFile, 'secret');
  symlinkSync(outsideFile, join(tmpWorkDir, 'link-escape.ts'));
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────

describe('FsIsolation', () => {
  // ── createFsIsolation defaults ──────────────────────────────────

  describe('createFsIsolation()', () => {
    it('creates isolation with only workDir required', () => {
      const iso = createFsIsolation({ workDir: '/tmp/work' });
      expect(iso).toBeDefined();
      expect(typeof iso.validatePath).toBe('function');
      expect(typeof iso.isPathBlocked).toBe('function');
      expect(typeof iso.isPathWritable).toBe('function');
      expect(typeof iso.resolveSecurePath).toBe('function');
      expect(typeof iso.generateMountArgs).toBe('function');
      expect(typeof iso.generateSeccompProfile).toBe('function');
      expect(typeof iso.getBlockedPaths).toBe('function');
    });

    it('includes default blocked paths', () => {
      const iso = makeIsolation();
      const blocked = iso.getBlockedPaths();

      expect(blocked.length).toBeGreaterThanOrEqual(DEFAULT_BLOCKED_PATHS.length);
      // Default blocked paths should be present (normalised)
      expect(blocked).toContain(normalize(resolve(`${HOME}/.ssh`)));
      expect(blocked).toContain(normalize(resolve(`${HOME}/.gnupg`)));
      expect(blocked).toContain(normalize(resolve(`${HOME}/.aws`)));
    });

    it('merges custom blocked paths with defaults', () => {
      const iso = createFsIsolation({
        workDir: '/tmp/work',
        blockedPaths: ['/custom/secret'],
      });
      const blocked = iso.getBlockedPaths();

      expect(blocked).toContain(normalize(resolve('/custom/secret')));
      // Default should still be there
      expect(blocked).toContain(normalize(resolve(`${HOME}/.ssh`)));
    });
  });

  // ── Path traversal detection ────────────────────────────────────

  describe('path traversal prevention', () => {
    it('detects simple ../ traversal', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/../../../etc/passwd', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('detects encoded %2e%2e%2f traversal', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/%2e%2e/%2e%2e/etc/passwd', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('detects double-encoded traversal via single decode to ../', () => {
      const iso = makeIsolation();
      // %2e%2e%2f decodes once to ../  which we detect
      const result = iso.validatePath('/home/agent/project/%2e%2e%2f%2e%2e%2fetc/passwd', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('double-encoded %252e stays literal after single decode (does not traverse)', () => {
      const iso = makeIsolation();
      // %252e%252e decodes once to %2e%2e, which path.resolve treats as a
      // literal directory name — this is NOT a traversal, and the path stays
      // inside workDir. This is the expected (safe) behaviour.
      const result = iso.validatePath('/home/agent/project/%252e%252e/secret', 'read');
      expect(result.allowed).toBe(true);
    });

    it('detects backslash traversal (Windows-style)', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project\\..\\..\\etc\\passwd', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('detects mixed slash traversal', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/..\\../etc/passwd', 'read');
      expect(result.allowed).toBe(false);
    });

    it('allows paths with .. in directory or file names (not traversal)', () => {
      const iso = makeIsolation();
      // `something..else` is not a traversal
      const result = iso.validatePath('/home/agent/project/something..else/file.ts', 'read');
      expect(result.allowed).toBe(true);
    });

    it('blocks resolveSecurePath with ../../../etc/passwd', () => {
      const iso = makeIsolation();
      const result = iso.resolveSecurePath('/home/agent/project', '../../../etc/passwd');
      expect(result).toBeNull();
    });

    it('blocks resolveSecurePath with absolute path outside base', () => {
      const iso = makeIsolation();
      // Absolute paths that resolve outside the base should be caught
      const result = iso.resolveSecurePath('/home/agent/project', '/etc/passwd');
      expect(result).toBeNull();
    });

    it('resolveSecurePath allows safe relative path', () => {
      const iso = makeIsolation();
      const result = iso.resolveSecurePath('/home/agent/project', 'src/index.ts');
      expect(result).toBe(normalize(resolve('/home/agent/project/src/index.ts')));
    });

    it('resolveSecurePath allows nested safe path', () => {
      const iso = makeIsolation();
      const result = iso.resolveSecurePath('/home/agent/project', 'src/utils/../helpers/util.ts');
      // `src/utils/../helpers` normalises to `src/helpers`
      // but our raw traversal check would flag `../`
      // Actually this contains `../` — so it should be blocked
      expect(result).toBeNull();
    });

    it('resolveSecurePath returns null for empty input', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/base', '')).toBeNull();
      expect(iso.resolveSecurePath('/base', '  ')).toBeNull();
    });
  });

  // ── Blocked path detection ──────────────────────────────────────

  describe('isPathBlocked()', () => {
    it('blocks ~/.ssh', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.ssh`)).toBe(true);
    });

    it('blocks ~/.ssh/id_rsa (nested)', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.ssh/id_rsa`)).toBe(true);
    });

    it('blocks ~/.gnupg', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.gnupg`)).toBe(true);
    });

    it('blocks ~/.aws', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.aws`)).toBe(true);
    });

    it('blocks ~/.aws/credentials (nested)', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.aws/credentials`)).toBe(true);
    });

    it('blocks ~/.env', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.env`)).toBe(true);
    });

    it('blocks ~/.config/gcloud', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked(`${HOME}/.config/gcloud`)).toBe(true);
    });

    it('blocks /etc/shadow', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/etc/shadow')).toBe(true);
    });

    it('blocks /etc/passwd', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/etc/passwd')).toBe(true);
    });

    it('blocks /proc', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/proc')).toBe(true);
    });

    it('blocks /proc/self/environ (nested)', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/proc/self/environ')).toBe(true);
    });

    it('blocks /sys', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/sys')).toBe(true);
    });

    it('blocks files named "credentials" anywhere', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/credentials')).toBe(true);
    });

    it('blocks files named "credentials.json" anywhere', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/config/credentials.json')).toBe(true);
    });

    it('blocks files named ".env" anywhere', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/.env')).toBe(true);
    });

    it('blocks ".env.local"', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/.env.local')).toBe(true);
    });

    it('blocks ".env.production"', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/.env.production')).toBe(true);
    });

    it('blocks ".env.development"', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/.env.development')).toBe(true);
    });

    it('blocks .git/config', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/.git/config')).toBe(true);
    });

    it('blocks nested .git/config', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/sub/.git/config')).toBe(true);
    });

    it('does not block regular files in workDir', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/src/index.ts')).toBe(false);
    });

    it('does not block regular .gitignore', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('/home/agent/project/.gitignore')).toBe(false);
    });

    it('blocks empty path', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('')).toBe(true);
    });

    it('blocks whitespace-only path', () => {
      const iso = makeIsolation();
      expect(iso.isPathBlocked('   ')).toBe(true);
    });

    it('blocks custom blocked paths', () => {
      const iso = createFsIsolation({
        workDir: '/tmp/work',
        blockedPaths: ['/secret/vault'],
      });
      expect(iso.isPathBlocked('/secret/vault')).toBe(true);
      expect(iso.isPathBlocked('/secret/vault/key.pem')).toBe(true);
    });
  });

  // ── Writable directory enforcement ──────────────────────────────

  describe('isPathWritable()', () => {
    it('entire workDir is writable when writableDirs is empty', () => {
      const iso = makeIsolation({ writableDirs: [] });
      expect(iso.isPathWritable('/home/agent/project/anything.ts')).toBe(true);
    });

    it('restricts writes to configured writableDirs', () => {
      const iso = makeIsolation({ writableDirs: ['src/', 'output/'] });
      expect(iso.isPathWritable('/home/agent/project/src/index.ts')).toBe(true);
      expect(iso.isPathWritable('/home/agent/project/output/result.json')).toBe(true);
      expect(iso.isPathWritable('/home/agent/project/config/app.json')).toBe(false);
    });

    it('handles nested writable paths', () => {
      const iso = makeIsolation({ writableDirs: ['src/'] });
      expect(iso.isPathWritable('/home/agent/project/src/deep/nested/file.ts')).toBe(true);
    });

    it('rejects paths outside workDir even with writableDirs', () => {
      const iso = makeIsolation({ writableDirs: ['src/'] });
      expect(iso.isPathWritable('/etc/hosts')).toBe(false);
    });

    it('returns false for empty path', () => {
      const iso = makeIsolation();
      expect(iso.isPathWritable('')).toBe(false);
    });

    it('returns false for whitespace-only path', () => {
      const iso = makeIsolation();
      expect(iso.isPathWritable('   ')).toBe(false);
    });
  });

  // ── validatePath ────────────────────────────────────────────────

  describe('validatePath()', () => {
    it('allows reading files in workDir', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/src/index.ts', 'read');
      expect(result.allowed).toBe(true);
    });

    it('allows reading files in readOnlyPaths', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/usr/share/common/data.json', 'read');
      expect(result.allowed).toBe(true);
    });

    it('blocks reading files outside workDir and readOnlyPaths', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/opt/secret/key.pem', 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside readable boundaries');
    });

    it('allows writing files in workDir when writableDirs is empty', () => {
      const iso = makeIsolation({ writableDirs: [] });
      const result = iso.validatePath('/home/agent/project/output/result.json', 'write');
      expect(result.allowed).toBe(true);
    });

    it('blocks writing outside workDir', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/etc/hosts', 'write');
      expect(result.allowed).toBe(false);
    });

    it('blocks writing outside writable directories', () => {
      const iso = makeIsolation({ writableDirs: ['src/'] });
      const result = iso.validatePath('/home/agent/project/config/app.json', 'write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in a writable directory');
    });

    it('allows writing inside writable directories', () => {
      const iso = makeIsolation({ writableDirs: ['src/'] });
      const result = iso.validatePath('/home/agent/project/src/new-file.ts', 'write');
      expect(result.allowed).toBe(true);
    });

    it('blocks deleting files outside workDir', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/etc/hosts', 'delete');
      expect(result.allowed).toBe(false);
    });

    it('allows deleting files inside writable directories', () => {
      const iso = makeIsolation({ writableDirs: ['output/'] });
      const result = iso.validatePath('/home/agent/project/output/temp.log', 'delete');
      expect(result.allowed).toBe(true);
    });

    it('blocks access to blocked paths for read operations', () => {
      const iso = makeIsolation();
      const result = iso.validatePath(`${HOME}/.ssh/id_rsa`, 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('blocks access to blocked paths for write operations', () => {
      const iso = makeIsolation();
      const result = iso.validatePath(`${HOME}/.ssh/authorized_keys`, 'write');
      expect(result.allowed).toBe(false);
    });

    it('blocks empty path for all operations', () => {
      const iso = makeIsolation();
      expect(iso.validatePath('', 'read').allowed).toBe(false);
      expect(iso.validatePath('', 'write').allowed).toBe(false);
      expect(iso.validatePath('', 'delete').allowed).toBe(false);
    });

    it('blocks .env files for read', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/.env', 'read');
      expect(result.allowed).toBe(false);
    });

    it('blocks credentials.json for write', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/credentials.json', 'write');
      expect(result.allowed).toBe(false);
    });

    it('blocks /proc/self/environ for read', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/proc/self/environ', 'read');
      expect(result.allowed).toBe(false);
    });
  });

  // ── Symlink handling ────────────────────────────────────────────

  describe('symlink handling', () => {
    it('blocks symlink that escapes workDir when allowSymlinks is false', () => {
      const iso = createFsIsolation({
        workDir: tmpWorkDir,
        allowSymlinks: false,
      });

      const result = iso.validatePath(join(tmpWorkDir, 'link-escape.ts'), 'read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Symlink escapes allowed boundaries');
    });

    it('allows symlink within workDir when allowSymlinks is false (target stays inside)', () => {
      const iso = createFsIsolation({
        workDir: tmpWorkDir,
        allowSymlinks: false,
      });

      // link-good.ts points to workdir/src/index.ts — still inside workDir
      const result = iso.validatePath(join(tmpWorkDir, 'link-good.ts'), 'read');
      expect(result.allowed).toBe(true);
    });

    it('allows escaping symlink when allowSymlinks is true (no symlink check)', () => {
      const iso = createFsIsolation({
        workDir: tmpWorkDir,
        allowSymlinks: true,
      });

      // When allowSymlinks is true, we do not resolve symlinks
      const result = iso.validatePath(join(tmpWorkDir, 'link-escape.ts'), 'read');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Docker mount arg generation ─────────────────────────────────

  describe('generateMountArgs()', () => {
    it('mounts workDir as rw', () => {
      const iso = makeIsolation();
      const args = iso.generateMountArgs();

      const workMount = args.find((a) => a.includes('/home/agent/project'));
      expect(workMount).toBeDefined();
      expect(workMount).toContain(':rw');
    });

    it('mounts readOnlyPaths as ro', () => {
      const iso = makeIsolation({ readOnlyPaths: ['/usr/share/common', '/opt/data'] });
      const args = iso.generateMountArgs();

      const roMounts = args.filter((a) => a.includes(':ro'));
      expect(roMounts.length).toBe(2);
      expect(roMounts.some((a) => a.includes('/usr/share/common'))).toBe(true);
      expect(roMounts.some((a) => a.includes('/opt/data'))).toBe(true);
    });

    it('uses -v= format for all mounts', () => {
      const iso = makeIsolation();
      const args = iso.generateMountArgs();

      for (const arg of args) {
        expect(arg).toMatch(/^-v=/);
      }
    });

    it('generates correct format: -v=host:container:mode', () => {
      const iso = makeIsolation();
      const args = iso.generateMountArgs();

      for (const arg of args) {
        const parts = arg.replace('-v=', '').split(':');
        expect(parts.length).toBe(3);
        expect(['ro', 'rw']).toContain(parts[2]);
      }
    });

    it('workDir mount maps same host and container path', () => {
      const iso = makeIsolation();
      const args = iso.generateMountArgs();

      const workMount = args[0];
      const parts = workMount.replace('-v=', '').split(':');
      expect(parts[0]).toBe(parts[1]);
    });

    it('handles empty readOnlyPaths', () => {
      const iso = makeIsolation({ readOnlyPaths: [] });
      const args = iso.generateMountArgs();

      // Only the workDir mount
      expect(args.length).toBe(1);
      expect(args[0]).toContain(':rw');
    });

    it('does not include --privileged or SYS_ADMIN', () => {
      const iso = makeIsolation();
      const args = iso.generateMountArgs();

      for (const arg of args) {
        expect(arg).not.toContain('--privileged');
        expect(arg).not.toContain('SYS_ADMIN');
      }
    });
  });

  // ── Seccomp profile generation ──────────────────────────────────

  describe('generateSeccompProfile()', () => {
    it('returns a valid seccomp profile object', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        defaultAction: string;
        syscalls: { names: string[]; action: string; errnoRet: number }[];
      };

      expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');
      expect(profile.syscalls).toBeDefined();
      expect(Array.isArray(profile.syscalls)).toBe(true);
      expect(profile.syscalls.length).toBeGreaterThan(0);
    });

    it('blocks mount syscall', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string }[];
      };

      const blockedNames = profile.syscalls[0].names;
      expect(blockedNames).toContain('mount');
    });

    it('blocks umount syscall', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string }[];
      };

      const blockedNames = profile.syscalls[0].names;
      expect(blockedNames).toContain('umount');
      expect(blockedNames).toContain('umount2');
    });

    it('blocks reboot syscall', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string }[];
      };

      const blockedNames = profile.syscalls[0].names;
      expect(blockedNames).toContain('reboot');
    });

    it('blocks ptrace syscall', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string }[];
      };

      const blockedNames = profile.syscalls[0].names;
      expect(blockedNames).toContain('ptrace');
    });

    it('blocks kernel module syscalls', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string }[];
      };

      const blockedNames = profile.syscalls[0].names;
      expect(blockedNames).toContain('init_module');
      expect(blockedNames).toContain('finit_module');
      expect(blockedNames).toContain('delete_module');
    });

    it('blocks namespace manipulation', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string }[];
      };

      const blockedNames = profile.syscalls[0].names;
      expect(blockedNames).toContain('unshare');
      expect(blockedNames).toContain('setns');
    });

    it('uses SCMP_ACT_ERRNO action with errnoRet 1', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[]; action: string; errnoRet: number }[];
      };

      expect(profile.syscalls[0].action).toBe('SCMP_ACT_ERRNO');
      expect(profile.syscalls[0].errnoRet).toBe(1);
    });

    it('includes all BLOCKED_SYSCALLS', () => {
      const iso = makeIsolation();
      const profile = iso.generateSeccompProfile() as {
        syscalls: { names: string[] }[];
      };

      const blockedNames = profile.syscalls[0].names;
      for (const syscall of BLOCKED_SYSCALLS) {
        expect(blockedNames).toContain(syscall);
      }
    });
  });

  // ── resolveSecurePath ───────────────────────────────────────────

  describe('resolveSecurePath()', () => {
    it('resolves simple relative path', () => {
      const iso = makeIsolation();
      const result = iso.resolveSecurePath('/home/agent/project', 'src/index.ts');
      expect(result).toBe(normalize(resolve('/home/agent/project/src/index.ts')));
    });

    it('rejects ../../../etc/passwd', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/home/agent/project', '../../../etc/passwd')).toBeNull();
    });

    it('rejects ../../etc/shadow', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/home/agent/project', '../../etc/shadow')).toBeNull();
    });

    it('rejects ../sibling', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/home/agent/project', '../sibling')).toBeNull();
    });

    it('resolves a path to the base itself', () => {
      const iso = makeIsolation();
      const result = iso.resolveSecurePath('/home/agent/project', '.');
      expect(result).toBe(normalize(resolve('/home/agent/project')));
    });

    it('rejects absolute path outside base', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/home/agent/project', '/etc/passwd')).toBeNull();
    });

    it('rejects empty user path', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/base', '')).toBeNull();
    });

    it('rejects whitespace-only user path', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/base', '   ')).toBeNull();
    });

    it('resolves deeply nested safe path', () => {
      const iso = makeIsolation();
      const result = iso.resolveSecurePath('/home/agent/project', 'a/b/c/d/e/file.ts');
      expect(result).toBe(normalize(resolve('/home/agent/project/a/b/c/d/e/file.ts')));
    });

    it('rejects encoded traversal in user path', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/base', '%2e%2e/secret')).toBeNull();
    });

    it('rejects backslash traversal in user path', () => {
      const iso = makeIsolation();
      expect(iso.resolveSecurePath('/base', '..\\secret')).toBeNull();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles root path /', () => {
      const iso = makeIsolation();
      // Root should not be writable
      expect(iso.isPathWritable('/')).toBe(false);
      // Root is outside readable boundaries
      const result = iso.validatePath('/', 'read');
      expect(result.allowed).toBe(false);
    });

    it('handles paths with unicode characters', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/src/\u00e9l\u00e8ve.ts', 'read');
      expect(result.allowed).toBe(true);
    });

    it('handles paths with spaces', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/my folder/file.ts', 'read');
      expect(result.allowed).toBe(true);
    });

    it('handles paths with consecutive slashes', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project//src///index.ts', 'read');
      expect(result.allowed).toBe(true);
    });

    it('handles paths ending with slash', () => {
      const iso = makeIsolation();
      const result = iso.validatePath('/home/agent/project/src/', 'read');
      expect(result.allowed).toBe(true);
    });

    it('handles case sensitivity for blocked filenames', () => {
      const iso = makeIsolation();
      // Credentials should be blocked case-insensitively
      expect(iso.isPathBlocked('/home/agent/project/CREDENTIALS')).toBe(true);
      expect(iso.isPathBlocked('/home/agent/project/Credentials')).toBe(true);
      expect(iso.isPathBlocked('/home/agent/project/Credentials.JSON')).toBe(true);
    });

    it('handles path with only dots', () => {
      const iso = makeIsolation();
      // Single dot resolves to cwd — should be outside workDir
      const result = iso.validatePath('.', 'read');
      expect(result.allowed).toBe(false);
    });

    it('handles tilde expansion', () => {
      const iso = makeIsolation();
      // ~/something should expand to home dir
      expect(iso.isPathBlocked('~/.ssh')).toBe(true);
      expect(iso.isPathBlocked('~/.aws')).toBe(true);
    });

    it('does not block .git directory itself (only .git/config)', () => {
      const iso = makeIsolation();
      // .git/ is not blocked by default, only .git/config is
      expect(iso.isPathBlocked('/home/agent/project/.git/HEAD')).toBe(false);
      expect(iso.isPathBlocked('/home/agent/project/.git/config')).toBe(true);
    });
  });

  // ── getBlockedPaths ─────────────────────────────────────────────

  describe('getBlockedPaths()', () => {
    it('returns normalised absolute paths', () => {
      const iso = makeIsolation();
      const blocked = iso.getBlockedPaths();

      for (const p of blocked) {
        expect(p).toBe(normalize(resolve(p)));
      }
    });

    it('returns a copy (not the internal array)', () => {
      const iso = makeIsolation();
      const blocked1 = iso.getBlockedPaths();
      const blocked2 = iso.getBlockedPaths();

      expect(blocked1).toEqual(blocked2);
      expect(blocked1).not.toBe(blocked2); // different references
    });

    it('contains all default blocked paths', () => {
      const iso = makeIsolation();
      const blocked = iso.getBlockedPaths();

      for (const dp of DEFAULT_BLOCKED_PATHS) {
        const normalised = normalize(resolve(dp));
        expect(blocked).toContain(normalised);
      }
    });
  });

  // ── Constants ───────────────────────────────────────────────────

  describe('exported constants', () => {
    it('DEFAULT_MAX_FILE_SIZE is 10MB', () => {
      expect(DEFAULT_MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    });

    it('DEFAULT_BLOCKED_PATHS contains expected entries', () => {
      expect(DEFAULT_BLOCKED_PATHS).toContain(`${HOME}/.ssh`);
      expect(DEFAULT_BLOCKED_PATHS).toContain(`${HOME}/.gnupg`);
      expect(DEFAULT_BLOCKED_PATHS).toContain(`${HOME}/.aws`);
      expect(DEFAULT_BLOCKED_PATHS).toContain(`${HOME}/.env`);
      expect(DEFAULT_BLOCKED_PATHS).toContain(`${HOME}/.config/gcloud`);
      expect(DEFAULT_BLOCKED_PATHS).toContain('/etc/shadow');
      expect(DEFAULT_BLOCKED_PATHS).toContain('/etc/passwd');
      expect(DEFAULT_BLOCKED_PATHS).toContain('/proc');
      expect(DEFAULT_BLOCKED_PATHS).toContain('/sys');
    });

    it('BLOCKED_FILENAME_PATTERNS contains expected entries', () => {
      expect(BLOCKED_FILENAME_PATTERNS).toContain('credentials');
      expect(BLOCKED_FILENAME_PATTERNS).toContain('credentials.json');
      expect(BLOCKED_FILENAME_PATTERNS).toContain('.env');
      expect(BLOCKED_FILENAME_PATTERNS).toContain('.git/config');
    });

    it('BLOCKED_FILENAME_PREFIXES contains .env. prefix', () => {
      expect(BLOCKED_FILENAME_PREFIXES).toContain('.env.');
    });

    it('BLOCKED_SYSCALLS contains critical entries', () => {
      expect(BLOCKED_SYSCALLS).toContain('mount');
      expect(BLOCKED_SYSCALLS).toContain('umount');
      expect(BLOCKED_SYSCALLS).toContain('reboot');
      expect(BLOCKED_SYSCALLS).toContain('ptrace');
      expect(BLOCKED_SYSCALLS).toContain('unshare');
      expect(BLOCKED_SYSCALLS).toContain('setns');
      expect(BLOCKED_SYSCALLS).toContain('kexec_load');
    });
  });

  // ── Integration scenarios ───────────────────────────────────────

  describe('integration scenarios', () => {
    it('full workflow: validate, mount, seccomp', () => {
      const iso = createFsIsolation({
        workDir: '/home/agent/project',
        readOnlyPaths: ['/usr/share/dict'],
        writableDirs: ['src/', 'output/'],
        maxFileSize: 5 * 1024 * 1024,
        allowSymlinks: false,
      });

      // Read from readonly
      expect(iso.validatePath('/usr/share/dict/words', 'read').allowed).toBe(true);

      // Read from workDir
      expect(iso.validatePath('/home/agent/project/README.md', 'read').allowed).toBe(true);

      // Write to writable dir
      expect(iso.validatePath('/home/agent/project/src/new.ts', 'write').allowed).toBe(true);

      // Write outside writable dir
      expect(iso.validatePath('/home/agent/project/config.json', 'write').allowed).toBe(false);

      // Blocked path
      expect(iso.validatePath(`${HOME}/.ssh/id_rsa`, 'read').allowed).toBe(false);

      // Mount args
      const mounts = iso.generateMountArgs();
      expect(mounts.length).toBe(2); // workDir rw + 1 readonly

      // Seccomp
      const seccomp = iso.generateSeccompProfile() as { defaultAction: string };
      expect(seccomp.defaultAction).toBe('SCMP_ACT_ALLOW');
    });

    it('agent cannot escape workDir via any method', () => {
      const iso = makeIsolation({ writableDirs: ['src/'] });

      // Direct path outside
      expect(iso.validatePath('/etc/hosts', 'write').allowed).toBe(false);

      // Traversal
      expect(iso.validatePath('/home/agent/project/../../../etc/hosts', 'write').allowed).toBe(
        false,
      );

      // Encoded traversal
      expect(iso.validatePath('/home/agent/project/%2e%2e/secret', 'write').allowed).toBe(false);

      // Backslash traversal
      expect(iso.validatePath('/home/agent/project\\..\\..\\etc\\hosts', 'write').allowed).toBe(
        false,
      );

      // Blocked paths
      expect(iso.validatePath(`${HOME}/.aws/credentials`, 'read').allowed).toBe(false);
      expect(iso.validatePath('/proc/self/maps', 'read').allowed).toBe(false);
    });

    it('resolveSecurePath + validatePath work together', () => {
      const iso = makeIsolation({ writableDirs: ['src/'] });

      // Safe path
      const safePath = iso.resolveSecurePath('/home/agent/project', 'src/util.ts');
      expect(safePath).not.toBeNull();
      expect(iso.validatePath(safePath as string, 'write').allowed).toBe(true);

      // Dangerous path
      const dangerousPath = iso.resolveSecurePath('/home/agent/project', '../../../etc/passwd');
      expect(dangerousPath).toBeNull();
    });
  });
});
