import type { ReactNode } from "react";
import type { NavPage, PortInfo } from "../../app/types";
import { MonitoringStatus } from "./MonitoringStatus";

type SidebarProps = {
  page: NavPage;
  onNavigate: (page: NavPage) => void;
  ports: PortInfo[];
  lastScanAt: number | null;
};

type NavigationItem = {
  page: NavPage;
  label: string;
  icon: ReactNode;
};

const navigationItems: NavigationItem[] = [
  { page: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
  { page: "ports", label: "Ports", icon: <PortsIcon /> },
  { page: "traffic", label: "Traffic", icon: <TrafficIcon /> },
  { page: "services", label: "Services", icon: <ServicesIcon /> },
  { page: "map", label: "Port Map", icon: <MapIcon /> },
  { page: "logs", label: "Logs", icon: <LogsIcon /> },
  { page: "settings", label: "Settings", icon: <SettingsIcon /> },
];

export function Sidebar({ page, onNavigate, ports, lastScanAt }: SidebarProps) {
  return (
    <aside className="shell-sidebar">
      <div className="shell-sidebar__brand">
        <span className="shell-sidebar__mark" aria-hidden="true">P</span>
        <span>PortPal</span>
      </div>
      <nav className="shell-sidebar__navigation" aria-label="Primary navigation">
        {navigationItems.map((item) => {
          const active = page === item.page;
          return (
            <button
              key={item.page}
              type="button"
              className="shell-sidebar__navigation-button"
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              onClick={() => onNavigate(item.page)}
            >
              <span className="shell-sidebar__icon" aria-hidden="true">{item.icon}</span>
              <span className="shell-sidebar__label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <MonitoringStatus ports={ports} lastScanAt={lastScanAt} />
    </aside>
  );
}

function DashboardIcon() {
  return <svg viewBox="0 0 18 18"><rect x="2" y="2" width="5" height="5" /><rect x="11" y="2" width="5" height="5" /><rect x="2" y="11" width="5" height="5" /><rect x="11" y="11" width="5" height="5" /></svg>;
}

function PortsIcon() {
  return <svg viewBox="0 0 18 18"><rect x="2" y="4" width="14" height="10" rx="2" /><path d="M5 9h.01M9 9h.01M13 9h.01" /></svg>;
}

function TrafficIcon() {
  return <svg viewBox="0 0 18 18"><path d="m2 13 4-4 3 2 5-6 2 2" /><path d="M2 16h14" /></svg>;
}

function ServicesIcon() {
  return <svg viewBox="0 0 18 18"><rect x="2" y="2" width="6" height="6" /><rect x="10" y="2" width="6" height="6" /><rect x="2" y="10" width="6" height="6" /><path d="M13 11v5m-2.5-2.5h5" /></svg>;
}

function MapIcon() {
  return <svg viewBox="0 0 18 18"><circle cx="4" cy="9" r="2" /><circle cx="14" cy="4" r="2" /><circle cx="14" cy="14" r="2" /><path d="m5.7 8 6.6-3.1M5.7 10l6.6 3.1" /></svg>;
}

function LogsIcon() {
  return <svg viewBox="0 0 18 18"><rect x="3" y="2" width="12" height="14" rx="2" /><path d="M6 6h6M6 9h6M6 12h4" /></svg>;
}

function SettingsIcon() {
  return <svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="2.5" /><path d="M9 2v2m0 10v2m7-7h-2M4 9H2m12-5.5-1.4 1.4M5.4 12.6 4 14m10 0-1.4-1.4M5.4 5.4 4 4" /></svg>;
}
