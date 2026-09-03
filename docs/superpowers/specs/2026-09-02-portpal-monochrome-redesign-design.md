# PortPal Monochrome Redesign Design

## Purpose

Redesign PortPal as a minimal monochrome desktop developer utility while preserving its existing Tauri backend behavior and frontend capabilities. The two images in `../New assets` are the visual source of truth:

- `main page asset.png` for the Ports screen
- `portmap assets.png` for the Port Map screen

The redesign must remain recognizably PortPal. It improves presentation, information hierarchy, component boundaries, and interaction quality without replacing real port discovery, traffic, process management, event history, project detection, or topology data.

## Scope

The work covers the application shell and all existing navigation destinations:

- Dashboard
- Ports
- Traffic
- Services
- Port Map
- Logs
- Settings

Ports is the reference implementation for the visual language. Port Map then reuses the same shell, controls, data presentation, and inspector. Dashboard, Traffic, Services, Logs, and Settings retain their current functionality while adopting the same design system.

Every existing navigation destination, control, action, and backend interaction remains accessible and retains its current behavior. Controls may move or receive new presentation, but the redesign does not remove or redefine them solely to match the references.

## Design Principles

- Use an almost entirely monochrome palette.
- Use typography, spacing, borders, and density for hierarchy instead of accent colors.
- Prefer thin separators and open layouts over card grids.
- Keep depth subtle and functional.
- Avoid gradients, glass effects, glows, decorative particles, framework colors, and large SaaS-style cards.
- Use short transitions only for state changes such as hover, selection, disclosure, and inspector entry.
- Do not animate the map continuously. Nodes move only when topology changes or the user manipulates the graph.
- Never fabricate backend data to make the UI resemble the reference.

## Visual Tokens

The shared CSS token layer uses these base values:

| Role | Value |
| --- | --- |
| Application background | `#0A0A0A` |
| Sidebar and titlebar | `#0D0D0D` |
| Primary surface | `#111111` |
| Hover/elevated surface | `#171717` |
| Selected surface | `#1D1D1D` |
| Border | `#262626` |
| Primary text | `#F5F5F5` |
| Secondary text | `#A3A3A3` |
| Muted text | `#666666` |
| Disabled | `#444444` |

Destructive actions may use a restrained red foreground or border when the meaning would otherwise be unclear. Status is not represented as a collection of colorful badges.

Geist is used for navigation, headings, labels, buttons, and general interface copy. JetBrains Mono is used for ports, PIDs, addresses, commands, paths where useful, counts, and other technical values.

Control radii remain restrained, generally 6 to 10 pixels. Surfaces use one-pixel borders. Hover changes use a slightly lighter surface. Selection uses a stronger neutral surface and border. Focus uses a brighter gray border without glow.

## Frontend Architecture

The current frontend is reorganized around focused modules while preserving the current React and Tauri command architecture:

```text
src/
  app/
    AppShell.tsx
    usePortPalData.ts
    types.ts
  components/
    shell/
      Titlebar.tsx
      Sidebar.tsx
      MonitoringStatus.tsx
    ui/
      Button.tsx
      IconButton.tsx
      SearchInput.tsx
      SegmentedControl.tsx
      EmptyState.tsx
      LoadingState.tsx
  features/
    ports/
      PortsPage.tsx
      PortTable.tsx
      portFilters.ts
    port-map/
      PortMapPage.tsx
      PortTopology.tsx
      graphModel.ts
      MapControls.tsx
      MapLegend.tsx
      MapMinimap.tsx
    inspector/
      PortInspector.tsx
      portInspectorModel.ts
    traffic/
      TrafficPage.tsx
    services/
      ServicesPage.tsx
    logs/
      LogsPage.tsx
    settings/
      SettingsPage.tsx
  lib/
    tauri.ts
    portPresentation.ts
  styles/
    tokens.css
    global.css
```

Exact splits may follow existing code constraints, but each module keeps one clear responsibility. Tauri calls and event listeners live behind a small typed frontend boundary. Presentation adapters distinguish real values from unavailable values before they reach components.

## Application Shell

The app keeps its frameless Tauri window and React window controls. The titlebar remains draggable, with minimize, maximize, and close controls aligned at the upper right.

The persistent sidebar contains the PortPal identity followed by:

1. Dashboard
2. Ports
3. Traffic
4. Services
5. Port Map
6. Logs
7. Settings

The active destination uses `#1D1D1D`, white text and iconography, and subtle border contrast. It never uses a colored accent.

The bottom of the sidebar contains a monitoring panel with:

- Monitoring status
- Number of observed processes and listening ports
- Time since the last successful port update

The process count is derived from unique real PIDs. The listening count is derived from the current port list. Last scan time is recorded from successful initial loads and `ports-updated` events.

