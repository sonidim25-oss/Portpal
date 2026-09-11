import { describe, it, expect } from 'vitest';
import {
  DEV_PORTS,
  classifyPort,
  countPortsByCategory,
  filterPorts,
  getServiceGroupKey,
  getServiceName,
  getServiceSecondary,
  getStatus,
  groupPortsByService,
  isSystemServicePort,
  latestConnectionCount,
  portEndpointKey,
  timeAgo,
  uniqueProcessCount,
} from './helpers';
import type { PortInfo } from '../app/types';

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
  it('prefers the service label for system ports even when a project_name leaks', () => {
    // Postgres started from a project folder still reads as Postgres primary.
    expect(
      getServiceName(basePort({ port: 5432, process_name: 'postgres', project_name: 'myapp' })),
    ).toBe('Postgres Server');
    expect(
      getServiceName(basePort({ port: 3306, process_name: 'mysqld', project_name: 'shop' })),
    ).toBe('MySQL Server');
    expect(
      getServiceName(basePort({ port: 6379, process_name: 'redis-server', project_name: 'shop' })),
    ).toBe('Redis Server');
  });
});

describe('service naming precedence', () => {
  it('marks well-known infrastructure ports as system services', () => {
    for (const port of [22, 80, 443, 3306, 5432, 6379, 27017]) {
      expect(isSystemServicePort(basePort({ port }))).toBe(true);
    }
    expect(isSystemServicePort(basePort({ port: 3000 }))).toBe(false);
    expect(isSystemServicePort(basePort({ port: 5173 }))).toBe(false);
  });
  it('returns the folder as secondary for system services and the framework for dev projects', () => {
    expect(
      getServiceSecondary(
        basePort({ port: 5432, process_name: 'postgres', project_name: 'myapp' }),
      ),
    ).toBe('myapp');
    expect(getServiceSecondary(basePort({ port: 3000, project_name: 'myapp' }))).toBe('React');
    expect(getServiceSecondary(basePort({ port: 3000, project_name: null }))).toBeNull();
    expect(
      getServiceSecondary(basePort({ port: 9999, process_name: 'custom.exe', project_name: null })),
    ).toBeNull();
  });
  it('never misclassifies system services as dev when project metadata leaks', () => {
    expect(
      classifyPort(
        basePort({
          port: 5432,
          process_name: 'postgres',
          project_name: 'myapp',
          project_path: 'C:\\work\\myapp',
        }),
      ),
    ).toBe('system');
    expect(
      classifyPort(
        basePort({ port: 49664, process_name: 'lsass.exe', project_path: 'C:\\Windows' }),
      ),
    ).toBe('system');
    expect(classifyPort(basePort({ port: 3000, project_name: 'myapp' }))).toBe('dev');
  });
});

describe('endpoint identity', () => {
  it('derives distinct keys for conflicting listeners on the same port', () => {
    const a = basePort({ port: 3000, pid: 111 });
    const b = basePort({ port: 3000, pid: 222 });
    expect(portEndpointKey(a)).toBe('111-3000');
    expect(portEndpointKey(b)).toBe('222-3000');
    expect(portEndpointKey(a)).not.toBe(portEndpointKey(b));
  });
});

