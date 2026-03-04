'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { accountDefaultsQuery, accountsQuery, useUpdateDefaults } from '../lib/queries';

// ---------------------------------------------------------------------------
// Failover & Default Account section
// ---------------------------------------------------------------------------

const FAILOVER_POLICIES = [
  {
    value: 'none' as const,
    label: 'None',
    description: 'Use assigned account only',
  },
  {
    value: 'priority' as const,
    label: 'Priority',
    description: 'Try next active account by priority on rate limit',
  },
  {
    value: 'round_robin' as const,
    label: 'Round Robin',
    description: 'Distribute across all active accounts',
  },
];

export function FailoverSection(): React.JSX.Element {
  const accounts = useQuery(accountsQuery());
  const defaults = useQuery(accountDefaultsQuery());
  const updateDefaults = useUpdateDefaults();

  const isLoading = accounts.isLoading || defaults.isLoading;

  function handleDefaultAccountChange(accountId: string): void {
    updateDefaults.mutate({
      defaultAccountId: accountId === '__none__' ? null : accountId,
    });
  }

  function handleFailoverPolicyChange(policy: 'none' | 'priority' | 'round_robin'): void {
    updateDefaults.mutate({ failoverPolicy: policy });
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold mb-1">Failover &amp; Default Account</h2>
        <p className="text-[12px] text-muted-foreground mb-4">
          Configure the global default account and how requests fail over between providers.
        </p>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Default Account */}
            <div className="space-y-1.5">
              <label className="text-[13px] text-muted-foreground" htmlFor="default-account">
                Default Account
              </label>
              <Select
                value={defaults.data?.defaultAccountId ?? '__none__'}
                onValueChange={handleDefaultAccountChange}
              >
                <SelectTrigger className="w-full" id="default-account">
                  <SelectValue placeholder="No default account" />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="__none__">No default</SelectItem>
                  {accounts.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Failover Policy */}
            <div className="space-y-2">
              <span className="text-[13px] text-muted-foreground">Failover Policy</span>
              <div className="flex gap-2 flex-wrap">
                {FAILOVER_POLICIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleFailoverPolicyChange(p.value)}
                    className={cn(
                      'px-3 py-2 rounded-sm text-sm border transition-colors text-left',
                      defaults.data?.failoverPolicy === p.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:bg-accent/10',
                    )}
                  >
                    <div className="font-medium text-[13px]">{p.label}</div>
                    <div className="text-[11px] opacity-80 mt-0.5">{p.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {updateDefaults.isPending && (
              <p className="text-[11px] text-muted-foreground">Saving...</p>
            )}
            {updateDefaults.isError && (
              <p className="text-[11px] text-red-500">
                Failed to save: {updateDefaults.error.message}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
