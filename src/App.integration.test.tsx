import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    vi.mocked(invoke).mockImplementation((cmd: string, _args?: unknown) => {
      if (cmd === 'get_ports') return Promise.resolve(mockPorts);
      if (cmd === 'get_port_events') return Promise.resolve([]);
      if (cmd === 'get_port_traffic') return Promise.resolve({});
      if (cmd === 'kill_process') return Promise.resolve();
      if (cmd === 'restart_process') return Promise.resolve();
      return Promise.resolve([]);
    });
    // listen mock returns unsubscribe
    vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
  });

  it('loads and displays ports from get_ports on mount', async () => {
    render(<App />);
    // wait for fetchPorts to resolve
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('get_ports'));
    // Ports tab should show filtered count 3 active connections
    await waitFor(() => expect(screen.getByText(/3 active connection/)).toBeInTheDocument());
    expect(screen.getByText('3000')).toBeInTheDocument();
    expect(screen.getByText('5173')).toBeInTheDocument();
  });

  it('filters by search and Dev/Other tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    // Search by process_name
    const search = screen.getByPlaceholderText(/Search ports or services/);
    await user.type(search, 'lsass');
    expect(screen.getByText('49664')).toBeInTheDocument();
    expect(screen.queryByText('3000')).not.toBeInTheDocument();

    await user.clear(search);

    // Dev tab should hide lsass (non-dev)
    const devBtn = screen.getByText('Dev');
    await user.click(devBtn);
    await waitFor(() => expect(screen.queryByText('49664')).not.toBeInTheDocument());
    expect(screen.getByText('3000')).toBeInTheDocument();

    // Other tab should show only non-dev
    const otherBtn = screen.getByText('Other');
    await user.click(otherBtn);
    expect(screen.getByText('49664')).toBeInTheDocument();
    expect(screen.queryByText('3000')).not.toBeInTheDocument();
  });

  it('kill calls invoke and shows STOPPED + toast', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('3000')).toBeInTheDocument());

    const killBtn = screen.getByTitle('Kill PID 1111');
    await user.click(killBtn);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('kill_process', { pid: 1111 }));
    // killed port moves to dead row with STOPPED badge (kept for restart)
    await waitFor(() => expect(screen.getByText('STOPPED')).toBeInTheDocument());
    expect(await screen.findByText(/Killed node on :3000/)).toBeInTheDocument();
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
    portsUpdatedCb({ payload: newPorts });

    await waitFor(() => expect(screen.getByText('8000')).toBeInTheDocument());
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
});
