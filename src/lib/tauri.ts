import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PortEvent, PortInfo, TrafficByPort } from '../app/types';

export interface GraphNodeData {
  id: string;
  port: number;
  pid: number;
  process_name: string;
  project_name: string | null;
  framework: string | null;
  is_dev: boolean;
  connection_count: number;
}

export interface GraphEdgeData {
  source: string;
  target: string;
  active: boolean;
}

export interface PortGraph {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

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
  getPortGraph(): Promise<PortGraph>;
  killProcess(pid: number): Promise<void>;
  restartProcess(port: number, pid: number): Promise<void>;
  onPortsUpdated(handler: (ports: PortInfo[]) => void): Promise<() => void>;
  onPortEvents(handler: (events: PortEvent[]) => void): Promise<() => void>;
  onScanDegraded(handler: (error: ScanError) => void): Promise<() => void>;
  onScanRecovered(handler: () => void): Promise<() => void>;
}

export const tauriPortPalGateway: PortPalGateway = {
  getPorts: () => invoke<PortInfo[]>('get_ports'),
  getPortEvents: () => invoke<PortEvent[]>('get_port_events'),
  getPortTraffic: () => invoke<TrafficByPort>('get_port_traffic'),
  getPortGraph: () => invoke<PortGraph>('get_port_graph'),
  killProcess: (pid) => invoke<void>('kill_process', { pid }),
  // Only the port and pid cross the IPC boundary. The command line and working
  // directory come from the backend's trusted store, so script running in this
  // webview cannot ask the host to execute anything of its choosing.
  restartProcess: (port, pid) => invoke<void>('restart_process', { port, pid }),
  onPortsUpdated: (handler) => listen<PortInfo[]>('ports-updated', (event) => handler(event.payload)),
  onPortEvents: (handler) => listen<PortEvent[]>('port-events', (event) => handler(event.payload)),
  // The background scanner skips a tick it cannot complete rather than
  // reporting an empty list, so these events are the only signal that the
  // visible ports have gone stale.
  onScanDegraded: (handler) => listen<ScanError>('scan-degraded', (event) => handler(event.payload)),
  onScanRecovered: (handler) => listen<null>('scan-recovered', () => handler()),
};
