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
    getPortGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    killProcess: vi.fn().mockResolvedValue(undefined),
    restartProcess: vi.fn().mockResolvedValue(undefined),
    onPortsUpdated: vi.fn().mockResolvedValue(() => {}),
    onPortEvents: vi.fn().mockResolvedValue(() => {}),
    ...overrides,
  };
}

describe('usePortPalData', () => {
  afterEach(() => vi.useRealTimers());

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

  it('restarts with the port command and path unchanged', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() => usePortPalData(gateway));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.restartPort(port));

    expect(gateway.restartProcess).toHaveBeenCalledWith(1234, 'npm run dev', 'C:/work/portpal');
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
});
