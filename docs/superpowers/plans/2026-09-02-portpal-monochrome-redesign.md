# PortPal Monochrome Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PortPal's frontend to match the two monochrome `New assets` references while preserving every existing screen, button, action, Tauri command, and backend behavior.

**Architecture:** Keep Rust/Tauri untouched and place its existing commands behind a typed frontend gateway. Move shared data ownership into one hook, build reusable monochrome primitives and shell components, then migrate Ports, the shared inspector, Port Map, and the remaining screens in test-first stages. The final `App.tsx` only coordinates navigation, shared state, and feature pages.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2, D3 7, CSS custom properties, Vitest 3, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-portpal-monochrome-redesign-design.md`

## Global Constraints

- Treat `../New assets/main page asset.png` and `../New assets/portmap assets.png` as the primary visual source of truth.
- Preserve Dashboard, Ports, Traffic, Services, Port Map, Logs, and Settings.
- Preserve search, All/Dev/Other filtering, Kill, Kill All, Restart, map refresh, map close, node selection, dragging, zoom, titlebar controls, font scaling, and tray-backed live updates.
- Do not modify `src-tauri` production code or any Tauri command contract.
- Do not fabricate user, address, endpoint, external-node, edge-count, or close-connection data.
- Keep unsupported reference controls absent or visibly disabled without interfering with supported controls.
- Use `#0A0A0A`, `#0D0D0D`, `#111111`, `#171717`, `#1D1D1D`, `#262626`, `#F5F5F5`, `#A3A3A3`, `#666666`, and `#444444` as the core visual palette.
- Use Geist for general UI and JetBrains Mono for technical values.
- Retain the merged font-scale setting (`Standard`, `Large`, `Larger`) and `--fs-scale` behavior.
- Keep the application usable at the configured 780 by 480 minimum and reference-sized 1536 by 1024 viewport.
- Run `npm install` in a fresh worktree before Vitest. Falling back to a parent checkout's test packages creates two React instances and invalid-hook failures.
- Do not address the baseline `npm audit` report as part of this visual redesign; report it separately.

---

### Task 1: Shared Types and Monochrome Port Presentation Selectors

**Files:**
- Create: `src/app/types.ts`
- Modify: `src/utils/helpers.ts`
- Modify: `src/utils/helpers.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `PortInfo`, `PortEvent`, `TrafficSample`, `NavPage`, `PortFilter`, `PortCategory`, `PortCounts`, `AdvancedPortFilters`, `classifyPort(port)`, `filterPorts(ports, search, filter, advanced?, traffic?)`, `countPortsByCategory(ports)`, `latestConnectionCount(traffic, port)`, `uniqueProcessCount(ports)`.
- Preserves: `DEV_PORTS`, `getServiceName`, `getStatus`, and `timeAgo` exports while downstream screens migrate.

- [ ] **Step 1: Make the existing integration event test warning-free**

Import `act` in `src/App.integration.test.tsx` and wrap the direct event callback:

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';

await act(async () => {
  portsUpdatedCb({ payload: newPorts });
});
```

- [ ] **Step 2: Verify the baseline suite passes without React act warnings**

Run: `npm run test:run -- --reporter=verbose`

Expected: 27 tests pass; output contains neither `Invalid hook call` nor `not wrapped in act`.

- [ ] **Step 3: Write failing classification and expanded-search tests**

Add tests to `src/utils/helpers.test.ts` that define the intended four-way filter and real-field search:

```ts
it('classifies project ports as dev and infrastructure as system', () => {
  expect(classifyPort(basePort({ port: 5173, project_name: 'PortPal' }))).toBe('dev');
  expect(classifyPort(basePort({ port: 5432, process_name: 'postgres' }))).toBe('system');
  expect(classifyPort(basePort({ port: 49664, process_name: 'lsass.exe' }))).toBe('system');
  expect(classifyPort(basePort({ port: 9229, process_name: 'node' }))).toBe('other');
});

it('searches project path, protocol, and start command', () => {
  const port = basePort({
    port: 5173,
    project_path: 'C:\\work\\PortPal',
    protocol: 'TCP',
    start_cmd: 'npm run dev',
  });
  expect(filterPorts([port], 'portpal', 'all')).toEqual([port]);
  expect(filterPorts([port], 'tcp', 'all')).toEqual([port]);
  expect(filterPorts([port], 'npm run', 'all')).toEqual([port]);
});

it('counts all, dev, system, and other from the same classifier', () => {
  expect(countPortsByCategory(ports)).toEqual({ all: 4, dev: 2, system: 2, other: 0 });
});
```

