'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { SpaceCard } from '@/components/collaboration/SpaceCard';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { SpaceType, SpaceVisibility } from '@/lib/api';
import { spacesQuery, useCreateSpace } from '@/lib/queries';

// ---------------------------------------------------------------------------
// CreateSpaceDialog
// ---------------------------------------------------------------------------

type CreateSpaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function CreateSpaceDialog({ open, onOpenChange }: CreateSpaceDialogProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SpaceType>('collaboration');
  const [visibility, setVisibility] = useState<SpaceVisibility>('private');
  const createSpace = useCreateSpace();
  const toast = useToast();

  const handleSubmit = useCallback((): void => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    createSpace.mutate(
      {
        name: trimmedName,
        description: description.trim() || undefined,
        type,
        visibility,
      },
      {
        onSuccess: () => {
          toast.success(`Space "${trimmedName}" created`);
          onOpenChange(false);
          setName('');
          setDescription('');
          setType('collaboration');
          setVisibility('private');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err));
        },
      },
    );
  }, [name, description, type, visibility, createSpace, toast, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Space</DialogTitle>
          <DialogDescription>
            Create a collaboration space for agents and humans to work together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <label
              htmlFor="space-name"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Name
            </label>
            <input
              id="space-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              placeholder="e.g. Auth Refactor"
              className="w-full px-3 py-2 bg-muted text-foreground border border-border rounded-md text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="space-description"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Description (optional)
            </label>
            <textarea
              id="space-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this space for?"
              rows={2}
              className="w-full px-3 py-2 bg-muted text-foreground border border-border rounded-md text-sm outline-none resize-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="space-type"
                className="text-xs font-medium text-muted-foreground mb-1 block"
              >
                Type
              </label>
              <select
                id="space-type"
                value={type}
                onChange={(e) => setType(e.target.value as SpaceType)}
                className="w-full px-3 py-2 bg-muted text-foreground border border-border rounded-md text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              >
                <option value="collaboration">Collaboration</option>
                <option value="solo">Solo</option>
                <option value="fleet-overview">Fleet Overview</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="space-visibility"
                className="text-xs font-medium text-muted-foreground mb-1 block"
              >
                Visibility
              </label>
              <select
                id="space-visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as SpaceVisibility)}
                className="w-full px-3 py-2 bg-muted text-foreground border border-border rounded-md text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              >
                <option value="private">Private</option>
                <option value="team">Team</option>
                <option value="public">Public</option>
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || createSpace.isPending}>
            {createSpace.isPending ? 'Creating...' : 'Create Space'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SpacesPage
// ---------------------------------------------------------------------------

export default function SpacesPage(): React.JSX.Element {
  const spaces = useQuery(spacesQuery());
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="relative p-4 md:p-6 max-w-[1000px] animate-page-enter">
      <FetchingBar isFetching={spaces.isFetching && !spaces.isLoading} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Spaces</h1>
        <div className="flex items-center gap-2">
          <RefreshButton
            onClick={() => void spaces.refetch()}
            isFetching={spaces.isFetching && !spaces.isLoading}
          />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            New Space
          </Button>
        </div>
      </div>

      {/* Loading */}
      {spaces.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          {['sk-1', 'sk-2', 'sk-3', 'sk-4'].map((key) => (
            <Skeleton key={key} className="h-28 rounded-lg" />
          ))}
        </div>
      )}

      {/* Error */}
      {spaces.error && (
        <ErrorBanner
          message={`Failed to load spaces: ${spaces.error.message}`}
          onRetry={() => void spaces.refetch()}
          className="mt-4"
        />
      )}

      {/* Empty state */}
      {!spaces.isLoading && !spaces.error && (spaces.data ?? []).length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p className="mb-3">No collaboration spaces yet.</p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            Create your first space
          </Button>
        </div>
      )}

      {/* Spaces grid */}
      {!spaces.isLoading && (spaces.data ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(spaces.data ?? []).map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
        </div>
      )}

      <CreateSpaceDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
