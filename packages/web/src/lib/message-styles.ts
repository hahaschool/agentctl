/**
 * Shared message type styling for chat message bubbles.
 *
 * Uses Tailwind classes instead of inline style objects so that
 * all colors go through the design system and dark-mode works for free.
 */

export type MessageStyle = {
  label: string;
  /** Tailwind text color class for the label */
  textClass: string;
  /** Tailwind background + border-left class for the bubble */
  bubbleClass: string;
};

const STYLES: Record<string, MessageStyle> = {
  human: {
    label: 'You',
    textClass: 'text-indigo-400',
    bubbleClass: 'bg-indigo-500/[0.08] border-l-indigo-400',
  },
  assistant: {
    label: 'Claude',
    textClass: 'text-green-400',
    bubbleClass: 'bg-green-500/[0.06] border-l-green-400',
  },
  tool_use: {
    label: 'Tool Call',
    textClass: 'text-yellow-400',
    bubbleClass: 'bg-yellow-500/[0.04] border-l-yellow-400',
  },
  tool_result: {
    label: 'Tool Result',
    textClass: 'text-slate-400',
    bubbleClass: 'bg-slate-400/[0.04] border-l-slate-400',
  },
};

const FALLBACK: MessageStyle = {
  label: 'Unknown',
  textClass: 'text-muted-foreground',
  bubbleClass: 'bg-card border-l-muted-foreground',
};

export function getMessageStyle(type: string): MessageStyle {
  return STYLES[type] ?? { ...FALLBACK, label: type };
}
