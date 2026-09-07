export interface PortInfo {
  port: number;
  pid: number;
  process_name: string;
  project_name: string | null;
  project_path: string | null;
  protocol: string;
  start_cmd: string | null;
}

export interface PortEvent {
  port: number;
  pid: number;
  process_name: string;
  framework: string | null;
  event_type: string;
  timestamp: number;
}

export interface TrafficSample { connections: number; timestamp: number }
export type TrafficByPort = Record<number, TrafficSample[]>;
export type NavPage = 'dashboard' | 'ports' | 'traffic' | 'map' | 'services' | 'logs' | 'settings';
export type PortFilter = 'all' | 'dev' | 'system' | 'other';
export type PortCategory = Exclude<PortFilter, 'all'>;
export type PortCounts = Record<PortFilter, number>;
export interface AdvancedPortFilters {
  protocol: 'all' | 'TCP' | 'UDP';
  project: 'all' | 'with-project' | 'without-project';
  restartableOnly: boolean;
  connectedOnly: boolean;
}