describe('groupPortsByService', () => {
  it('merges listeners from the same project folder', () => {
    const groups = groupPortsByService([
      basePort({ port: 3000, pid: 101, project_name: 'shop', project_path: '/shop' }),
      basePort({ port: 3001, pid: 102, project_name: 'shop', project_path: '/shop' }),
      basePort({ port: 5432, pid: 103, process_name: 'postgres' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('shop');
    expect(groups[0].ports).toHaveLength(2);
  });
  it('never merges a folder named like a system service with the real service', () => {
    const groups = groupPortsByService([
      basePort({
        port: 3000,
        pid: 101,
        process_name: 'node',
        project_name: 'Postgres',
        project_path: '/work/postgres-demo',
      }),
      basePort({ port: 5432, pid: 103, process_name: 'postgres', project_name: null }),
    ]);
    expect(groups).toHaveLength(2);
    expect(getServiceGroupKey(groups[0].ports[0])).not.toBe(getServiceGroupKey(groups[1].ports[0]));
    // Same display string is disambiguated so both groups stay addressable.
    expect(groups.map((g) => g.name).sort()).toEqual(['Postgres :3000', 'Postgres :5432']);
  });
  it('keeps conflicting listeners on a system port in one group with distinct rows', () => {
    const groups = groupPortsByService([
      basePort({ port: 5432, pid: 103, process_name: 'postgres' }),
      basePort({ port: 5432, pid: 104, process_name: 'postgres' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ports).toHaveLength(2);
    const keys = groups[0].ports.map(portEndpointKey);
    expect(new Set(keys).size).toBe(2);
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
    expect(getStatus(basePort({ port: 9999 }))).toEqual({
      label: 'LISTENING',
      cls: 'status-listening',
    });
    expect(getStatus(basePort({ port: 49664 }))).toEqual({
      label: 'LISTENING',
      cls: 'status-listening',
    });
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
  it('dev filter keeps project and known developer ports', () => {
    const dev = filterPorts(ports, '', 'dev');
    expect(dev.map((p) => p.port)).toEqual(expect.arrayContaining([3000, 5173]));
    expect(dev).toHaveLength(2);
  });
  it('system filter keeps infrastructure ports', () => {
    const system = filterPorts(ports, '', 'system');
    expect(system.map((p) => p.port)).toEqual([49664, 5432]);
  });
  it('other filter excludes developer and system ports', () => {
    expect(filterPorts(ports, '', 'other')).toEqual([]);
  });
  it('search by port substring', () => {
    expect(filterPorts(ports, '300', 'all')).toEqual([expect.objectContaining({ port: 3000 })]);
  });
  it('search by process_name case-insensitive', () => {
    expect(filterPorts(ports, 'LSASS', 'all')).toEqual([expect.objectContaining({ port: 49664 })]);
  });
  it('search by project_name', () => {
    expect(filterPorts(ports, 'my-react', 'all')).toEqual([
      expect.objectContaining({ port: 3000 }),
    ]);
  });
  it('trims and lowercases search', () => {
    expect(filterPorts(ports, '  my-react  ', 'all')).toHaveLength(1);
  });
  it('system + search combined', () => {
    expect(filterPorts(ports, 'postgres', 'system').map((p) => p.port)).toEqual([5432]);
    expect(filterPorts(ports, 'postgres', 'other')).toHaveLength(0);
  });
});

describe('port presentation selectors', () => {
  const ports: PortInfo[] = [
    basePort({
      port: 3000,
      project_name: 'PortPal',
      project_path: 'C:\\work\\PortPal',
      start_cmd: 'npm run dev',
    }),
    basePort({ port: 5173 }),
    basePort({ port: 5432, process_name: 'postgres' }),
    basePort({ port: 49664, process_name: 'lsass.exe' }),
  ];

  it('classifies project ports as dev and infrastructure as system', () => {
    expect(classifyPort(basePort({ port: 5173, project_name: 'PortPal' }))).toBe('dev');
    expect(classifyPort(basePort({ port: 5432, process_name: 'postgres' }))).toBe('system');
    expect(classifyPort(basePort({ port: 49664, process_name: 'lsass.exe' }))).toBe('system');
    expect(classifyPort(basePort({ port: 9229, process_name: 'node' }))).toBe('other');
  });

  it('searches project path, protocol, and start command', () => {
    const port = basePort({
      port: 5173,
      project_path: 'C:\\work\\PortPal',
      protocol: 'TCP',
      start_cmd: 'npm run dev',
    });
    expect(filterPorts([port], 'portpal', 'all')).toEqual([port]);
    expect(filterPorts([port], 'tcp', 'all')).toEqual([port]);
    expect(filterPorts([port], 'npm run', 'all')).toEqual([port]);
  });

  it('counts all, dev, system, and other from the same classifier', () => {
    expect(countPortsByCategory(ports)).toEqual({ all: 4, dev: 2, system: 2, other: 0 });
  });

  it('applies advanced protocol, project, restartability, and connection filters', () => {
    const restartablePort = ports[0];
    const connectedPort = ports[1];
    const traffic = {
      [connectedPort.port]: [{ connections: 3, timestamp: 2 }],
      [restartablePort.port]: [{ connections: 0, timestamp: 1 }],
    };

    expect(
      filterPorts(ports, '', 'all', {
        protocol: 'TCP',
        project: 'with-project',
        restartableOnly: false,
        connectedOnly: false,
      }),
    ).toEqual([restartablePort]);
    expect(
      filterPorts(ports, '', 'all', {
        protocol: 'all',
        project: 'all',
        restartableOnly: true,
        connectedOnly: false,
      }),
    ).toEqual([restartablePort]);
    expect(
      filterPorts(
        ports,
        '',
        'all',
        { protocol: 'all', project: 'all', restartableOnly: false, connectedOnly: true },
        traffic,
      ),
    ).toEqual([connectedPort]);
  });

  it('returns the most recent connection count and unique process count', () => {
    expect(
      latestConnectionCount(
        {
          3000: [
            { connections: 1, timestamp: 1 },
            { connections: 4, timestamp: 2 },
          ],
        },
        basePort(),
      ),
    ).toBe(4);
    expect(latestConnectionCount({}, basePort())).toBe(0);
    expect(
      uniqueProcessCount([
        basePort({ pid: 1, process_name: 'node' }),
        basePort({ pid: 2, process_name: 'node' }),
        basePort({ pid: 3, process_name: 'python' }),
      ]),
    ).toBe(2);
  });
});
