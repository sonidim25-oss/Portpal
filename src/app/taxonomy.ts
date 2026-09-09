/**
 * Single source of truth for the TypeScript side of PortPal's port taxonomy
 * and kill policy.
 *
 * Which ports are critical infrastructure and which process names are
 * protected used to be re-declared in `src/app/killPolicy.ts` and twice more
 * in `src/utils/helpers.ts` (`SYSTEM_PORTS` and the byte-identical
 * `SYSTEM_SERVICE_PORTS`), with a third copy plus an inline name array in
 * Rust — and nothing enforcing agreement. A missed edit silently weakened the
 * kill guard.
 *
 * This module and `src-tauri/src/taxonomy.rs` both assert set equality
 * against `shared/taxonomy.json` in their test suites, so drift fails tests
 * instead of shipping. To add a protected service, edit the fixture plus the
 * two language tables.
 */

export const CRITICAL_PORTS: readonly number[] = [22, 80, 443, 3306, 5432, 6379, 27017];

export const CRITICAL_PROCESS_NAMES: readonly string[] = [
  'system',
  'svchost',
  'lsass',
  'postgres',
  'redis-server',
  'mysqld',
  'mongod',
];

const criticalPortSet: ReadonlySet<number> = new Set(CRITICAL_PORTS);
// One optional `.exe` for every name, case-insensitive — mirrors the
// backend's lowercase-then-strip-one-suffix normalization.
const criticalNamePattern = new RegExp(`^(${CRITICAL_PROCESS_NAMES.join('|')})(\\.exe)?$`, 'i');

export function isCriticalPort(port: number): boolean {
  return criticalPortSet.has(port);
}

export function isCriticalProcessName(processName: string): boolean {
  return criticalNamePattern.test(processName);
}
