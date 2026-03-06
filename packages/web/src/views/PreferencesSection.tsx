'use client';

import { useCallback, useState } from 'react';

// Card removed — parent SettingsGroup provides visual grouping
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { STORAGE_KEYS } from '../lib/storage-keys';

// ---------------------------------------------------------------------------
// localStorage keys & defaults
// ---------------------------------------------------------------------------

const LS_DEFAULT_MODEL = STORAGE_KEYS.DEFAULT_MODEL;
const LS_AUTO_REFRESH = STORAGE_KEYS.AUTO_REFRESH_INTERVAL;
const LS_MAX_MESSAGES = STORAGE_KEYS.MAX_DISPLAY_MESSAGES;

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-0-20250514', label: 'Claude Opus 4' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
] as const;

const DEFAULT_AUTO_REFRESH = '10000';
const DEFAULT_MAX_MESSAGES = '100';

// ---------------------------------------------------------------------------
// Auto-refresh interval options
// ---------------------------------------------------------------------------

const REFRESH_OPTIONS = [
  { value: '5000', label: '5s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
  { value: '60000', label: '1m' },
  { value: '0', label: 'Off' },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readLS(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable -- silently ignore
  }
}

// ---------------------------------------------------------------------------
// PreferencesSection
// ---------------------------------------------------------------------------

export function PreferencesSection(): React.JSX.Element {
  const [defaultModel, setDefaultModel] = useState(() => readLS(LS_DEFAULT_MODEL, DEFAULT_MODEL));
  const [autoRefresh, setAutoRefresh] = useState(() =>
    readLS(LS_AUTO_REFRESH, DEFAULT_AUTO_REFRESH),
  );
  const [maxMessages, setMaxMessages] = useState(() =>
    readLS(LS_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
  );

  const handleModelChange = useCallback((v: string) => {
    setDefaultModel(v);
    writeLS(LS_DEFAULT_MODEL, v);
  }, []);

  const handleRefreshChange = useCallback((v: string) => {
    setAutoRefresh(v);
    writeLS(LS_AUTO_REFRESH, v);
  }, []);

  const handleMaxMessagesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow the field to be empty while editing, but always persist a valid number
    setMaxMessages(raw);
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n) && n >= 1) {
      writeLS(LS_MAX_MESSAGES, String(Math.round(n)));
    }
  }, []);

  const handleMaxMessagesBlur = useCallback(() => {
    // On blur, normalise to a valid value so the user sees consistent state
    const n = Number(maxMessages);
    if (!Number.isFinite(n) || n < 1 || maxMessages === '') {
      setMaxMessages(DEFAULT_MAX_MESSAGES);
      writeLS(LS_MAX_MESSAGES, DEFAULT_MAX_MESSAGES);
    } else {
      const rounded = String(Math.round(n));
      setMaxMessages(rounded);
      writeLS(LS_MAX_MESSAGES, rounded);
    }
  }, [maxMessages]);

  return (
    <div id="preferences" className="scroll-mt-6">
      <div className="pb-3 mb-4 border-b border-border/30">
        <h3 className="text-sm font-semibold">Defaults</h3>
      </div>

      <div className="space-y-4">
        {/* Default Model */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor="pref-default-model">
            Default Model
          </label>
          <Select value={defaultModel} onValueChange={handleModelChange}>
            <SelectTrigger className="w-full" id="pref-default-model">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {MODEL_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Model used when creating new sessions or agents.
          </p>
        </div>

        {/* Auto-refresh interval */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor="pref-auto-refresh">
            Auto-Refresh Interval
          </label>
          <Select value={autoRefresh} onValueChange={handleRefreshChange}>
            <SelectTrigger className="w-full" id="pref-auto-refresh">
              <SelectValue placeholder="Select interval" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {REFRESH_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            How often list views poll for updates. &ldquo;Off&rdquo; disables automatic polling.
          </p>
        </div>

        {/* Maximum messages to display */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium" htmlFor="pref-max-messages">
            Max Display Messages
          </label>
          <Input
            id="pref-max-messages"
            type="number"
            min={1}
            max={10000}
            placeholder={DEFAULT_MAX_MESSAGES}
            value={maxMessages}
            onChange={handleMaxMessagesChange}
            onBlur={handleMaxMessagesBlur}
          />
          <p className="text-[11px] text-muted-foreground">
            Maximum number of messages shown in the session detail view.
          </p>
        </div>
      </div>
    </div>
  );
}