- [ ] **Step 4: Run the selector tests and verify RED**

Run: `npm run test:run -- src/utils/helpers.test.ts`

Expected: FAIL because `classifyPort`, the `system` filter, expanded search, and count helper do not exist.

- [ ] **Step 5: Add shared data types and minimal selector implementation**

Create `src/app/types.ts`:

```ts
export interface PortInfo {
  port: number;
  pid: number;
  process_name: string;
  project_name: string | null;
  project_path: string | null;
  protocol: string;
  start_cmd: string | null;
}

export interface PortEvent {
  port: number;
  pid: number;
  process_name: string;
  framework: string | null;
  event_type: string;
  timestamp: number;
}

export interface TrafficSample { connections: number; timestamp: number }
export type TrafficByPort = Record<number, TrafficSample[]>;
export type NavPage = 'dashboard' | 'ports' | 'traffic' | 'map' | 'services' | 'logs' | 'settings';
export type PortFilter = 'all' | 'dev' | 'system' | 'other';
export type PortCategory = Exclude<PortFilter, 'all'>;
export type PortCounts = Record<PortFilter, number>;
export interface AdvancedPortFilters {
  protocol: 'all' | 'TCP' | 'UDP';
  project: 'all' | 'with-project' | 'without-project';
  restartableOnly: boolean;
  connectedOnly: boolean;
}
```

In `src/utils/helpers.ts`, classify projects first, then explicit infrastructure/system ports and processes, then known developer ports. Make every filter call `classifyPort`; search a joined list of only real fields:

```ts
const SYSTEM_PORTS = new Set([22, 80, 443, 3306, 5432, 6379, 27017]);
const SYSTEM_PROCESSES = /^(system|svchost(?:\.exe)?|lsass(?:\.exe)?|postgres|redis-server|mysqld|mongod)$/i;

export function classifyPort(port: PortInfo): PortCategory {
  if (port.project_name || port.project_path) return 'dev';
  if (SYSTEM_PORTS.has(port.port) || SYSTEM_PROCESSES.test(port.process_name)) return 'system';
  if (DEV_PORTS[port.port]) return 'dev';
  return 'other';
}
```

Extend `filterPorts` with an optional `AdvancedPortFilters` argument and an optional `TrafficByPort` argument used only for `connectedOnly`; default arguments reproduce the current All/Dev/Other plus search behavior exactly.

- [ ] **Step 6: Update `App.tsx` to import shared types and use the four-way filter**

Remove duplicate local interfaces, import from `src/app/types.ts`, and replace its inline `useMemo` filtering with `filterPorts(ports, search, portFilter)`.

- [ ] **Step 7: Run focused and full tests**

Run: `npm run test:run -- src/utils/helpers.test.ts src/App.integration.test.tsx`

Expected: PASS with no warnings.

- [ ] **Step 8: Commit the selector boundary**

```powershell
git add src/app/types.ts src/utils/helpers.ts src/utils/helpers.test.ts src/App.tsx src/App.integration.test.tsx
git commit -m "refactor: centralize port presentation data"
```

---

### Task 2: Typed Tauri Gateway and Shared PortPal State Hook

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/app/usePortPalData.ts`
- Create: `src/app/usePortPalData.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: shared types from Task 1.
- Produces: `PortPalGateway`, `tauriPortPalGateway`, `UsePortPalDataResult`, and `usePortPalData(gateway?)`.
- Preserves: the exact `get_ports`, `get_port_events`, `get_port_traffic`, `kill_process`, `restart_process`, `ports-updated`, and `port-events` names and payloads.

- [ ] **Step 1: Write failing gateway-hook behavior tests**

Use `renderHook` with a local fake gateway and fake timers. Cover initial loads, live port updates, observed start events, kill, restart, per-resource errors, and last successful scan time:

```tsx
const gateway: PortPalGateway = {
  getPorts: vi.fn().mockResolvedValue([port]),
  getPortEvents: vi.fn().mockResolvedValue([]),
  getPortTraffic: vi.fn().mockResolvedValue({ 5173: [{ connections: 3, timestamp: 1000 }] }),
  getPortGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  killProcess: vi.fn().mockResolvedValue(undefined),
  restartProcess: vi.fn().mockResolvedValue(undefined),
  onPortsUpdated: vi.fn().mockResolvedValue(() => {}),
  onPortEvents: vi.fn().mockResolvedValue(() => {}),
};

const { result } = renderHook(() => usePortPalData(gateway));
await waitFor(() => expect(result.current.loading).toBe(false));
expect(result.current.ports).toEqual([port]);
expect(result.current.traffic[5173]?.at(-1)?.connections).toBe(3);
```

