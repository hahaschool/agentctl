import { describe, expect, it } from 'vitest';

import { getMessageStyle, type MessageStyle } from './message-styles';

// ---------------------------------------------------------------------------
// MessageStyle Type
// ---------------------------------------------------------------------------

describe('MessageStyle type', () => {
  it('should have label property as string', () => {
    const style: MessageStyle = {
      label: 'Test',
      textClass: 'text-red-400',
      bubbleClass: 'bg-red-500/[0.08] border-l-red-400',
    };
    expect(style.label).toBe('Test');
  });

  it('should have textClass property as string', () => {
    const style: MessageStyle = {
      label: 'Test',
      textClass: 'text-blue-400',
      bubbleClass: 'bg-blue-500/[0.08] border-l-blue-400',
    };
    expect(style.textClass).toBe('text-blue-400');
  });

  it('should have bubbleClass property as string', () => {
    const style: MessageStyle = {
      label: 'Test',
      textClass: 'text-green-400',
      bubbleClass: 'bg-green-500/[0.08] border-l-green-400',
    };
    expect(style.bubbleClass).toBe('bg-green-500/[0.08] border-l-green-400');
  });
});

// ---------------------------------------------------------------------------
// getMessageStyle - Known Types
// ---------------------------------------------------------------------------

describe('getMessageStyle - known types', () => {
  it('returns human style for "human" type', () => {
    const style = getMessageStyle('human');
    expect(style.label).toBe('You');
    expect(style.textClass).toBe('text-indigo-400');
    expect(style.bubbleClass).toBe('bg-indigo-500/[0.08] border-l-indigo-400');
  });

  it('returns assistant style for "assistant" type', () => {
    const style = getMessageStyle('assistant');
    expect(style.label).toBe('Claude');
    expect(style.textClass).toBe('text-green-400');
    expect(style.bubbleClass).toBe('bg-green-500/[0.06] border-l-green-400');
  });

  it('returns tool_use style for "tool_use" type', () => {
    const style = getMessageStyle('tool_use');
    expect(style.label).toBe('Tool Call');
    expect(style.textClass).toBe('text-yellow-400');
    expect(style.bubbleClass).toBe('bg-yellow-500/[0.04] border-l-yellow-400');
  });

  it('returns tool_result style for "tool_result" type', () => {
    const style = getMessageStyle('tool_result');
    expect(style.label).toBe('Tool Result');
    expect(style.textClass).toBe('text-slate-400');
    expect(style.bubbleClass).toBe('bg-slate-400/[0.04] border-l-slate-400');
  });
});

// ---------------------------------------------------------------------------
// getMessageStyle - Unknown Types
// ---------------------------------------------------------------------------

describe('getMessageStyle - unknown types', () => {
  it('returns fallback style for unknown type', () => {
    const style = getMessageStyle('unknown');
    expect(style.label).toBe('unknown');
    expect(style.textClass).toBe('text-muted-foreground');
    expect(style.bubbleClass).toBe('bg-card border-l-muted-foreground');
  });

  it('returns fallback style for empty string type', () => {
    const style = getMessageStyle('');
    expect(style.label).toBe('');
    expect(style.textClass).toBe('text-muted-foreground');
    expect(style.bubbleClass).toBe('bg-card border-l-muted-foreground');
  });

  it('preserves unknown type as label in fallback', () => {
    const style = getMessageStyle('custom_type');
    expect(style.label).toBe('custom_type');
  });

  it('handles arbitrary string types', () => {
    const style = getMessageStyle('random_message_type');
    expect(style.label).toBe('random_message_type');
    expect(style.textClass).toBe('text-muted-foreground');
    expect(style.bubbleClass).toBe('bg-card border-l-muted-foreground');
  });

  it('handles type with special characters', () => {
    const style = getMessageStyle('type-with-dashes_and_underscores');
    expect(style.label).toBe('type-with-dashes_and_underscores');
  });

  it('handles type with spaces', () => {
    const style = getMessageStyle('type with spaces');
    expect(style.label).toBe('type with spaces');
  });
});

// ---------------------------------------------------------------------------
// getMessageStyle - Case Sensitivity
// ---------------------------------------------------------------------------

