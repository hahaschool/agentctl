import React from 'react';
import type { SessionContentMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export type TimelineMarker = {
  afterIndex: number;
  type: 'time-gap' | 'human-turn';
  label: string;
};

const TIME_GAP_THRESHOLD_MS = 30 * 60 * 1000;

export function computeTimelineMarkers(messages: SessionContentMessage[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  let turnCount = 1;

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (!prev || !curr) continue;

    // Time gap detection
    if (prev.timestamp && curr.timestamp) {
      const gap = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
      if (gap >= TIME_GAP_THRESHOLD_MS) {
        const mins = Math.round(gap / 60_000);
        const label = mins >= 60 ? `${Math.round(mins / 60)}h gap` : `${mins}m gap`;
        markers.push({ afterIndex: i - 1, type: 'time-gap', label });
      }
    }

    // Human turn boundary
    if (curr.type === 'human' && prev.type !== 'human') {
      turnCount++;
      markers.push({ afterIndex: i - 1, type: 'human-turn', label: `Turn ${turnCount}` });
    }
  }

  return markers;
}

export const TimelineMarkerRow = React.memo(function TimelineMarkerRow({
  marker,
  onClick,
}: {
  marker: TimelineMarker;
  onClick?: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-4 py-1 text-[10px] cursor-pointer transition-colors',
        marker.type === 'time-gap'
          ? 'text-yellow-600 dark:text-yellow-400 bg-yellow-500/5 hover:bg-yellow-500/10'
          : 'text-blue-600 dark:text-blue-400 bg-blue-500/5 hover:bg-blue-500/10',
      )}
    >
      <span className="flex-1 border-t border-current opacity-30" />
      <span className="font-medium whitespace-nowrap">{marker.label}</span>
      <span className="flex-1 border-t border-current opacity-30" />
    </button>
  );
});
