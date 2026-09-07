import type { PortFilter, PortInfo } from "../../app/types";
import type { GraphNodeData, PortGraph } from "../../lib/tauri";
import { classifyPort } from "../../utils/helpers";

export type GraphFilters = { search: string; category: PortFilter };

export function resolveGraphSelection(node: GraphNodeData | undefined, ports: PortInfo[]): PortInfo | undefined {
  if (!node) return undefined;
  return ports.find((port) => port.port === node.port && port.pid === node.pid);
}

export function filterGraph(graph: PortGraph, ports: PortInfo[], filters: GraphFilters): PortGraph {
  const query = filters.search.trim().toLowerCase();
  const nodes = graph.nodes.filter((node) => {
    const port = resolveGraphSelection(node, ports);
    if (!port) return false;
    if (filters.category !== "all" && classifyPort(port) !== filters.category) return false;
    if (!query) return true;
    return [node.id, node.port, node.pid, node.process_name, node.project_name, node.framework,
      port.project_path, port.protocol, port.start_cmd]
      .filter(Boolean).join(" ").toLowerCase().includes(query);
  });
  const visible = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  return { nodes, edges };
}

export function canGroupByProject(nodes: GraphNodeData[]): boolean {
  return new Set(nodes.map((node) => node.project_name?.trim()).filter(Boolean)).size >= 2;
}
