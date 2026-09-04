import { useEffect, useState, useMemo } from "react";
import "./App.css";
import PortMap from "./PortMap";
import { AppShell } from "./components/shell/AppShell";
import type { NavPage, PortEvent, PortInfo, TrafficByPort } from "./app/types";
import { usePortPalData } from "./app/usePortPalData";
import { PortsPage } from "./features/ports/PortsPage";
import { DEV_PORTS, getServiceName, timeAgo } from "./utils/helpers";

/* Multipliers for --fs-scale, the root of the type scale in App.css. */
const TEXT_SIZES = [
  { label: "Standard", value: 1 },
  { label: "Large", value: 1.15 },
  { label: "Larger", value: 1.3 },
];
const FONT_SCALE_KEY = "portpal.fontScale";

function loadFontScale(): number {
  try {
    const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
    if (TEXT_SIZES.some((s) => s.value === saved)) return saved;
  } catch {}
  return 1;
}
/* ── Sparkline mini-chart ── */
function Sparkline({ data, color, width = 64, height = 20 }: {
  data: number[]; color: string; width?: number; height?: number;
}) {
  if (data.length < 2) {
    return <div className="sparkline-empty" style={{ width, height }} />;
  }
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="sparkline">
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts} ${width},${height}`}
        fill={`url(#sg-${color.replace("#","")})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<NavPage>("ports");
  const [fontScale, setFontScale] = useState<number>(loadFontScale);
  const {
    ports,
    events,
    traffic,
    killedPorts,
    killing,
    restarting,
    observedAt,
    lastScanAt,
    loading,
    errors,
    toast,
    refreshPorts,
    refreshEvents,
    killPort,
    restartPort,
  } = usePortPalData();

  useEffect(() => {
    document.documentElement.style.setProperty("--fs-scale", String(fontScale));
    try { localStorage.setItem(FONT_SCALE_KEY, String(fontScale)); } catch {}
  }, [fontScale]);

  const fwSet = new Set(ports.map((p) => DEV_PORTS[p.port]?.label).filter(Boolean));
  const activeConns = Object.values(traffic).reduce((sum, samples) => {
    const last = samples[samples.length - 1];
    return sum + (last?.connections ?? 0);
  }, 0);

  return (
    <>
      <AppShell page={page} onNavigate={setPage} ports={ports} lastScanAt={lastScanAt}>
          {/* ════════ DASHBOARD ════════ */}
          {page === "dashboard" && (
            <DashboardPage
              ports={ports}
              events={events}
              traffic={traffic}
              fwSet={fwSet}
              activeConns={activeConns}
              onNavigate={setPage}
            />
          )}

          {/* ════════ PORTS ════════ */}
          {page === "ports" && (
            <PortsPage
              ports={ports}
              traffic={traffic}
              observedAt={observedAt}
              killedPorts={killedPorts}
              killing={killing}
              restarting={restarting}
              loading={loading}
              error={errors.ports}
              onRetry={refreshPorts}
              onKill={killPort}
              onRestart={restartPort}
              onOpenMap={() => setPage("map")}
            />
          )}

          {/* ════════ TRAFFIC ════════ */}
          {page === "traffic" && <TrafficPage ports={ports} traffic={traffic} />}

          {/* ════════ PORT MAP ════════ */}
          {page === "map" && <PortMap onClose={() => setPage("ports")} />}

          {/* ════════ SERVICES ════════ */}
          {page === "services" && <ServicesPage ports={ports} traffic={traffic} />}

          {/* ════════ LOGS ════════ */}
          {page === "logs" && <LogsPage events={events} onRefresh={refreshEvents} />}

          {/* ════════ SETTINGS ════════ */}
          {page === "settings" && (
            <SettingsPage fontScale={fontScale} onFontScale={setFontScale} />
          )}
      </AppShell>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/* ══════════════════════════════════════════════
   SETTINGS PAGE
   ══════════════════════════════════════════════ */
function SettingsPage({ fontScale, onFontScale }: {
  fontScale: number; onFontScale: (v: number) => void;
}) {
  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        <p className="settings-sub">Appearance &amp; accessibility</p>
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-label">Text size</div>
            <div className="settings-hint">Scales every label, table and badge in PortPal.</div>
          </div>
          <div className="size-group" role="group" aria-label="Text size">
            {TEXT_SIZES.map((size) => (
              <button
                key={size.label}
                className={`size-btn${fontScale === size.value ? " active" : ""}`}
                aria-pressed={fontScale === size.value}
                onClick={() => onFontScale(size.value)}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-preview">
          <span className="settings-preview-port">:3000</span>
          <span className="settings-preview-name">vite — my-app</span>
          <span className="status-badge status-active">ACTIVE</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   DASHBOARD PAGE
   ══════════════════════════════════════════════ */
function DashboardPage({ ports, events, traffic, fwSet, activeConns, onNavigate }: {
  ports: PortInfo[];
  events: PortEvent[];
  traffic: TrafficByPort;
  fwSet: Set<string>;
  activeConns: number;
  onNavigate: (page: NavPage) => void;
}) {
  const recentEvents = events.slice(0, 5);

  return (
    <div className="dashboard">
      <h2 className="dash-title">Dashboard</h2>
      <p className="dash-sub">Overview of your port activity</p>

      {/* Stat cards */}
      <div className="stat-grid">
        <StatCard label="Active Ports" value={ports.length} icon="⚡" color="#22c55e" onClick={() => onNavigate("ports")} />
        <StatCard label="Frameworks" value={fwSet.size} icon="🧩" color="#7c6fff" />
        <StatCard label="Connections" value={activeConns} icon="🔗" color="#3b82f6" onClick={() => onNavigate("map")} />
        <StatCard label="Events Today" value={events.filter(e => Date.now() - e.timestamp < 86400000).length} icon="📋" color="#eab308" onClick={() => onNavigate("logs")} />
      </div>

      {/* Active services */}
      <div className="dash-section">
        <div className="dash-section-header">
          <h3>Active Services</h3>
          <button className="dash-link" onClick={() => onNavigate("ports")}>View all →</button>
        </div>
        <div className="dash-services">
          {ports.slice(0, 6).map((p) => {
            const dev = DEV_PORTS[p.port];
            const samples = traffic[p.port] || [];
            const sparkData = samples.map(s => s.connections);
            return (
              <div key={p.port} className="dash-svc-card">
                <div className="dash-svc-top">
                  <span className="dash-svc-port" style={{ color: dev?.color ?? "#7c6fff" }}>:{p.port}</span>
                  <span className="status-badge status-active" style={{ fontSize: "var(--fs-3xs)", padding: "2px 5px" }}>ACTIVE</span>
                </div>
                <div className="dash-svc-name">{getServiceName(p)}</div>
                <Sparkline data={sparkData} color={dev?.color ?? "#7c6fff"} width={100} height={24} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent events */}
      <div className="dash-section">
        <div className="dash-section-header">
          <h3>Recent Events</h3>
          <button className="dash-link" onClick={() => onNavigate("logs")}>View all →</button>
        </div>
        {recentEvents.length === 0 ? (
          <p className="dash-empty">No events yet — start a server to see activity</p>
        ) : (
          <div className="dash-events">
            {recentEvents.map((ev, i) => (
              <div key={`${ev.timestamp}-${i}`} className="dash-event-row">
                <span className={`ev-dot ${ev.event_type === "started" ? "ev-green" : "ev-red"}`} />
                <span className="ev-port">:{ev.port}</span>
                <span className="ev-name">{ev.process_name}</span>
                <span className={`ev-type ${ev.event_type}`}>{ev.event_type}</span>
                <span className="ev-time">{timeAgo(ev.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, onClick }: {
  label: string; value: number; icon: string; color: string; onClick?: () => void;
}) {
  return (
    <div className="stat-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <div className="stat-icon" style={{ background: `${color}18`, color }}>{icon}</div>
      <div className="stat-info">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   LOGS PAGE
   ══════════════════════════════════════════════ */
function LogsPage({ events, onRefresh }: { events: PortEvent[]; onRefresh: () => void }) {
  return (
    <div className="logs-page">
      <div className="logs-header">
        <div>
          <h2>Event Logs</h2>
          <p className="logs-sub">{events.length} event{events.length !== 1 ? "s" : ""} recorded</p>
        </div>
        <button className="logs-refresh" onClick={onRefresh}>↻ Refresh</button>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-ring" />
          <span>No events yet</span>
          <span className="empty-sub">Port start and stop events will appear here</span>
        </div>
      ) : (
        <div className="logs-list">
          {events.map((ev, i) => (
            <div key={`${ev.timestamp}-${i}`} className="log-row">
              <div className="log-left">
                <span className={`log-dot ${ev.event_type === "started" ? "ev-green" : "ev-red"}`} />
                <div className="log-info">
                  <div className="log-main">
                    <span className="log-port">:{ev.port}</span>
                    <span className="log-process">{ev.process_name}</span>
                    {ev.framework && (
                      <span className="log-fw" style={{ color: DEV_PORTS[ev.port]?.color ?? "#7c6fff" }}>
                        {ev.framework}
                      </span>
                    )}
                  </div>
                  <div className="log-detail">
                    PID {ev.pid} · {ev.event_type === "started" ? "Service started" : "Service stopped"}
                  </div>
                </div>
              </div>
              <div className="log-right">
                <span className={`log-type-badge ${ev.event_type}`}>{ev.event_type}</span>
                <span className="log-time">{new Date(ev.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   TRAFFIC PAGE
   ══════════════════════════════════════════════ */
function TrafficPage({ ports, traffic }: { ports: PortInfo[]; traffic: TrafficByPort }) {
  const totalConns = Object.values(traffic).reduce((sum, samples) => {
    const last = samples[samples.length - 1];
    return sum + (last?.connections ?? 0);
  }, 0);

  const peakConns = Object.values(traffic).reduce((sum, samples) => {
    return sum + Math.max(0, ...samples.map(s => s.connections));
  }, 0);

  return (
    <div className="traffic-page">
      <div className="traffic-header">
        <div>
          <h2>Traffic Monitor</h2>
          <p className="traffic-page-sub">Real-time connection activity across all ports</p>
        </div>
      </div>

      {/* Overview stats */}
      <div className="traffic-stats">
        <div className="traf-stat">
          <div className="traf-stat-value">{ports.length}</div>
          <div className="traf-stat-label">Active Ports</div>
        </div>
        <div className="traf-stat">
          <div className="traf-stat-value">{totalConns}</div>
          <div className="traf-stat-label">Current Connections</div>
        </div>
        <div className="traf-stat">
          <div className="traf-stat-value">{peakConns}</div>
          <div className="traf-stat-label">Peak (Session)</div>
        </div>
      </div>

      {/* Per-port traffic cards */}
      {ports.length === 0 ? (
        <div className="empty-state">
          <div className="empty-ring" />
          <span>No active ports</span>
          <span className="empty-sub">Start a server to see traffic</span>
        </div>
      ) : (
        <div className="traffic-list">
          {ports.map((p) => {
            const dev = DEV_PORTS[p.port];
            const samples = traffic[p.port] || [];
            const sparkData = samples.map(s => s.connections);
            const current = sparkData[sparkData.length - 1] ?? 0;
            const peak = Math.max(0, ...sparkData);
            const color = dev?.color ?? "#7c6fff";

            return (
              <div key={p.port} className="traf-card">
                <div className="traf-card-left">
                  <div className="traf-card-header">
                    <span className="traf-port-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                    <span className="traf-port-num" style={{ color }}>:{p.port}</span>
                    <span className="traf-svc-name">{getServiceName(p)}</span>
                    {dev && (
                      <span className="fw-badge" style={{ "--fw-color": dev.color, fontSize: "var(--fs-2xs)", padding: "2px 6px" } as React.CSSProperties}>
                        <span className="fw-icon">{dev.icon}</span>
                        {dev.label}
                      </span>
                    )}
                  </div>
                  <div className="traf-card-stats">
                    <span className="traf-metric">
                      <span className="traf-metric-val">{current}</span>
                      <span className="traf-metric-label">current</span>
                    </span>
                    <span className="traf-metric-sep">·</span>
                    <span className="traf-metric">
                      <span className="traf-metric-val">{peak}</span>
                      <span className="traf-metric-label">peak</span>
                    </span>
                    <span className="traf-metric-sep">·</span>
                    <span className="traf-metric">
                      <span className="traf-metric-val">{samples.length}</span>
                      <span className="traf-metric-label">samples</span>
                    </span>
                  </div>
                </div>
                <div className="traf-card-chart">
                  <Sparkline data={sparkData} color={color} width={240} height={40} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
/* ══════════════════════════════════════════════
   SERVICES PAGE
   ══════════════════════════════════════════════ */
interface ServiceGroup {
  name: string;
  color: string;
  icon: string;
  ports: PortInfo[];
}

function ServicesPage({ ports, traffic }: { ports: PortInfo[]; traffic: TrafficByPort }) {
  // Group ports by project_name or framework
  const groups = useMemo(() => {
    const map = new Map<string, ServiceGroup>();

    for (const p of ports) {
      const dev = DEV_PORTS[p.port];
      const key = p.project_name ?? dev?.label ?? p.process_name;
      const existing = map.get(key);

      if (existing) {
        existing.ports.push(p);
      } else {
        map.set(key, {
          name: key,
          color: dev?.color ?? "#7c6fff",
          icon: dev?.icon ?? "📦",
          ports: [p],
        });
      }
    }

    // Sort: most ports first
    return [...map.values()].sort((a, b) => b.ports.length - a.ports.length);
  }, [ports]);

  return (
    <div className="services-page">
      <div className="services-header">
        <div>
          <h2>Services</h2>
          <p className="services-sub">{groups.length} service{groups.length !== 1 ? "s" : ""} running across {ports.length} port{ports.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-ring" />
          <span>No services running</span>
          <span className="empty-sub">Start a server to see it here</span>
        </div>
      ) : (
        <div className="services-grid">
          {groups.map((group) => {
            const totalConns = group.ports.reduce((sum, p) => {
              const samples = traffic[p.port] || [];
              return sum + (samples[samples.length - 1]?.connections ?? 0);
            }, 0);

            // Merge sparkline data from all ports in this group
            const mergedSpark: number[] = [];
            for (const p of group.ports) {
              const samples = traffic[p.port] || [];
              samples.forEach((s, i) => {
                mergedSpark[i] = (mergedSpark[i] || 0) + s.connections;
              });
            }

            return (
              <div key={group.name} className="svc-card" style={{ "--svc-color": group.color } as React.CSSProperties}>
                <div className="svc-card-header">
                  <div className="svc-card-icon">{group.icon}</div>
                  <div className="svc-card-info">
                    <div className="svc-card-name">{group.name}</div>
                    <div className="svc-card-meta">
                      {group.ports.length} port{group.ports.length !== 1 ? "s" : ""} · {totalConns} conn{totalConns !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span className="status-badge status-active" style={{ fontSize: "var(--fs-3xs)", padding: "2px 6px" }}>RUNNING</span>
                </div>

                <div className="svc-sparkline-wrap">
                  <Sparkline data={mergedSpark} color={group.color} width={200} height={32} />
                </div>

                <div className="svc-ports-list">
                  {group.ports.map((p) => (
                    <div key={p.port} className="svc-port-item">
                      <span className="svc-port-dot" style={{ background: group.color }} />
                      <span className="svc-port-num">:{p.port}</span>
                      <span className="svc-port-process">{p.process_name}</span>
                      <span className="svc-port-pid">PID {p.pid}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
