import { useEffect, useMemo, useRef, useState } from "react";
import { isCriticalProcess, type KillOutcome } from "../../app/killPolicy";
import { KillConfirmation } from "./KillConfirmation";
import type { AdvancedPortFilters, PortFilter, PortInfo, TrafficByPort } from "../../app/types";
import { Button, EmptyState, LoadingState, PageHeader, SearchInput } from "../../components/ui/controls";
import { PortInspector } from "../inspector/PortInspector";
import { countPortsByCategory, filterPorts } from "../../utils/helpers";
import { DEFAULT_ADVANCED_PORT_FILTERS, PortFilters } from "./PortFilters";
import { PortTable, type PortSelection } from "./PortTable";
import "./ports.css";

export interface PortsPageProps {
  ports: PortInfo[];
  traffic: TrafficByPort;
  observedAt: Record<number, number>;
  killedPorts: Map<number, PortInfo>;
  killing: ReadonlySet<number>;
  restarting: ReadonlySet<number>;
  loading: boolean;
  error: string | null;
  onRetry(): Promise<void>;
  onKill(port: PortInfo): Promise<void | KillOutcome>;
  onRestart(port: PortInfo): Promise<void>;
}

function samePort(port: PortInfo, selection: PortSelection): boolean {
  return port.port === selection.port && port.pid === selection.pid;
}

export function PortsPage({
  ports,
  traffic,
  observedAt,
  killedPorts,
  killing,
  restarting,
  loading,
  error,
  onRetry,
  onKill,
  onRestart,
}: PortsPageProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<PortFilter>("all");
  const [advanced, setAdvanced] = useState<AdvancedPortFilters>(DEFAULT_ADVANCED_PORT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<PortSelection | null>(null);
  const [killSelection, setKillSelection] = useState<PortInfo[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkPending = useRef(false);
  const [killSummary, setKillSummary] = useState<string | null>(null);
  const latest = useRef({ ports, killing });
  latest.current = { ports, killing };
  const protectedListener = (port: PortInfo) => [port, ...latest.current.ports.filter((p) => p.pid === port.pid)].find(isCriticalProcess);
  const uniqueProcesses = (items: PortInfo[]) => {
    const seen = new Set<number>();
    return items.filter((port) => {
      if (seen.has(port.pid)) return false;
      seen.add(port.pid);
      return true;
    });
  };
  const requestKill = async (port: PortInfo): Promise<void> => {
    if (protectedListener(port)) {
      await onKill(port);
      return;
    }
    setKillSummary(null);
    setKillSelection([port]);
  };
  const confirmKills = async () => {
    if (!killSelection || bulkPending.current) return;
    const targets = killSelection;
    bulkPending.current = true;
    setBulkBusy(true);
    setKillSelection(null);
    let killed = 0, failed = 0, critical = 0, busy = 0;
    try {
      for (const port of targets) {
        if (protectedListener(port)) { critical++; continue; }
        if (latest.current.killing.has(port.pid)) { busy++; continue; }
        // Only act on the originally confirmed endpoint if it remains visible
        // in the live data. The backend independently rescans before signaling.
        if (!latest.current.ports.some((p) => samePort(p, port))) { failed++; continue; }
        try {
          const outcome = await onKill(port);
          if (outcome === 'failed') failed++;
          else if (outcome === 'critical') critical++;
          else if (outcome === 'busy') busy++;
          else killed++;
        } catch { failed++; }
      }
      if (targets.length > 1) {
        setKillSummary(`Killed ${killed}, failed ${failed}, skipped critical ${critical}, skipped busy ${busy}`);
      }
    } finally {
      bulkPending.current = false;
      setBulkBusy(false);
    }
  };
  const counts = useMemo(() => countPortsByCategory(ports), [ports]);
  const filteredPorts = useMemo(
    () => filterPorts(ports, search, category, advanced, traffic),
    [advanced, category, ports, search, traffic],
  );
  const selectedLivePort = selected ? filteredPorts.find((port) => samePort(port, selected)) : undefined;
  const selectedKilledPort = selected
    ? [...killedPorts.values()].find((port) => samePort(port, selected))
    : undefined;
  const selectedPort = selectedLivePort ?? selectedKilledPort;

  useEffect(() => {
    if (selected && !selectedPort) setSelected(null);
  }, [selected, selectedPort]);

  const toggleSelection = (port: PortInfo) => {
    setSelected((current) => current && samePort(port, current) ? null : { port: port.port, pid: port.pid });
  };

  const description = !error && (!loading || ports.length > 0)
    ? `${ports.length} listening port${ports.length === 1 ? "" : "s"}`
    : undefined;

  return (
    <section className="ports-page" aria-labelledby="ports-page-title">
      <div className="ports-page__header">
        <PageHeader
          title={<span id="ports-page-title">Ports</span>}
          description={description}
          actions={(
            <>
              <SearchInput
                label="Search ports"
                placeholder="Search ports, process, project..."
                value={search}
                onChange={setSearch}
              />
            </>
          )}
        />
      </div>

      <div className="ports-page__controls">
        <div className="ports-page__filter-controls">
          <PortFilters
            category={category}
            counts={counts}
            advanced={advanced}
            open={filtersOpen}
            onCategoryChange={setCategory}
            onAdvancedChange={setAdvanced}
            onOpenChange={setFiltersOpen}
          />
        </div>
        <Button
          variant="danger"
          disabled={filteredPorts.length === 0 || bulkBusy}
          onClick={() => { setKillSummary(null); setKillSelection(uniqueProcesses(filteredPorts)); }}
          className="ports-page__kill-all"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" />
            <circle cx="8" cy="8" r="1.5" />
          </svg>
          Kill All
        </Button>
      </div>

      <div className="ports-page__workspace">
        <div className="ports-page__table-pane">
          {error ? (
            <EmptyState title="Unable to load ports" description={error}>
              <Button onClick={() => void onRetry()}>Retry</Button>
            </EmptyState>
          ) : loading && ports.length === 0 ? (
            <LoadingState label="Scanning ports…" />
          ) : ports.length === 0 && killedPorts.size === 0 ? (
            <EmptyState title="No ports in use" description="Start a server and it will appear here." />
          ) : (
            <PortTable
              ports={filteredPorts}
              traffic={traffic}
              observedAt={observedAt}
              killedPorts={killedPorts}
              killing={killing}
              restarting={restarting}
              selected={selected}
              onSelect={toggleSelection}
              onKill={requestKill}
              onRestart={onRestart}
            />
          )}
        </div>

        {selectedPort && (
          <PortInspector
            port={selectedPort}
            traffic={traffic[selectedPort.port] ?? []}
            observedAt={observedAt[selectedPort.port]}
            killed={Boolean(selectedKilledPort)}
            killing={killing}
            restarting={restarting}
            onClose={() => setSelected(null)}
            onKill={requestKill}
            onRestart={onRestart}
          />
        )}
      </div>
      {killSummary && <div className="kill-summary" role="status">{killSummary}</div>}
      {killSelection && <KillConfirmation count={killSelection.length}
        protectedPorts={killSelection.flatMap((port) => { const protectedPort = protectedListener(port); return protectedPort ? [protectedPort] : []; })}
        onCancel={() => setKillSelection(null)} onConfirm={() => void confirmKills()} />}
    </section>
  );
}
