import type { ReactNode } from "react";
import type { NavPage, PortInfo } from "../../app/types";
import { Sidebar } from "./Sidebar";
import { Titlebar } from "./Titlebar";
import "./shell.css";

type AppShellProps = {
  page: NavPage;
  onNavigate: (page: NavPage) => void;
  ports: PortInfo[];
  lastScanAt: number | null;
  children: ReactNode;
};

export function AppShell({ page, onNavigate, ports, lastScanAt, children }: AppShellProps) {
  return (
    <div className="app app-shell">
      <Titlebar />
      <div className="app-shell__body">
        <Sidebar page={page} onNavigate={onNavigate} ports={ports} lastScanAt={lastScanAt} />
        <main className="content app-shell__content">{children}</main>
      </div>
    </div>
  );
}
