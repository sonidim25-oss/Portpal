import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const mockPorts = [
  { port: 3000, pid: 1111, process_name: 'node', project_name: 'my-app', project_path: '/a/my-app', protocol: 'TCP', start_cmd: 'npm run dev' },
  { port: 5173, pid: 2222, process_name: 'node', project_name: null, project_path: null, protocol: 'TCP', start_cmd: null },
  { port: 49664, pid: 3333, process_name: 'lsass.exe', project_name: null, project_path: null, protocol: 'TCP', start_cmd: null },
];

describe('App integration - invoke + ports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.style.removeProperty('--fs-scale');
    vi.mocked(invoke).mockImplementation((cmd: string, _args?: unknown) => {
      if (cmd === 'get_ports') return Promise.resolve(mockPorts);
      if (cmd === 'get_port_events') return Promise.resolve([]);
      if (cmd === 'get_port_traffic') return Promise.resolve({});
      if (cmd === 'kill_process') return Promise.resolve();
      if (cmd === 'restart_process') return Promise.resolve();
      if (cmd === 'get_port_graph') return Promise.resolve({
        nodes: mockPorts.map((port) => ({ id: `port:${port.port}`, ...port, framework: null, is_dev: Boolean(port.project_name), connection_count: 0 })),
        edges: [],
      });
      return Promise.resolve([]);
    });
    // listen mock returns unsubscribe
    vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
  });

  it('loads and displays ports from get_ports on mount', async () => {
    render(<App />);
    // wait for fetchPorts to resolve
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_ports'));
    await waitFor(() => expect(screen.getByText('3 listening ports')).toBeInTheDocument());
    expect(screen.getByText('3000')).toBeInTheDocument();
    expect(screen.getByText('5173')).toBeInTheDocument();
  });

  it('filters by search and Dev/System tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    // Search by process_name
    const search = screen.getByPlaceholderText('Search ports, process, project...');
    await user.type(search, 'lsass');
    expect(screen.getByText('49664')).toBeInTheDocument();
    expect(screen.queryByText('3000')).not.toBeInTheDocument();

    await user.clear(search);

    // Dev tab should hide lsass (non-dev)
    const devBtn = screen.getByText('Dev');
    await user.click(devBtn);
    await waitFor(() => expect(screen.queryByText('49664')).not.toBeInTheDocument());
    expect(screen.getByText('3000')).toBeInTheDocument();

    // System tab should show only infrastructure ports.
    const systemBtn = screen.getByText('System');
    await user.click(systemBtn);
    expect(screen.getByText('49664')).toBeInTheDocument();
    expect(screen.queryByText('3000')).not.toBeInTheDocument();
  });

  it('kill calls invoke and shows STOPPED + toast', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    const killBtn = screen.getByRole('button', { name: 'Kill port 3000' });
    await user.click(killBtn);
    expect(screen.getByRole('alertdialog', { name: 'Confirm process termination' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('kill_process', { pid: 1111 }));
    // killed port moves to dead row with STOPPED badge (kept for restart)
    await waitFor(() => expect(screen.getByText('STOPPED')).toBeInTheDocument());
    expect(await screen.findByText(/Killed node on :3000/)).toBeInTheDocument();
  });

  it('restart sends only the port and pid, never a command line or path', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Restart port 3000' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('restart_process', {
      port: 3000,
      pid: 1111,
    }));

    // Regression guard for the command-injection fix: no restart_process call
    // may ever carry an attacker-controllable cmd or cwd.
    const restartArgs = vi.mocked(invoke).mock.calls
      .filter(([cmd]) => cmd === 'restart_process')
      .map(([, args]) => args as Record<string, unknown>);
    expect(restartArgs.length).toBeGreaterThan(0);
    for (const args of restartArgs) {
      expect(Object.keys(args).sort()).toEqual(['pid', 'port']);
    }
  });

  it('keeps six navigation destinations wired (MVP: Port Map hidden)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    for (const [navigation, heading] of [
      ['Dashboard', 'Dashboard'], ['Traffic', 'Traffic Monitor'], ['Services', 'Services'],
      ['Logs', 'Event Logs'], ['Settings', 'Settings'], ['Ports', 'Ports'],
      // MVP: Port Map hidden - preserved in src/features/port-map/
    ] as const) {
      await user.click(screen.getByRole('button', { name: navigation }));
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    // No Port Map navigation in MVP
    expect(screen.queryByRole('button', { name: 'Port Map' })).not.toBeInTheDocument();
  });

  it('confirms filtered bulk kills with unchanged PID payloads', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search ports, process, project...'), 'node');
    await user.click(screen.getByRole('button', { name: 'Kill All' }));

    expect(invoke).not.toHaveBeenCalledWith('kill_process', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('kill_process', { pid: 1111 }));
    expect(invoke).toHaveBeenCalledWith('kill_process', { pid: 2222 });
    expect(invoke).not.toHaveBeenCalledWith('kill_process', { pid: 3333 });
  });

  it('ports-updated event updates list', async () => {
    let portsUpdatedCb: (e: { payload: typeof mockPorts }) => void = () => {};
    vi.mocked(listen).mockImplementation(((event: string, cb: unknown) => {
      if (event === 'ports-updated') portsUpdatedCb = cb as (e: { payload: typeof mockPorts }) => void;
      return Promise.resolve(() => {});
    }) as never);
    render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_ports'));

    // Simulate new port arriving via tray emit
    const newPorts = [...mockPorts, { port: 8000, pid: 4444, process_name: 'python', project_name: null, project_path: null, protocol: 'TCP', start_cmd: null }];
    await act(async () => {
      portsUpdatedCb({ payload: newPorts });
    });

    await waitFor(() => expect(screen.getByText('8000')).toBeInTheDocument());
  });

  it('text size setting scales the UI and persists', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Text size')).toBeInTheDocument();
    // Standard is the default selection.
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Larger' }));
    expect(document.documentElement.style.getPropertyValue('--fs-scale')).toBe('1.3');
    expect(localStorage.getItem('portpal.fontScale')).toBe('1.3');

    // The choice survives a restart.
    unmount();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Larger' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows empty state when no ports', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'get_ports') return Promise.resolve([]);
      if (cmd === 'get_port_events') return Promise.resolve([]);
      if (cmd === 'get_port_traffic') return Promise.resolve({});
      return Promise.resolve([]);
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/No ports in use/)).toBeInTheDocument());
  });
  it('surfaces a failed port scan with a working retry instead of an empty list', async () => {
    const user = userEvent.setup();
    let scanWorks = false;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'get_ports') return scanWorks ? Promise.resolve(mockPorts) : Promise.reject(new Error('`netstat` was not found on PATH'));
      if (cmd === 'get_port_events') return Promise.resolve([]);
      if (cmd === 'get_port_traffic') return Promise.resolve({});
      return Promise.resolve([]);
    });
    render(<App />);

    // A backend failure must never read as "nothing is listening".
    await waitFor(() => expect(screen.getByText('Unable to load ports')).toBeInTheDocument());
    expect(screen.getByText('`netstat` was not found on PATH')).toBeInTheDocument();
    expect(screen.queryByText(/No ports in use/)).not.toBeInTheDocument();

    scanWorks = true;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());
    expect(screen.queryByText('Unable to load ports')).not.toBeInTheDocument();
  });

  it('reports the same failure on the pages that only derive from a scan', async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'get_ports') return Promise.reject(new Error('scan unavailable'));
      if (cmd === 'get_port_events') return Promise.resolve([]);
      if (cmd === 'get_port_traffic') return Promise.resolve({});
      return Promise.resolve([]);
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Unable to load ports')).toBeInTheDocument());

    for (const [navigation, retry] of [
      ['Traffic', 'Retry traffic'], ['Services', 'Retry services'], ['Dashboard', 'Retry dashboard'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: navigation }));
      expect(screen.getByRole('alert')).toHaveTextContent('scan unavailable');
      expect(screen.getByRole('button', { name: retry })).toBeInTheDocument();
    }
  });
});
