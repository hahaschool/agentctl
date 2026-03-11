'use client';

import type { MemoryScopeRecord, MemoryScopeType } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FolderSync,
  Globe,
  MoreHorizontal,
  Plus,
  Tag,
  Trash2,
  TrendingUp,
  User,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  memoryScopesQuery,
  useCreateScope,
  useDeleteScope,
  useMergeScopes,
  usePromoteScope,
  useRenameScope,
} from '@/lib/queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScopeNode = {
  scope: MemoryScopeRecord;
  children: ScopeNode[];
};

type ConfirmDeleteState = {
  scopeId: string;
  factCount: number;
};

type ConfirmPromoteState = {
  scopeId: string;
  factCount: number;
  parentId: string;
};

type ConfirmMergeState = {
  sourceId: string;
  targetId: string;
  factCount: number;
};

type RenameState = {
  scopeId: string;
  currentName: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTree(scopes: MemoryScopeRecord[]): ScopeNode[] {
  const roots: ScopeNode[] = [];

  for (const scope of scopes) {
    if (scope.parentId === null) {
      roots.push({ scope, children: [] });
    }
  }

  // Attach non-root scopes as children of their parent (all non-global scopes are children of global)
  for (const scope of scopes) {
    if (scope.parentId !== null) {
      const parent = findNode(roots, scope.parentId);
      if (parent) {
        parent.children.push({ scope, children: [] });
      } else {
        // orphan — add as root
        roots.push({ scope, children: [] });
      }
    }
  }

  // Sort children within each node
  for (const root of roots) {
    sortChildren(root);
  }

  return roots;
}

function findNode(nodes: ScopeNode[], id: string): ScopeNode | null {
  for (const node of nodes) {
    if (node.scope.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function sortChildren(node: ScopeNode): void {
  node.children.sort((a, b) => a.scope.name.localeCompare(b.scope.name));
  for (const child of node.children) {
    sortChildren(child);
  }
}

// ---------------------------------------------------------------------------
// ScopeTypeBadge
// ---------------------------------------------------------------------------

const SCOPE_TYPE_CONFIG: Record<
  MemoryScopeType,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  global: {
    label: 'global',
    className: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
    Icon: Globe,
  },
  project: {
    label: 'project',
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    Icon: Tag,
  },
  agent: {
    label: 'agent',
    className: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    Icon: User,
  },
  session: {
    label: 'session',
    className: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
    Icon: Tag,
  },
};

type ScopeTypeBadgeProps = { type: MemoryScopeType };

function ScopeTypeBadge({ type }: ScopeTypeBadgeProps): React.JSX.Element {
  const config = SCOPE_TYPE_CONFIG[type];
  const { Icon } = config;
  return (
    <Badge variant="outline" className={`shrink-0 gap-1 text-[10px] ${config.className}`}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// ScopeTreeNode
// ---------------------------------------------------------------------------

type ScopeTreeNodeProps = {
  node: ScopeNode;
  depth: number;
  siblings: MemoryScopeRecord[];
  onRename: (state: RenameState) => void;
  onDelete: (state: ConfirmDeleteState) => void;
  onPromote: (state: ConfirmPromoteState) => void;
  onMerge: (state: ConfirmMergeState) => void;
};

function ScopeTreeNode({
  node,
  depth,
  siblings,
  onRename,
  onDelete,
  onPromote,
  onMerge,
}: ScopeTreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const indent = depth * 24;

  const mergeTargets = siblings.filter((s) => s.id !== node.scope.id);

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        {/* Expand/collapse toggle */}
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Scope name */}
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm text-foreground"
          title={node.scope.id}
        >
          {node.scope.name}
        </span>

        {/* Type badge */}
        <ScopeTypeBadge type={node.scope.type} />

        {/* Fact count */}
        <span className="w-16 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {node.scope.factCount} {node.scope.factCount === 1 ? 'fact' : 'facts'}
        </span>

        {/* Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
              aria-label={`Actions for ${node.scope.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {node.scope.type !== 'global' && (
              <>
                <DropdownMenuItem
                  onClick={() => onRename({ scopeId: node.scope.id, currentName: node.scope.name })}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {node.scope.parentId && (
                  <DropdownMenuItem
                    onClick={() =>
                      onPromote({
                        scopeId: node.scope.id,
                        factCount: node.scope.factCount,
                        parentId: node.scope.parentId as string,
                      })
                    }
                  >
                    <TrendingUp className="mr-2 h-3.5 w-3.5" />
                    Promote facts to parent
                  </DropdownMenuItem>
                )}
                {mergeTargets.length > 0 && (
                  <DropdownMenuItem
                    onClick={() =>
                      onMerge({
                        sourceId: node.scope.id,
                        targetId: mergeTargets[0]?.id ?? '',
                        factCount: node.scope.factCount,
                      })
                    }
                  >
                    <FolderSync className="mr-2 h-3.5 w-3.5" />
                    Merge into sibling
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() =>
                    onDelete({ scopeId: node.scope.id, factCount: node.scope.factCount })
                  }
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete scope
                </DropdownMenuItem>
              </>
            )}
            {node.scope.type === 'global' && (
              <DropdownMenuItem disabled>No actions for global scope</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <ScopeTreeNode
              key={child.scope.id}
              node={child}
              depth={depth + 1}
              siblings={node.children.map((c) => c.scope)}
              onRename={onRename}
              onDelete={onDelete}
              onPromote={onPromote}
              onMerge={onMerge}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateScopeDialog
// ---------------------------------------------------------------------------

type CreateScopeDialogProps = {
  open: boolean;
  onClose: () => void;
};

function CreateScopeDialog({ open, onClose }: CreateScopeDialogProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [type, setType] = useState<MemoryScopeType>('project');
  const createScope = useCreateScope();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      createScope.mutate(
        { name: name.trim(), type },
        {
          onSuccess: () => {
            setName('');
            setType('project');
            onClose();
          },
        },
      );
    },
    [name, type, createScope, onClose],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Memory Scope</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scope-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as MemoryScopeType)}>
              <SelectTrigger id="scope-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="session">Session</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="scope-name">Name</Label>
            <Input
              id="scope-name"
              placeholder={`e.g. ${type === 'project' ? 'my-project' : type === 'agent' ? 'worker-1' : 'session-abc'}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Scope ID will be{' '}
              <code className="font-mono">
                {type}:{name || '…'}
              </code>
            </p>
          </div>
          {createScope.error && (
            <p className="text-sm text-destructive" role="alert">
              {createScope.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || createScope.isPending}>
              {createScope.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// RenameDialog
// ---------------------------------------------------------------------------

type RenameDialogProps = {
  state: RenameState | null;
  onClose: () => void;
};

function RenameDialog({ state, onClose }: RenameDialogProps): React.JSX.Element {
  const [name, setName] = useState(state?.currentName ?? '');
  const renameScope = useRenameScope();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!state || !name.trim()) return;
      renameScope.mutate({ id: state.scopeId, name: name.trim() }, { onSuccess: onClose });
    },
    [state, name, renameScope, onClose],
  );

  // Reset when dialog opens
  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (v && state) setName(state.currentName);
      if (!v) onClose();
    },
    [state, onClose],
  );

  return (
    <Dialog open={!!state} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Scope</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rename-scope">New Name</Label>
            <Input
              id="rename-scope"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {renameScope.error && (
            <p className="text-sm text-destructive" role="alert">
              {renameScope.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || renameScope.isPending}>
              {renameScope.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// MergeDialog — lets user pick the target sibling
// ---------------------------------------------------------------------------

type MergeDialogProps = {
  state: ConfirmMergeState | null;
  allScopes: MemoryScopeRecord[];
  onClose: () => void;
};

function MergeDialog({ state, allScopes, onClose }: MergeDialogProps): React.JSX.Element {
  const mergeScopes = useMergeScopes();
  const [targetId, setTargetId] = useState(state?.targetId ?? '');

  const candidates = allScopes.filter((s) => s.id !== state?.sourceId);

  const handleConfirm = useCallback(() => {
    if (!state || !targetId) return;
    mergeScopes.mutate({ sourceId: state.sourceId, targetId }, { onSuccess: onClose });
  }, [state, targetId, mergeScopes, onClose]);

  return (
    <AlertDialog open={!!state} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge Scope</AlertDialogTitle>
          <AlertDialogDescription>
            All {state?.factCount ?? 0} facts from{' '}
            <code className="font-mono text-foreground">{state?.sourceId}</code> will be moved into
            the target scope. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="merge-target">Target scope</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="merge-target">
              <SelectValue placeholder="Select a target scope" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {mergeScopes.error && (
          <p className="text-sm text-destructive" role="alert">
            {mergeScopes.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!targetId || mergeScopes.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mergeScopes.isPending ? 'Merging…' : 'Merge'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function MemoryScopeManagerView(): React.JSX.Element {
  const { data, isLoading, error } = useQuery(memoryScopesQuery());
  const deleteScope = useDeleteScope();
  const promoteScope = usePromoteScope();

  const [createOpen, setCreateOpen] = useState(false);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [deleteState, setDeleteState] = useState<ConfirmDeleteState | null>(null);
  const [promoteState, setPromoteState] = useState<ConfirmPromoteState | null>(null);
  const [mergeState, setMergeState] = useState<ConfirmMergeState | null>(null);

  const scopes = data?.scopes ?? [];
  const tree = buildTree(scopes);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteState) return;
    deleteScope.mutate(
      { id: deleteState.scopeId, cascade: deleteState.factCount > 0 },
      { onSuccess: () => setDeleteState(null) },
    );
  }, [deleteState, deleteScope]);

  const handlePromoteConfirm = useCallback(() => {
    if (!promoteState) return;
    promoteScope.mutate(promoteState.scopeId, {
      onSuccess: () => setPromoteState(null),
    });
  }, [promoteState, promoteScope]);

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Memory Scopes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the scope hierarchy used to organise memory facts.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" />
          New Scope
        </Button>
      </div>

      {/* Tree card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Scope Hierarchy</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          {isLoading && (
            <div data-testid="scopes-loading" className="space-y-2 px-2 py-3">
              {Array.from({ length: 3 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                <div key={i} className="h-8 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}

          {!isLoading && error && (
            <p className="px-2 py-4 text-sm text-destructive" role="alert">
              Failed to load scopes. Please try again.
            </p>
          )}

          {!isLoading && !error && scopes.length === 0 && (
            <div data-testid="scopes-empty" className="px-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">No memory scopes found.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Create your first scope
              </Button>
            </div>
          )}

          {!isLoading && !error && scopes.length > 0 && (
            <div data-testid="scope-tree">
              {tree.map((rootNode) => (
                <ScopeTreeNode
                  key={rootNode.scope.id}
                  node={rootNode}
                  depth={0}
                  siblings={tree.map((n) => n.scope)}
                  onRename={setRenameState}
                  onDelete={setDeleteState}
                  onPromote={setPromoteState}
                  onMerge={setMergeState}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CreateScopeDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <RenameDialog state={renameState} onClose={() => setRenameState(null)} />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteState} onOpenChange={(v) => !v && setDeleteState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scope</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteState?.factCount && deleteState.factCount > 0 ? (
                <>
                  This will delete scope{' '}
                  <code className="font-mono text-foreground">{deleteState?.scopeId}</code> and its{' '}
                  {deleteState.factCount} {deleteState.factCount === 1 ? 'fact' : 'facts'}. This
                  action cannot be undone.
                </>
              ) : (
                <>
                  Delete scope{' '}
                  <code className="font-mono text-foreground">{deleteState?.scopeId}</code>? This
                  action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteScope.error && (
            <p className="text-sm text-destructive" role="alert">
              {deleteScope.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteScope.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteScope.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Promote confirmation */}
      <AlertDialog open={!!promoteState} onOpenChange={(v) => !v && setPromoteState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote Facts</AlertDialogTitle>
            <AlertDialogDescription>
              Move all {promoteState?.factCount ?? 0} facts from{' '}
              <code className="font-mono text-foreground">{promoteState?.scopeId}</code> to{' '}
              <code className="font-mono text-foreground">{promoteState?.parentId}</code>. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {promoteScope.error && (
            <p className="text-sm text-destructive" role="alert">
              {promoteScope.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePromoteConfirm} disabled={promoteScope.isPending}>
              {promoteScope.isPending ? 'Promoting…' : 'Promote'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge dialog */}
      <MergeDialog state={mergeState} allScopes={scopes} onClose={() => setMergeState(null)} />
    </div>
  );
}
