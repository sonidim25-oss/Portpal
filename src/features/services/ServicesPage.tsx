import { useMemo } from 'react';
import type { PortInfo, TrafficByPort } from '../../app/types';
import { Sparkline } from '../../components/ui/Sparkline';
import { groupPortsByService, portEndpointKey } from '../../utils/helpers';
import { ErrorNotice } from '../ErrorNotice';
import { LoadingState } from '../../components/ui/controls';

interface ServicesPageProps {
  ports: PortInfo[];
  traffic: TrafficByPort;
  loading: boolean;
  /// The grouping is derived entirely from a scan, so a failed scan must not
  /// be presented as "no services running".
  error: string | null;
  onRetry(): void;
}

export function ServicesPage({ ports, traffic, loading, error, onRetry }: ServicesPageProps) {
  const groups = useMemo(() => groupPortsByService(ports), [ports]);

  return (
    <div className="secondary-page secondary-column-page">
      <header className="secondary-heading"><h2>Services</h2><p>{groups.length} service{groups.length === 1 ? '' : 's'} running across {ports.length} port{ports.length === 1 ? '' : 's'}</p></header>
      {error && <ErrorNotice message={error} retryLabel="Retry services" onRetry={onRetry} />}
      {groups.length === 0 && error ? null : groups.length === 0 && loading ? <LoadingState label="Scanning services…" /> : groups.length === 0 ? <div className="secondary-empty"><strong>No services running</strong><span>Start a server to see it here</span></div> : (
        <div className="secondary-services-grid">
          {groups.map((group) => {
            const total = group.ports.reduce((sum, port) => {
              const samples = traffic[port.port] ?? [];
              return sum + (samples[samples.length - 1]?.connections ?? 0);
            }, 0);
            const merged: number[] = [];
            for (const port of group.ports) (traffic[port.port] ?? []).forEach((sample, index) => { merged[index] = (merged[index] ?? 0) + sample.connections; });
            return (
              <article key={group.key} className="secondary-service" aria-label={`${group.name} service`}>
                <div className="secondary-row-heading"><div><h3>{group.name}</h3><p>{group.ports.length} port{group.ports.length === 1 ? '' : 's'} · {total} conn{total === 1 ? '' : 's'}</p></div><span className="secondary-state">Running</span></div>
                <Sparkline data={merged} width={200} height={32} />
                <div className="secondary-list">
                  {group.ports.map((port) => <div key={portEndpointKey(port)} className="secondary-service-port"><span className="secondary-mono">:{port.port}</span><span>{port.process_name}</span><span className="secondary-time">PID {port.pid}</span></div>)}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
