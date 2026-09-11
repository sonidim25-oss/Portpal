import type {
  AdvancedPortFilters,
  PortCategory,
  PortCounts,
  PortFilter,
  PortInfo,
  TrafficByPort,
} from '../app/types';
import { isCriticalPort, isCriticalProcessName, isDevPort } from '../app/taxonomy';

/**
 * UI presentation metadata for well-known ports: brand color and emoji icon.
 *
 * This is NOT a classification table — port classification lives in the
 * shared taxonomy (`src/app/taxonomy.ts` ↔ `shared/taxonomy.json`). This map
 * only provides display styling for `getServiceName`, `getServiceSecondary`,
 * and components that render a framework badge. It intentionally includes
 * system-infrastructure ports (22, 80, 443) so their rows get a service label
 * and icon even though `classifyPort` categorises them as 'system'.
 */
export const PORT_STYLES: Record<number, { label: string; color: string; icon: string }> = {
  3000: { label: 'React', color: '#61dafb', icon: '⚛' },
  3001: { label: 'React', color: '#61dafb', icon: '⚛' },
  4000: { label: 'Node', color: '#68a063', icon: '⬢' },
  4200: { label: 'Angular', color: '#dd0031', icon: '△' },
  5173: { label: 'Vite', color: '#646cff', icon: '⚡' },
  5174: { label: 'Vite', color: '#646cff', icon: '⚡' },
  8000: { label: 'Django', color: '#2bbc8a', icon: '🐍' },
  8080: { label: 'HTTP', color: '#f0a500', icon: '🌐' },
  8888: { label: 'Jupyter', color: '#f37626', icon: '📓' },
  5432: { label: 'Postgres', color: '#336791', icon: '🐘' },
  3306: { label: 'MySQL', color: '#4479a1', icon: '🐬' },
  6379: { label: 'Redis', color: '#dc382d', icon: '◆' },
  27017: { label: 'Mongo', color: '#4db33d', icon: '🍃' },
  9000: { label: 'PHP', color: '#8892bf', icon: '🐘' },
  1420: { label: 'Tauri', color: '#ffc131', icon: '🦀' },
  4173: { label: 'Vite', color: '#646cff', icon: '⚡' },
  2000: { label: 'Node', color: '#68a063', icon: '⬢' },
  8443: { label: 'HTTPS', color: '#22c55e', icon: '🔐' },
  22: { label: 'SSH', color: '#6e7681', icon: '🔒' },
  443: { label: 'HTTPS', color: '#22c55e', icon: '🔐' },
  80: { label: 'HTTP', color: '#f0a500', icon: '🌐' },
};

export const DEV_PORTS = PORT_STYLES;

// Critical infrastructure is classified by the shared taxonomy predicates
// (kept in agreement with the Rust backend through shared/taxonomy.json),
// so a port can never be kill-protected yet classified as dev, or vice versa.
// The name check allows one `.exe` suffix for every protected name, exactly
// like the backend and the kill guard. This replaces the former byte-identical
// SYSTEM_PORTS / SYSTEM_SERVICE_PORTS pair.
/**
 * Well-known infrastructure ports whose service label is authoritative.
 * Naming precedence rule (documented contract):
 * - System service ports (Postgres 5432, MySQL 3306, Redis 6379, Mongo 27017,
 *   SSH 22, HTTP 80, HTTPS 443): the PORT_STYLES service label is PRIMARY
 *   (e.g. "Postgres Server"); a folder-derived project_name is SECONDARY.
 *   This holds even when a project_name/project_path leaks onto the listener
 *   (e.g. Postgres started from a project folder still reads "Postgres").
 * - Dev servers (React 3000, Vite 5173, ...): project_name is PRIMARY and the
 *   framework label is SECONDARY.
 * - Everything else: process_name, with project_name as secondary when present.
 */
export function isSystemServicePort(port: PortInfo): boolean {
  return isCriticalPort(port.port);
}

export function classifyPort(port: PortInfo): PortCategory {
  // System first: a project_name/project_path leaking onto an infrastructure
  // listener (e.g. Postgres launched from a project folder) must not
  // misclassify it as dev.
  if (isCriticalPort(port.port) || isCriticalProcessName(port.process_name)) return 'system';
  if (port.project_name || port.project_path) return 'dev';
  if (isDevPort(port.port)) return 'dev';
  return 'other';
}

export function getServiceName(port: PortInfo): string {
  const style = PORT_STYLES[port.port];
  // System services always lead with their service label (see contract above).
  if (style && isSystemServicePort(port)) return `${style.label} Server`;
  if (port.project_name) return port.project_name;
  if (style) return `${style.label} Server`;
  return port.process_name;
}

/**
 * Secondary display string for the naming precedence contract, or null when
 * the primary name already carries the full identity.
 * - System service + folder project: the folder name (e.g. "myapp" under "Postgres Server").
 * - Dev project on a known framework port: the framework label (e.g. "React" under "myapp").
 */
