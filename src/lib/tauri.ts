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

export interface PortPalGateway {
  getPorts(): Promise<PortInfo[]>;
  getPortEvents(): Promise<PortEvent[]>;
  getPortTraffic(): Promise<TrafficByPort>;
  getPortGraph(): Promise<PortGraph>;
  killProcess(pid: number): Promise<void>;
  restartProcess(pid: number, cmd: string, cwd: string): Promise<void>;
  onPortsUpdated(handler: (ports: PortInfo[]) => void): Promise<() => void>;
  onPortEvents(handler: (events: PortEvent[]) => void): Promise<() => void>;
}

export const tauriPortPalGateway: PortPalGateway = {
  getPorts: () => invoke<PortInfo[]>('get_ports'),
  getPortEvents: () => invoke<PortEvent[]>('get_port_events'),
  getPortTraffic: () => invoke<TrafficByPort>('get_port_traffic'),
  getPortGraph: () => invoke<PortGraph>('get_port_graph'),
  killProcess: (pid) => invoke<void>('kill_process', { pid }),
  restartProcess: (pid, cmd, cwd) => invoke<void>('restart_process', { pid, cmd, cwd }),
  onPortsUpdated: (handler) => listen<PortInfo[]>('ports-updated', (event) => handler(event.payload)),
  onPortEvents: (handler) => listen<PortEvent[]>('port-events', (event) => handler(event.payload)),
};
