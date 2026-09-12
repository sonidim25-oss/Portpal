import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PortInspector } from './PortInspector';
import type { PortInfo, TrafficSample } from '../../app/types';
import type { PortPalGateway } from '../../lib/tauri';

const port: PortInfo = {
  port: 3000,
  pid: 18344,
  process_name: 'node.exe',
  project_name: 'PortPal',
  project_path: 'C:\\work\\PortPal',
  protocol: 'TCP',
  start_cmd: 'npm run dev',
};

const traffic: TrafficSample[] = [
  { timestamp: 1_000, connections: 4 },
  { timestamp: 2_000, connections: 12 },
];

function renderInspector(overrides: Partial<React.ComponentProps<typeof PortInspector>> = {}) {
  const onClose = vi.fn();
  const onKill = vi.fn();
  const onRestart = vi.fn();

  render(
    <PortInspector
      port={port}
      traffic={traffic}
      observedAt={1_000}
      killed={false}
      killing={new Set()}
      restarting={new Set()}
      onClose={onClose}
      onKill={onKill}
      onRestart={onRestart}
      now={121_000}
      {...overrides}
    />,
  );

  return { onClose, onKill, onRestart };
}

describe('PortInspector', () => {
  it('closes from its close control and Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderInspector();

    await user.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows real details with definition-list semantics and sends kill requests for the selected port', async () => {
    const user = userEvent.setup();
    const { onKill } = renderInspector();

    expect(screen.getByRole('complementary', { name: 'Port inspector for :3000' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Project' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Process' })).toBeVisible();
    expect(document.querySelectorAll('dl')).toHaveLength(3);
    expect(document.querySelectorAll('dt')).toHaveLength(9);
    expect(document.querySelectorAll('dd')).toHaveLength(9);
    expect(screen.getByText('Observed 2m ago')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Close Connections/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Open.*Path|Open.*Folder|Terminal/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kill Process' }));
    expect(onKill).toHaveBeenCalledWith(port);
  });

  it('shows Restart only for killed, restartable ports and disables it while pending', async () => {
    const { onRestart } = renderInspector({
      killed: true,
      restarting: new Set([port.pid]),
    });

    expect(screen.queryByRole('button', { name: 'Kill Process' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart Process' })).toBeDisabled();
    expect(onRestart).not.toHaveBeenCalled();
    // Wait for env to settle
    await screen.findByRole('complementary');
  });

  it('sends restart requests for a killed, restartable port', async () => {
    const user = userEvent.setup();
    const { onRestart } = renderInspector({ killed: true });

    await user.click(screen.getByRole('button', { name: 'Restart Process' }));
    expect(onRestart).toHaveBeenCalledWith(port);
  });

  it('disables the process action while killing or restarting is pending', async () => {
    const { rerender } = render(
      <PortInspector
        port={port}
        traffic={traffic}
        observedAt={1_000}
        killed={false}
        killing={new Set([port.pid])}
        restarting={new Set()}
        onClose={() => {}}
        onKill={() => {}}
        onRestart={() => {}}
        now={121_000}
      />,
    );

    expect(screen.getByRole('button', { name: 'Kill Process' })).toBeDisabled();

    rerender(
      <PortInspector
        port={port}
        traffic={traffic}
        observedAt={1_000}
        killed={false}
        killing={new Set()}
        restarting={new Set([port.pid])}
        onClose={() => {}}
        onKill={() => {}}
        onRestart={() => {}}
        now={121_000}
      />,
    );

    expect(screen.getByRole('button', { name: 'Kill Process' })).toBeDisabled();
    await screen.findByRole('complementary');
  });

  it('renders complete command, cwd, and fetched environment variables when present', async () => {
    const mockGateway = {
      getProcessEnv: vi.fn().mockResolvedValue({
        DATABASE_URL: 'postgres://localhost:5432/mydb',
        NODE_ENV: 'development',
      }),
    } as unknown as PortPalGateway;

    renderInspector({
      port: {
        ...port,
        start_cmd: 'node server.js --port 3000',
        cwd: 'C:\\work\\PortPal\\backend',
      },
      gateway: mockGateway,
    });

    expect(screen.getByText('Command')).toBeVisible();
    expect(screen.getByText('node server.js --port 3000')).toBeVisible();
    expect(screen.getByText('CWD')).toBeVisible();
    expect(screen.getByText('C:\\work\\PortPal\\backend')).toBeVisible();

    expect(await screen.findByText('Environment Variables')).toBeVisible();
    expect(await screen.findByText('DATABASE_URL')).toBeInTheDocument();
    expect(await screen.findByText('postgres://localhost:5432/mydb')).toBeInTheDocument();
    expect(await screen.findByText('NODE_ENV')).toBeInTheDocument();
    expect(mockGateway.getProcessEnv).toHaveBeenCalledWith(port.pid);
  });

  it('indicates restricted OS policy when environment variables are unavailable', async () => {
    const mockGateway = {
      getProcessEnv: vi.fn().mockResolvedValue(null),
    } as unknown as PortPalGateway;

    renderInspector({
      port,
      gateway: mockGateway,
    });

    expect(await screen.findByText('Environment Variables')).toBeVisible();
    expect(await screen.findByText('Restricted')).toBeVisible();
    expect(
      await screen.findByText('Environment variables restricted by OS security policy.'),
    ).toBeInTheDocument();
    expect(mockGateway.getProcessEnv).toHaveBeenCalledWith(port.pid);
  });
});
