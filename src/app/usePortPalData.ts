import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortEvent, PortInfo, TrafficByPort } from './types';
import { tauriPortPalGateway, type PortPalGateway } from '../lib/tauri';
import { isCriticalProcess, type KillOutcome } from './killPolicy';

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
  eventsLoading: boolean;
  errors: ResourceErrors;
  toast: string | null;
  refreshPorts(): Promise<void>;
  refreshEvents(): Promise<void>;
  refreshTraffic(): Promise<void>;
  killPort(port: PortInfo): Promise<KillOutcome>;
  restartPort(port: PortInfo): Promise<void>;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return error instanceof Error ? error.message : String(error);
}

function observedStarts(events: PortEvent[], initial: Record<number, number> = {}): Record<number, number> {
  // Keyed by port number: conflicting listeners on the same port share one
  // observed-at timestamp. Conflict-safe because the timestamp describes the
  // endpoint, while identity-sensitive logic (selection, keys) is pid-aware.
  // Take Math.max so the newest start timestamp wins regardless of array order.
  return events.reduce<Record<number, number>>((observedAt, event) => {
    if (event.event_type === 'started') {
      observedAt[event.port] = Math.max(observedAt[event.port] ?? 0, event.timestamp);
    }
    return observedAt;
  }, { ...initial });
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
  const [eventsLoading, setEventsLoading] = useState(true);
  const [errors, setErrors] = useState<ResourceErrors>({ ports: null, events: null, traffic: null });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKills = useRef(new Set<number>());

  // Latest-wins, single slot: a second failure replaces the first message and
  // restarts the one timer. Queueing would make the user wait out stale news
  // about an action they already know failed, and a burst of failures usually
  // shares one cause, so the newest message is the useful one. Anything that
  // must survive being replaced belongs in a page error state with a retry,
  // not here.
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
      setObservedAt((current) => observedStarts(result, current));
      setErrors((current) => ({ ...current, events: null }));
    } catch (error) {
      setErrors((current) => ({ ...current, events: errorMessage(error) }));
    } finally {
      setEventsLoading(false);
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
    let unlistenDegraded: (() => void) | undefined;
    let unlistenRecovered: (() => void) | undefined;
    let unlistenScanCompleted: (() => void) | undefined;

    // A subscription that never attaches cannot be retried per resource: the
    // stream simply never arrives, and refreshing that resource would not
    // reattach it. There is no retry affordance to offer, so the failure goes
    // out as a toast instead of an error state with a Retry that cannot help.
    const subscribe = (
      setup: Promise<() => void>,
      attach: (unlisten: () => void) => void,
      stream: string,
    ) => {
      void setup
        .then((unlisten) => {
          if (active) attach(unlisten);
          else unlisten();
        })
        .catch((error) => {
          if (active) showToast(`Live ${stream} unavailable: ${errorMessage(error)}`);
        });
    };

    subscribe(gateway.onPortsUpdated((updatedPorts) => {
      setPorts(updatedPorts);
      setLoading(false);
      // `lastScanAt` is NOT stamped here. This event only fires when the port
      // list changed, so using it made the status line report the last change
      // rather than the last scan; `onScanCompleted` below is the scan clock.
      setErrors((current) => ({ ...current, ports: null }));
      setKilledPorts((current) => {
        // Keyed by port number: a STOPPED row describes the endpoint, not the
        // PID. Clear it as soon as the port is live again (same or new PID);
        // killPort already filters the live list by PID so conflicts keep
        // their surviving rows.
        const livePorts = new Set(updatedPorts.map((port) => port.port));
        const next = new Map(current);
        for (const port of next.keys()) {
          if (livePorts.has(port)) next.delete(port);
        }
        return next;
      });
      // The backend purges first_seen for stopped endpoints (logger.rs), so
      // the frontend mirror must do the same to avoid unbounded growth.
      setObservedAt((current) => {
        const livePorts = new Set(updatedPorts.map((port) => port.port));
        const next: Record<number, number> = {};
        for (const key of Object.keys(current)) {
          const port = Number(key);
          if (livePorts.has(port)) next[port] = current[port];
        }
        return next;
      });
    }), (unlisten) => { unlistenPorts = unlisten; }, 'port updates');

    subscribe(gateway.onPortEvents((updatedEvents) => {
      setEvents((current) => [...updatedEvents, ...current].slice(0, 200));
      setObservedAt((current) => observedStarts(updatedEvents, current));
    }), (unlisten) => { unlistenEvents = unlisten; }, 'port events');

    // The scanner cannot report a failed scan as an empty list, so a break in
    // scanning would otherwise leave the last successful rows on screen
    // indefinitely. Surface it as a ports error: the rows are no longer
    // trustworthy, and the page offers a retry.
    subscribe(gateway.onScanDegraded((scanError) => {
      setLoading(false);
      setErrors((current) => ({ ...current, ports: scanError.message }));
    }), (unlisten) => { unlistenDegraded = unlisten; }, 'scan health');

    subscribe(gateway.onScanRecovered(() => {
      setErrors((current) => ({ ...current, ports: null }));
      void refreshPorts();
    }), (unlisten) => { unlistenRecovered = unlisten; }, 'scan recovery');

    // The liveness clock behind "Last scan". It ticks on every completed scan,
    // including the quiet ones that change nothing, so a climbing value means
    // scanning really has stopped — the signal the line is there to give.
    // A failed scan emits nothing, so the value climbs then too, which is
    // correct: the last successful scan is exactly what it names.
    subscribe(gateway.onScanCompleted(() => {
      setLastScanAt(Date.now());
    }), (unlisten) => { unlistenScanCompleted = unlisten; }, 'scan heartbeat');

    return () => {
      active = false;
      clearInterval(trafficTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      unlistenPorts?.();
      unlistenEvents?.();
      unlistenDegraded?.();
      unlistenRecovered?.();
      unlistenScanCompleted?.();
    };
  }, [gateway, refreshEvents, refreshPorts, refreshTraffic, showToast]);

  const killPort = useCallback(async (port: PortInfo): Promise<KillOutcome> => {
    if (pendingKills.current.has(port.pid)) return 'busy';
    if ([port, ...ports.filter((p) => p.pid === port.pid)].some(isCriticalProcess)) {
      showToast(`Protected service ${port.process_name} cannot be killed`);
      return 'critical';
    }
    pendingKills.current.add(port.pid);
    setKilling((current) => new Set(current).add(port.pid));
    // All live endpoints sharing this PID die together; snapshot them first
    // so every affected port gets its own STOPPED row for restore.
    const siblings = [port, ...ports.filter((p) => p.pid === port.pid && p.port !== port.port)];
    try {
      await gateway.killProcess(port.pid);
      showToast(`Killed ${port.process_name} on :${port.port}`);
      setPorts((current) => current.filter((item) => item.pid !== port.pid));
      setKilledPorts((current) => {
        const next = new Map(current);
        for (const endpoint of siblings) {
          next.set(endpoint.port, endpoint);
        }
        return next;
      });
      return 'killed';
    } catch (error) {
      showToast(`Failed to kill PID ${port.pid}: ${errorMessage(error)}`);
      return typeof error === 'object' && error !== null && 'code' in error && error.code === 'critical_process' ? 'critical' : 'failed';
    } finally {
      pendingKills.current.delete(port.pid);
      setKilling((current) => {
        const next = new Set(current);
        next.delete(port.pid);
        return next;
      });
    }
  }, [gateway, showToast, ports]);

  const restartPort = useCallback(async (port: PortInfo) => {
    const label = port.project_name ?? port.process_name;
    // Restart needs a launch record the backend captured during a scan, which
    // requires both a command line and a project root to jail it to. The table
    // hides the button when either is missing, so reaching here means a stale
    // row or a caller that skipped that check — say which half is missing
    // rather than letting the click look like it did nothing at all.
    if (!port.start_cmd || !port.project_path) {
      const reason = !port.start_cmd
        ? 'PortPal did not record how it was started'
        : 'no project folder was found for it';
      showToast(`Can't restart ${label}: ${reason}`);
      return;
    }
    setRestarting((current) => new Set(current).add(port.pid));
    try {
      await gateway.restartProcess(port.port, port.pid);
      showToast(`Restarting ${label}…`);
      setKilledPorts((current) => {
        const next = new Map(current);
        // Only clear our own STOPPED row: on a port conflict the entry may
        // belong to a different PID than the one being restarted.
        if (next.get(port.port)?.pid === port.pid) next.delete(port.port);
        return next;
      });
    } catch (error) {
      showToast(`Failed to restart ${label}: ${errorMessage(error)}`);
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
    eventsLoading,
    errors,
    toast,
    refreshPorts,
    refreshEvents,
    refreshTraffic,
    killPort,
    restartPort,
  };
}