Assert that killing a restartable port preserves it in `killedPorts`, nonrestartable ports do not enter that map, and restart sends `{ pid, cmd, cwd }` unchanged.

- [ ] **Step 2: Run the hook test and verify RED**

Run: `npm run test:run -- src/app/usePortPalData.test.tsx`

Expected: FAIL because the gateway and hook do not exist.

- [ ] **Step 3: Implement the typed gateway**

Create `src/lib/tauri.ts` with this public shape:

```ts
export interface GraphNodeData {
  id: string;
  port: number;
  pid: number;
  process_name: string;
  project_name: string | null;
  framework: string | null;
  is_dev: boolean;
  connection_count: number;
}

export interface GraphEdgeData {
  source: string;
  target: string;
  active: boolean;
}

export interface PortGraph { nodes: GraphNodeData[]; edges: GraphEdgeData[] }
export interface PortPalGateway {
  getPorts(): Promise<PortInfo[]>;
  getPortEvents(): Promise<PortEvent[]>;
  getPortTraffic(): Promise<TrafficByPort>;
  getPortGraph(): Promise<PortGraph>;
  killProcess(pid: number): Promise<void>;
  restartProcess(pid: number, cmd: string, cwd: string): Promise<void>;
  onPortsUpdated(handler: (ports: PortInfo[]) => void): Promise<() => void>;
  onPortEvents(handler: (events: PortEvent[]) => void): Promise<() => void>;
}
```

Implement every method as a thin `invoke` or `listen` wrapper. Do not add fallback values or translate backend errors in this file.

- [ ] **Step 4: Implement `usePortPalData` by extracting current App state and effects**

Return this stable public interface:

```ts
export interface UsePortPalDataResult {
  ports: PortInfo[];
  events: PortEvent[];
  traffic: TrafficByPort;
  killedPorts: Map<number, PortInfo>;
  killing: ReadonlySet<number>;
  restarting: ReadonlySet<number>;
  observedAt: Record<number, number>;
  lastScanAt: number | null;
  loading: boolean;
  errors: { ports: string | null; events: string | null; traffic: string | null };
  toast: string | null;
  refreshPorts(): Promise<void>;
  refreshEvents(): Promise<void>;
  killPort(port: PortInfo): Promise<void>;
  restartPort(port: PortInfo): Promise<void>;
}
```

Seed `observedAt` from started events and update it from live events. Set `lastScanAt` only after a successful port load/update. Preserve the existing four-second traffic refresh and listener cleanup.

- [ ] **Step 5: Replace the state/effects in `App.tsx` with the hook**

Keep current rendering unchanged. Adapt existing handlers to `killPort(port)` and `restartPort(port)` without changing labels, pending behavior, or toast text.

- [ ] **Step 6: Run focused and integration tests**

Run: `npm run test:run -- src/app/usePortPalData.test.tsx src/App.integration.test.tsx`

Expected: PASS; existing integration behavior remains intact.

- [ ] **Step 7: Commit the data boundary**

```powershell
git add src/lib/tauri.ts src/app/usePortPalData.ts src/app/usePortPalData.test.tsx src/App.tsx
git commit -m "refactor: isolate PortPal frontend data flow"
```

---

### Task 3: Monochrome Tokens and Reusable UI Primitives

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/components/ui/controls.tsx`
- Create: `src/components/ui/controls.test.tsx`
- Create: `src/components/ui/ui.css`
- Modify: `src/main.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: `Button`, `IconButton`, `SearchInput`, `SegmentedControl`, `PageHeader`, `LoadingState`, and `EmptyState`.
- Preserves: root `--fs-scale` and the merged text-size behavior.

- [ ] **Step 1: Write failing primitive accessibility tests**

```tsx
render(<SearchInput label="Search ports" value="" onChange={vi.fn()} placeholder="Search ports, process, project..." />);
expect(screen.getByRole('searchbox', { name: 'Search ports' })).toBeVisible();

render(<SegmentedControl ariaLabel="Port category" value="dev" options={options} onChange={onChange} />);
expect(screen.getByRole('button', { name: 'Dev 2' })).toHaveAttribute('aria-pressed', 'true');
```

Also assert icon-only buttons require a nonempty `label` that becomes both accessible name and `title`.

- [ ] **Step 2: Run the primitive test and verify RED**

Run: `npm run test:run -- src/components/ui/controls.test.tsx`

Expected: FAIL because the primitives do not exist.

- [ ] **Step 3: Add the approved token layer**

Create `src/styles/tokens.css` with named semantic aliases and the retained type scale:

