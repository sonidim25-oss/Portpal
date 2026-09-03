import type { PortInfo } from "../../app/types";

type MonitoringStatusProps = {
  ports: PortInfo[];
  lastScanAt: number | null;
};

function formatLastScan(lastScanAt: number | null): string {
  if (lastScanAt === null) return "Waiting for scan";

  const seconds = Math.max(0, Math.floor((Date.now() - lastScanAt) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  return `${Math.floor(minutes / 60)}h ago`;
}

export function MonitoringStatus({ ports, lastScanAt }: MonitoringStatusProps) {
  const processCount = new Set(ports.map((port) => port.pid)).size;
  const processSummary = `${processCount} process${processCount === 1 ? "" : "es"}, ${ports.length} port${ports.length === 1 ? "" : "s"}`;
  const scanSummary = `Last scan: ${formatLastScan(lastScanAt)}`;

  return (
    <section className="shell-monitoring-status" aria-label={`Monitoring: ${processSummary}. ${scanSummary}`}>
      <div className="shell-monitoring-status__heading">
        <span className="shell-monitoring-status__indicator" aria-hidden="true" />
        <span className="shell-monitoring-status__heading-copy">Monitoring</span>
      </div>
      <p>{processSummary}</p>
      <p className="shell-monitoring-status__scan">{scanSummary}</p>
    </section>
  );
}
