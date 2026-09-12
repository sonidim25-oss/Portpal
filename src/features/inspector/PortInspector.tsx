import { useEffect } from 'react';
import type { PortInfo, TrafficSample } from '../../app/types';
import { Button, IconButton } from '../../components/ui/controls';
import { PortInfoCard } from '../../port-intel';
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
}: PortInspectorProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const connections = traffic[traffic.length - 1]?.connections ?? 0;
  const model = buildInspectorModel({ port, connections, observedAt, now, killed });
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
            {envEntries.length > 0 && (
              <details className="port-inspector__env-details">
                <summary className="port-inspector__env-summary">
                  <span>Environment Variables</span>
                  <span className="port-inspector__env-count">{envEntries.length}</span>
                </summary>
                <div className="port-inspector__env-list">
                  {envEntries.map(([key, val]) => (
                    <div className="port-inspector__env-item" key={key}>
                      <span className="port-inspector__env-key">{key}</span>
                      <span className="port-inspector__env-val">{val}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {model.process.envUnavailable && (
              <details className="port-inspector__env-details">
                <summary className="port-inspector__env-summary">
                  <span>Environment Variables</span>
                  <span className="port-inspector__env-count">Restricted</span>
                </summary>
                <div className="port-inspector__env-list">
                  <span className="port-inspector__env-restricted">
                    Environment variables restricted by OS security policy.
                  </span>
                </div>
              </details>
            )}
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
