import type { AdvancedPortFilters, PortCategory, PortCounts, PortFilter, PortInfo, TrafficByPort } from '../app/types';

export const DEV_PORTS: Record<number, { label: string; color: string; icon: string }> = {
  3000: { label: "React", color: "#61dafb", icon: "⚛" },
  3001: { label: "React", color: "#61dafb", icon: "⚛" },
  4000: { label: "Node", color: "#68a063", icon: "⬢" },
  4200: { label: "Angular", color: "#dd0031", icon: "△" },
  5173: { label: "Vite", color: "#646cff", icon: "⚡" },
  5174: { label: "Vite", color: "#646cff", icon: "⚡" },
  8000: { label: "Django", color: "#2bbc8a", icon: "🐍" },
  8080: { label: "HTTP", color: "#f0a500", icon: "🌐" },
  8888: { label: "Jupyter", color: "#f37626", icon: "📓" },
  5432: { label: "Postgres", color: "#336791", icon: "🐘" },
  3306: { label: "MySQL", color: "#4479a1", icon: "🐬" },
  6379: { label: "Redis", color: "#dc382d", icon: "◆" },
  27017: { label: "Mongo", color: "#4db33d", icon: "🍃" },
  9000: { label: "PHP", color: "#8892bf", icon: "🐘" },
  1420: { label: "Tauri", color: "#ffc131", icon: "🦀" },
  22: { label: "SSH", color: "#6e7681", icon: "🔒" },
  443: { label: "HTTPS", color: "#22c55e", icon: "🔐" },
  80: { label: "HTTP", color: "#f0a500", icon: "🌐" },
};

const SYSTEM_PORTS = new Set([22, 80, 443, 3306, 5432, 6379, 27017]);
const SYSTEM_PROCESSES = /^(system|svchost(?:\.exe)?|lsass(?:\.exe)?|postgres|redis-server|mysqld|mongod)$/i;

export function classifyPort(port: PortInfo): PortCategory {
  if (port.project_name || port.project_path) return 'dev';
  if (SYSTEM_PORTS.has(port.port) || SYSTEM_PROCESSES.test(port.process_name)) return 'system';
  if (DEV_PORTS[port.port]) return 'dev';
  return 'other';
}

export function getServiceName(port: PortInfo): string {
  const dev = DEV_PORTS[port.port];
  if (port.project_name) return port.project_name;
  if (dev) return `${dev.label} Server`;
  return port.process_name;
}

export function getStatus(port: PortInfo): { label: string; cls: string } {
  const dev = DEV_PORTS[port.port];
  if (dev && [5432, 3306, 6379, 27017].includes(port.port)) {
    return { label: "ACTIVE", cls: "status-active" };
  }
  if (dev) return { label: "ACTIVE", cls: "status-active" };
  return { label: "LISTENING", cls: "status-listening" };
}

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function filterPorts(
  ports: PortInfo[],
  search: string,
  portFilter: PortFilter,
  advanced?: AdvancedPortFilters,
  traffic?: TrafficByPort
): PortInfo[] {
  let list = portFilter === 'all' ? ports : ports.filter((port) => classifyPort(port) === portFilter);

  if (advanced) {
    list = list.filter((port) => {
      if (advanced.protocol !== 'all' && port.protocol !== advanced.protocol) return false;
      if (advanced.project === 'with-project' && !port.project_name && !port.project_path) return false;
      if (advanced.project === 'without-project' && (port.project_name || port.project_path)) return false;
      if (advanced.restartableOnly && (!port.start_cmd || !port.project_path)) return false;
      if (advanced.connectedOnly && latestConnectionCount(traffic ?? {}, port) === 0) return false;
      return true;
    });
  }

  const q = search.toLowerCase().trim();
  if (!q) return list;
  return list.filter((port) => [
    String(port.port),
    port.process_name,
    port.project_name,
    port.project_path,
    port.protocol,
    port.start_cmd,
  ].filter(Boolean).join(' ').toLowerCase().includes(q));
}

export function countPortsByCategory(ports: PortInfo[]): PortCounts {
  const counts: PortCounts = { all: ports.length, dev: 0, system: 0, other: 0 };
  for (const port of ports) counts[classifyPort(port)]++;
  return counts;
}

export function latestConnectionCount(traffic: TrafficByPort, port: PortInfo): number {
  const samples = traffic[port.port];
  return samples?.[samples.length - 1]?.connections ?? 0;
}

export function uniqueProcessCount(ports: PortInfo[]): number {
  return new Set(ports.map((port) => port.process_name)).size;
}
