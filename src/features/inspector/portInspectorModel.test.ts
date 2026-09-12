import { describe, expect, it } from 'vitest';
import { buildInspectorModel } from './portInspectorModel';
import type { PortInfo } from '../../app/types';

const port: PortInfo = {
  port: 3000,
  pid: 18344,
  process_name: 'node.exe',
  project_name: 'PortPal',
  project_path: 'C:\\work\\PortPal',
  protocol: 'TCP',
  start_cmd: 'npm run dev',
};

describe('buildInspectorModel', () => {
  it('builds available details from observed port data without inventing unsupported fields', () => {
    const model = buildInspectorModel({
      port,
      connections: 12,
      observedAt: 1_000,
      now: 121_000,
      killed: false,
    });

    expect(model.overview).toContainEqual({ label: 'PID', value: '18344', mono: true });
    expect(model.overview).toContainEqual({
      label: 'Started',
      value: 'Observed 2m ago',
      mono: false,
    });
    expect(model.overview).toContainEqual({ label: 'Connections', value: '12', mono: true });
    expect(model.project?.path).toBe('C:\\work\\PortPal');
    expect(model.process?.command).toBe('npm run dev');
    expect(JSON.stringify(model)).not.toMatch(/User|Local Address|Close Connections/);
  });

  it('omits unavailable details while retaining zero traffic and a restartable killed port', () => {
    const model = buildInspectorModel({
      port: { ...port, project_path: null, start_cmd: null },
      connections: 0,
      observedAt: undefined,
      now: 121_000,
      killed: true,
    });

    expect(model.overview).toContainEqual({ label: 'Connections', value: '0', mono: true });
    expect(model.overview.some((item) => item.label === 'Started')).toBe(false);
    expect(model.project).toEqual({ name: 'PortPal' });
    expect(model.process?.command).toBeUndefined();
    expect(model.actions).toEqual({ canKill: false, canRestart: false });
  });

  it('marks killed ports as restartable only when their recorded project and command are both available', () => {
    const model = buildInspectorModel({
      port,
      connections: 0,
      observedAt: 1_000,
      now: 1_000,
      killed: true,
    });

    expect(model.actions).toEqual({ canKill: false, canRestart: true });
  });

  it('includes cwd and environment variables in process model when present', () => {
    const model = buildInspectorModel({
      port: {
        ...port,
        cwd: 'C:\\work\\PortPal',
        env: { NODE_ENV: 'development', PORT: '3000' },
      },
      connections: 1,
      now: 1_000,
      killed: false,
    });

    expect(model.process?.cwd).toBe('C:\\work\\PortPal');
    expect(model.process?.env).toEqual({ NODE_ENV: 'development', PORT: '3000' });
    expect(model.process?.envUnavailable).toBe(false);
  });

  it('flags envUnavailable when env is explicitly null (restricted by OS)', () => {
    const model = buildInspectorModel({
      port: {
        ...port,
        env: null,
      },
      connections: 1,
      now: 1_000,
      killed: false,
    });

    expect(model.process?.envUnavailable).toBe(true);
    expect(model.process?.env).toBeUndefined();
  });
});