```css
:root {
  --surface-app: #0a0a0a;
  --surface-shell: #0d0d0d;
  --surface-primary: #111111;
  --surface-hover: #171717;
  --surface-selected: #1d1d1d;
  --border-default: #262626;
  --text-primary: #f5f5f5;
  --text-secondary: #a3a3a3;
  --text-muted: #666666;
  --text-disabled: #444444;
  --danger: #b86a6a;
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
  --fs-scale: 1;
  --sidebar-width: 232px;
  --titlebar-height: 46px;
}
```

Include the merged `--fs-3xs` through `--fs-5xl` calculations and neutral focus/hover timing tokens.

- [ ] **Step 4: Implement the primitive components and styles**

Use ordinary buttons and inputs, `aria-pressed` for segments, inline monochrome SVG icons, 6 to 10 pixel radii, one-pixel neutral borders, and no gradients, glow, blur, or framework-specific color.

- [ ] **Step 5: Import the new global layers without deleting old feature CSS**

Make `src/index.css` import `styles/tokens.css` and `styles/global.css`. Keep `App.css` and `PortMap.css` until their consumers migrate.

- [ ] **Step 6: Run primitive tests and TypeScript**

Run: `npm run test:run -- src/components/ui/controls.test.tsx`

Run: `npx tsc --noEmit`

Expected: both PASS.

- [ ] **Step 7: Commit the design-system foundation**

```powershell
git add src/styles src/components/ui src/main.tsx src/index.css
git commit -m "feat: add monochrome UI foundation"
```

---

### Task 4: Reference-Matched Application Shell

