import { useCallback, useEffect, useState } from "react";
import { tauriPortPalGateway, type PortGraph, type PortPalGateway } from "../../lib/tauri";

export function usePortGraph(gateway: PortPalGateway = tauriPortPalGateway) {
  const [graph, setGraph] = useState<PortGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setGraph(await gateway.getPortGraph());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    void refresh();
    let active = true;
    let unlisten: (() => void) | undefined;
    void gateway.onPortsUpdated(() => void refresh()).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => { active = false; unlisten?.(); };
  }, [gateway, refresh]);

  return { graph, loading, error, refresh };
}
