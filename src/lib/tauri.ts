import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PortEvent, PortInfo, TrafficByPort } from '../app/types';

/// Mirrors the Rust `ScanError`: why a port scan could not be completed.
/// Distinct from an empty port list, which means nothing is listening.
export interface ScanError {
  code: 'tool_missing' | 'tool_failed' | (string & {});
  tool: string;
  message: string;
}

export interface PortPalGateway {
  getPorts(): Promise<PortInfo[]>;
  getPortEvents(): Promise<PortEvent[]>;
  getPortTraffic(): Promise<TrafficByPort>;
  killProcess(pid: number): Promise<void>;
  restartProcess(port: number, pid: number): Promise<void>;
  onPortsUpdated(handler: (ports: PortInfo[]) => void): Promise<() => void>;
  onPortEvents(handler: (events: PortEvent[]) => void): Promise<() => void>;
  onScanDegraded(handler: (error: ScanError) => void): Promise<() => void>;
  onScanRecovered(handler: () => void): Promise<() => void>;
  /** Fires once per completed background scan, whether or not the ports changed. */
  onScanCompleted(handler: () => void): Promise<() => void>;
}

export const tauriPortPalGateway: PortPalGateway = {
  getPorts: () => invoke<PortInfo[]>('get_ports'),
  getPortEvents: () => invoke<PortEvent[]>('get_port_events'),
  getPortTraffic: () => invoke<TrafficByPort>('get_port_traffic'),
  killProcess: (pid) => invoke<void>('kill_process', { pid }),
  // Only the port and pid cross the IPC boundary. The command line and working
  // directory come from the backend's trusted store, so script running in this
  // webview cannot ask the host to execute anything of its choosing.
  restartProcess: (port, pid) => invoke<void>('restart_process', { port, pid }),
  onPortsUpdated: (handler) =>
    listen<PortInfo[]>('ports-updated', (event) => handler(event.payload)),
  onPortEvents: (handler) => listen<PortEvent[]>('port-events', (event) => handler(event.payload)),
  // The background scanner skips a tick it cannot complete rather than
  // reporting an empty list, so these events are the only signal that the
  // visible ports have gone stale.
  onScanDegraded: (handler) =>
    listen<ScanError>('scan-degraded', (event) => handler(event.payload)),
  onScanRecovered: (handler) => listen<null>('scan-recovered', () => handler()),
  // Separate from `ports-updated`, which only fires when the port list
  // actually differs: "the scanner is alive" and "the data changed" are
  // different claims, and the monitoring status needs the first.
  onScanCompleted: (handler) => listen<null>('scan-completed', () => handler()),
};