export function getServiceSecondary(port: PortInfo): string | null {
  const style = PORT_STYLES[port.port];
  if (style && isSystemServicePort(port)) return port.project_name;
  if (port.project_name && style && port.project_name !== style.label) return style.label;
  return null;
}

/**
 * Canonical collision-free React key / endpoint identity for a listener.
 * Ports are NOT unique: two processes can conflict on the same port (SO_REUSEADDR,
 * v4/v6 dual-bind, stale scan rows), so every list key must include the PID.
 * Matches the PortTable pattern (`${pid}-${port}`).
 */
export function portEndpointKey(port: Pick<PortInfo, 'port' | 'pid'>): string {
  return `${port.pid}-${port.port}`;
}

export interface ServiceGroup {
  key: string;
  name: string;
  ports: PortInfo[];
}

/** Stable grouping identity for a listener (never a bare display string). */
export function getServiceGroupKey(port: PortInfo): string {
  const style = PORT_STYLES[port.port];
  if (style && isSystemServicePort(port)) return `system:${style.label.toLowerCase()}:${port.port}`;
  if (port.project_path?.trim()) return `project:${port.project_path.trim().toLowerCase()}`;
  if (port.project_name?.trim()) return `project-name:${port.project_name.trim().toLowerCase()}`;
  if (style) return `framework:${style.label.toLowerCase()}`;
  return `process:${port.process_name.toLowerCase()}`;
}

/** Display name for a service group; duplicates are disambiguated by groupPortsByService. */
export function getServiceGroupName(port: PortInfo): string {
  const style = PORT_STYLES[port.port];
  if (style && isSystemServicePort(port)) return style.label;
  return port.project_name ?? style?.label ?? port.process_name;
}

/**
 * Groups listeners by stable service identity. Two different services that
 * happen to share a display string (e.g. a dev folder literally named
 * "Postgres" vs the real Postgres service) never merge: they get distinct
 * keys, and the duplicate display name is disambiguated with its port.
 */
export function groupPortsByService(ports: PortInfo[]): ServiceGroup[] {
  const grouped = new Map<string, ServiceGroup>();
  for (const port of ports) {
    const key = getServiceGroupKey(port);
    const group = grouped.get(key);
    if (group) group.ports.push(port);
    else grouped.set(key, { key, name: getServiceGroupName(port), ports: [port] });
  }
  const groups = [...grouped.values()].sort((a, b) => b.ports.length - a.ports.length);
  const nameCounts = new Map<string, number>();
  for (const group of groups)
    nameCounts.set(group.name.toLowerCase(), (nameCounts.get(group.name.toLowerCase()) ?? 0) + 1);
  for (const group of groups) {
    if ((nameCounts.get(group.name.toLowerCase()) ?? 0) > 1) {
      const firstPort = Math.min(...group.ports.map((p) => p.port));
      group.name = `${group.name} :${firstPort}`;
    }
  }
  return groups;
}

export function getStatus(port: PortInfo): { label: string; cls: string } {
  // Every row is a live TCP listener; the label distinguishes curated
  // (dev/system taxonomy) listeners from uncatalogued ones.
  if (isDevPort(port.port) || isCriticalPort(port.port))
    return { label: 'ACTIVE', cls: 'status-active' };
  return { label: 'LISTENING', cls: 'status-listening' };
}

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 5) return 'just now';
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
  traffic?: TrafficByPort,
): PortInfo[] {
  let list =
    portFilter === 'all' ? ports : ports.filter((port) => classifyPort(port) === portFilter);

  if (advanced) {
    list = list.filter((port) => {
      if (advanced.protocol !== 'all' && port.protocol !== advanced.protocol) return false;
      if (advanced.project === 'with-project' && !port.project_name && !port.project_path)
        return false;
      if (advanced.project === 'without-project' && (port.project_name || port.project_path))
        return false;
      if (advanced.restartableOnly && (!port.start_cmd || !port.project_path)) return false;
      if (advanced.connectedOnly && latestConnectionCount(traffic ?? {}, port) === 0) return false;
      return true;
    });
  }

  const q = search.toLowerCase().trim();
  if (!q) return list;
  return list.filter((port) =>
    [
      String(port.port),
      port.process_name,
      port.project_name,
      port.project_path,
      port.protocol,
      port.start_cmd,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

export function countPortsByCategory(ports: PortInfo[]): PortCounts {
  const counts: PortCounts = { all: ports.length, dev: 0, system: 0, other: 0 };
  for (const port of ports) counts[classifyPort(port)]++;
  return counts;
}

export function latestConnectionCount(traffic: TrafficByPort, port: PortInfo): number {
  // TrafficByPort is keyed by port number (backend aggregates per port), so
  // conflicting listeners on the same port intentionally share samples here.
  // React keys and selection must still use portEndpointKey (pid-aware).
  const samples = traffic[port.port];
  return samples?.[samples.length - 1]?.connections ?? 0;
}

export function uniqueProcessCount(ports: PortInfo[]): number {
  return new Set(ports.map((port) => port.process_name)).size;
}
