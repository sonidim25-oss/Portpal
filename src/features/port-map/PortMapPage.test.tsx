import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PortInfo } from "../../app/types";
import type { PortGraph, PortPalGateway } from "../../lib/tauri";
import { PortMapPage, type PortMapPageProps } from "./PortMapPage";

const ports: PortInfo[] = [
  { port: 5173, pid: 10, process_name: "node", project_name: "PortPal", project_path: "C:/PortPal", protocol: "TCP", start_cmd: "npm run dev" },
  { port: 3000, pid: 20, process_name: "node", project_name: "Docs", project_path: "C:/Docs", protocol: "TCP", start_cmd: null },
];
const graph: PortGraph = { nodes: [
  { id: "port:5173", port: 5173, pid: 10, process_name: "node", project_name: "PortPal", framework: "Vite", is_dev: true, connection_count: 3 },
  { id: "port:3000", port: 3000, pid: 20, process_name: "node", project_name: "Docs", framework: "React", is_dev: true, connection_count: 1 },
], edges: [{ source: "port:5173", target: "port:3000", active: true }] };

function renderMap(overrides: Partial<PortMapPageProps> = {}) {
  const gateway: PortPalGateway = {
    getPorts: vi.fn().mockResolvedValue(ports), getPortEvents: vi.fn().mockResolvedValue([]),
    getPortTraffic: vi.fn().mockResolvedValue({}), getPortGraph: vi.fn().mockResolvedValue(graph),
    killProcess: vi.fn().mockResolvedValue(undefined), restartProcess: vi.fn().mockResolvedValue(undefined),
    onPortsUpdated: vi.fn().mockResolvedValue(() => {}), onPortEvents: vi.fn().mockResolvedValue(() => {}),
  };
  const props: PortMapPageProps = { ports, traffic: {}, observedAt: {}, killedPorts: new Map(), killing: new Set(), restarting: new Set(), onKill: vi.fn(), onRestart: vi.fn(), onClose: vi.fn(), gateway, ...overrides };
  return { ...render(<PortMapPage {...props} />), props, gateway };
}

describe("PortMapPage", () => {
  it("renders the stable map controls and data-backed affordances", async () => {
    renderMap();
    expect(screen.getByRole("heading", { name: "Port Map" })).toBeVisible();
    expect(screen.getByText("Visualize connections between your services")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search port map" })).toBeVisible();
    for (const name of ["All", "Dev", "System", "Other"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Show external" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Show external" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Group by project" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Fit map to view" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh map" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close Port Map" })).toBeVisible();
    expect(screen.getByLabelText("Port map legend")).toBeVisible();
    expect(screen.getByLabelText("Port map minimap")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: /PortPal.*5173.*node/i })).toBeVisible());
  });

  it("selects a topology node and preserves the shared inspector Kill behavior", async () => {
    const { props } = renderMap();
    fireEvent.click(await screen.findByRole("button", { name: /PortPal.*5173.*node/i }));
    const user = userEvent.setup();
    expect(screen.getByRole("complementary", { name: "Port inspector for :5173" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kill Process" }));
    expect(props.onKill).toHaveBeenCalledWith(ports[0]);
  });

  it("disables grouping when fewer than two named projects remain", async () => {
    const user = userEvent.setup();
    renderMap();
    await user.type(screen.getByRole("searchbox", { name: "Search port map" }), "PortPal");
    expect(screen.getByRole("checkbox", { name: "Group by project" })).toBeDisabled();
  });

  it("keeps a valid topology visible and offers retry after a refresh fails", async () => {
    const user = userEvent.setup();
    const { gateway } = renderMap();
    await screen.findByRole("button", { name: /PortPal.*5173.*node/i });
    vi.mocked(gateway.getPortGraph).mockRejectedValueOnce(new Error("map refresh unavailable"));

    await user.click(screen.getByRole("button", { name: "Refresh map" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("map refresh unavailable");
    expect(screen.getByRole("button", { name: /PortPal.*5173.*node/i })).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
