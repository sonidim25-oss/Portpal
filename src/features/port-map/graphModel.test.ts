import { describe, expect, it } from "vitest";
import type { PortInfo, PortFilter } from "../../app/types";
import type { PortGraph } from "../../lib/tauri";
import { canGroupByProject, filterGraph, resolveGraphSelection } from "./graphModel";

const ports: PortInfo[] = [
  { port: 5173, pid: 10, process_name: "node", project_name: "PortPal", project_path: "C:/PortPal", protocol: "TCP", start_cmd: "npm run dev" },
  { port: 5432, pid: 20, process_name: "postgres", project_name: null, project_path: null, protocol: "TCP", start_cmd: null },
  { port: 9229, pid: 30, process_name: "node", project_name: null, project_path: null, protocol: "TCP", start_cmd: null },
  { port: 3000, pid: 40, process_name: "node", project_name: "Docs", project_path: "C:/Docs", protocol: "TCP", start_cmd: "npm start" },
];

const graph: PortGraph = {
  nodes: [
    { id: "port:5173", port: 5173, pid: 10, process_name: "node", project_name: "PortPal", framework: "Vite", is_dev: true, connection_count: 3 },
    { id: "port:5432", port: 5432, pid: 20, process_name: "postgres", project_name: null, framework: "Postgres", is_dev: false, connection_count: 1 },
    { id: "port:9229", port: 9229, pid: 30, process_name: "node", project_name: null, framework: null, is_dev: false, connection_count: 0 },
    { id: "port:3000", port: 3000, pid: 40, process_name: "node", project_name: "Docs", framework: "React", is_dev: true, connection_count: 2 },
  ],
  edges: [
    { source: "port:5173", target: "port:5432", active: true },
    { source: "port:5173", target: "port:3000", active: true },
  ],
};

describe("graphModel", () => {
  it("searches joined port and graph metadata and removes edges to hidden endpoints", () => {
    const filtered = filterGraph(graph, ports, { search: "PortPal", category: "all" });
    expect(filtered.nodes.map((node) => node.id)).toEqual(["port:5173"]);
    expect(filtered.edges).toEqual([]);
    expect(filtered.nodes.every((node) => !node.id.startsWith("external:"))).toBe(true);
  });

  it.each<[PortFilter, string[]]>([
    ["all", ["port:5173", "port:5432", "port:9229", "port:3000"]],
    ["dev", ["port:5173", "port:3000"]],
    ["system", ["port:5432"]],
    ["other", ["port:9229"]],
  ])("filters the %s category through the shared classifier", (category, ids) => {
    expect(filterGraph(graph, ports, { search: "", category }).nodes.map((node) => node.id)).toEqual(ids);
  });

  it("resolves a selected node only when both port and PID identify a live port", () => {
    expect(resolveGraphSelection(graph.nodes[0], ports)).toEqual(ports[0]);
    expect(resolveGraphSelection({ ...graph.nodes[0], pid: 999 }, ports)).toBeUndefined();
    expect(resolveGraphSelection(undefined, ports)).toBeUndefined();
  });

  it("enables grouping only when at least two named projects are visible", () => {
    expect(canGroupByProject(graph.nodes)).toBe(true);
    expect(canGroupByProject(graph.nodes.slice(0, 3))).toBe(false);
  });
});
