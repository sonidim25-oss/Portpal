import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PortGraph, PortPalGateway } from "../../lib/tauri";
import { usePortGraph } from "./usePortGraph";

const first: PortGraph = { nodes: [{ id: "port:5173", port: 5173, pid: 10, process_name: "node", project_name: "PortPal", framework: "Vite", is_dev: true, connection_count: 0 }], edges: [] };
const second: PortGraph = { nodes: [{ ...first.nodes[0], connection_count: 2 }], edges: [] };

function gateway(getPortGraph: PortPalGateway["getPortGraph"], onPortsUpdated: PortPalGateway["onPortsUpdated"] = vi.fn().mockResolvedValue(() => {})): PortPalGateway {
  return {
    getPortGraph, onPortsUpdated,
    getPorts: vi.fn().mockResolvedValue([]), getPortEvents: vi.fn().mockResolvedValue([]), getPortTraffic: vi.fn().mockResolvedValue({}),
    killProcess: vi.fn().mockResolvedValue(undefined), restartProcess: vi.fn().mockResolvedValue(undefined), onPortEvents: vi.fn().mockResolvedValue(() => {}),
    onScanDegraded: vi.fn().mockResolvedValue(() => {}), onScanRecovered: vi.fn().mockResolvedValue(() => {}),
  };
}

describe("usePortGraph", () => {
  it("retains the last valid graph and exposes the refresh failure", async () => {
    const getPortGraph = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error("Graph unavailable"));
    const testGateway = gateway(getPortGraph);
    const { result } = renderHook(() => usePortGraph(testGateway));
    await waitFor(() => expect(result.current.graph).toEqual(first));
    await act(() => result.current.refresh());
    expect(result.current.graph).toEqual(first);
    expect(result.current.error).toBe("Graph unavailable");
  });

  it("refreshes from the gateway when ports-updated fires", async () => {
    let notify: (() => void) | undefined;
    const onPortsUpdated = vi.fn(async (handler: () => void) => { notify = handler; return () => {}; });
    const getPortGraph = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const testGateway = gateway(getPortGraph, onPortsUpdated);
    const { result } = renderHook(() => usePortGraph(testGateway));
    await waitFor(() => expect(result.current.graph).toEqual(first));
    await act(async () => { notify?.(); });
    await waitFor(() => expect(result.current.graph).toEqual(second));
    expect(getPortGraph).toHaveBeenCalledTimes(2);
  });
});
