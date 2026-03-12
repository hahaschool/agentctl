// =============================================================================
// LogViewer — Full-screen scrollable log view for a specific service
// =============================================================================

import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useState } from 'react';

type Props = {
  readonly serviceName: string;
  readonly servicePort: number;
  readonly onBack: () => void;
};

const CONTROL_URL = (process.env.CONTROL_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const WORKER_URL = (process.env.WORKER_URL ?? 'http://localhost:9000').replace(/\/$/, '');

function getLogUrl(port: number): string | null {
  if (port === 8080) return `${CONTROL_URL}/api/health`;
  if (port === 9000) return `${WORKER_URL}/api/health`;
  return null;
}

export function LogViewer({ serviceName, servicePort, onBack }: Props): React.ReactElement {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 24;
  const visibleLines = termHeight - 6; // Header + footer + borders

  useEffect(() => {
    let active = true;

    const fetchLogs = async (): Promise<void> => {
      const url = getLogUrl(servicePort);
      if (!url) {
        if (active) {
          setLines([`No log endpoint available for ${serviceName} (:${servicePort})`]);
          setLoading(false);
        }
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          if (active) {
            setLines([`HTTP ${response.status} from ${url}`]);
            setLoading(false);
          }
          return;
        }

        const text = await response.text();
        if (active) {
          try {
            const data = JSON.parse(text) as Record<string, unknown>;
            const formatted = JSON.stringify(data, null, 2).split('\n');
            setLines(formatted);
          } catch {
            setLines(text.split('\n'));
          }
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setLines([`Failed to fetch logs: ${message}`]);
          setLoading(false);
        }
      }
    };

    fetchLogs();

    return () => {
      active = false;
    };
  }, [serviceName, servicePort]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setScrollOffset((prev) => Math.min(Math.max(0, lines.length - visibleLines), prev + 1));
    }
    if (key.pageUp) {
      setScrollOffset((prev) => Math.max(0, prev - visibleLines));
    }
    if (key.pageDown) {
      setScrollOffset((prev) =>
        Math.min(Math.max(0, lines.length - visibleLines), prev + visibleLines),
      );
    }
  });

  const displayedLines = lines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column" height={termHeight}>
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text bold color="blue">
          {'\u2501'} Logs: {serviceName} :{servicePort} {'\u2501'}
        </Text>
        <Text> </Text>
        <Text dimColor>
          ({scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, lines.length)} of{' '}
          {lines.length})
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="gray" paddingX={1}>
        {loading ? (
          <Text>
            <Spinner type="dots" /> Loading logs...
          </Text>
        ) : (
          displayedLines.map((line, index) => <Text key={`${scrollOffset + index}`}>{line}</Text>)
        )}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>
          ESC/q:back {'  '} {'\u2191\u2193'}:scroll {'  '} PgUp/PgDn:page
        </Text>
      </Box>
    </Box>
  );
}