At large sizes, the shell follows the reference proportions, including a sidebar near 232 pixels. It must still work at PortPal's configured minimum size of 780 by 480 pixels. At narrow widths, spacing and columns compress, nonessential secondary text may truncate, and the inspector becomes an overlay or collapsible layer. Ports, actions, navigation, and selection remain accessible.

## Shared Data Ownership

`usePortPalData` owns current ports, traffic samples, recent events, observed start times, pending kill/restart state, killed-but-restartable processes, load errors, and scan timestamps. It retains the existing commands and events:

- `get_ports`
- `get_port_events`
- `get_port_traffic`
- `kill_process`
- `restart_process`
- `ports-updated`
- `port-events`

Port Map continues to load `get_port_graph`, but selection is resolved back to the richer shared `PortInfo` record by port and PID. This allows Ports and Port Map to render the same inspector rather than separate approximations.

## Ports Screen

The screen follows the first reference.

The header contains the title, real listening-port count, and a large search input with the placeholder `Search ports, process, project...`.

Below the header is a compact control row:

- All
- Dev
- System
- Other
- Filter
- Kill All

All counts are derived from the visible port data. Search matches port, process name, project name, project path, framework label, and protocol where present.

Classification is implemented as a deterministic pure selector:

- Dev: known developer/runtime ports, a detected project, or a known development framework.
- System: known infrastructure services and well-known system ports/processes represented by an explicit maintainable allowlist.
- Other: values that cannot be classified confidently.

The Filter action exposes only filters backed by current fields, such as protocol, project presence, restartability, and active connection count. It does not expose user, address, or endpoint filters until the backend supplies them.

Kill All preserves its current behavior by dispatching the existing kill action for the current filtered result immediately. Individual kill and restart operations preserve the existing command behavior and pending-state protections.

The table uses these columns when space permits:

- Port and protocol
- Process and command/executable summary
- Project and path
- PID
- Connections
- Started/observed time
- Actions

Rows use separators instead of individual cards. A neutral status dot indicates a currently observed listener. Selecting a row opens the shared inspector. Keyboard selection and visible focus are supported. Secondary values truncate with a native title or accessible label where appropriate.

The current stopped/restartable row behavior is preserved. A stopped row uses muted presentation plus restrained destructive status and exposes restart only when both start command and project path are available.

## Shared Port Inspector

The inspector is a right-side IDE-style panel, not a modal. It is shared by Ports and Port Map.

The inspector displays only real available values:

- Listening/observed status
- Protocol
- Process name
- PID
- Observed start time when known
- Latest active connection count
- Project name and path when detected
- Start command when detected

Unavailable rows are omitted rather than shown with invented values. Optional sections disappear cleanly when empty.

Supported actions are:

- Kill process
- Restart process when `start_cmd` and `project_path` are both present

Open in Explorer/Finder, Show in Terminal, Close Connections, OS user, and exact local address are not presented as working features because the current shipping command path does not support them.

The panel closes by close button, Escape, navigation away, or selecting the active row/node again. If the selected listener disappears, the panel closes or transitions to the real stopped/restartable representation when the stored data supports it.

## Port Map

The screen follows the second reference while using only current graph data.

The header contains:

- Port Map title and subtitle
- Search input
- All, Dev, System, and Other filters
- Show external option
- Group by project option
- Zoom out, zoom percentage, zoom in, and fit/fullscreen controls
- Existing refresh and close controls

The map canvas is black and open. Nodes are rectangular dark surfaces with thin gray borders. Their labels prioritize project/service name, port, and process/framework. Different node categories use iconography, text, and border treatment rather than framework color.

Known internal relationships use thin solid gray edges. Current backend edges are unweighted, so the UI does not fabricate edge-count badges. The graph's node `connection_count` is presented as a node-level related-service count only where labeling it this way is accurate.

Show external is visible but disabled with concise explanatory text because the current graph contains no external endpoints. It becomes functional only after external node data exists.

Group by project is enabled only when useful grouping can be derived from current project names. Nodes without a project remain ungrouped. Grouping changes layout forces and optional boundary treatment; it does not change the underlying graph.

Search and filters dim or hide nodes consistently and preserve comprehensible edges. Selecting a node opens the shared inspector using its matching `PortInfo` where available.

The topology retains functional D3 dragging, zooming, refresh, close, node selection, and node-level kill behavior. It removes the particle canvas, neon glows, pulsing nodes, decorative rings, animated flow strokes, and continuous decorative movement. The simulation settles and remains stable until data or user interaction changes it.

A compact legend explains service nodes and connection lines. A lightweight minimap mirrors real node positions in the lower-right corner and indicates the viewport. Fit-to-view is the reference's fullscreen-style control; actual application fullscreen is not required.

## Remaining Screens

Dashboard retains its current summaries, navigation links, service overview, traffic information, and recent events while adopting the monochrome tokens and restrained surfaces.

Traffic retains real connection samples and sparklines but renders them with neutral strokes and surfaces. Its summary and rows use the shared page header and separators instead of colorful statistic cards.

