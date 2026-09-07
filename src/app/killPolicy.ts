import type { PortInfo } from './types';

export type KillOutcome = 'killed' | 'failed' | 'critical' | 'busy';

// Mirrors the backend defaults. Host-configured additional ports are enforced
// by the backend and returned as typed critical_process errors.
const criticalPorts = new Set([22, 80, 443, 3306, 5432, 6379, 27017]);
const criticalNames = /^(system|svchost|lsass|postgres|redis-server|mysqld|mongod)(\.exe)?$/i;

export function isCriticalProcess(port: PortInfo): boolean {
  return port.pid <= 1 || port.pid > 2147483647 || criticalPorts.has(port.port) || criticalNames.test(port.process_name);
}
