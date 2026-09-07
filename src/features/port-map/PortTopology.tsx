import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as d3 from "d3";
import type { GraphEdgeData, GraphNodeData, PortGraph } from "../../lib/tauri";
import type { MapPoint } from "./MapMinimap";

type SimNode = GraphNodeData & d3.SimulationNodeDatum;
type SimEdge = Omit<GraphEdgeData, "source" | "target"> & d3.SimulationLinkDatum<SimNode>;
export type TopologyHandle = { zoomBy(delta: number): void; fit(): void };

export function PortTopology({ graph, grouped, selectedId, onSelect, onZoom, onSettled, ref }: {
  graph: PortGraph; grouped: boolean; selectedId?: string; onSelect(id: string): void;
  onZoom(value: number): void; onSettled(points: MapPoint[], viewport: { x: number; y: number; width: number; height: number }): void;
  ref?: Ref<TopologyHandle>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | undefined>(undefined);
  const nodesRef = useRef<SimNode[]>([]);

  useEffect(() => {
    d3.select(svgRef.current).selectAll<SVGGElement, SimNode>(".port-map__node")
      .classed("is-selected", d => d.id === selectedId);
  }, [selectedId]);

  const applyFit = () => {
    const el = svgRef.current; const nodes = nodesRef.current;
    if (!el || !nodes.length || !zoomRef.current) return;
    const w = el.clientWidth || 900, h = el.clientHeight || 560;
    const minX = d3.min(nodes, d => d.x) ?? 0, maxX = d3.max(nodes, d => d.x) ?? w;
    const minY = d3.min(nodes, d => d.y) ?? 0, maxY = d3.max(nodes, d => d.y) ?? h;
    const scale = Math.max(.5, Math.min(2, .85 / Math.max((maxX-minX)/w, (maxY-minY)/h, .01)));
    const transform = d3.zoomIdentity.translate(w/2-scale*(minX+maxX)/2, h/2-scale*(minY+maxY)/2).scale(scale);
    d3.select(el).call(zoomRef.current.transform, transform);
  };
  useImperativeHandle(ref, () => ({
    zoomBy(delta) { const el=svgRef.current; if(el && zoomRef.current) d3.select(el).call(zoomRef.current.scaleBy, 1 + delta); },
    fit: applyFit,
  }));

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const width = el.clientWidth || 900, height = el.clientHeight || 560;
    const svg = d3.select(el); svg.selectAll("*").remove();
    const scene = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([.5, 2]).on("zoom", event => {
      scene.attr("transform", event.transform); onZoom(event.transform.k);
      onSettled(nodesRef.current.map(n => ({ id:n.id, x:n.x ?? 0, y:n.y ?? 0 })), {
        x: -event.transform.x / event.transform.k,
        y: -event.transform.y / event.transform.k,
        width: width / event.transform.k,
        height: height / event.transform.k,
      });
    });
    zoomRef.current = zoom; svg.call(zoom);
    const nodes: SimNode[] = graph.nodes.map(node => ({ ...node }));
    const edges: SimEdge[] = graph.edges.map(edge => ({ ...edge, source: edge.source, target: edge.target }));
    nodesRef.current = nodes;
    const projects = [...new Set(nodes.map(n => n.project_name).filter(Boolean))];
    const projectX = new Map(projects.map((p, i) => [p, width * (i + 1) / (projects.length + 1)]));
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink<SimNode, SimEdge>(edges).id(d => d.id).distance(190).strength(.45))
      .force("charge", d3.forceManyBody().strength(-520))
      .force("collide", d3.forceCollide(86))
      .force("x", d3.forceX<SimNode>(d => grouped && d.project_name ? projectX.get(d.project_name) ?? width/2 : width/2).strength(grouped ? .25 : .06))
      .force("y", d3.forceY(height/2).strength(.08));
    const edge = scene.append("g").selectAll("line").data(edges).join("line").attr("class", "port-map__edge");
    const node = scene.append("g").selectAll<SVGGElement, SimNode>("g").data(nodes).join("g")
      .attr("class", d => `port-map__node${d.id === selectedId ? " is-selected" : ""}`)
      .attr("role", "button").attr("tabindex", 0)
      .attr("aria-label", d => `${d.project_name ?? d.process_name}, port ${d.port}, ${d.process_name}`)
      .on("click", (_, d) => onSelect(d.id))
      .on("keydown", (event, d) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(d.id); } })
      .call(d3.drag<SVGGElement, SimNode>().on("start", (event,d)=>{ if(!event.active) simulation.alphaTarget(.2).restart(); d.fx=d.x; d.fy=d.y; }).on("drag",(event,d)=>{d.fx=event.x;d.fy=event.y;}).on("end",(event,d)=>{if(!event.active)simulation.alphaTarget(0);d.fx=null;d.fy=null;}));
    node.append("rect").attr("x", -72).attr("y", -38).attr("width", 144).attr("height", 76).attr("rx", 8);
    node.append("text").attr("class", "port-map__node-name").attr("y", -12).text(d => d.project_name ?? d.framework ?? d.process_name);
    node.append("text").attr("class", "port-map__node-port").attr("y", 10).text(d => String(d.port));
    node.append("text").attr("class", "port-map__node-process").attr("y", 28).text(d => d.framework ?? d.process_name);
    simulation.on("tick", () => {
      edge.attr("x1", d => (d.source as SimNode).x ?? 0).attr("y1", d => (d.source as SimNode).y ?? 0).attr("x2", d => (d.target as SimNode).x ?? 0).attr("y2", d => (d.target as SimNode).y ?? 0);
      node.attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    }).on("end", () => {
      simulation.stop();
      onSettled(nodes.map(n => ({ id:n.id, x:n.x ?? 0, y:n.y ?? 0 })), { x:0, y:0, width, height });
    });
    return () => { simulation.stop(); };
  }, [graph, grouped, onSelect, onSettled, onZoom]);
  return <svg ref={svgRef} className="port-map__topology" aria-label="Port topology" />;
}
