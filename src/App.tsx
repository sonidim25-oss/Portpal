import { useEffect, useState } from 'react';
import './features/secondary-pages.css';
import { usePortPalData } from './app/usePortPalData';
import type { NavPage } from './app/types';
import { AppShell } from './components/shell/AppShell';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { LogsPage } from './features/logs/LogsPage';
// MVP: Port Map hidden - preserved in src/features/port-map/PortMapPage.tsx
// import { PortMapPage } from './features/port-map/PortMapPage';
import { PortsPage } from './features/ports/PortsPage';
import { ServicesPage } from './features/services/ServicesPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TrafficPage } from './features/traffic/TrafficPage';

const FONT_SCALE_KEY = 'portpal.fontScale';
const FONT_SCALES = [1, 1.15, 1.3];

function loadFontScale(): number {
  try {
    const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
    if (FONT_SCALES.includes(saved)) return saved;
  } catch {}
  return 1;
}

export default function App() {
  const [page, setPage] = useState<NavPage>('ports');
  const [fontScale, setFontScale] = useState(loadFontScale);
  const {
    ports, events, traffic, killedPorts, killing, restarting, observedAt,
    lastScanAt, loading, eventsLoading, errors, toast, refreshPorts, refreshEvents,
    refreshTraffic, killPort, restartPort,
  } = usePortPalData();

  // Pages that only derive from backend data still have to report the failure
  // behind what they are showing, or a failed scan reads as a confident zero.
  // Each page reports the first failure among the sources it renders, and its
  // retry refreshes exactly those sources.
  const refreshPortsAndTraffic = () => { void refreshPorts(); void refreshTraffic(); };
  const refreshEverything = () => { refreshPortsAndTraffic(); void refreshEvents(); };

  useEffect(() => {
    document.documentElement.style.setProperty('--fs-scale', String(fontScale));
    try { localStorage.setItem(FONT_SCALE_KEY, String(fontScale)); } catch {}
  }, [fontScale]);

  return (
    <>
      <AppShell page={page} onNavigate={setPage} ports={ports} lastScanAt={lastScanAt}>
        {page === 'dashboard' && <DashboardPage ports={ports} events={events} traffic={traffic} error={errors.ports ?? errors.events ?? errors.traffic} onRetry={refreshEverything} onNavigate={setPage} />}
        {page === 'ports' && <PortsPage ports={ports} traffic={traffic} observedAt={observedAt} killedPorts={killedPorts} killing={killing} restarting={restarting} loading={loading} error={errors.ports} onRetry={refreshPorts} onKill={killPort} onRestart={restartPort} onOpenMap={() => setPage('map')} />}
        {page === 'traffic' && <TrafficPage ports={ports} traffic={traffic} loading={loading} error={errors.traffic ?? errors.ports} onRetry={refreshPortsAndTraffic} />}
        {/* MVP: Port Map hidden - code preserved, route disabled */}
        {/* {page === 'map' && <PortMapPage ports={ports} traffic={traffic} observedAt={observedAt} killedPorts={killedPorts} killing={killing} restarting={restarting} onKill={killPort} onRestart={restartPort} onClose={() => setPage('ports')} />} */}
        {page === 'services' && <ServicesPage ports={ports} traffic={traffic} loading={loading} error={errors.ports ?? errors.traffic} onRetry={refreshPortsAndTraffic} />}
        {page === 'logs' && <LogsPage events={events} loading={eventsLoading} error={errors.events} onRefresh={refreshEvents} />}
        {page === 'settings' && <SettingsPage fontScale={fontScale} onFontScale={setFontScale} />}
      </AppShell>
      {/* Single slot, latest-wins: see showToast in usePortPalData. */}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