**Files:**
- Create: `src/components/shell/Titlebar.tsx`
- Create: `src/components/shell/Sidebar.tsx`
- Create: `src/components/shell/MonitoringStatus.tsx`
- Create: `src/components/shell/AppShell.tsx`
- Create: `src/components/shell/AppShell.test.tsx`
- Create: `src/components/shell/shell.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `NavPage`, `PortInfo`, `lastScanAt`, shared UI primitives, and Tauri window controls.
- Produces: `AppShell({ page, onNavigate, ports, lastScanAt, children })`.

- [ ] **Step 1: Write failing shell tests**

Render the shell with two ports owned by one PID and assert:

```tsx
expect(screen.getByText('PortPal')).toBeVisible();
expect(screen.getAllByRole('button', { name: 'Dashboard' })).toHaveLength(1);
expect(screen.getByRole('button', { name: 'Ports' })).toHaveAttribute('aria-current', 'page');
expect(screen.getByText('1 process, 2 ports')).toBeVisible();
expect(screen.getByText('Last scan: 2s ago')).toBeVisible();
expect(screen.getByRole('button', { name: 'Minimize' })).toBeVisible();
```

Assert all seven existing destinations appear in this order: Dashboard, Ports, Traffic, Services, Port Map, Logs, Settings.

- [ ] **Step 2: Run the shell test and verify RED**

Run: `npm run test:run -- src/components/shell/AppShell.test.tsx`

Expected: FAIL because the shell components do not exist.

- [ ] **Step 3: Implement titlebar, sidebar, and monitoring status**

Use the reference's broad sidebar, horizontal icon-and-label navigation, integrated PortPal brand, and lower monitoring panel. Keep `getCurrentWindow().minimize()`, `.toggleMaximize()`, and `.close()` calls unchanged.

- [ ] **Step 4: Implement responsive shell styling**

At widths below 980px, reduce `--sidebar-width` to 176px. At widths below 820px, reduce it to 72px, visually hide navigation labels while retaining accessible names, and turn the inspector into an overlay in later tasks.

- [ ] **Step 5: Replace only the old titlebar/sidebar markup in `App.tsx`**

Continue rendering the existing page bodies inside `AppShell`; do not migrate page behavior in this task.

- [ ] **Step 6: Run shell and App integration tests**

Run: `npm run test:run -- src/components/shell/AppShell.test.tsx src/App.integration.test.tsx`

Expected: PASS after updating integration queries to the new accessible navigation names.

- [ ] **Step 7: Commit the shell**

```powershell
git add src/components/shell src/App.tsx src/App.integration.test.tsx
git commit -m "feat: rebuild the PortPal application shell"
```

---

### Task 5: Shared Real-Data Port Inspector

**Files:**
- Create: `src/features/inspector/portInspectorModel.ts`
- Create: `src/features/inspector/portInspectorModel.test.ts`
- Create: `src/features/inspector/PortInspector.tsx`
- Create: `src/features/inspector/PortInspector.test.tsx`
- Create: `src/features/inspector/PortInspector.css`

**Interfaces:**
- Consumes: `PortInfo`, current traffic samples, observed timestamp, killed state, pending sets, and existing kill/restart callbacks.
- Produces: `buildInspectorModel(input)` and `PortInspector`.

- [ ] **Step 1: Write failing model tests for real and missing values**

```ts
const model = buildInspectorModel({ port, connections: 12, observedAt: 1000, now: 121000 });
expect(model.overview).toContainEqual({ label: 'PID', value: '18344', mono: true });
expect(model.overview).toContainEqual({ label: 'Started', value: 'Observed 2m ago', mono: false });
expect(model.project?.path).toBe('C:\\work\\PortPal');
expect(JSON.stringify(model)).not.toMatch(/User|Local Address|Close Connections/);
```

Add cases for missing project path, missing command, zero connections, and a killed/restartable port.

- [ ] **Step 2: Run the model test and verify RED**

Run: `npm run test:run -- src/features/inspector/portInspectorModel.test.ts`

Expected: FAIL because the inspector model does not exist.

- [ ] **Step 3: Implement the pure inspector model**

Return only available Overview, Project, and Process values. Label event timing `Observed …`; never label it as an OS start time.

- [ ] **Step 4: Write failing inspector interaction tests**

Assert close, Escape, kill, conditional restart, pending disabling, definition-list semantics, and omission of unsupported actions:

```tsx
expect(screen.queryByRole('button', { name: /Close Connections/i })).not.toBeInTheDocument();
await user.click(screen.getByRole('button', { name: 'Kill Process' }));
expect(onKill).toHaveBeenCalledWith(port);
```

- [ ] **Step 5: Run the component test and verify RED**

Run: `npm run test:run -- src/features/inspector/PortInspector.test.tsx`

Expected: FAIL because `PortInspector` does not exist.

- [ ] **Step 6: Implement and style the shared inspector**

Use a 320px IDE-like side panel with semantic section headings, definition lists, restrained separators, a close icon, and existing Kill/Restart callbacks. Destructive red appears only on the Kill action and its hover/focus state.

- [ ] **Step 7: Run both inspector suites**

Run: `npm run test:run -- src/features/inspector`

Expected: PASS.

- [ ] **Step 8: Commit the inspector**

```powershell
git add src/features/inspector
git commit -m "feat: add shared port inspector"
```

---

### Task 6: Ports Reference Screen

**Files:**
- Create: `src/features/ports/PortsPage.tsx`
- Create: `src/features/ports/PortsPage.test.tsx`
- Create: `src/features/ports/PortTable.tsx`
- Create: `src/features/ports/PortFilters.tsx`
- Create: `src/features/ports/ports.css`
- Modify: `src/App.tsx`
- Modify: `src/App.integration.test.tsx`

**Interfaces:**
- Consumes: shared port state/actions, selectors, primitives, inspector, and `onNavigate('map')`.
- Produces: `PortsPage` with existing behavior plus real-data System and advanced filters.

```ts
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
```

- [ ] **Step 1: Write failing Ports screen tests against the reference hierarchy**

Cover heading/count, exact search placeholder, All/Dev/System/Other counts, Filter, Kill All, map-toggle action, table headings, row selection, and inspector:

```tsx
expect(screen.getByRole('heading', { name: 'Ports' })).toBeVisible();
expect(screen.getByText('3 listening ports')).toBeVisible();
expect(screen.getByPlaceholderText('Search ports, process, project...')).toBeVisible();
expect(screen.getByRole('columnheader', { name: 'PORT' })).toBeVisible();
expect(screen.getByRole('columnheader', { name: 'PROCESS' })).toBeVisible();
expect(screen.getByRole('columnheader', { name: 'PROJECT' })).toBeVisible();
```

Also cover loading, empty, and failed-port-load states. A failed load must display Retry and must not claim that zero ports are listening.

- [ ] **Step 2: Add failing behavior-preservation tests**

Assert individual Kill, conditional Restart, immediate Kill All across the current filtered results, stopped/restartable rows, and Open Port Map. Kill All must not introduce a confirmation dialog.

- [ ] **Step 3: Run the Ports tests and verify RED**

Run: `npm run test:run -- src/features/ports/PortsPage.test.tsx`

Expected: FAIL because `PortsPage` does not exist.

- [ ] **Step 4: Implement the page header, filters, and real-data table**

Use a CSS grid shell with the table and inspector as siblings. Table rows use separators, neutral status dots, and mono technical values. Keep kill/restart directly reachable in the Actions column; an ellipsis may visually group them but must not change their callback arguments or pending behavior.

The Filter popover contains only fields available now: protocol, has project, restartable, and has active connections. Its default state changes nothing.

- [ ] **Step 5: Implement selection and responsive inspector behavior**

Click, Enter, or Space selects a row. Clicking the active row, Escape, close, or navigation clears selection. Below 980px the inspector overlays the right side; below 820px it occupies the content width minus the compact sidebar.

- [ ] **Step 6: Replace the inline Ports block in `App.tsx`**

Pass existing live state and actions. Remove only markup and CSS no longer used by Ports; retain other page styles until Task 8.

- [ ] **Step 7: Run Ports and App integration tests**

Run: `npm run test:run -- src/features/ports/PortsPage.test.tsx src/App.integration.test.tsx`

Expected: PASS, including unchanged invoke payload assertions.

- [ ] **Step 8: Commit the Ports reference implementation**

```powershell
git add src/features/ports src/App.tsx src/App.integration.test.tsx src/App.css
git commit -m "feat: rebuild the Ports workspace"
```

---

### Task 7: Stable Monochrome Port Map

**Files:**
- Create: `src/features/port-map/graphModel.ts`
- Create: `src/features/port-map/graphModel.test.ts`
- Create: `src/features/port-map/usePortGraph.ts`
- Create: `src/features/port-map/PortMapPage.tsx`
- Create: `src/features/port-map/PortMapPage.test.tsx`
- Create: `src/features/port-map/PortTopology.tsx`
- Create: `src/features/port-map/MapControls.tsx`
- Create: `src/features/port-map/MapLegend.tsx`
- Create: `src/features/port-map/MapMinimap.tsx`
- Create: `src/features/port-map/port-map.css`
- Modify: `src/App.tsx`
- Delete: `src/PortMap.tsx`
- Delete: `src/PortMap.css`

**Interfaces:**
- Consumes: `PortGraph`, `PortInfo[]`, shared gateway, classification, shared inspector, and existing kill/restart callbacks.
- Produces: `filterGraph`, `resolveGraphSelection`, `PortMapPage`, and a D3 topology with controlled zoom/selection.

`PortTopology` owns simulation-only copies of `GraphNodeData` and `GraphEdgeData`, so D3's mutation of `x`, `y`, `source`, and `target` never mutates the gateway response retained by `usePortGraph`.

- [ ] **Step 1: Write failing pure graph-model tests**

Test search, All/Dev/System/Other filtering, edge removal when endpoints are hidden, selection resolution by port and PID, grouping eligibility, and the absence of external synthesis:

```ts
const filtered = filterGraph(graph, ports, { search: 'PortPal', category: 'all' });
expect(filtered.nodes.map((node) => node.id)).toEqual(['port:5173']);
expect(filtered.edges).toEqual([]);
expect(filtered.nodes.every((node) => !node.id.startsWith('external:'))).toBe(true);
```

- [ ] **Step 2: Run graph-model tests and verify RED**

Run: `npm run test:run -- src/features/port-map/graphModel.test.ts`

Expected: FAIL because the graph model does not exist.

- [ ] **Step 3: Implement graph selectors and `usePortGraph`**

`usePortGraph(gateway)` loads `get_port_graph`, retains the last valid graph on refresh failure, exposes `loading`, `error`, and `refresh`, and refreshes on the existing `ports-updated` signal without changing the backend.

- [ ] **Step 4: Write failing Port Map control and preservation tests**

Assert the title/subtitle, search, four categories, checked/disabled Show external control, Group by project eligibility, zoom buttons, fit control, Refresh, Close Port Map, legend, minimap, and selected-node Kill behavior.

```tsx
expect(screen.getByRole('checkbox', { name: 'Show external' })).toBeDisabled();
expect(screen.getByRole('button', { name: 'Refresh map' })).toBeVisible();
expect(screen.getByRole('button', { name: 'Close Port Map' })).toBeVisible();
```

- [ ] **Step 5: Run Port Map component tests and verify RED**

Run: `npm run test:run -- src/features/port-map/PortMapPage.test.tsx`

Expected: FAIL because the page and controls do not exist.

- [ ] **Step 6: Implement the React page and D3 topology**

Render nodes as dark rounded rectangles with project/service name, port, and process/framework text. Use thin neutral solid edges. Set `role="button"`, `tabindex="0"`, and Enter/Space handlers on node groups. Retain drag and D3 zoom. Stop the simulation after it settles; do not add particle canvases, glow filters, pulsing transitions, decorative rings, or animation loops.

- [ ] **Step 7: Implement zoom controls, grouping, legend, and minimap**

Expose zoom percentage from the D3 transform, clamp between 50% and 200%, and make fit-to-view compute a transform from real node bounds. Group by project adjusts force targets only when at least two named projects exist. The minimap reads real settled node coordinates and viewport bounds.

- [ ] **Step 8: Integrate the shared inspector and existing actions**

Resolve the selected graph node to shared `PortInfo`. Use the inspector for Kill and conditional Restart. Preserve the page's Refresh and Close controls and clear selection when the node disappears.

- [ ] **Step 9: Replace old Port Map imports and run tests**

Run: `npm run test:run -- src/features/port-map src/App.integration.test.tsx`

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 10: Commit the Port Map migration**

```powershell
git add src/features/port-map src/App.tsx src/PortMap.tsx src/PortMap.css
git commit -m "feat: rebuild Port Map as a technical topology"
```

---

### Task 8: Preserve and Restyle Dashboard, Traffic, Services, Logs, and Settings

**Files:**
- Create: `src/components/ui/Sparkline.tsx`
- Create: `src/features/dashboard/DashboardPage.tsx`
- Create: `src/features/traffic/TrafficPage.tsx`
- Create: `src/features/services/ServicesPage.tsx`
- Create: `src/features/logs/LogsPage.tsx`
- Create: `src/features/settings/SettingsPage.tsx`
- Create: `src/features/secondary-pages.test.tsx`
- Create: `src/features/secondary-pages.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: existing ports, events, traffic, their resource-specific error states, retry callbacks, font scale, navigation callbacks, and event refresh.
- Produces: focused page components with unchanged user-facing actions and monochrome presentation.

