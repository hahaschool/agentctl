import { useCallback, useEffect, useRef, useState } from 'react';

type UsePollingOptions<T> = {
  fetcher: () => Promise<T>;
  intervalMs?: number;
  enabled?: boolean;
};

type UsePollingResult<T> = {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  refresh: () => void;
};

export function usePolling<T>({
  fetcher,
  intervalMs = 10_000,
  enabled = true,
}: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void doFetch();
  }, [doFetch]);

  useEffect(() => {
    if (!enabled) return;

    void doFetch();
    timerRef.current = setInterval(doFetch, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [doFetch, intervalMs, enabled]);

  return { data, error, isLoading, refresh };
}
