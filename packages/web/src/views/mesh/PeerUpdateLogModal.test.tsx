import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SSE connection
vi.mock('@/lib/api/sync', () => ({
  connectUpdateLogStream: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { connectUpdateLogStream } from '@/lib/api/sync';
import { PeerUpdateLogModal } from './PeerUpdateLogModal';

const mockConnect = vi.mocked(connectUpdateLogStream);

describe('PeerUpdateLogModal', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockConnect.mockReturnValue(vi.fn());
  });
  it('renders the modal with machine ID and version range', () => {
    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('peer-update-log-modal')).toBeInTheDocument();
    expect(screen.getByText('Updating test-peer')).toBeInTheDocument();
    expect(screen.getByText(/v0\.4\.0.*→.*v0\.5\.0/)).toBeInTheDocument();
  });

  it('connects to SSE on mount', () => {
    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(mockConnect).toHaveBeenCalledWith('test-peer', 'job-123', expect.any(Object));
  });

  it('shows "Waiting for output..." when no logs yet', () => {
    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
  });

  it('shows log lines when onLog is called', () => {
    mockConnect.mockImplementation((_machineId, _jobId, callbacks) => {
      // Simulate immediate log delivery
      callbacks.onLog({ stream: 'stdout', text: 'peer-update: starting', ts: Date.now() });
      callbacks.onLog({ stream: 'stderr', text: 'warning: something', ts: Date.now() });
      return vi.fn();
    });

    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('peer-update: starting')).toBeInTheDocument();
    expect(screen.getByText('warning: something')).toBeInTheDocument();
  });

  it('shows success status when onStatus fires with success', () => {
    mockConnect.mockImplementation((_machineId, _jobId, callbacks) => {
      callbacks.onStatus({
        status: 'success',
        result: {
          exitCode: 0,
          durationMs: 45000,
          previousVersion: 'v0.4.0',
          newVersion: 'v0.5.0',
        },
      });
      return vi.fn();
    });

    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Update completed successfully')).toBeInTheDocument();
  });

  it('shows failure status with error details', () => {
    mockConnect.mockImplementation((_machineId, _jobId, callbacks) => {
      callbacks.onStatus({
        status: 'failed',
        error: 'peer-update script exited with code 3',
        result: {
          exitCode: 3,
          durationMs: 12000,
          previousVersion: 'v0.4.0',
          newVersion: 'v0.4.0',
        },
      });
      return vi.fn();
    });

    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Update failed')).toBeInTheDocument();
    expect(screen.getByText('peer-update script exited with code 3')).toBeInTheDocument();
    expect(screen.getByText(/exit 3/)).toBeInTheDocument();
  });

  it('shows disconnect message when SSE drops without final status', () => {
    mockConnect.mockImplementation((_machineId, _jobId, callbacks) => {
      callbacks.onDisconnect();
      return vi.fn();
    });

    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Connection lost — update may have completed'),
    ).toBeInTheDocument();
  });

  it('shows "Close" when done and "Close (update continues)" when running', () => {
    render(
      <PeerUpdateLogModal
        machineId="test-peer"
        jobId="job-123"
        previousVersion="v0.4.0"
        localVersion="v0.5.0"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Close (update continues)')).toBeInTheDocument();
  });
});
