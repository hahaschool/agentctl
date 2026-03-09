'use client';

import type React from 'react';
import { cn } from '@/lib/utils';
import { formatNumber } from '../lib/format-utils';

type DiscoverStatsBarProps = {
  filteredCount: number;
  totalCount: number;
  projectCount: number;
  machineCount: number;
  importedInFilterCount: number;
  hasImported: boolean;
  selectedCount: number;
  notImportedFilteredCount: number;
  onSelectAll: () => void;
  onBulkImport: () => void;
  bulkImporting: boolean;
  importProgress: { current: number; total: number } | null;
};

export function DiscoverStatsBar({
  filteredCount,
  totalCount,
  projectCount,
  machineCount,
  importedInFilterCount,
  hasImported,
  selectedCount,
  notImportedFilteredCount,
  onSelectAll,
  onBulkImport,
  bulkImporting,
  importProgress,
}: DiscoverStatsBarProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground mb-4">
      <div>
        Showing {formatNumber(filteredCount)} of {formatNumber(totalCount)} sessions across{' '}
        {projectCount} project{projectCount !== 1 ? 's' : ''} on {machineCount} machine
        {machineCount !== 1 ? 's' : ''}
        {hasImported && (
          <span className="ml-2 text-green-600 dark:text-green-400">
            ({importedInFilterCount} already imported)
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onSelectAll}
          className="px-2.5 py-1 bg-muted text-muted-foreground border border-border rounded-md text-[11px] cursor-pointer whitespace-nowrap transition-colors hover:bg-muted/80 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          {selectedCount > 0 && selectedCount === notImportedFilteredCount
            ? 'Deselect All'
            : 'Select All'}
        </button>
        {selectedCount > 0 && (
          <>
            <button
              type="button"
              onClick={onBulkImport}
              disabled={bulkImporting}
              className={cn(
                'px-3 py-1 bg-primary text-white rounded-md text-[11px] font-medium border-none cursor-pointer whitespace-nowrap transition-colors hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
                bulkImporting && 'opacity-50 cursor-not-allowed',
              )}
            >
              {bulkImporting ? 'Importing...' : `Import ${selectedCount} Selected`}
            </button>
            {importProgress && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  />
                </div>
                <span>
                  {importProgress.current}/{importProgress.total}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