Services retains grouping by detected project/framework/process and current traffic summaries. Service groups become restrained list or compact grid surfaces without framework-colored card borders.

Logs retains the real event history and refresh action. Started and stopped events use text, iconography, and minimal semantic treatment rather than colored badge blocks.

Settings remains an honest empty/coming-soon state because no settings backend currently exists. It adopts the shared shell and page-header structure without adding fake controls.

## Error, Loading, and Empty States

Initial loading uses a restrained neutral progress indicator. Empty states are compact and factual.

Previously swallowed fetch errors become local error states with a retry action. A Ports failure does not claim there are zero ports. Port Map graph failures do not erase a previously valid graph. Traffic or event failures do not break port discovery.

Kill and restart failures display restrained toast feedback. Buttons are disabled only for the affected pending action. Bulk kill reports partial failure accurately instead of claiming all processes were killed.

## Accessibility

- Every icon-only control has an accessible name and title.
- Table rows and map nodes are keyboard selectable.
- Focus indicators use neutral border contrast.
- The active navigation item uses `aria-current="page"`.
- Popovers and inspector dismissal return focus predictably to their trigger or selected item.
- Inspector sections use semantic headings and definition lists.
- Status is never communicated by color alone.
- Controls retain readable contrast in all states.

## Backend Capability Matrix

| Reference field or action | Current source | Redesign behavior |
| --- | --- | --- |
| Port | `PortInfo.port` | Display |
| PID | `PortInfo.pid` | Display |
| Process | `PortInfo.process_name` | Display |
| Protocol | `PortInfo.protocol` | Display |
| Project name/path | `PortInfo.project_name`, `project_path` | Display when present |
| Start command | `PortInfo.start_cmd` | Display when present; enables restart with project path |
| Latest connection count | `TrafficSample.connections` | Display as current port-level sample |
| Observed start time | `PortEvent.timestamp` and in-memory observation | Label as observed time |
| Internal graph nodes | `GraphNode` | Display |
| Internal graph relationships | `GraphEdge` | Display as unweighted solid lines |
| OS user | Not exposed | Omit |
| Exact local address | Not exposed | Omit |
| True OS process start time | Not exposed | Omit; do not mislabel observation time |
| Individual connections | Not exposed | Omit connection list |
| External hosts | Not exposed | Disable Show external and omit external nodes |
| Per-edge connection counts | Not exposed | Omit edge badges |
| Close connections | No command | Omit action |
| Open project path | Plugin path diverges between Tauri entrypoints | Omit action until supported consistently |
| Show in terminal | No command | Omit action |

## Future Backend Additions

To reproduce every reference detail truthfully, a later backend change should add:

1. A richer port-detail payload containing process user, exact listening addresses, and OS process start time.
2. A connection-record payload containing local and remote address/port, state, owning PID, protocol, and aggregation count.
3. External graph nodes and weighted edges derived from those connection records, with hostname resolution kept optional and nonblocking.
4. A close-connections command with platform-specific support and explicit failure semantics.
5. Consistent opener plugin registration and permissions in both `main.rs` and `lib.rs`, followed by a typed open-path command or supported plugin call.
6. A platform-aware show-in-terminal command with safe argument handling.
7. Exposure of logger first-seen timestamps through the primary port payload or a dedicated command if persistent observed timing is desired.

These additions are out of scope for the visual redesign and are not simulated in the frontend.

## Testing Strategy

Add Vitest, React Testing Library, `user-event`, and jsdom. Keep Tauri calls behind a mockable typed boundary while tests exercise real component behavior and pure selectors.

Focused tests cover:

- Dev/System/Other classification and filter counts
- Search across every supported real field
- Filter composition
- Kill All dispatch across the current filtered result without introducing a confirmation step
- Individual kill and restart pending/error behavior
- Shared inspector selection, dismissal, and omission of unavailable fields
- Navigation state and monitoring summary
- Observed-time labeling
- Graph filtering and search transformation
- Node selection resolving to shared port details
- Zoom, fit-to-view, grouping eligibility, and disabled external control
- Loading, empty, stale-data, and retry states
- Accessibility names and keyboard behavior for critical controls

Verification consists of focused tests during each red-green cycle, the complete frontend test suite, TypeScript checking, the Vite production build, and a final working-tree/diff review. Visual inspection compares Ports and Port Map at the reference aspect ratio and at the configured minimum window size.

## Delivery Order

1. Establish test infrastructure and typed data boundaries.
2. Add shared tokens and primitive controls.
3. Build the application shell and monitoring panel.
4. Rebuild Ports and its filtering/actions.
5. Build the shared inspector and integrate it with Ports.
6. Rebuild Port Map and integrate the shared inspector.
7. Restyle Dashboard, Traffic, Services, Logs, and Settings.
8. Verify behavior, accessibility, responsive layouts, and build output.

Each stage leaves the application usable and preserves current backend contracts.
