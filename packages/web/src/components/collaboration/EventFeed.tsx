'use client';

import type { SpaceEvent } from '@agentctl/shared';
import { Bot, Cpu, User } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';

import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Sender icon helper
// ---------------------------------------------------------------------------

function SenderIcon({ senderType }: { senderType: string }): React.JSX.Element {
  const base = 'size-6 shrink-0 rounded-full flex items-center justify-center';
  switch (senderType) {
    case 'agent':
      return (
        <span className={cn(base, 'bg-blue-500/10 text-blue-500')}>
          <Bot size={14} />
        </span>
      );
    case 'system':
      return (
        <span className={cn(base, 'bg-amber-500/10 text-amber-500')}>
          <Cpu size={14} />
        </span>
      );
    default:
      return (
        <span className={cn(base, 'bg-green-500/10 text-green-500')}>
          <User size={14} />
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: SpaceEvent }): React.JSX.Element {
  const isMessage = event.type === 'message';
  const isControl = event.type === 'control';
  const isArtifact = event.type === 'artifact';
  const text = (event.payload?.text as string | undefined) ?? '';
  const label = (event.payload?.label as string | undefined) ?? event.type;

  if (isControl || event.visibility === 'silent') {
    return (
      <div className="flex items-center gap-2 py-1 px-3">
        <div className="flex-1 border-t border-border/50" />
        <span className="text-[10px] text-muted-foreground/60 font-mono">{label}</span>
        <div className="flex-1 border-t border-border/50" />
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 px-3 py-2 group hover:bg-accent/5 transition-colors">
      <SenderIcon senderType={event.senderType} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-xs font-semibold text-foreground">{event.senderId}</span>
          <span className="text-[10px] text-muted-foreground">
            <LiveTimeAgo date={event.createdAt} />
          </span>
          {!isMessage && (
            <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted px-1 rounded-sm">
              {event.type}
            </span>
          )}
          {event.visibility === 'internal' && (
            <span className="text-[10px] text-yellow-600 dark:text-yellow-400">internal</span>
          )}
        </div>
        {isArtifact ? (
          <div className="text-xs text-foreground bg-muted/50 border border-border/50 rounded-md p-2 font-mono whitespace-pre-wrap break-words">
            {text || JSON.stringify(event.payload, null, 2)}
          </div>
        ) : (
          <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
            {text || JSON.stringify(event.payload)}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventFeed
// ---------------------------------------------------------------------------

export type EventFeedProps = {
  events: SpaceEvent[];
  isLoading?: boolean;
};

export function EventFeed({ events, isLoading }: EventFeedProps): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive.
  const eventCount = events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: eventCount triggers re-scroll on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventCount]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-12">
        Loading events...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-12">
        No events in this thread yet. Send a message to get started.
      </div>
    );
  }

  // Sort by sequence number ascending (chronological)
  const sorted = [...events].sort((a, b) => a.sequenceNum - b.sequenceNum);

  return (
    <div className="flex-1 overflow-y-auto">
      {sorted.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
