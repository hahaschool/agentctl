'use client';

import { AlertTriangleIcon } from 'lucide-react';
import type React from 'react';

export type MixedModelEntry = {
  table: string;
  model: string;
  count: number;
};

type MixedModelsBannerProps = {
  models: readonly MixedModelEntry[];
  activeModel: string;
};

export function MixedModelsBanner({
  models,
  activeModel,
}: MixedModelsBannerProps): React.JSX.Element | null {
  const distinctModels = new Set(models.map((entry) => entry.model));
  const hasActiveMismatch = activeModel
    ? models.some((entry) => entry.model !== activeModel)
    : false;

  if (distinctModels.size <= 1 && !hasActiveMismatch) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-amber-100">Mixed embedding models detected</p>
          <p>
            Active provider model <strong>{activeModel}</strong> does not match every recent
            embedded memory surface. Vector search results can be incomplete until the fleet is
            re-aligned.
          </p>
        </div>
      </div>
      <ul className="space-y-1 text-xs text-amber-100/90">
        {models.map((entry) => (
          <li
            key={`${entry.table}-${entry.model}`}
            className="flex items-center justify-between gap-3"
          >
            <span>{entry.table}</span>
            <span>
              {entry.model} · {entry.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
