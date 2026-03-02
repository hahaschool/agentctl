import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnomalyDetector } from './anomaly-detector.js';

describe('AnomalyDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper: fill the baseline period by recording N calls for the given tools.
   * Each call is spaced 1 second apart to give a realistic baseline.
   */
  function fillBaseline(
    detector: AnomalyDetector,
    agentId: string,
    tools: string[],
    totalCalls: number,
  ): void {
    const baseTime = new Date('2026-03-02T12:00:00.000Z');

    for (let i = 0; i < totalCalls; i++) {
      const tool = tools[i % tools.length];
      const callTime = new Date(baseTime.getTime() + i * 1000);
      vi.setSystemTime(callTime);
      detector.recordCall(agentId, tool, callTime);
    }
  }

  // ── Baseline learning ────────────────────────────────────────────

  describe('baseline learning', () => {
    it('does not report anomalies during the baseline period', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 10 });
      const baseTime = new Date('2026-03-02T12:00:00.000Z');

      for (let i = 0; i < 9; i++) {
        const callTime = new Date(baseTime.getTime() + i * 1000);
        vi.setSystemTime(callTime);
        const anomalies = detector.recordCall('agent-1', 'Bash', callTime);
        expect(anomalies).toEqual([]);
      }
    });

    it('completes baseline after the configured threshold', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash', 'Read'], 5);

      const baseline = detector.getBaseline('agent-1');

      expect(baseline.baselineComplete).toBe(true);
      expect(baseline.totalCalls).toBe(5);
    });

    it('returns incomplete baseline when below threshold', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 10 });
      const now = new Date();

      detector.recordCall('agent-1', 'Bash', now);

      const baseline = detector.getBaseline('agent-1');

      expect(baseline.baselineComplete).toBe(false);
      expect(baseline.totalCalls).toBe(1);
      expect(baseline.tools.Bash).toBeDefined();
      expect(baseline.tools.Bash.callCount).toBe(1);
    });

    it('returns empty baseline for unknown agents', () => {
      const detector = new AnomalyDetector();
      const baseline = detector.getBaseline('unknown');

      expect(baseline.baselineComplete).toBe(false);
      expect(baseline.totalCalls).toBe(0);
      expect(baseline.tools).toEqual({});
    });
  });

  // ── New tool detection ──────────────────────────────────────────

  describe('new tool detection', () => {
    it('detects when an agent uses a tool not seen during baseline', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash', 'Read'], 5);

      // Now use a new tool after baseline
      const callTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(callTime);
      const anomalies = detector.recordCall('agent-1', 'Write', callTime);

      expect(anomalies.length).toBeGreaterThanOrEqual(1);

      const newToolAnomaly = anomalies.find((a) => a.type === 'new_tool');

      expect(newToolAnomaly).toBeDefined();
      expect(newToolAnomaly?.severity).toBe('medium');
      expect(newToolAnomaly?.tool).toBe('Write');
      expect(newToolAnomaly?.agentId).toBe('agent-1');
      expect(newToolAnomaly?.message).toContain('Write');
    });

    it('does not flag tools already seen during baseline', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash', 'Read'], 5);

      // Use a tool that was in the baseline
      const callTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(callTime);
      const anomalies = detector.recordCall('agent-1', 'Bash', callTime);

      const newToolAnomaly = anomalies.find((a) => a.type === 'new_tool');

      expect(newToolAnomaly).toBeUndefined();
    });

    it('only flags a new tool once (on first occurrence)', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash'], 5);

      const time1 = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(time1);
      const anomalies1 = detector.recordCall('agent-1', 'Write', time1);

      expect(anomalies1.find((a) => a.type === 'new_tool')).toBeDefined();

      const time2 = new Date('2026-03-02T12:01:01.000Z');
      vi.setSystemTime(time2);
      const anomalies2 = detector.recordCall('agent-1', 'Write', time2);

      expect(anomalies2.find((a) => a.type === 'new_tool')).toBeUndefined();
    });
  });

  // ── Frequency spike detection ───────────────────────────────────

  describe('frequency spike detection', () => {
    it('detects when call rate exceeds 3x the baseline average', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 10,
        frequencySpikeMultiplier: 3,
        frequencyWindowMs: 60_000,
      });

      // Build baseline: ~10 Bash calls over 10 seconds = ~60 calls/min baseline
      const baseTime = new Date('2026-03-02T12:00:00.000Z');

      for (let i = 0; i < 10; i++) {
        const callTime = new Date(baseTime.getTime() + i * 1000);
        vi.setSystemTime(callTime);
        detector.recordCall('agent-1', 'Bash', callTime);
      }

      // Now spike: many rapid calls in a short window (>3x the baseline)
      // Baseline was ~60/min, so >180/min should trigger
      const spikeBase = new Date('2026-03-02T12:01:00.000Z');
      let spikeDetected = false;

      for (let i = 0; i < 200; i++) {
        const callTime = new Date(spikeBase.getTime() + i * 100); // 10 calls/sec = 600/min
        vi.setSystemTime(callTime);
        const anomalies = detector.recordCall('agent-1', 'Bash', callTime);

        if (anomalies.find((a) => a.type === 'frequency_spike')) {
          spikeDetected = true;
          break;
        }
      }

      expect(spikeDetected).toBe(true);
    });

    it('does not flag normal usage within baseline bounds', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 10,
        frequencySpikeMultiplier: 3,
        frequencyWindowMs: 60_000,
      });

      // Build baseline: 10 calls over 10 seconds = ~60/min
      const baseTime = new Date('2026-03-02T12:00:00.000Z');

      for (let i = 0; i < 10; i++) {
        const callTime = new Date(baseTime.getTime() + i * 1000);
        vi.setSystemTime(callTime);
        detector.recordCall('agent-1', 'Bash', callTime);
      }

      // Post-baseline: continue at roughly the same rate
      const postTime = new Date('2026-03-02T12:01:00.000Z');
      const anomalies: string[] = [];

      for (let i = 0; i < 10; i++) {
        const callTime = new Date(postTime.getTime() + i * 1000);
        vi.setSystemTime(callTime);
        const results = detector.recordCall('agent-1', 'Bash', callTime);

        for (const a of results) {
          if (a.type === 'frequency_spike') {
            anomalies.push(a.type);
          }
        }
      }

      expect(anomalies).toHaveLength(0);
    });

    it('respects custom spike multiplier', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 5,
        frequencySpikeMultiplier: 2,
        frequencyWindowMs: 60_000,
      });

      // Baseline: 5 calls in 5 seconds = ~60/min
      fillBaseline(detector, 'agent-1', ['Bash'], 5);

      // Spike at 2x (should trigger since multiplier is 2)
      const spikeBase = new Date('2026-03-02T12:01:00.000Z');
      let spikeDetected = false;

      for (let i = 0; i < 150; i++) {
        const callTime = new Date(spikeBase.getTime() + i * 200); // 5/sec = 300/min
        vi.setSystemTime(callTime);
        const anomalies = detector.recordCall('agent-1', 'Bash', callTime);

        if (anomalies.find((a) => a.type === 'frequency_spike')) {
          spikeDetected = true;
          break;
        }
      }

      expect(spikeDetected).toBe(true);
    });
  });

  // ── Suspicious combination detection ────────────────────────────

  describe('suspicious combination detection', () => {
    it('detects Bash + Write in quick succession', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 5,
        suspiciousCombinationWindowMs: 5000,
      });

      fillBaseline(detector, 'agent-1', ['Bash', 'Write', 'Read'], 6);

      // After baseline, do Bash then Write quickly
      const bashTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(bashTime);
      detector.recordCall('agent-1', 'Bash', bashTime);

      const writeTime = new Date('2026-03-02T12:01:02.000Z'); // 2 seconds later
      vi.setSystemTime(writeTime);
      const anomalies = detector.recordCall('agent-1', 'Write', writeTime);

      const comboAnomaly = anomalies.find((a) => a.type === 'suspicious_combination');

      expect(comboAnomaly).toBeDefined();
      expect(comboAnomaly?.severity).toBe('high');
      expect(comboAnomaly?.message).toContain('Bash and Write');
    });

    it('detects Write + Bash in quick succession (reverse order)', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 5,
        suspiciousCombinationWindowMs: 5000,
      });

      fillBaseline(detector, 'agent-1', ['Bash', 'Write', 'Read'], 6);

      const writeTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(writeTime);
      detector.recordCall('agent-1', 'Write', writeTime);

      const bashTime = new Date('2026-03-02T12:01:02.000Z');
      vi.setSystemTime(bashTime);
      const anomalies = detector.recordCall('agent-1', 'Bash', bashTime);

      const comboAnomaly = anomalies.find((a) => a.type === 'suspicious_combination');

      expect(comboAnomaly).toBeDefined();
    });

    it('does not flag Bash + Write when outside the time window', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 5,
        suspiciousCombinationWindowMs: 5000,
      });

      fillBaseline(detector, 'agent-1', ['Bash', 'Write', 'Read'], 6);

      const bashTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(bashTime);
      detector.recordCall('agent-1', 'Bash', bashTime);

      // 10 seconds later — outside the 5s window
      const writeTime = new Date('2026-03-02T12:01:10.000Z');
      vi.setSystemTime(writeTime);
      const anomalies = detector.recordCall('agent-1', 'Write', writeTime);

      const comboAnomaly = anomalies.find((a) => a.type === 'suspicious_combination');

      expect(comboAnomaly).toBeUndefined();
    });

    it('does not flag non-suspicious tool pairs', () => {
      const detector = new AnomalyDetector({
        baselineCallThreshold: 5,
        suspiciousCombinationWindowMs: 5000,
      });

      fillBaseline(detector, 'agent-1', ['Bash', 'Read', 'Glob'], 6);

      const readTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(readTime);
      detector.recordCall('agent-1', 'Read', readTime);

      const globTime = new Date('2026-03-02T12:01:01.000Z');
      vi.setSystemTime(globTime);
      const anomalies = detector.recordCall('agent-1', 'Glob', globTime);

      const comboAnomaly = anomalies.find((a) => a.type === 'suspicious_combination');

      expect(comboAnomaly).toBeUndefined();
    });
  });

  // ── Anomaly report structure ─────────────────────────────────────

  describe('anomaly report structure', () => {
    it('returns properly structured anomaly reports', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash'], 5);

      const callTime = new Date('2026-03-02T12:01:00.000Z');
      vi.setSystemTime(callTime);
      const anomalies = detector.recordCall('agent-1', 'NewTool', callTime);

      expect(anomalies.length).toBeGreaterThanOrEqual(1);

      const report = anomalies[0];

      expect(report).toHaveProperty('type');
      expect(report).toHaveProperty('severity');
      expect(report).toHaveProperty('message');
      expect(report).toHaveProperty('agentId');
      expect(report).toHaveProperty('tool');
      expect(report).toHaveProperty('detectedAt');
      expect(typeof report.message).toBe('string');
      expect(new Date(report.detectedAt).toISOString()).toBe(report.detectedAt);
    });
  });

  // ── Agent isolation ─────────────────────────────────────────────

  describe('agent isolation', () => {
    it('tracks agents independently', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash'], 5);
      fillBaseline(detector, 'agent-2', ['Read'], 5);

      const baseline1 = detector.getBaseline('agent-1');
      const baseline2 = detector.getBaseline('agent-2');

      expect(baseline1.tools.Bash).toBeDefined();
      expect(baseline1.tools.Read).toBeUndefined();

      expect(baseline2.tools.Read).toBeDefined();
      expect(baseline2.tools.Bash).toBeUndefined();
    });
  });

  // ── reset() ─────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears all state for the specified agent', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash'], 5);

      expect(detector.getBaseline('agent-1').baselineComplete).toBe(true);

      detector.reset('agent-1');

      const baseline = detector.getBaseline('agent-1');

      expect(baseline.baselineComplete).toBe(false);
      expect(baseline.totalCalls).toBe(0);
    });

    it('does not affect other agents when resetting one', () => {
      const detector = new AnomalyDetector({ baselineCallThreshold: 5 });

      fillBaseline(detector, 'agent-1', ['Bash'], 5);
      fillBaseline(detector, 'agent-2', ['Read'], 5);

      detector.reset('agent-1');

      expect(detector.getBaseline('agent-1').baselineComplete).toBe(false);
      expect(detector.getBaseline('agent-2').baselineComplete).toBe(true);
    });

    it('is safe to call for non-existent agents', () => {
      const detector = new AnomalyDetector();

      expect(() => detector.reset('nonexistent')).not.toThrow();
    });
  });
});
