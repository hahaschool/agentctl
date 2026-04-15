import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetBuildInfoCacheForTests,
  getAppVersion,
  getGitSha,
  getSchemaVersion,
} from './build-info.js';

describe('build-info', () => {
  beforeEach(() => {
    __resetBuildInfoCacheForTests();
  });

  afterEach(() => {
    __resetBuildInfoCacheForTests();
    delete process.env.GIT_SHA;
    delete process.env.GITHUB_SHA;
  });

  describe('getAppVersion', () => {
    it('reads the control-plane package.json semver', () => {
      const version = getAppVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('getGitSha', () => {
    it('prefers GIT_SHA env', () => {
      process.env.GIT_SHA = 'abc1234';
      expect(getGitSha()).toBe('abc1234');
    });

    it('falls back to a short GITHUB_SHA', () => {
      process.env.GITHUB_SHA = '1234567890abcdef1234567890abcdef12345678';
      expect(getGitSha()).toBe('1234567');
    });

    it('returns "unknown" when neither env is set', () => {
      expect(getGitSha()).toBe('unknown');
    });
  });

  describe('getSchemaVersion', () => {
    it('reports a non-zero migration count for this build', () => {
      const schemaVersion = getSchemaVersion();
      // Peers gate apply decisions on this value (§33.10). Exact number grows
      // with each drizzle migration; assert only that we discovered some.
      expect(schemaVersion).toBeGreaterThan(0);
    });
  });
});
