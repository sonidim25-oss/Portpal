import { useEffect, useMemo, useState } from "react";
import type { AdvancedPortFilters, PortFilter, PortInfo, TrafficByPort } from "../../app/types";
import { Button, EmptyState, IconButton, LoadingState, PageHeader, SearchInput } from "../../components/ui/controls";
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
  onKill(port: PortInfo): Promise<void>;
  onRestart(port: PortInfo): Promise<void>;
  onOpenMap(): void;
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
  onOpenMap,
}: PortsPageProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<PortFilter>("all");
  const [advanced, setAdvanced] = useState<AdvancedPortFilters>(DEFAULT_ADVANCED_PORT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<PortSelection | null>(null);
  const counts = useMemo(() => countPortsByCategory(ports), [ports]);
  const filteredPorts = useMemo(
    () => filterPorts(ports, search, category, advanced, traffic),
    [advanced, category, ports, search, traffic],
  );
  const selectedLivePort = selected ? ports.find((port) => samePort(port, selected)) : undefined;
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

  const openMap = () => {
    setSelected(null);
    onOpenMap();
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
              <IconButton label="Open Port Map" onClick={openMap} className="ports-page__map-button">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="3" cy="8" r="2" />
                  <circle cx="13" cy="4" r="2" />
                  <circle cx="13" cy="12" r="2" />
                  <path d="m4.8 7.1 6.4-2.3M4.8 8.9l6.4 2.3" />
                </svg>
              </IconButton>
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
          disabled={filteredPorts.length === 0}
          onClick={() => filteredPorts.forEach((port) => void onKill(port))}
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
              onKill={onKill}
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
            onKill={onKill}
            onRestart={onRestart}
          />
        )}
      </div>
    </section>
  );
}
