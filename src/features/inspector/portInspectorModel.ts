import type { PortInfo } from '../../app/types';

export type InspectorDetail = {
  label: string;
  value: string;
  mono: boolean;
};

export type InspectorProject = {
  name?: string;
  path?: string;
};

export type InspectorProcess = {
  name: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  envUnavailable?: boolean;
};

export type InspectorModel = {
  title: string;
  overview: InspectorDetail[];
  project?: InspectorProject;
  process?: InspectorProcess;
  actions: {
    canKill: boolean;
    canRestart: boolean;
  };
};

export type BuildInspectorModelInput = {
  port: PortInfo;
  connections: number;
  observedAt?: number;
  now: number;
  killed: boolean;
};

function observedAgo(observedAt: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - observedAt) / 1_000));
  if (elapsedSeconds < 60) return 'Observed just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Observed ${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Observed ${elapsedHours}h ago`;

  return `Observed ${Math.floor(elapsedHours / 24)}d ago`;
}

export function buildInspectorModel({
  port,
  connections,
  observedAt,
  now,
  killed,
}: BuildInspectorModelInput): InspectorModel {
  const overview: InspectorDetail[] = [
    { label: 'Port', value: `:${port.port}`, mono: true },
    { label: 'PID', value: String(port.pid), mono: true },
    { label: 'Protocol', value: port.protocol, mono: true },
    { label: 'Connections', value: String(connections), mono: true },
  ];

  if (observedAt !== undefined) {
    overview.push({ label: 'Started', value: observedAgo(observedAt, now), mono: false });
  }

  const project =
    port.project_name || port.project_path
      ? {
          ...(port.project_name ? { name: port.project_name } : {}),
          ...(port.project_path ? { path: port.project_path } : {}),
        }
      : undefined;
  const hasProcessInfo = port.process_name || port.start_cmd || port.cwd || port.env !== undefined;
  const process: InspectorProcess | undefined = hasProcessInfo
    ? {
        name: port.process_name,
        ...(port.start_cmd ? { command: port.start_cmd } : {}),
        ...(port.cwd ? { cwd: port.cwd } : {}),
        ...(port.env && Object.keys(port.env).length > 0 ? { env: port.env } : {}),
        envUnavailable: port.env === null,
      }
    : undefined;
  const restartable = Boolean(port.start_cmd && port.project_path);

  return {
    title: port.project_name ?? port.process_name,
    overview,
    ...(project ? { project } : {}),
    ...(process ? { process } : {}),
    actions: {
      canKill: !killed,
      canRestart: killed && restartable,
    },
  };
}
