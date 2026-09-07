import type { Page } from "@playwright/test";

type FixturePort = { port: number; pid: number; process_name: string; project_name: string | null; project_path: string | null; protocol: string; start_cmd: string | null };
type FixtureEvent = FixturePort & { framework: string | null; event_type: string; timestamp: number };
type FixtureGraph = { nodes: Array<{ id: string; port: number; pid: number; process_name: string; project_name: string | null; framework: string | null; is_dev: boolean; connection_count: number }>; edges: Array<{ source: string; target: string; active: boolean }> };
export type TauriFixture = { ports: FixturePort[]; events: FixtureEvent[]; traffic: Record<number, Array<{ connections: number; timestamp: number }>>; graph: FixtureGraph };

export async function installTauriFixture(page: Page, fixture: TauriFixture) {
  await page.addInitScript((data) => {
    let nextCallbackId = 1;
    let nextEventId = 1;
    const callbacks = new Map<number, { callback: (...args: unknown[]) => void; once: boolean }>();
    const listenerCallbacks = new Map<number, number>();
    const calls: Array<{ cmd: string; args: unknown }> = [];
    Object.defineProperty(window, "__PORTPAL_FIXTURE_CALLS__", { value: calls });
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", { value: { unregisterListener: (_event: string, eventId: number) => { const callbackId = listenerCallbacks.get(eventId); if (callbackId !== undefined) callbacks.delete(callbackId); listenerCallbacks.delete(eventId); } } });
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback: (...args: unknown[]) => void, once = false) { const id = nextCallbackId++; callbacks.set(id, { callback, once }); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(cmd: string, args?: unknown) {
        calls.push({ cmd, args });
        switch (cmd) {
          case "get_ports": return structuredClone(data.ports);
          case "get_port_events": return structuredClone(data.events);
          case "get_port_traffic": return structuredClone(data.traffic);
          case "get_port_graph": return structuredClone(data.graph);
          case "restart_process": {
            // The hardened command takes a port and a pid and nothing else;
            // reject anything that smuggles a command line or path across IPC.
            const keys = Object.keys((args ?? {}) as Record<string, unknown>).sort();
            if (keys.join(",") !== "pid,port") throw new Error(`restart_process rejected unexpected arguments: ${keys.join(",")}`);
            return undefined;
          }
          case "kill_process": case "plugin:event|unlisten": return undefined;
          case "plugin:event|listen": { const eventId = nextEventId++; const handler = (args as { handler?: number } | undefined)?.handler; if (handler !== undefined) listenerCallbacks.set(eventId, handler); return eventId; }
          default: throw new Error(`Unexpected fixture command: ${cmd}`);
        }
      },
    } });
  }, fixture);
}
