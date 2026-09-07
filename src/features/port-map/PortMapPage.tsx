import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortFilter, PortInfo, TrafficByPort } from "../../app/types";
import { Button, EmptyState, IconButton, LoadingState, PageHeader } from "../../components/ui/controls";
import { PortInspector } from "../inspector/PortInspector";
import { tauriPortPalGateway, type PortPalGateway } from "../../lib/tauri";
import { canGroupByProject, filterGraph, resolveGraphSelection } from "./graphModel";
import { MapControls } from "./MapControls";
import { MapLegend } from "./MapLegend";
import { MapMinimap, type MapPoint } from "./MapMinimap";
import { PortTopology, type TopologyHandle } from "./PortTopology";
import { usePortGraph } from "./usePortGraph";
import "./port-map.css";

export interface PortMapPageProps {
  ports: PortInfo[]; traffic: TrafficByPort; observedAt: Record<number, number>;
  killedPorts: Map<number, PortInfo>; killing: ReadonlySet<number>; restarting: ReadonlySet<number>;
  onKill(port: PortInfo): Promise<void> | void; onRestart(port: PortInfo): Promise<void> | void; onClose(): void;
  gateway?: PortPalGateway;
}

export function PortMapPage({ ports, traffic, observedAt, killedPorts, killing, restarting, onKill, onRestart, onClose, gateway = tauriPortPalGateway }: PortMapPageProps) {
  const { graph, loading, error, refresh } = usePortGraph(gateway);
  const [search, setSearch] = useState(""); const [category, setCategory] = useState<PortFilter>("all");
  const [grouped, setGrouped] = useState(false); const [selectedId, setSelectedId] = useState<string>();
  const [zoom, setZoom] = useState(1); const [points, setPoints] = useState<MapPoint[]>([]);
  const [viewport, setViewport] = useState({ x:0, y:0, width:900, height:560 });
  const topology = useRef<TopologyHandle>(null);
  const filtered = useMemo(() => filterGraph(graph, ports, { search, category }), [category, graph, ports, search]);
  const canGroup = canGroupByProject(filtered.nodes);
  const selectedNode = filtered.nodes.find(node => node.id === selectedId);
  const selectedPort = resolveGraphSelection(selectedNode, ports) ?? (selectedNode ? [...killedPorts.values()].find(port => port.port === selectedNode.port && port.pid === selectedNode.pid) : undefined);
  useEffect(() => { if (!canGroup) setGrouped(false); }, [canGroup]);
  useEffect(() => { if (selectedId && !selectedPort) setSelectedId(undefined); }, [selectedId, selectedPort]);
  const select = useCallback((id: string) => setSelectedId(current => current === id ? undefined : id), []);
  const settled = useCallback((next: MapPoint[], bounds: typeof viewport) => { setPoints(next); setViewport(bounds); }, []);

  return <section className="port-map" aria-labelledby="port-map-title">
    <div className="port-map__header"><PageHeader title={<span id="port-map-title">Port Map</span>} description="Visualize connections between your services" actions={<>
      <IconButton label="Refresh map" onClick={() => void refresh()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5V2l-1.3 1.3A6 6 0 1 0 14 8" /></svg></IconButton>
      <IconButton label="Close Port Map" onClick={onClose}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></IconButton>
    </>} /></div>
    <MapControls search={search} category={category} zoom={zoom} canGroup={canGroup} grouped={grouped} onSearch={setSearch} onCategory={setCategory} onGrouped={setGrouped} onZoom={delta => topology.current?.zoomBy(delta)} onFit={() => topology.current?.fit()} />
    {error && graph.nodes.length > 0 && <div className="port-map__error" role="alert"><span>{error}</span><Button onClick={() => void refresh()}>Retry</Button></div>}
    <div className="port-map__workspace">
      <div className="port-map__canvas">
        {loading && graph.nodes.length === 0 ? <LoadingState label="Mapping connections…" /> : error && graph.nodes.length === 0 ? <EmptyState title="Unable to load map" description={error}><Button onClick={() => void refresh()}>Retry</Button></EmptyState> : filtered.nodes.length === 0 ? <EmptyState title="No ports to map" description="Adjust filters or start a server." /> : <PortTopology ref={topology} graph={filtered} grouped={grouped} selectedId={selectedId} onSelect={select} onZoom={setZoom} onSettled={settled} />}
        <MapLegend /><MapMinimap points={points} viewport={viewport} />
      </div>
      {selectedPort && <PortInspector port={selectedPort} traffic={traffic[selectedPort.port] ?? []} observedAt={observedAt[selectedPort.port]} killed={killedPorts.has(selectedPort.port)} killing={killing} restarting={restarting} onClose={() => setSelectedId(undefined)} onKill={onKill} onRestart={onRestart} />}
    </div>
  </section>;
}