- [ ] **Step 1: Write failing cross-page preservation tests**

Cover Dashboard summary/navigation cards, Traffic totals and rows, Services grouping, Logs refresh/event rows, and Settings font-scale persistence:

```tsx
await user.click(screen.getByRole('button', { name: 'Larger' }));
expect(onFontScale).toHaveBeenCalledWith(1.3);

await user.click(screen.getByRole('button', { name: 'Refresh logs' }));
expect(onRefresh).toHaveBeenCalledTimes(1);
```

Add error cases proving Traffic and Logs show a compact Retry action without replacing valid stale data from an earlier successful load.

- [ ] **Step 2: Run secondary-page tests and verify RED**

Run: `npm run test:run -- src/features/secondary-pages.test.tsx`

Expected: FAIL because the extracted page modules do not exist.

- [ ] **Step 3: Extract the existing page logic without changing data or callbacks**

Move current JSX and calculations into the five page modules. Move Sparkline into a shared component. Preserve Dashboard click navigation, Logs refresh, and Settings `Standard`/`Large`/`Larger` buttons exactly. Wire the hook's traffic and event error fields to compact retry states while retaining previously loaded rows.

- [ ] **Step 4: Apply the shared monochrome hierarchy**

Replace colored cards/badges with neutral sections, separators, restrained list rows, and mono technical values. Sparklines use neutral gray strokes and no gradient fill. Do not remove empty states, event types, service grouping, or traffic summaries.

