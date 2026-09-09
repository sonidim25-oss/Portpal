import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortEvent, PortInfo, TrafficByPort } from './types';
import type { PortPalGateway } from '../lib/tauri';
import { usePortPalData } from './usePortPalData';

const port: PortInfo = {
  port: 5173,
  pid: 1234,
  process_name: 'node',
  project_name: 'portpal',
  project_path: 'C:/work/portpal',
  protocol: 'TCP',
  start_cmd: 'npm run dev',
};

function createGateway(overrides: Partial<PortPalGateway> = {}): PortPalGateway {
  return {
    getPorts: vi.fn().mockResolvedValue([port]),
    getPortEvents: vi.fn().mockResolvedValue([]),
    getPortTraffic: vi.fn().mockResolvedValue({ 5173: [{ connections: 3, timestamp: 1000 }] } satisfies TrafficByPort),
    killProcess: vi.fn().mockResolvedValue(undefined),
    restartProcess: vi.fn().mockResolvedValue(undefined),
    onPortsUpdated: vi.fn().mockResolvedValue(() => {}),
    onPortEvents: vi.fn().mockResolvedValue(() => {}),
    onScanDegraded: vi.fn().mockResolvedValue(() => {}),
    onScanRecovered: vi.fn().mockResolvedValue(() => {}),
    ...overrides,
  };
}

