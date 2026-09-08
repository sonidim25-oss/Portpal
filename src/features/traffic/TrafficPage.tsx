import type { PortInfo, TrafficByPort } from '../../app/types';
import { LoadingState } from '../../components/ui/controls';
import { Sparkline } from '../../components/ui/Sparkline';
import { DEV_PORTS, getServiceName, getServiceSecondary, portEndpointKey } from '../../utils/helpers';
import { ErrorNotice } from '../ErrorNotice';

interface TrafficPageProps {
  ports: PortInfo[];
  traffic: TrafficByPort;
  loading: boolean;
  /// Whichever failure explains what this page is showing: a traffic error
  /// makes the numbers stale, a port error makes the rows themselves stale.
  error: string | null;
  onRetry(): void;
}

export function TrafficPage({ ports, traffic, loading, error, onRetry }: TrafficPageProps) {
  const total = Object.values(traffic).reduce((sum, samples) => sum + (samples[samples.length - 1]?.connections ?? 0), 0);
  const peak = Object.values(traffic).reduce((sum, samples) => sum + Math.max(0, ...samples.map((sample) => sample.connections)), 0);

  return (
    <div className="secondary-page secondary-column-page">
      <header className="secondary-heading"><h2>Traffic Monitor</h2><p>Real-time connection activity across all ports</p></header>
      {error && <ErrorNotice message={error} retryLabel="Retry traffic" onRetry={onRetry} />}
      <div className="secondary-summary-grid secondary-summary-grid-three">
        <Summary label="Active Ports" value={ports.length} />
        <Summary label="Current Connections" value={total} />
        <Summary label="Peak (Session)" value={peak} />
      </div>
      {/* Loading, empty, and failed are three different answers: only claim
          there is nothing listening once a scan has actually come back. */}
      {ports.length === 0 && error ? null : ports.length === 0 && loading ? <LoadingState label="Reading traffic…" /> : ports.length === 0 ? <Empty title="No active ports" detail="Start a server to see traffic" /> : (
        <div className="secondary-list secondary-scroll-list" role="list">
          {ports.map((port) => {
            const samples = traffic[port.port] ?? [];
            const values = samples.map((sample) => sample.connections);
            return (
              <div key={portEndpointKey(port)} className="secondary-traffic-row" role="listitem" aria-label={`Port ${port.port} traffic`}>
                <div className="secondary-traffic-info">
                  <div className="secondary-row-heading">
                    <span className="secondary-mono">:{port.port}</span>
                    <span>{getServiceName(port)}</span>
                    {DEV_PORTS[port.port] && <span className="secondary-state">{DEV_PORTS[port.port].label}</span>}
                    {getServiceSecondary(port) && getServiceSecondary(port) !== DEV_PORTS[port.port]?.label && (
                      <span className="secondary-muted">{getServiceSecondary(port)}</span>
                    )}
                  </div>
                  <div className="secondary-metrics">
                    <Metric value={values[values.length - 1] ?? 0} label="current" />
                    <Metric value={Math.max(0, ...values)} label="peak" />
                    <Metric value={samples.length} label="samples" />
                  </div>
                </div>
                <Sparkline data={values} width={240} height={40} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="secondary-summary"><span className="secondary-summary-value">{value}</span><span className="secondary-summary-label">{label}</span></div>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <span><strong>{value}</strong> <small>{label}</small></span>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="secondary-empty"><strong>{title}</strong><span>{detail}</span></div>;
}
