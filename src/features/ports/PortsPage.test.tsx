import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PortInfo } from "../../app/types";
import { PortsPage, type PortsPageProps } from "./PortsPage";

const devPort: PortInfo = {
  port: 3000,
  pid: 1111,
  process_name: "node",
  project_name: "Web App",
  project_path: "C:\\work\\web-app",
  protocol: "TCP",
  start_cmd: "npm run dev",
};

const systemPort: PortInfo = {
  port: 49664,
  pid: 2222,
  process_name: "lsass.exe",
  project_name: null,
  project_path: null,
  protocol: "TCP",
  start_cmd: null,
};

const otherPort: PortInfo = {
  port: 9229,
  pid: 3333,
  process_name: "node",
  project_name: null,
  project_path: null,
  protocol: "UDP",
  start_cmd: null,
};

const stoppedPort: PortInfo = {
  port: 5173,
  pid: 4444,
  process_name: "vite",
  project_name: "PortPal",
  project_path: "C:\\work\\PortPal",
  protocol: "TCP",
  start_cmd: "npm run dev",
};

function renderPorts(overrides: Partial<PortsPageProps> = {}) {
  const onRetry = vi.fn().mockResolvedValue(undefined);
  const onKill = vi.fn().mockResolvedValue(undefined);
  const onRestart = vi.fn().mockResolvedValue(undefined);
  const props: PortsPageProps = {
    ports: [devPort, systemPort, otherPort],
    traffic: {
      3000: [{ timestamp: 1_000, connections: 7 }],
      49664: [{ timestamp: 1_000, connections: 0 }],
      9229: [{ timestamp: 1_000, connections: 1 }],
    },
    observedAt: { 3000: 1_000 },
    killedPorts: new Map(),
    killing: new Set(),
    restarting: new Set(),
    loading: false,
    error: null,
    onRetry,
    onKill,
    onRestart,
    ...overrides,
  };

  const view = render(<PortsPage {...props} />);
  return { ...view, props, onRetry, onKill, onRestart };
}

