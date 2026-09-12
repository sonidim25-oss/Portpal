import { useEffect, useState } from 'react';
import type { PortInfo, TrafficSample } from '../../app/types';
import { Button, IconButton } from '../../components/ui/controls';
import { PortInfoCard } from '../../port-intel';
import { tauriPortPalGateway, type PortPalGateway } from '../../lib/tauri';
import { buildInspectorModel, type InspectorDetail } from './portInspectorModel';
import './PortInspector.css';

export type PortInspectorProps = {
  port: PortInfo;
  traffic: TrafficSample[];
  observedAt?: number;
  killed: boolean;
  killing: ReadonlySet<number>;
  restarting: ReadonlySet<number>;
  onClose: () => void;
  onKill: (port: PortInfo) => void;
  onRestart: (port: PortInfo) => void;
  now?: number;
  gateway?: PortPalGateway;
};

type InspectorSectionProps = {
  title: string;
  rows: InspectorDetail[];
  children?: React.ReactNode;
};

function InspectorSection({ title, rows, children }: InspectorSectionProps) {
  const headingId = `port-inspector-${title.toLowerCase()}`;

  return (
    <section className="port-inspector__section" aria-labelledby={headingId}>
      <h3 id={headingId} className="port-inspector__section-title">
        {title}
      </h3>
      {rows.length > 0 && (
        <dl className="port-inspector__details">
          {rows.map((row) => (
            <div className="port-inspector__detail" key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.mono ? 'port-inspector__value--mono' : undefined}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </section>
  );
}

export function PortInspector({
  port,
  traffic,
  observedAt,
  killed,
  killing,
  restarting,
  onClose,
  onKill,
  onRestart,
  now = Date.now(),
  gateway = tauriPortPalGateway,
}: PortInspectorProps) {
  // Environment variables are fetched only when the user opens the disclosure,
  // never on selection. A process environment routinely holds credentials —
  // tokens, connection strings with passwords — so it crosses the IPC boundary
  // when someone asks to read it, not every time a row is clicked.
  const [envState, setEnvState] = useState<{
    pid: number;
    status: 'idle' | 'loading' | 'loaded';
    data: Record<string, string> | null;
  }>({
    pid: port.pid,
    status: 'idle',
    data: null,
  });

  // Selecting a different port discards the previous process's variables and
  // closes the disclosure, so an open panel never shows one process's
  // environment under another's pid.
  useEffect(() => {
    setEnvState({ pid: port.pid, status: 'idle', data: null });
  }, [port.pid]);

  const requestEnv = (pid: number) => {
    if (envState.status !== 'idle' || envState.pid !== pid) return;
    setEnvState({ pid, status: 'loading', data: null });

    const settle = (data: Record<string, string> | null) =>
      // The pid guard drops a response that arrives after the user moved on.
      setEnvState((current) => (current.pid === pid ? { pid, status: 'loaded', data } : current));

    gateway
      .getProcessEnv(pid)
      .then(settle)
      .catch(() => settle(null));
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const connections = traffic[traffic.length - 1]?.connections ?? 0;
  const currentEnv =
    envState.pid === port.pid && envState.status === 'loaded' ? envState.data : undefined;
  const model = buildInspectorModel({
    port,
    connections,
    observedAt,
    now,
    killed,
    env: currentEnv,
  });
  const pending = killing.has(port.pid) || restarting.has(port.pid);
  const projectRows: InspectorDetail[] = model.project
    ? [
        ...(model.project.name ? [{ label: 'Name', value: model.project.name, mono: false }] : []),
        ...(model.project.path ? [{ label: 'Path', value: model.project.path, mono: true }] : []),
      ]
    : [];
  const processRows: InspectorDetail[] = model.process
    ? [
        { label: 'Name', value: model.process.name, mono: true },
        ...(model.process.command
          ? [{ label: 'Command', value: model.process.command, mono: true }]
          : []),
        ...(model.process.cwd ? [{ label: 'CWD', value: model.process.cwd, mono: true }] : []),
      ]
    : [];

  const envEntries = model.process?.env ? Object.entries(model.process.env) : [];
  // The summary carries the state, so a closed disclosure still says whether
  // there is anything behind it once it has been opened before.
  const envSummary =
    envState.status === 'loading'
      ? '…'
      : envState.status === 'loaded'
        ? model.process?.envUnavailable
          ? 'Restricted'
          : envEntries.length
        : '';

  return (
    <aside className="port-inspector" aria-label={`Port inspector for :${port.port}`}>
      <header className="port-inspector__header">
        <div>
          <p className="port-inspector__eyebrow">Port</p>
          <h2 className="port-inspector__title">:{port.port}</h2>
          <p className="port-inspector__subtitle">{model.title}</p>
        </div>
        <IconButton label="Close inspector" onClick={onClose} className="port-inspector__close">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m3 3 10 10M13 3 3 13" />
          </svg>
        </IconButton>
      </header>

      <div className="port-inspector__content">
        <PortInfoCard port={port} headingLevel="h3" className="port-inspector__intel" />
        <InspectorSection title="Overview" rows={model.overview} />
        {projectRows.length > 0 && <InspectorSection title="Project" rows={projectRows} />}
        {model.process && (
          <InspectorSection title="Process" rows={processRows}>
            <details
              className="port-inspector__env-details"
              key={port.pid}
              onToggle={(event) => {
                if (event.currentTarget.open) requestEnv(port.pid);
              }}
            >
              <summary className="port-inspector__env-summary">
                <span>Environment Variables</span>
                <span className="port-inspector__env-count">{envSummary}</span>
              </summary>
              <div className="port-inspector__env-list">
                {envState.status === 'loading' && (
                  <span className="port-inspector__env-restricted">Reading environment…</span>
                )}
                {envState.status === 'loaded' && model.process.envUnavailable && (
                  <span className="port-inspector__env-restricted">
                    Environment variables restricted by OS security policy.
                  </span>
                )}
                {envEntries.map(([key, val]) => (
                  <div className="port-inspector__env-item" key={key}>
                    <span className="port-inspector__env-key">{key}</span>
                    <span className="port-inspector__env-val">{val}</span>
                  </div>
                ))}
              </div>
            </details>
          </InspectorSection>
        )}
      </div>

      {(model.actions.canKill || model.actions.canRestart) && (
        <footer className="port-inspector__actions">
          {model.actions.canRestart && (
            <Button
              onClick={() => onRestart(port)}
              disabled={pending}
              className="port-inspector__action"
            >
              Restart Process
            </Button>
          )}
          {model.actions.canKill && (
            <Button
              variant="danger"
              onClick={() => onKill(port)}
              disabled={pending}
              className="port-inspector__action port-inspector__action--kill"
            >
              Kill Process
            </Button>
          )}
        </footer>
      )}
    </aside>
  );
}
