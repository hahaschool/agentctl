'use client';

import { Network } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useCallback, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import type { Session } from '@/lib/api';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// SessionSpaceLink
//
// Renders a "Link to Space" button for sessions that do not already have a
// collaboration space. Clicking it creates a solo Space with a "Main" thread
// and adds the session's agent as a member.
// ---------------------------------------------------------------------------

export type SessionSpaceLinkProps = {
  session: Session;
};

export function SessionSpaceLink({ session }: SessionSpaceLinkProps): React.JSX.Element | null {
  const router = useRouter();
  const toast = useToast();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(async (): Promise<void> => {
    setIsCreating(true);
    try {
      // 1. Create a solo space named after the session
      const spaceName = session.agentName
        ? `${session.agentName} — ${session.id.slice(0, 8)}`
        : `Session ${session.id.slice(0, 8)}`;

      const space = await api.createSpace({
        name: spaceName,
        description: `Linked from session ${session.id}`,
        type: 'solo',
        visibility: 'private',
      });

      // 2. Create a "Main" thread
      await api.createThread(space.id, {
        title: 'Main',
        type: 'discussion',
      });

      // 3. Add the session's agent as a member (if agentId exists)
      if (session.agentId) {
        await api.addSpaceMember(space.id, {
          memberType: 'agent',
          memberId: session.agentId,
          role: 'member',
        });
      }

      toast.success(`Space "${spaceName}" created`);
      router.push(`/spaces/${space.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create space');
    } finally {
      setIsCreating(false);
    }
  }, [session, router, toast]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleCreate()}
      disabled={isCreating}
      title="Create a collaboration space linked to this session"
    >
      <Network size={14} className="mr-1.5" />
      {isCreating ? 'Creating...' : 'Link to Space'}
    </Button>
  );
}