describe("PortsPage", () => {
  it("matches the reference hierarchy with real category counts and table fields", () => {
    renderPorts();

    expect(screen.getByRole("heading", { name: "Ports" })).toBeVisible();
    expect(screen.getByRole("banner").parentElement).toHaveClass("ports-page__header");
    expect(screen.getByText("3 listening ports")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search ports" })).toHaveAttribute(
      "placeholder",
      "Search ports, process, project...",
    );
    expect(screen.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dev 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "System 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Other 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Filter" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Kill All" })).toBeVisible();

    for (const heading of ["PORT", "PROCESS", "PROJECT", "PID", "CONNECTIONS", "STARTED", "ACTIONS"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeVisible();
    }

    const row = screen.getByRole("row", { name: /3000.*node.*Web App.*1111.*7/i });
    expect(within(row).getByText("TCP", { exact: false })).toBeVisible();
    expect(within(row).getByText("C:\\work\\web-app")).toBeVisible();
  });

  it("opens and composes only filters backed by current port data", async () => {
    const user = userEvent.setup();
    renderPorts();

    await user.click(screen.getByRole("button", { name: "Filter" }));
    const filters = screen.getByRole("dialog", { name: "Port filters" });
    expect(within(filters).getByRole("combobox", { name: "Protocol" })).toBeVisible();
    expect(within(filters).getByRole("combobox", { name: "Project" })).toBeVisible();
    expect(within(filters).getByRole("checkbox", { name: "Restartable only" })).toBeVisible();
    expect(within(filters).getByRole("checkbox", { name: "Has active connections" })).toBeVisible();
    expect(within(filters).queryByText(/user|address|endpoint/i)).not.toBeInTheDocument();

    await user.selectOptions(within(filters).getByRole("combobox", { name: "Protocol" }), "TCP");
    await user.selectOptions(within(filters).getByRole("combobox", { name: "Project" }), "with-project");
    await user.click(within(filters).getByRole("checkbox", { name: "Restartable only" }));
    await user.click(within(filters).getByRole("checkbox", { name: "Has active connections" }));

    expect(screen.getByText("3000")).toBeVisible();
    expect(screen.queryByText("49664")).not.toBeInTheDocument();
    expect(screen.queryByText("9229")).not.toBeInTheDocument();
  });

  it("selects rows by click, Enter, and Space and dismisses the inspector predictably", async () => {
    const user = userEvent.setup();
    renderPorts();

    const devRow = screen.getByRole("row", { name: /3000.*node.*Web App/i });
    await user.click(devRow);
    expect(screen.getByRole("complementary", { name: "Port inspector for :3000" })).toBeVisible();

    await user.click(devRow);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    devRow.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("complementary", { name: "Port inspector for :3000" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    const systemRow = screen.getByRole("row", { name: /49664.*lsass/i });
    systemRow.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("complementary", { name: "Port inspector for :49664" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("closes a selected live inspector when search hides its row", async () => {
    const user = userEvent.setup();
    renderPorts();

    await user.click(screen.getByRole("row", { name: /3000.*node.*Web App/i }));
    expect(screen.getByRole("complementary", { name: "Port inspector for :3000" })).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "Search ports" }), "lsass");

    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });

  it("closes a selected live inspector when a category hides its row", async () => {
    const user = userEvent.setup();
    renderPorts();

    await user.click(screen.getByRole("row", { name: /3000.*node.*Web App/i }));
    expect(screen.getByRole("complementary", { name: "Port inspector for :3000" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "System 1" }));

    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });

  it("closes a selected live inspector when an advanced filter hides its row", async () => {
    const user = userEvent.setup();
    renderPorts();

    await user.click(screen.getByRole("row", { name: /9229.*UDP.*node/i }));
    expect(screen.getByRole("complementary", { name: "Port inspector for :9229" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Protocol" }), "TCP");

    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });

  it("keeps individual Kill and conditional Restart actions directly reachable with original ports", async () => {
    const user = userEvent.setup();
    const { onKill, onRestart } = renderPorts({ killedPorts: new Map([[stoppedPort.port, stoppedPort]]) });

    await user.click(screen.getByRole("button", { name: "Kill port 3000" }));
    expect(screen.getByRole("alertdialog", { name: "Confirm process termination" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onKill).toHaveBeenCalledWith(devPort);

    expect(screen.queryByRole("button", { name: "Restart port 49664" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart port 3000" }));
    expect(onRestart).toHaveBeenCalledWith(devPort);

    const stoppedRow = screen.getByRole("row", { name: /5173.*Stopped.*vite.*PortPal.*4444/i });
    expect(within(stoppedRow).getByText("STOPPED")).toBeVisible();
    await user.click(within(stoppedRow).getByRole("button", { name: "Restart port 5173" }));
    expect(onRestart).toHaveBeenCalledWith(stoppedPort);
  });

  it("activates Kill with Enter without selecting its row", async () => {
    const user = userEvent.setup();
    const { onKill } = renderPorts();
    const killButton = screen.getByRole("button", { name: "Kill port 3000" });

    killButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("alertdialog", { name: "Confirm process termination" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onKill).toHaveBeenCalledWith(devPort);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("activates Restart with Space without selecting its row", async () => {
    const user = userEvent.setup();
    const { onRestart } = renderPorts();
    const restartButton = screen.getByRole("button", { name: "Restart port 3000" });

    restartButton.focus();
    await user.keyboard(" ");

    expect(onRestart).toHaveBeenCalledWith(devPort);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("shows operation-specific busy feedback while kill or restart is pending", () => {
    renderPorts({
      killedPorts: new Map([[stoppedPort.port, stoppedPort]]),
      killing: new Set([devPort.pid]),
      restarting: new Set([stoppedPort.pid]),
    });

    const killingButton = screen.getByRole("button", { name: "Killing port 3000" });
    expect(killingButton).toBeDisabled();
    expect(killingButton).toHaveAttribute("aria-busy", "true");
    expect(killingButton.querySelector(".ports-table__spinner")).toBeInTheDocument();

    const blockedRestartButton = screen.getByRole("button", { name: "Restart port 3000" });
    expect(blockedRestartButton).toBeDisabled();
    expect(blockedRestartButton).not.toHaveAttribute("aria-busy");
    expect(blockedRestartButton.querySelector(".ports-table__spinner")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Kill port 49664" })).toBeEnabled();

    const restartingButton = screen.getByRole("button", { name: "Restarting port 5173" });
    expect(restartingButton).toBeDisabled();
    expect(restartingButton).toHaveAttribute("aria-busy", "true");
    expect(restartingButton.querySelector(".ports-table__spinner")).toBeInTheDocument();
  });

  it("confirms before killing the current filtered results", async () => {
    const user = userEvent.setup();
    const { onKill } = renderPorts();

    await user.type(screen.getByRole("searchbox", { name: "Search ports" }), "node");
    await user.click(screen.getByRole("button", { name: "Kill All" }));

    expect(onKill).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Confirm process termination" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onKill).toHaveBeenCalledTimes(2);
    expect(onKill).toHaveBeenNthCalledWith(1, devPort);
    expect(onKill).toHaveBeenNthCalledWith(2, otherPort);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names protected Postgres, cancels safely, and deduplicates confirmed PIDs", async () => {
    const user = userEvent.setup();
    const postgres = { ...systemPort, port: 5432, process_name: "Postgres" };
    const { onKill } = renderPorts({ ports: [devPort, { ...devPort, port: 3001 }, postgres, otherPort], killing: new Set([otherPort.pid]) });
    const button = screen.getByRole("button", { name: "Kill All" });
    await user.click(button);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Postgres/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onKill).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onKill).toHaveBeenCalledTimes(1));
    expect(onKill).toHaveBeenCalledWith(devPort);
    expect(await screen.findByRole("status")).toHaveTextContent("Killed 1, failed 0, skipped critical 1, skipped busy 1");
  });

  it("routes critical kills directly to onKill without confirm dialog and keeps keyboard focus inside confirmation", async () => {
    const user = userEvent.setup();
    const { onKill } = renderPorts();
    await user.click(screen.getByRole("button", { name: "Kill port 49664" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onKill).toHaveBeenCalledWith(systemPort);

    await user.click(screen.getByRole("button", { name: "Kill port 3000" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/1 unique process selected/)).toBeVisible();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(onKill).toHaveBeenCalledWith(devPort);
  });

  it("settles bulk failures sequentially and reports truthful counts", async () => {
    const user = userEvent.setup();
    const onKill = vi.fn().mockResolvedValueOnce('failed').mockRejectedValueOnce(new Error('denied'));
    renderPorts({ ports: [devPort, otherPort], onKill });
    await user.click(screen.getByRole("button", { name: "Kill All" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Killed 0, failed 2");
    expect(onKill).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state without claiming a port count", () => {
    renderPorts({ ports: [], loading: true });

    expect(screen.getByRole("status")).toHaveTextContent("Scanning ports…");
    expect(screen.queryByText(/listening ports?$/i)).not.toBeInTheDocument();
  });

  it("shows an honest empty state", () => {
    renderPorts({ ports: [] });

    expect(screen.getByRole("heading", { name: "No ports in use" })).toBeVisible();
    expect(screen.getByText("0 listening ports")).toBeVisible();
  });

  it("shows the port-load error and retries without claiming zero listeners", async () => {
    const user = userEvent.setup();
    const { onRetry } = renderPorts({ ports: [], error: "Port scan unavailable" });

    expect(screen.getByRole("heading", { name: "Unable to load ports" })).toBeVisible();
    expect(screen.getByText("Port scan unavailable")).toBeVisible();
    expect(screen.queryByText("0 listening ports")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders conflicting listeners on the same port as distinct selectable rows", async () => {
    const user = userEvent.setup();
    const conflict: PortInfo = {
      ...devPort,
      pid: 9999,
      project_name: "Other App",
      project_path: "C:\\work\\other-app",
    };
    renderPorts({ ports: [devPort, conflict] });

    expect(screen.getAllByText("3000")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /3000.*1111/i })).toBeVisible();
    expect(screen.getByRole("row", { name: /3000.*9999/i })).toBeVisible();

    await user.click(screen.getByRole("row", { name: /3000.*9999/i }));
    expect(screen.getByRole("complementary", { name: "Port inspector for :3000" })).toBeVisible();
  });

  it("keeps a selected killed listener in the inspector and closes a vanished selection", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderPorts();

    await user.click(screen.getByRole("row", { name: /3000.*node.*Web App/i }));
    rerender(
      <PortsPage
        {...props}
        ports={[systemPort, otherPort]}
        killedPorts={new Map([[devPort.port, devPort]])}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Port inspector for :3000" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Restart Process" })).toBeVisible();

    rerender(<PortsPage {...props} ports={[systemPort, otherPort]} killedPorts={new Map()} />);
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });
});
