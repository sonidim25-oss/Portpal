import type { NavPage, PortEvent, PortInfo, TrafficByPort } from '../../app/types';
import { Sparkline } from '../../components/ui/Sparkline';
import {
  DEV_PORTS,
  getServiceName,
  getServiceSecondary,
  portEndpointKey,
  timeAgo,
} from '../../utils/helpers';
import { ErrorNotice } from '../ErrorNotice';

interface DashboardPageProps {
  ports: PortInfo[];
  events: PortEvent[];
  traffic: TrafficByPort;
  /// Every tile here is derived from a backend call, so a failed call would
  /// otherwise read as a confident zero. Retry refreshes all three sources.
  error: string | null;
  onRetry(): void;
  onNavigate(page: NavPage): void;
}

export function DashboardPage({
  ports,
  events,
  traffic,
  error,
  onRetry,
  onNavigate,
}: DashboardPageProps) {
  const frameworks = new Set(ports.map((port) => DEV_PORTS[port.port]?.label).filter(Boolean));
  const connections = Object.values(traffic).reduce(
    (total, samples) => total + (samples[samples.length - 1]?.connections ?? 0),
    0,
  );
  const eventsToday = events.filter((event) => Date.now() - event.timestamp < 86_400_000).length;

  return (
    <div className="secondary-page secondary-dashboard">
      <PageHeading title="Dashboard" description="Overview of your port activity" />
      {error && <ErrorNotice message={error} retryLabel="Retry dashboard" onRetry={onRetry} />}
      <div className="secondary-summary-grid">
        <Summary label="Active Ports" value={ports.length} onClick={() => onNavigate('ports')} />
        <Summary label="Frameworks" value={frameworks.size} />
        <Summary label="Connections" value={connections} />
        <Summary label="Events Today" value={eventsToday} onClick={() => onNavigate('logs')} />
      </div>

      <section className="secondary-section">
        <SectionHeading title="Active Services" onViewAll={() => onNavigate('ports')} />
        <div className="secondary-dashboard-services">
          {ports.slice(0, 6).map((port) => (
            <article key={portEndpointKey(port)} className="secondary-dashboard-service">
              <div className="secondary-row-heading">
                <span className="secondary-mono">:{port.port}</span>
                <span className="secondary-state">Active</span>
              </div>
              <div className="secondary-muted">{getServiceName(port)}</div>
              {getServiceSecondary(port) && (
                <div className="secondary-muted">{getServiceSecondary(port)}</div>
              )}
              <Sparkline
                data={(traffic[port.port] ?? []).map((sample) => sample.connections)}
                width={100}
                height={24}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="secondary-section">
        <SectionHeading title="Recent Events" onViewAll={() => onNavigate('logs')} />
        {events.length === 0 ? (
          <p className="secondary-empty-copy">No events yet — start a server to see activity</p>
        ) : (
          <div className="secondary-list">
            {events.slice(0, 5).map((event, index) => (
              <div key={`${event.timestamp}-${index}`} className="secondary-event-row">
                <span className="secondary-mono">:{event.port}</span>
                <span>{event.process_name}</span>
                <span className="secondary-state">{event.event_type}</span>
                <span className="secondary-time">{timeAgo(event.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="secondary-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function Summary({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="secondary-summary-value">{value}</span>
      <span className="secondary-summary-label">{label}</span>
    </>
  );
  return onClick ? (
    <button className="secondary-summary secondary-summary-button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="secondary-summary">{content}</div>
  );
}

function SectionHeading({ title, onViewAll }: { title: string; onViewAll(): void }) {
  return (
    <div className="secondary-section-heading">
      <h3>{title}</h3>
      <button onClick={onViewAll} aria-label="View all">
        View all <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
