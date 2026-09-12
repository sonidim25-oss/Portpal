import type { ReactNode } from 'react';
import type { NavPage, PortInfo } from '../../app/types';
import { Sidebar } from './Sidebar';
import { Titlebar } from './Titlebar';
import './shell.css';

type AppShellProps = {
  page: NavPage;
  onNavigate: (page: NavPage) => void;
  ports: PortInfo[];
  lastScanAt: number | null;
  updateVersion?: string | null;
  children: ReactNode;
};

export function AppShell({
  page,
  onNavigate,
  ports,
  lastScanAt,
  updateVersion = null,
  children,
}: AppShellProps) {
  return (
    <div className="app app-shell">
      <Sidebar
        page={page}
        onNavigate={onNavigate}
        ports={ports}
        lastScanAt={lastScanAt}
        updateVersion={updateVersion}
      />
      <Titlebar />
      <main className="content app-shell__content">{children}</main>
    </div>
  );
}