describe('getMessageStyle - case sensitivity', () => {
  it('is case-sensitive: "Human" does not match "human"', () => {
    const style = getMessageStyle('Human');
    expect(style.label).toBe('Human');
    expect(style.textClass).toBe('text-muted-foreground');
  });

  it('is case-sensitive: "ASSISTANT" does not match "assistant"', () => {
    const style = getMessageStyle('ASSISTANT');
    expect(style.label).toBe('ASSISTANT');
    expect(style.textClass).toBe('text-muted-foreground');
  });

  it('is case-sensitive: "Tool_Use" does not match "tool_use"', () => {
    const style = getMessageStyle('Tool_Use');
    expect(style.label).toBe('Tool_Use');
    expect(style.textClass).toBe('text-muted-foreground');
  });
});

// ---------------------------------------------------------------------------
// getMessageStyle - Style Properties
// ---------------------------------------------------------------------------

describe('getMessageStyle - style properties', () => {
  it('all known styles have non-empty textClass', () => {
    const types = ['human', 'assistant', 'tool_use', 'tool_result'];
    for (const type of types) {
      const style = getMessageStyle(type);
      expect(style.textClass).toBeTruthy();
      expect(style.textClass.length).toBeGreaterThan(0);
    }
  });

  it('all known styles have non-empty bubbleClass', () => {
    const types = ['human', 'assistant', 'tool_use', 'tool_result'];
    for (const type of types) {
      const style = getMessageStyle(type);
      expect(style.bubbleClass).toBeTruthy();
      expect(style.bubbleClass.length).toBeGreaterThan(0);
    }
  });

  it('all known styles have non-empty label', () => {
    const types = ['human', 'assistant', 'tool_use', 'tool_result'];
    for (const type of types) {
      const style = getMessageStyle(type);
      expect(style.label).toBeTruthy();
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it('textClass contains color utility class', () => {
    const types = ['human', 'assistant', 'tool_use', 'tool_result'];
    for (const type of types) {
      const style = getMessageStyle(type);
      expect(style.textClass).toMatch(/text-\w+-\d+/);
    }
  });

  it('bubbleClass contains bg and border-l classes', () => {
    const types = ['human', 'assistant', 'tool_use', 'tool_result'];
    for (const type of types) {
      const style = getMessageStyle(type);
      expect(style.bubbleClass).toMatch(/bg-/);
      expect(style.bubbleClass).toMatch(/border-l-/);
    }
  });
});

// ---------------------------------------------------------------------------
// getMessageStyle - Return Type
// ---------------------------------------------------------------------------

describe('getMessageStyle - return type', () => {
  it('returns an object with label, textClass, and bubbleClass', () => {
    const style = getMessageStyle('human');
    expect(style).toHaveProperty('label');
    expect(style).toHaveProperty('textClass');
    expect(style).toHaveProperty('bubbleClass');
    expect(Object.keys(style).length).toBe(3);
  });

  it('returns a new object for fallback style', () => {
    const style1 = getMessageStyle('unknown1');
    const style2 = getMessageStyle('unknown2');
    expect(style1).not.toBe(style2);
  });

  it('returns the same object reference for known styles', () => {
    const style1 = getMessageStyle('human');
    const style2 = getMessageStyle('human');
    expect(style1).toBe(style2);
  });
});

// ---------------------------------------------------------------------------
// getMessageStyle - Edge Cases
// ---------------------------------------------------------------------------

describe('getMessageStyle - edge cases', () => {
  it('handles very long type strings', () => {
    const longType = 'a'.repeat(1000);
    const style = getMessageStyle(longType);
    expect(style.label).toBe(longType);
  });

  it('handles numeric-like strings', () => {
    const style = getMessageStyle('123');
    expect(style.label).toBe('123');
  });

  it('handles strings with only whitespace', () => {
    const style = getMessageStyle('   ');
    expect(style.label).toBe('   ');
  });

  it('handles strings with unicode characters', () => {
    const style = getMessageStyle('emoji_🚀_type');
    expect(style.label).toBe('emoji_🚀_type');
  });

  it('fallback style uses consistent classes across different unknown types', () => {
    const style1 = getMessageStyle('unknown1');
    const style2 = getMessageStyle('unknown2');
    expect(style1.textClass).toBe(style2.textClass);
    expect(style1.bubbleClass).toBe(style2.bubbleClass);
  });
});
