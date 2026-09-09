import type { PortInfo } from './types';
import { isCriticalPort, isCriticalProcessName } from './taxonomy';

export type KillOutcome = 'killed' | 'failed' | 'critical' | 'busy';

// The frontend mirror of the backend kill policy lives in `./taxonomy` (kept
// in agreement with `src-tauri` via `shared/taxonomy.json`). Host-configured
// additional ports are enforced by the backend and returned as typed
// critical_process errors.
export function isCriticalProcess(port: PortInfo): boolean {
  return port.pid <= 1 || port.pid > 2147483647 || isCriticalPort(port.port) || isCriticalProcessName(port.process_name);
}
