import { describe, expect, it } from 'vitest';
import fixture from '../../shared/taxonomy.json';
import { CRITICAL_PORTS, CRITICAL_PROCESS_NAMES, isCriticalPort, isCriticalProcessName } from './taxonomy';
import { DEV_PORTS } from '../utils/helpers';

// Cross-language contract: this module and src-tauri/src/taxonomy.rs assert
// against the same shared/taxonomy.json fixture, so a protected service added
// on one side but missed on the other fails tests instead of silently
// weakening the kill guard.
describe('taxonomy fixture agreement', () => {
  it('critical ports match the shared fixture', () => {
    expect([...CRITICAL_PORTS]).toEqual(fixture.criticalPorts);
  });

  it('critical process names match the shared fixture', () => {
    expect([...CRITICAL_PROCESS_NAMES]).toEqual(fixture.criticalProcessNames);
  });

  it('matches every fixture name with optional .exe and any case, like the backend', () => {
    expect(isCriticalPort(5432)).toBe(true);
    for (const name of fixture.criticalProcessNames) {
      expect(isCriticalProcessName(name)).toBe(true);
      expect(isCriticalProcessName(`${name}.exe`)).toBe(true);
      expect(isCriticalProcessName(name.toUpperCase())).toBe(true);
    }
    expect(isCriticalPort(3000)).toBe(false);
    expect(isCriticalProcessName('node')).toBe(false);
    expect(isCriticalProcessName('postgres-helper')).toBe(false);
  });

  it('DEV_PORTS covers every fixture dev port', () => {
    for (const { port } of fixture.devPorts) {
      expect(DEV_PORTS[port], `DEV_PORTS missing fixture dev port ${port}`).toBeDefined();
    }
  });
});
