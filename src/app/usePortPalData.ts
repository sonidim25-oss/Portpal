import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortEvent, PortInfo, TrafficByPort } from './types';
import { tauriPortPalGateway, type PortPalGateway } from '../lib/tauri';

type ResourceErrors = { ports: string | null; events: string | null; traffic: string | null };

export interface UsePortPalDataResult {
  ports: PortInfo[];
  events: PortEvent[];
  traffic: TrafficByPort;
  killedPorts: Map<number, PortInfo>;
  killing: ReadonlySet<number>;
  restarting: ReadonlySet<number>;
  observedAt: Record<number, number>;
  lastScanAt: number | null;
  loading: boolean;
  errors: ResourceErrors;
  toast: string | null;
  refreshPorts(): Promise<void>;
  refreshEvents(): Promise<void>;
  killPort(port: PortInfo): Promise<void>;
  restartPort(port: PortInfo): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observedStarts(events: PortEvent[]): Record<number, number> {
  return events.reduce<Record<number, number>>((observedAt, event) => {
    if (event.event_type === 'started') observedAt[event.port] = event.timestamp;
    return observedAt;
  }, {});
}

export function usePortPalData(gateway: PortPalGateway = tauriPortPalGateway): UsePortPalDataResult {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [events, setEvents] = useState<PortEvent[]>([]);
  const [traffic, setTraffic] = useState<TrafficByPort>({});
  const [killedPorts, setKilledPorts] = useState<Map<number, PortInfo>>(new Map());
  const [killing, setKilling] = useState<Set<number>>(new Set());
  const [restarting, setRestarting] = useState<Set<number>>(new Set());
  const [observedAt, setObservedAt] = useState<Record<number, number>>({});
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<ResourceErrors>({ ports: null, events: null, traffic: null });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const result = await gateway.getPorts();
      setPorts(result);
      setLastScanAt(Date.now());
      setErrors((current) => ({ ...current, ports: null }));
    } catch (error) {
      setErrors((current) => ({ ...current, ports: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  const refreshEvents = useCallback(async () => {
    try {
      const result = await gateway.getPortEvents();
      setEvents(result);
      setObservedAt((current) => ({ ...current, ...observedStarts(result) }));
      setErrors((current) => ({ ...current, events: null }));
    } catch (error) {
      setErrors((current) => ({ ...current, events: errorMessage(error) }));
    }
  }, [gateway]);

  const refreshTraffic = useCallback(async () => {
    try {
      const result = await gateway.getPortTraffic();
      setTraffic(result);
      setErrors((current) => ({ ...current, traffic: null }));
    } catch (error) {
      setErrors((current) => ({ ...current, traffic: errorMessage(error) }));
    }
  }, [gateway]);

  useEffect(() => {
    void refreshPorts();
    void refreshEvents();
    void refreshTraffic();

    const trafficTimer = setInterval(() => void refreshTraffic(), 4000);
    let active = true;
    let unlistenPorts: (() => void) | undefined;
    let unlistenEvents: (() => void) | undefined;

    void gateway.onPortsUpdated((updatedPorts) => {
      setPorts(updatedPorts);
      setLoading(false);
      setLastScanAt(Date.now());
      setErrors((current) => ({ ...current, ports: null }));
      setKilledPorts((current) => {
        const livePorts = new Set(updatedPorts.map((port) => port.port));
        const next = new Map(current);
        for (const port of next.keys()) {
          if (livePorts.has(port)) next.delete(port);
        }
        return next;
      });
      void refreshTraffic();
    }).then((unlisten) => {
      if (active) unlistenPorts = unlisten;
      else unlisten();
    });

    void gateway.onPortEvents((updatedEvents) => {
      setEvents((current) => [...updatedEvents, ...current].slice(0, 200));
      setObservedAt((current) => ({ ...current, ...observedStarts(updatedEvents) }));
    }).then((unlisten) => {
      if (active) unlistenEvents = unlisten;
      else unlisten();
    });

    return () => {
      active = false;
      clearInterval(trafficTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      unlistenPorts?.();
      unlistenEvents?.();
    };
  }, [gateway, refreshEvents, refreshPorts, refreshTraffic]);

  const killPort = useCallback(async (port: PortInfo) => {
    setKilling((current) => new Set(current).add(port.pid));
    try {
      await gateway.killProcess(port.pid);
      showToast(`Killed ${port.process_name} on :${port.port}`);
      setPorts((current) => current.filter((item) => item.pid !== port.pid));
      if (port.start_cmd && port.project_path) {
        setKilledPorts((current) => new Map(current).set(port.port, port));
      }
    } catch {
      showToast(`Failed to kill PID ${port.pid}`);
    } finally {
      setKilling((current) => {
        const next = new Set(current);
        next.delete(port.pid);
        return next;
      });
    }
  }, [gateway, showToast]);

  const restartPort = useCallback(async (port: PortInfo) => {
    if (!port.start_cmd || !port.project_path) return;
    setRestarting((current) => new Set(current).add(port.pid));
    try {
      await gateway.restartProcess(port.pid, port.start_cmd, port.project_path);
      showToast(`Restarting ${port.project_name ?? port.process_name}…`);
      setKilledPorts((current) => {
        const next = new Map(current);
        next.delete(port.port);
        return next;
      });
    } catch (error) {
      showToast(`Failed to restart: ${error}`);
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(port.pid);
        return next;
      });
    }
  }, [gateway, showToast]);

  return {
    ports,
    events,
    traffic,
    killedPorts,
    killing,
    restarting,
    observedAt,
    lastScanAt,
    loading,
    errors,
    toast,
    refreshPorts,
    refreshEvents,
    killPort,
    restartPort,
  };
}
