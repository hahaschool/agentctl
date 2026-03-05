'use client';

import { useQuery } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '../components/Toast';
import {
  accountsQuery,
  projectAccountsQuery,
  useDeleteProjectAccount,
  useUpsertProjectAccount,
} from '../lib/queries';

// ---------------------------------------------------------------------------
// Project Account Mappings section
// ---------------------------------------------------------------------------

export function ProjectAccountsSection(): React.JSX.Element {
  const accounts = useQuery(accountsQuery());
  const mappings = useQuery(projectAccountsQuery());
  const upsert = useUpsertProjectAccount();
  const remove = useDeleteProjectAccount();

  const toast = useToast();
  const [newPath, setNewPath] = useState('');
  const [newAccountId, setNewAccountId] = useState('');

  const isLoading = accounts.isLoading || mappings.isLoading;

  function handleAdd(): void {
    if (!newPath.trim() || !newAccountId) return;
    upsert.mutate(
      { projectPath: newPath.trim(), accountId: newAccountId },
      {
        onSuccess: () => {
          setNewPath('');
          setNewAccountId('');
          toast.success('Mapping added');
        },
        onError: (err) => toast.error(`Failed to save mapping: ${err.message}`),
      },
    );
  }

  function handleRemove(id: string): void {
    remove.mutate(id, {
      onSuccess: () => toast.success('Mapping removed'),
      onError: (err) => toast.error(`Failed to remove mapping: ${err.message}`),
    });
  }

  /** Resolve an account ID to its display name. */
  function accountName(accountId: string): string {
    const acct = accounts.data?.find((a) => a.id === accountId);
    return acct ? `${acct.name} (${acct.provider})` : `Deleted (${accountId.slice(0, 8)}...)`;
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold mb-1">Project Account Mappings</h2>
        <p className="text-[12px] text-muted-foreground mb-4">
          Override the default account for specific project paths.
        </p>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Existing mappings table */}
            {mappings.data && mappings.data.length > 0 ? (
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Project Path
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Account
                      </th>
                      <th className="w-10 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.data.map((m) => (
                      <tr key={m.id} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs">{m.projectPath}</td>
                        <td className="px-3 py-2">{accountName(m.accountId)}</td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              if (window.confirm(`Remove mapping for "${m.projectPath}"?`)) {
                                handleRemove(m.id);
                              }
                            }}
                            disabled={remove.isPending}
                            aria-label={`Remove mapping for ${m.projectPath}`}
                          >
                            <Trash2Icon className="size-3.5 text-muted-foreground hover:text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground italic">
                No project-specific account mappings configured.
              </p>
            )}

            {/* Add mapping form */}
            <div className="flex gap-2 items-end flex-wrap">
              <div className="flex-1 min-w-[180px] space-y-1">
                <label className="text-[12px] text-muted-foreground" htmlFor="new-project-path">
                  Project path
                </label>
                <Input
                  id="new-project-path"
                  placeholder="my-project"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="min-w-[160px] space-y-1">
                <label className="text-[12px] text-muted-foreground" htmlFor="new-project-account">
                  Account
                </label>
                <Select value={newAccountId} onValueChange={setNewAccountId}>
                  <SelectTrigger className="w-full h-8" id="new-project-account">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {accounts.data?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newPath.trim() || !newAccountId || upsert.isPending}
              >
                {upsert.isPending ? 'Saving...' : 'Add'}
              </Button>
            </div>

            {upsert.isError && (
              <p className="text-[11px] text-red-500">
                Failed to save mapping: {upsert.error.message}
              </p>
            )}
            {remove.isError && (
              <p className="text-[11px] text-red-500">
                Failed to remove mapping: {remove.error.message}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
