export interface PortInfo {
  port: number;
  pid: number;
  process_name: string;
  project_name: string | null;
  project_path: string | null;
  /** Always 'TCP': the backend scans TCP listeners only. See docs/scan-scope.md. */
  protocol: string;
  start_cmd: string | null;
  cwd?: string | null;
  env?: Record<string, string> | null;
}

export interface PortEvent {
  port: number;
  pid: number;
  process_name: string;
  framework: string | null;
  event_type: string;
  timestamp: number;
}

export interface TrafficSample {
  connections: number;
  timestamp: number;
}
export type TrafficByPort = Record<number, TrafficSample[]>;
export type NavPage = 'dashboard' | 'ports' | 'traffic' | 'services' | 'logs' | 'settings';
export type PortFilter = 'all' | 'dev' | 'system' | 'other';
export type PortCategory = Exclude<PortFilter, 'all'>;
export type PortCounts = Record<PortFilter, number>;
export interface AdvancedPortFilters {
  /** 'UDP' is offered but never matches: UDP is out of scan scope, not missing data. */
  protocol: 'all' | 'TCP' | 'UDP';
  project: 'all' | 'with-project' | 'without-project';
  restartableOnly: boolean;
  connectedOnly: boolean;
}