- [ ] **Step 5: Replace the inline components in `App.tsx`**

Import each focused page and delete only the now-moved component definitions. Keep `App.tsx` responsible for page selection and prop wiring.

- [ ] **Step 6: Run secondary and integration tests**

Run: `npm run test:run -- src/features/secondary-pages.test.tsx src/App.integration.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the secondary screens**

```powershell
git add src/components/ui/Sparkline.tsx src/features src/App.tsx src/App.integration.test.tsx
git commit -m "feat: unify remaining screens with monochrome UI"
```

---

### Task 9: Final App Composition, Responsive CSS, and Browser Smoke Coverage

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.integration.test.tsx`
- Modify: `e2e/critical.spec.ts`
- Create: `e2e/fixtures/tauri.ts`
- Delete: `src/App.css`

**Interfaces:**
- Consumes: all components from Tasks 1 through 8.
- Produces: final application composition and deterministic preview smoke fixtures that never ship in production.

- [ ] **Step 1: Write failing full-App preservation assertions**

Extend `src/App.integration.test.tsx` to verify all seven navigation destinations, unchanged kill/restart invoke payloads, immediate filtered Kill All behavior, live update handling, map navigation/close, and persisted font scale.

- [ ] **Step 2: Run the integration suite and verify RED for missing final wiring**

Run: `npm run test:run -- src/App.integration.test.tsx`

Expected: FAIL only on final wiring or accessible-name assertions introduced in Step 1.

- [ ] **Step 3: Reduce `App.tsx` to orchestration**

