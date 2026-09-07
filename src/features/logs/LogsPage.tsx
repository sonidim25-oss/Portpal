import type { PortEvent } from '../../app/types';

interface LogsPageProps { events: PortEvent[]; error: string | null; onRefresh(): void }

export function LogsPage({ events, error, onRefresh }: LogsPageProps) {
  return (
    <div className="secondary-page secondary-column-page">
      <header className="secondary-heading secondary-heading-actions">
        <div><h2>Event Logs</h2><p>{events.length} event{events.length === 1 ? '' : 's'} recorded</p></div>
        <button className="secondary-action" onClick={onRefresh} aria-label="Refresh logs">Refresh</button>
      </header>
      {error && <div className="secondary-error" role="alert"><span>{error}</span><button onClick={onRefresh} aria-label="Retry logs">Retry</button></div>}
      {events.length === 0 ? <div className="secondary-empty"><strong>No events yet</strong><span>Port start and stop events will appear here</span></div> : (
        <div className="secondary-list secondary-scroll-list">
          {events.map((event, index) => (
            <div key={`${event.timestamp}-${index}`} className="secondary-log-row">
              <div><div className="secondary-row-heading"><span className="secondary-mono">:{event.port}</span><span>{event.process_name}</span>{event.framework && <span className="secondary-state">{event.framework}</span>}</div><p>PID {event.pid} · Service {event.event_type}</p></div>
              <div className="secondary-log-meta"><span className="secondary-state">{event.event_type}</span><time>{new Date(event.timestamp).toLocaleTimeString()}</time></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
