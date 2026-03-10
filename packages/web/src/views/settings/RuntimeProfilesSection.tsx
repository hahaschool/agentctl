'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { accountsQuery, machinesQuery, runtimeConfigDefaultsQuery, useUpdateRuntimeConfigDefaults } from '@/lib/queries';

import { RuntimeProfileCard } from './RuntimeProfileCard';
import { buildRuntimeConfig, inferAccountRuntimeCompatibility, readRuntimeProfiles, type RuntimeProfileSettings } from './types';

export function RuntimeProfilesSection(): React.JSX.Element {
  const runtimeDefaults = useQuery(runtimeConfigDefaultsQuery());
  const machines = useQuery(machinesQuery());
  const accounts = useQuery(accountsQuery());
  const updateRuntimeDefaults = useUpdateRuntimeConfigDefaults();
  const toast = useToast();

  const derivedProfiles = useMemo(
    () => readRuntimeProfiles(runtimeDefaults.data, machines.data ?? []),
    [runtimeDefaults.data, machines.data],
  );

  const [profiles, setProfiles] = useState<RuntimeProfileSettings[]>(derivedProfiles);

  useEffect(() => {
    setProfiles(derivedProfiles);
  }, [derivedProfiles]);

  const isLoading = runtimeDefaults.isLoading || machines.isLoading || accounts.isLoading;
  const isDirty = JSON.stringify(profiles) !== JSON.stringify(derivedProfiles);

  function updateProfile(nextProfile: RuntimeProfileSettings): void {
    setProfiles((current) =>
      current.map((profile) => (profile.runtime === nextProfile.runtime ? nextProfile : profile)),
    );
  }

  function managedCredentialCount(runtime: RuntimeProfileSettings['runtime']): number {
    return (accounts.data ?? []).filter((account) =>
      inferAccountRuntimeCompatibility(account).includes(runtime),
    ).length;
  }

  function handleSave(): void {
    if (!runtimeDefaults.data) return;
    updateRuntimeDefaults.mutate(buildRuntimeConfig(runtimeDefaults.data.config, profiles), {
      onSuccess: () => toast.success('Runtime profiles saved'),
      onError: (error) => toast.error(`Failed to save runtime profiles: ${error.message}`),
    });
  }

  return (
    <div id="runtime-profiles-content" className="space-y-4">
      {isLoading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-[320px] rounded-[24px]" />
          <Skeleton className="h-[320px] rounded-[24px]" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            {profiles.map((profile) => (
              <RuntimeProfileCard
                key={profile.runtime}
                profile={profile}
                allMachineIds={(machines.data ?? []).map((machine) => machine.id)}
                managedCredentialCount={managedCredentialCount(profile.runtime)}
                onChange={updateProfile}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-[24px] border border-border/40 bg-muted/30 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium">Managed runtime config sync</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Saving updates the canonical runtime config used to render `.claude` and `.codex`
                files on managed workers.
              </p>
            </div>
            <Button onClick={handleSave} disabled={!isDirty || updateRuntimeDefaults.isPending}>
              {updateRuntimeDefaults.isPending ? 'Saving...' : 'Save runtime profiles'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
