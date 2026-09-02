import { describe, it, expect } from 'vitest';
import { DEV_PORTS, getServiceName, getStatus, timeAgo, filterPorts, type PortInfo } from './helpers';

const basePort = (over: Partial<PortInfo> = {}): PortInfo => ({
  port: 3000,
  pid: 1234,
  process_name: 'node',
  project_name: null,
  project_path: null,
  protocol: 'TCP',
  start_cmd: null,
  ...over,
});

describe('DEV_PORTS', () => {
  it('maps known dev ports', () => {
    expect(DEV_PORTS[3000].label).toBe('React');
    expect(DEV_PORTS[5173].label).toBe('Vite');
    expect(DEV_PORTS[1420].label).toBe('Tauri');
    expect(DEV_PORTS[5432].label).toBe('Postgres');
  });
});

describe('getServiceName', () => {
  it('prefers project_name over DEV label', () => {
    const p = basePort({ port: 3000, project_name: 'MyApp' });
    expect(getServiceName(p)).toBe('MyApp');
  });
  it('uses DEV label Server when no project_name and is dev port', () => {
    expect(getServiceName(basePort({ port: 3000, project_name: null }))).toBe('React Server');
    expect(getServiceName(basePort({ port: 5173, project_name: null }))).toBe('Vite Server');
    expect(getServiceName(basePort({ port: 1420, project_name: null }))).toBe('Tauri Server');
  });
  it('falls back to process_name for unknown port', () => {
    const p = basePort({ port: 9999, process_name: 'custom.exe', project_name: null });
    expect(getServiceName(p)).toBe('custom.exe');
  });
});

describe('getStatus', () => {
  it('returns ACTIVE for dev ports', () => {
    expect(getStatus(basePort({ port: 3000 }))).toEqual({ label: 'ACTIVE', cls: 'status-active' });
    expect(getStatus(basePort({ port: 5173 }))).toEqual({ label: 'ACTIVE', cls: 'status-active' });
    expect(getStatus(basePort({ port: 1420 }))).toEqual({ label: 'ACTIVE', cls: 'status-active' });
  });
  it('returns ACTIVE for DB dev ports explicitly', () => {
    for (const p of [5432, 3306, 6379, 27017]) {
      expect(getStatus(basePort({ port: p }))).toEqual({ label: 'ACTIVE', cls: 'status-active' });
    }
  });
  it('returns LISTENING for non-dev port', () => {
    expect(getStatus(basePort({ port: 9999 }))).toEqual({ label: 'LISTENING', cls: 'status-listening' });
    expect(getStatus(basePort({ port: 49664 }))).toEqual({ label: 'LISTENING', cls: 'status-listening' });
  });
});

describe('timeAgo', () => {
  const now = 1_000_000_000_000;
  it('just now <5s', () => {
    expect(timeAgo(now - 0, now)).toBe('just now');
    expect(timeAgo(now - 4000, now)).toBe('just now');
  });
  it('seconds', () => {
    expect(timeAgo(now - 5000, now)).toBe('5s ago');
    expect(timeAgo(now - 59000, now)).toBe('59s ago');
  });
  it('minutes', () => {
    expect(timeAgo(now - 60_000, now)).toBe('1m ago');
    expect(timeAgo(now - 120_000, now)).toBe('2m ago');
    expect(timeAgo(now - 3599_000, now)).toBe('59m ago');
  });
  it('hours', () => {
    expect(timeAgo(now - 3600_000, now)).toBe('1h ago');
    expect(timeAgo(now - 7200_000, now)).toBe('2h ago');
  });
  it('days', () => {
    expect(timeAgo(now - 86400_000, now)).toBe('1d ago');
    expect(timeAgo(now - 172800_000, now)).toBe('2d ago');
  });
});

describe('filterPorts', () => {
  const ports: PortInfo[] = [
    basePort({ port: 3000, process_name: 'node', project_name: 'my-react' }),
    basePort({ port: 5173, process_name: 'node', project_name: null }),
    basePort({ port: 49664, process_name: 'lsass.exe', project_name: null }),
    basePort({ port: 5432, process_name: 'postgres.exe', project_name: null }),
  ];

  it('all returns all when no search', () => {
    expect(filterPorts(ports, '', 'all')).toHaveLength(4);
  });
  it('dev filter keeps only DEV_PORTS', () => {
    const dev = filterPorts(ports, '', 'dev');
    expect(dev.map((p) => p.port)).toEqual(expect.arrayContaining([3000, 5173, 5432]));
    expect(dev).toHaveLength(3);
  });
  it('other filter keeps non-DEV', () => {
    const other = filterPorts(ports, '', 'other');
    expect(other).toEqual([expect.objectContaining({ port: 49664 })]);
  });
  it('search by port substring', () => {
    expect(filterPorts(ports, '300', 'all')).toEqual([expect.objectContaining({ port: 3000 })]);
  });
  it('search by process_name case-insensitive', () => {
    expect(filterPorts(ports, 'LSASS', 'all')).toEqual([expect.objectContaining({ port: 49664 })]);
  });
  it('search by project_name', () => {
    expect(filterPorts(ports, 'my-react', 'all')).toEqual([expect.objectContaining({ port: 3000 })]);
  });
  it('search by DEV label', () => {
    expect(filterPorts(ports, 'react', 'all').map((p) => p.port)).toContain(3000);
    expect(filterPorts(ports, 'vite', 'all').map((p) => p.port)).toContain(5173);
  });
  it('trims and lowercases search', () => {
    expect(filterPorts(ports, '  REACT  ', 'all')).toHaveLength(1);
  });
  it('dev + search combined', () => {
    // search postgres in dev should return 5432, but postgres in other should not
    expect(filterPorts(ports, 'postgres', 'dev').map((p) => p.port)).toEqual([5432]);
    expect(filterPorts(ports, 'postgres', 'other')).toHaveLength(0);
  });
});
