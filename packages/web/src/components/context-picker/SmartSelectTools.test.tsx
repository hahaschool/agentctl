import { describe, expect, it } from 'vitest';

import { findByTopicIndices, findKeyDecisionIndices } from './SmartSelectTools';

function msg(type: string, content: string) {
  return { type, content };
}

describe('findKeyDecisionIndices', () => {
  it('returns empty for empty messages', () => {
    expect(findKeyDecisionIndices([])).toEqual([]);
  });

  it('finds messages with "decided"', () => {
    const msgs = [
      msg('human', 'Can you help?'),
      msg('assistant', 'Sure'),
      msg('human', 'I decided to use PostgreSQL'),
      msg('assistant', 'Good choice'),
    ];
    expect(findKeyDecisionIndices(msgs)).toContain(2);
  });

  it('finds messages with "let\'s go with"', () => {
    const msgs = [msg('human', 'Options?'), msg('assistant', "Let's go with Fastify")];
    expect(findKeyDecisionIndices(msgs)).toContain(1);
  });

  it('finds messages with "instead of"', () => {
    const msgs = [msg('human', 'Use Vitest instead of Jest')];
    expect(findKeyDecisionIndices(msgs)).toContain(0);
  });

  it('finds messages with "architecture"', () => {
    const msgs = [msg('assistant', 'The architecture should use microservices')];
    expect(findKeyDecisionIndices(msgs)).toContain(0);
  });

  it('finds messages with "trade-off"', () => {
    const msgs = [msg('assistant', 'The trade-off here is latency vs throughput')];
    expect(findKeyDecisionIndices(msgs)).toContain(0);
  });

  it('includes surrounding context (1 before + 1 after)', () => {
    const msgs = [
      msg('human', 'context before'),
      msg('assistant', 'I decided to use X'),
      msg('human', 'context after'),
    ];
    const indices = findKeyDecisionIndices(msgs);
    expect(indices).toContain(0);
    expect(indices).toContain(1);
    expect(indices).toContain(2);
  });

  it('skips tool_use and tool_result messages', () => {
    const msgs = [
      msg('tool_use', 'decided to read file'),
      msg('tool_result', 'decided content here'),
    ];
    expect(findKeyDecisionIndices(msgs)).toEqual([]);
  });

  it('skips progress messages', () => {
    const msgs = [msg('progress', 'decided to continue')];
    expect(findKeyDecisionIndices(msgs)).toEqual([]);
  });

  it('does not include tool messages in context window', () => {
    const msgs = [
      msg('human', 'I decided to use X'),
      msg('tool_use', 'reading...'),
      msg('tool_result', 'result'),
      msg('assistant', 'Done'),
    ];
    const indices = findKeyDecisionIndices(msgs);
    expect(indices).toContain(0);
    expect(indices).not.toContain(1);
    expect(indices).not.toContain(2);
  });

  it('does not match unrelated content', () => {
    const msgs = [msg('human', 'Hello world'), msg('assistant', 'Hi there')];
    expect(findKeyDecisionIndices(msgs)).toEqual([]);
  });

  it('returns sorted indices', () => {
    const msgs = [
      msg('human', 'first'),
      msg('assistant', 'I decided A'),
      msg('human', 'second'),
      msg('assistant', 'third'),
      msg('human', "Let's go with B"),
      msg('assistant', 'Done'),
    ];
    const indices = findKeyDecisionIndices(msgs);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
    }
  });

  it('custom contextRadius works', () => {
    const msgs = [
      msg('human', 'far before'),
      msg('assistant', 'near before'),
      msg('human', 'I decided X'),
      msg('assistant', 'near after'),
      msg('human', 'far after'),
    ];
    // radius 0 = only the match itself
    const r0 = findKeyDecisionIndices(msgs, 0);
    expect(r0).toEqual([2]);

    // radius 2 = 2 before + 2 after
    const r2 = findKeyDecisionIndices(msgs, 2);
    expect(r2).toContain(0);
    expect(r2).toContain(4);
  });
});

describe('findByTopicIndices', () => {
  it('returns empty for empty topic', () => {
    expect(findByTopicIndices([msg('human', 'hello')], '')).toEqual([]);
    expect(findByTopicIndices([msg('human', 'hello')], '  ')).toEqual([]);
  });

  it('returns empty for empty messages', () => {
    expect(findByTopicIndices([], 'auth')).toEqual([]);
  });

  it('ignores keywords shorter than 3 chars', () => {
    const msgs = [msg('human', 'I am ok')];
    expect(findByTopicIndices(msgs, 'am ok')).toEqual([]);
  });

  it('finds messages matching a single keyword', () => {
    const msgs = [
      msg('human', 'Set up the authentication system'),
      msg('assistant', 'Created auth middleware'),
      msg('human', 'Now work on the database schema'),
      msg('assistant', 'PostgreSQL migration for users table'),
    ];
    const indices = findByTopicIndices(msgs, 'authentication');
    expect(indices).toContain(0);
    expect(indices).toContain(1); // context
  });

  it('finds messages matching multiple keywords', () => {
    const msgs = [
      msg('human', 'Set up authentication'),
      msg('assistant', 'Done with auth'),
      msg('human', 'Work on database migration'),
      msg('assistant', 'Created the migration file'),
      msg('human', 'Add password hashing to auth'),
    ];
    const indices = findByTopicIndices(msgs, 'auth migration');
    expect(indices).toContain(0); // "authentication" contains "auth"
    expect(indices).toContain(2); // "migration"
    expect(indices).toContain(4); // "auth"
  });

  it('is case insensitive', () => {
    const msgs = [msg('human', 'PostgreSQL Database')];
    expect(findByTopicIndices(msgs, 'postgresql')).toContain(0);
    expect(findByTopicIndices(msgs, 'DATABASE')).toContain(0);
  });

  it('does not match unrelated content', () => {
    const msgs = [msg('human', 'Hello world'), msg('assistant', 'Hi there')];
    expect(findByTopicIndices(msgs, 'kubernetes')).toEqual([]);
  });

  it('includes context radius', () => {
    const msgs = [
      msg('human', 'before'),
      msg('assistant', 'authentication handler created'),
      msg('human', 'after'),
    ];
    const indices = findByTopicIndices(msgs, 'authentication', 1);
    expect(indices).toContain(0); // context before
    expect(indices).toContain(1); // match
    expect(indices).toContain(2); // context after
  });
});
