import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseUpdateWindow, UPDATE_WINDOW_ENV } from './peer-update.js';

// ---------------------------------------------------------------------------
// Roadmap §33.11 — opt-in auto-update schedulers.
//
// The scheduler artefacts are static text files (plist XML + systemd unit
// syntax) that operators must explicitly install and enable. These tests
// assert the load-bearing guarantees we advertise in the READMEs:
//   1. launchd plist ships disabled + carries a daily calendar schedule.
//   2. systemd service is oneshot; timer has a daily OnCalendar trigger.
//   3. AGENTCTL_UPDATE_WINDOW env var is present in both unit files so
//      the CLI's informational output matches the scheduler config.
//   4. The CLI's parseUpdateWindow helper rejects malformed windows.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const PLIST_PATH = path.join(REPO_ROOT, 'infra/launchd/com.agentctl.peer-update.plist');
const SYSTEMD_SERVICE_PATH = path.join(REPO_ROOT, 'infra/systemd/agentctl-peer-update.service');
const SYSTEMD_TIMER_PATH = path.join(REPO_ROOT, 'infra/systemd/agentctl-peer-update.timer');

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

/**
 * Extract the string value that follows a <key>name</key> element in the
 * plist. Good enough for the handful of fields we need without pulling in
 * a full XML parser (and avoids taking on a new dependency for a test).
 */
function plistStringValue(xml: string, key: string): string | null {
  const keyPattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, 'i');
  const match = keyPattern.exec(xml);
  return match ? (match[1] ?? null) : null;
}

/**
 * True iff the plist declares `<key>name</key><true/>` (boolean marker).
 */
function plistBooleanIsTrue(xml: string, key: string): boolean {
  const pattern = new RegExp(`<key>${key}</key>\\s*<true\\s*/>`, 'i');
  return pattern.test(xml);
}

/**
 * Extract an integer that sits under `<key>StartCalendarInterval</key>`
 * with the given sub-key (e.g. "Hour" or "Minute"). Returns null if the
 * calendar block or sub-key is missing.
 */
function plistCalendarInteger(xml: string, subKey: string): number | null {
  const block = /<key>StartCalendarInterval<\/key>\s*<dict>([\s\S]*?)<\/dict>/i.exec(xml);
  if (!block || !block[1]) return null;
  const pattern = new RegExp(`<key>${subKey}</key>\\s*<integer>(\\d+)</integer>`, 'i');
  const match = pattern.exec(block[1]);
  return match ? Number(match[1]) : null;
}

/**
 * Returns the value of a simple `Key=value` line from a systemd unit
 * (the first occurrence only — sufficient for the keys we assert on).
 */
function systemdValue(contents: string, key: string): string | null {
  const pattern = new RegExp(`^${key}=(.*)$`, 'm');
  const match = pattern.exec(contents);
  return match ? (match[1]?.trim() ?? null) : null;
}

describe('launchd plist (com.agentctl.peer-update)', () => {
  const xml = readFile(PLIST_PATH);

  it('declares the expected Label and is shipped disabled', () => {
    expect(plistStringValue(xml, 'Label')).toBe('com.agentctl.peer-update');
    expect(plistBooleanIsTrue(xml, 'Disabled')).toBe(true);
  });

  it('schedules via StartCalendarInterval with a daily 03:00 default', () => {
    expect(plistCalendarInteger(xml, 'Hour')).toBe(3);
    expect(plistCalendarInteger(xml, 'Minute')).toBe(0);
  });

  it('exposes AGENTCTL_UPDATE_WINDOW so the CLI surfaces the schedule', () => {
    // The env block is a nested dict under EnvironmentVariables — a single
    // regex over the block is enough since we only need to assert presence.
    expect(xml).toMatch(/<key>AGENTCTL_UPDATE_WINDOW<\/key>\s*<string>03:00<\/string>/);
  });

  it('routes stdout + stderr into ~/Library/Logs/agentctl/', () => {
    expect(plistStringValue(xml, 'StandardOutPath')).toMatch(
      /Library\/Logs\/agentctl\/peer-update\.out\.log$/,
    );
    expect(plistStringValue(xml, 'StandardErrorPath')).toMatch(
      /Library\/Logs\/agentctl\/peer-update\.err\.log$/,
    );
  });
});

describe('systemd unit (agentctl-peer-update.service + .timer)', () => {
  const service = readFile(SYSTEMD_SERVICE_PATH);
  const timer = readFile(SYSTEMD_TIMER_PATH);

  it('service is oneshot with a templated WorkingDirectory', () => {
    expect(systemdValue(service, 'Type')).toBe('oneshot');
    expect(systemdValue(service, 'WorkingDirectory')).toBe('%h/agentctl');
    expect(systemdValue(service, 'ExecStart')).toMatch(/pnpm peer-update$/);
  });

  it('service seeds AGENTCTL_UPDATE_WINDOW in the process environment', () => {
    // There are multiple Environment= lines; just assert the window one is present.
    expect(service).toMatch(/^Environment=AGENTCTL_UPDATE_WINDOW=03:00$/m);
    expect(service).toContain(UPDATE_WINDOW_ENV);
  });

  it('timer fires daily at 03:00 with a randomised delay + persistence', () => {
    expect(systemdValue(timer, 'OnCalendar')).toBe('*-*-* 03:00:00');
    expect(systemdValue(timer, 'Persistent')).toBe('true');
    expect(systemdValue(timer, 'RandomizedDelaySec')).toBe('300');
  });
});

describe('parseUpdateWindow', () => {
  it('accepts HH:MM values and rejects malformed input', () => {
    expect(parseUpdateWindow('03:00')).toEqual({ hour: 3, minute: 0, raw: '03:00' });
    expect(parseUpdateWindow('23:59')).toEqual({ hour: 23, minute: 59, raw: '23:59' });
    expect(parseUpdateWindow('  04:30  ')).toEqual({ hour: 4, minute: 30, raw: '04:30' });

    expect(parseUpdateWindow(undefined)).toBeNull();
    expect(parseUpdateWindow('')).toBeNull();
    expect(parseUpdateWindow('25:00')).toBeNull();
    expect(parseUpdateWindow('03:60')).toBeNull();
    expect(parseUpdateWindow('3pm')).toBeNull();
  });
});