Keep navigation state, font-scale state, the shared data hook, and feature prop wiring. Remove obsolete inline icons, components, duplicated selectors, and dead imports only after their replacements are tested.

Remove the `App.css` import and delete the file after confirming every live selector is owned by `styles`, `components`, or `features` CSS.

- [ ] **Step 4: Finish responsive and density rules**

Verify these explicit behaviors in CSS:

```css
@media (max-width: 980px) {
  :root { --sidebar-width: 176px; }
  .port-inspector { position: absolute; inset: 0 0 0 auto; width: min(360px, calc(100% - 24px)); }
}

@media (max-width: 820px) {
  :root { --sidebar-width: 72px; }
  .sidebar__label, .monitoring-status__details { position: absolute; clip: rect(0 0 0 0); }
  .port-table__project, .port-table__connections { display: none; }
}
```

Use text overflow for process/project paths and maintain keyboard access when text is visually hidden.

- [ ] **Step 5: Add a test-only Tauri preview fixture**

Create `e2e/fixtures/tauri.ts` exporting `installTauriFixture(page, fixture)`. Before navigation, use `page.addInitScript` to define `window.__TAURI_INTERNALS__` with `invoke`, `transformCallback`, and `unregisterCallback`. `invoke(cmd, args)` returns deterministic values for `get_ports`, `get_port_events`, `get_port_traffic`, `get_port_graph`, `kill_process`, `restart_process`, `plugin:event|listen`, and `plugin:event|unlisten`. `transformCallback` stores callbacks by numeric ID so Tauri's event wrapper can initialize without a native runtime. Provide no external graph nodes. The fixture lives only under `e2e`; production source must contain no sample ports or external nodes.

- [ ] **Step 6: Update browser smoke tests to the new accessible UI**

At 1536 by 1024, assert the reference shell, Ports table, row selection/inspector, Port Map controls, all existing navigation, Logs refresh, and Settings scale. At 780 by 480, assert compact navigation, scrollable content, and operable inspector close.

- [ ] **Step 7: Run full frontend and browser tests**

Run: `npm run test:run`

Run: `npm run test:e2e`

Expected: all tests pass with no React warnings, unhandled promise rejections, or console errors caused by the application.

- [ ] **Step 8: Commit final composition and smoke coverage**

```powershell
git add src e2e
git commit -m "test: lock down redesigned PortPal workflows"
```

---

### Task 10: Visual and Build Verification

**Files:**
- Modify only files required by a failing verification; every production fix requires a reproducing failing test first.

**Interfaces:**
- Verifies: frontend behavior, Rust backend stability, responsive rendering, visual constraints, and repository cleanliness.

- [ ] **Step 1: Run the complete frontend suite**

Run: `npm run test:run -- --reporter=verbose`

Expected: all tests pass and output is free of React act warnings and unhandled errors.

- [ ] **Step 2: Run TypeScript and production build**

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: both exit 0.

- [ ] **Step 3: Run Rust tests without changing backend code**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all merged backend tests pass.

- [ ] **Step 4: Run browser smoke tests**

Run: `npm run test:e2e`

Expected: every critical path passes at both reference and minimum sizes.

- [ ] **Step 5: Capture and inspect reference-sized screens**

Use the deterministic E2E fixture to capture Ports and Port Map at 1536 by 1024 plus both screens at 780 by 480. Compare them directly with:

- `C:\Users\123da\PycharmProjects\PortPal\New assets\main page asset.png`
- `C:\Users\123da\PycharmProjects\PortPal\New assets\portmap assets.png`

Reject the implementation if shell proportions, table density, inspector integration, map node treatment, palette, or hierarchy materially drift from the references.

- [ ] **Step 6: Audit prohibited visual patterns and fabricated data**

Run:

```powershell
rg -n "#7c6fff|#646cff|linear-gradient|backdrop-filter|box-shadow:.*(purple|blue)|external:" src
rg -n "Local Address|Close Connections|NPM Registry|142\.250\.|140\.82\." src
```

Expected: no production matches except restrained noncolor shadows explicitly justified by the spec; no fabricated reference data.

- [ ] **Step 7: Review the exact working-tree delta**

Run:

```powershell
git diff --check
git status --short
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

Confirm that `src-tauri` production files are unchanged by redesign commits and that every existing feature/action has a passing preservation test.

- [ ] **Step 8: Record known backend gaps in the handoff**

Report the unavailable OS user, exact local address, true process start time, individual endpoints, external nodes, weighted edges, close-connections, open-path, and terminal actions. Point to the spec's Future Backend Additions section; do not implement them in this branch.