describe('usePortPalData', () => {
  afterEach(() => vi.useRealTimers());

  it('reports a missing scan tool instead of an empty port list', async () => {
    const gateway = createGateway({
      getPorts: vi.fn().mockRejectedValue({ code: 'tool_missing', tool: 'lsof', message: '`lsof` was not found on PATH.' }),
    });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors.ports).toContain('was not found on PATH');
    expect(result.current.ports).toEqual([]);
  });

  it('marks already-listed ports stale when background scanning degrades', async () => {
    // The rows on screen came from an earlier successful scan. Once scanning
    // breaks they can no longer be trusted, so the page must say so rather
    // than leave them looking live.
    let degrade!: (error: { code: string; tool: string; message: string }) => void;
    const gateway = createGateway({
      onScanDegraded: vi.fn().mockImplementation(async (handler) => { degrade = handler; return () => {}; }),
    });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.ports).toEqual([port]));
    expect(result.current.errors.ports).toBeNull();

    act(() => degrade({ code: 'tool_failed', tool: 'lsof', message: '`lsof` failed: permission denied' }));
    expect(result.current.errors.ports).toContain('permission denied');
  });

  it('clears the degraded state and rescans once scanning recovers', async () => {
    let degrade!: (error: { code: string; tool: string; message: string }) => void;
    let recover!: () => void;
    const gateway = createGateway({
      onScanDegraded: vi.fn().mockImplementation(async (handler) => { degrade = handler; return () => {}; }),
      onScanRecovered: vi.fn().mockImplementation(async (handler) => { recover = handler; return () => {}; }),
    });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => degrade({ code: 'tool_missing', tool: 'lsof', message: 'gone' }));
    expect(result.current.errors.ports).toBe('gone');

    await act(async () => { recover(); });
    await waitFor(() => expect(result.current.errors.ports).toBeNull());
  });

  it('surfaces typed backend policy errors without removing the process', async () => {
    const gateway = createGateway({ killProcess: vi.fn().mockRejectedValue({ code: 'not_observed', message: 'PID is not a currently observed listening process' }) });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { expect(await result.current.killPort(port)).toBe('failed'); });
    expect(result.current.toast).toContain('PID is not a currently observed listening process');
    expect(result.current.ports).toEqual([port]);
    expect(result.current.killedPorts.size).toBe(0);
  });

  it('blocks protected listeners even when another row for the PID appears safe', async () => {
    const gateway = createGateway({ getPorts: vi.fn().mockResolvedValue([port, { ...port, port: 5432, process_name: 'Postgres' }]) });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { expect(await result.current.killPort(port)).toBe('critical'); });
    expect(gateway.killProcess).not.toHaveBeenCalled();
  });

  it('atomically skips duplicate in-flight kills of the same PID', async () => {
    let finish!: () => void;
    const gateway = createGateway({ killProcess: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; })) });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      const first = result.current.killPort(port);
      expect(await result.current.killPort({ ...port, port: 3000 })).toBe('busy');
      finish();
      expect(await first).toBe('killed');
    });
    expect(gateway.killProcess).toHaveBeenCalledTimes(1);
    expect(result.current.killing.size).toBe(0);
  });

  it('loads ports, events, and traffic on mount and records the successful scan time', async () => {
    const gateway = createGateway({
      getPortEvents: vi.fn().mockResolvedValue([{ port: 5173, pid: 1234, process_name: 'node', framework: 'Vite', event_type: 'started', timestamp: 900 }] satisfies PortEvent[]),
    });
    const { result } = renderHook(() => usePortPalData(gateway));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.ports).toEqual([port]);
    expect(result.current.traffic[5173]?.[0]?.connections).toBe(3);
    expect(result.current.observedAt[5173]).toBe(900);
    expect(result.current.lastScanAt).not.toBeNull();
  });

  it('updates ports and traffic from live port updates and refreshes traffic every four seconds', async () => {
    vi.useFakeTimers();
    let receivePorts: ((ports: PortInfo[]) => void) | undefined;
    const updatedPort = { ...port, port: 4173 };
    const gateway = createGateway({
      onPortsUpdated: vi.fn().mockImplementation(async (handler) => {
        receivePorts = handler;
        return () => {};
      }),
    });
    const { result } = renderHook(() => usePortPalData(gateway));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);

    await act(async () => receivePorts?.([updatedPort]));
    expect(result.current.ports).toEqual([updatedPort]);

    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(gateway.getPortTraffic).toHaveBeenCalledTimes(3);
  });

  it('records observed times from live start events', async () => {
    let receiveEvents: ((events: PortEvent[]) => void) | undefined;
    const gateway = createGateway({
      onPortEvents: vi.fn().mockImplementation(async (handler) => {
        receiveEvents = handler;
        return () => {};
      }),
    });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const started = { port: 5173, pid: 1234, process_name: 'node', framework: 'Vite', event_type: 'started', timestamp: 12345 } satisfies PortEvent;
    await act(async () => receiveEvents?.([started]));

    expect(result.current.events[0]).toEqual(started);
    expect(result.current.observedAt[5173]).toBe(12345);
  });

  it('keeps restartable killed ports, but not nonrestartable ones', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.killPort(port));
    expect(result.current.killedPorts.get(5173)).toEqual(port);

    const nonrestartable = { ...port, port: 3001, pid: 4321, start_cmd: null, project_path: null };
    await act(async () => result.current.killPort(nonrestartable));
    expect(result.current.killedPorts.has(3001)).toBe(false);
  });

  it('restarts by port and pid only, never forwarding a command or path', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.restartPort(port));

    expect(gateway.restartProcess).toHaveBeenCalledWith(5173, 1234);
    // The command line and project path stay behind the IPC boundary.
    expect(vi.mocked(gateway.restartProcess).mock.calls[0]).toHaveLength(2);
    expect(JSON.stringify(vi.mocked(gateway.restartProcess).mock.calls)).not.toContain('npm run dev');
  });

  it('does not restart a port with no recorded command or path, and says why', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.restartPort({ ...port, start_cmd: null, project_path: null }));

    expect(gateway.restartProcess).not.toHaveBeenCalled();
    // Silently returning made the click look like a no-op; the refusal is now
    // reported the same way every other failure in this hook is.
    expect(result.current.toast).toContain("Can't restart portpal");
    expect(result.current.restarting.size).toBe(0);
  });

  it('names the missing half when explaining why a restart is unavailable', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.restartPort({ ...port, start_cmd: null }));
    expect(result.current.toast).toContain('did not record how it was started');

    await act(async () => result.current.restartPort({ ...port, project_path: null }));
    expect(result.current.toast).toContain('no project folder was found');

    expect(gateway.restartProcess).not.toHaveBeenCalled();
  });

  it('falls back to the process name when a refused restart has no project name', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.restartPort({ ...port, project_name: null, start_cmd: null }));

    expect(result.current.toast).toContain("Can't restart node");
  });

  it('exposes independent errors without setting a successful scan time for a failed port load', async () => {
    const gateway = createGateway({
      getPorts: vi.fn().mockRejectedValue(new Error('ports unavailable')),
      getPortEvents: vi.fn().mockRejectedValue(new Error('events unavailable')),
      getPortTraffic: vi.fn().mockRejectedValue(new Error('traffic unavailable')),
    });
    const { result } = renderHook(() => usePortPalData(gateway));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.errors).toEqual({ ports: 'ports unavailable', events: 'events unavailable', traffic: 'traffic unavailable' });
    expect(result.current.lastScanAt).toBeNull();
  });

  it('exposes the existing traffic refresh callback for retry actions', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.refreshTraffic());

    expect(gateway.getPortTraffic).toHaveBeenCalledTimes(2);
  });
  it('keeps one toast slot: a second failure replaces the first and reuses the timer', async () => {
    vi.useFakeTimers();
    const gateway = createGateway({
      killProcess: vi.fn()
        .mockRejectedValueOnce({ message: 'first failure' })
        .mockRejectedValueOnce({ message: 'second failure' }),
    });
    const { result, unmount } = renderHook(() => usePortPalData(gateway));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // Two failures in quick succession: the newer message wins outright, and
    // the older one never reappears once the single timer expires.
    await act(async () => { await result.current.killPort(port); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.toast).toContain('first failure');
    await act(async () => { await result.current.killPort({ ...port, pid: 4321 }); });
    expect(result.current.toast).toContain('second failure');

    // The first toast's remaining 2s must not clear the second one early.
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(result.current.toast).toContain('second failure');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.toast).toBeNull();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no toast timer or polling timer running after unmount', async () => {
    vi.useFakeTimers();
    const gateway = createGateway({ killProcess: vi.fn().mockRejectedValue(new Error('nope')) });
    const { result, unmount } = renderHook(() => usePortPalData(gateway));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await result.current.killPort(port); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('toasts when a live subscription cannot be attached at all', async () => {
    // No per-resource retry can reattach a stream, so this failure has to be
    // reported directly rather than parked in a page error state.
    const gateway = createGateway({
      onPortsUpdated: vi.fn().mockRejectedValue(new Error('event channel closed')),
    });
    const { result } = renderHook(() => usePortPalData(gateway));

    await waitFor(() => expect(result.current.toast).toContain('event channel closed'));
    expect(result.current.toast).toContain('Live port updates unavailable');
  });

  it('reports a readable restart failure instead of a stringified object', async () => {
    const gateway = createGateway({
      restartProcess: vi.fn().mockRejectedValue({ code: 'spawn_failed', message: 'working directory is gone' }),
    });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.restartPort(port); });

    expect(result.current.toast).toContain('working directory is gone');
    expect(result.current.toast).not.toContain('[object Object]');
    expect(result.current.restarting.size).toBe(0);
  });

  it('reports a failed rescan rather than silently keeping the previous rows, and clears it on retry', async () => {
    const getPorts = vi.fn()
      .mockResolvedValueOnce([port])
      .mockRejectedValueOnce(new Error('scan failed'))
      .mockResolvedValueOnce([port]);
    const gateway = createGateway({ getPorts });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.ports).toEqual([port]));
    const firstScanAt = result.current.lastScanAt;

    await act(async () => { await result.current.refreshPorts(); });
    // The rows survive in state, but they are flagged: the page renders the
    // error instead of the table, and the scan time is not moved forward.
    expect(result.current.errors.ports).toBe('scan failed');
    expect(result.current.lastScanAt).toBe(firstScanAt);

    await act(async () => { await result.current.refreshPorts(); });
    expect(result.current.errors.ports).toBeNull();
  });

  it('reports each resource as loaded only once its own call comes back', async () => {
    const gateway = createGateway({ getPortEvents: vi.fn().mockRejectedValue(new Error('events unavailable')) });
    const { result } = renderHook(() => usePortPalData(gateway));
    expect(result.current.eventsLoading).toBe(true);

    await waitFor(() => expect(result.current.eventsLoading).toBe(false));
    expect(result.current.errors.events).toBe('events unavailable');
  });

  it('records the newest start timestamp, not the oldest one, from reverse-chronological events', async () => {
    // get_events returns reverse-chronological events (newest first).
    // When multiple start events exist for a port, the newest timestamp must win.
    const events: PortEvent[] = [
      { port: 5173, pid: 1234, event_type: 'started', timestamp: 2000, process_name: 'node' },
      { port: 5173, pid: 1234, event_type: 'started', timestamp: 1000, process_name: 'node' },
    ];
    const gateway = createGateway({ getPortEvents: vi.fn().mockResolvedValue(events) });
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.eventsLoading).toBe(false));

    expect(result.current.observedAt[5173]).toBe(2000);
  });
});
