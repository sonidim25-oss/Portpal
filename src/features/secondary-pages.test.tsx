import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PortEvent, PortInfo, TrafficByPort } from '../app/types';
import { DashboardPage } from './dashboard/DashboardPage';
import { LogsPage } from './logs/LogsPage';
import { ServicesPage } from './services/ServicesPage';
import { SettingsPage } from './settings/SettingsPage';
import { TrafficPage } from './traffic/TrafficPage';

const ports: PortInfo[] = [
  { port: 3000, pid: 101, process_name: 'node', project_name: 'shop', project_path: '/shop', protocol: 'TCP', start_cmd: 'npm run dev' },
  { port: 3001, pid: 102, process_name: 'node', project_name: 'shop', project_path: '/shop', protocol: 'TCP', start_cmd: 'npm run api' },
  { port: 5432, pid: 103, process_name: 'postgres', project_name: null, project_path: null, protocol: 'TCP', start_cmd: null },
];

const traffic: TrafficByPort = {
  3000: [{ connections: 2, timestamp: 1 }, { connections: 5, timestamp: 2 }],
  3001: [{ connections: 3, timestamp: 1 }, { connections: 1, timestamp: 2 }],
  5432: [{ connections: 4, timestamp: 1 }],
};

const events: PortEvent[] = [
  { port: 3000, pid: 101, process_name: 'node', framework: 'React', event_type: 'started', timestamp: Date.now() },
  { port: 5432, pid: 103, process_name: 'postgres', framework: null, event_type: 'stopped', timestamp: Date.now() - 1000 },
];

describe('secondary pages', () => {
  it('preserves dashboard summaries and navigation actions', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<DashboardPage ports={ports} events={events} traffic={traffic} error={null} onRetry={vi.fn()} onNavigate={onNavigate} />);

    expect(screen.getByText('Active Ports').previousElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Frameworks').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Connections').previousElementSibling).toHaveTextContent('10');
    expect(screen.getByText('Events Today').previousElementSibling).toHaveTextContent('2');

    await user.click(screen.getByRole('button', { name: /Active Ports/ }));
    // Connections is a plain stat, not a navigation target.
    expect(screen.queryByRole('button', { name: /Connections/ })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'View all' })[1]);
    expect(onNavigate.mock.calls).toEqual([['ports'], ['logs']]);
  });

  it('preserves traffic totals, per-port metrics, and stale rows alongside retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<TrafficPage ports={ports} traffic={traffic} loading={false} error="traffic unavailable" onRetry={onRetry} />);

    expect(screen.getByText('Current Connections').previousElementSibling).toHaveTextContent('10');
    expect(screen.getByText('Sum of peaks').previousElementSibling).toHaveTextContent('12');
    const row = screen.getByRole('listitem', { name: /port 3000 traffic/i });
    expect(within(row).getByText('current').parentElement).toHaveTextContent('5 current');
    expect(within(row).getByText('peak').parentElement).toHaveTextContent('5 peak');
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('traffic unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry traffic' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('preserves service grouping and aggregate connection counts', () => {
    render(<ServicesPage ports={ports} traffic={traffic} loading={false} error={null} onRetry={vi.fn()} />);

    expect(screen.getByText('2 services running across 3 ports')).toBeInTheDocument();
    const shop = screen.getByRole('article', { name: 'shop service' });
    expect(within(shop).getByText('2 ports · 6 conns')).toBeInTheDocument();
    expect(within(shop).getByText(':3000')).toBeInTheDocument();
    expect(within(shop).getByText(':3001')).toBeInTheDocument();
  });

  it('renders duplicate-port listeners as distinct rows without key collisions', () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args); });
    try {
      const conflict: PortInfo[] = [
        { port: 3000, pid: 101, process_name: 'node', project_name: 'shop', project_path: '/shop', protocol: 'TCP', start_cmd: 'npm run dev' },
        { port: 3000, pid: 202, process_name: 'node', project_name: 'shop-2', project_path: '/shop-2', protocol: 'TCP', start_cmd: 'npm run dev' },
      ];
      const conflictTraffic: TrafficByPort = { 3000: [{ connections: 2, timestamp: 1 }] };
      const onNavigate = vi.fn();

      const { unmount } = render(<DashboardPage ports={conflict} events={[]} traffic={conflictTraffic} error={null} onRetry={vi.fn()} onNavigate={onNavigate} />);
      expect(screen.getAllByText(':3000')).toHaveLength(2);
      expect(screen.getByText('shop')).toBeInTheDocument();
      expect(screen.getByText('shop-2')).toBeInTheDocument();
      unmount();

      render(<TrafficPage ports={conflict} traffic={conflictTraffic} loading={false} error={null} onRetry={vi.fn()} />);
      expect(screen.getAllByRole('listitem', { name: /port 3000 traffic/i })).toHaveLength(2);

      expect(errors.flat().join(' ').toLowerCase()).not.toContain('unique "key"');
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the service label primary with the folder secondary for system ports', () => {
    const pg: PortInfo[] = [
      { port: 5432, pid: 103, process_name: 'postgres', project_name: 'myapp', project_path: '/work/myapp', protocol: 'TCP', start_cmd: null },
    ];
    const pgTraffic: TrafficByPort = { 5432: [{ connections: 1, timestamp: 1 }] };
    render(<DashboardPage ports={pg} events={[]} traffic={pgTraffic} error={null} onRetry={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByText('Postgres Server')).toBeInTheDocument();
    expect(screen.getByText('myapp')).toBeInTheDocument();
  });

  it('never merges a folder named like a system service with the real service', () => {
    const tricky: PortInfo[] = [
      { port: 3000, pid: 101, process_name: 'node', project_name: 'Postgres', project_path: '/work/postgres-demo', protocol: 'TCP', start_cmd: 'npm run dev' },
      { port: 5432, pid: 103, process_name: 'postgres', project_name: null, project_path: null, protocol: 'TCP', start_cmd: null },
    ];
    render(<ServicesPage ports={tricky} traffic={{}} loading={false} error={null} onRetry={vi.fn()} />);

    expect(screen.getByText('2 services running across 2 ports')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Postgres :3000 service' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Postgres :5432 service' })).toBeInTheDocument();
  });

  it('preserves log event rows and refresh while retaining stale events on error', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<LogsPage events={events} loading={false} error="events unavailable" onRefresh={onRefresh} />);

    expect(screen.getByText('2 events recorded')).toBeInTheDocument();
    expect(screen.getByText(':3000')).toBeInTheDocument();
    expect(screen.getByText(':5432')).toBeInTheDocument();
    expect(screen.getByText('events unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh logs' }));
    await user.click(screen.getByRole('button', { name: 'Retry logs' }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('preserves all settings font-scale controls', async () => {
    const user = userEvent.setup();
    const onFontScale = vi.fn();
    render(<SettingsPage fontScale={1} onFontScale={onFontScale} />);

    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Large' }));
    await user.click(screen.getByRole('button', { name: 'Larger' }));
    expect(onFontScale.mock.calls).toEqual([[1.15], [1.3]]);
  });
  it('reports a failed load on every derived page instead of an empty result', async () => {
    // Dashboard and Services derive everything from a scan, so a failed scan
    // would otherwise render as a confident "nothing is running".
    const user = userEvent.setup();
    const onRetry = vi.fn();

    const dashboard = render(<DashboardPage ports={[]} events={[]} traffic={{}} error="ports unavailable" onRetry={onRetry} onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ports unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry dashboard' }));
    dashboard.unmount();

    const services = render(<ServicesPage ports={[]} traffic={{}} loading={false} error="ports unavailable" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ports unavailable');
    expect(screen.queryByText('No services running')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry services' }));
    services.unmount();

    const traffic = render(<TrafficPage ports={[]} traffic={{}} loading={false} error="ports unavailable" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ports unavailable');
    expect(screen.queryByText('No active ports')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry traffic' }));
    traffic.unmount();

    render(<LogsPage events={[]} loading={false} error="events unavailable" onRefresh={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('events unavailable');
    expect(screen.queryByText('No events yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry logs' }));

    expect(onRetry).toHaveBeenCalledTimes(4);
  });

  it('separates still-loading from confirmed-empty on the derived pages', () => {
    const services = render(<ServicesPage ports={[]} traffic={{}} loading error={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Scanning services…');
    expect(screen.queryByText('No services running')).not.toBeInTheDocument();
    services.unmount();

    const traffic = render(<TrafficPage ports={[]} traffic={{}} loading error={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading traffic…');
    expect(screen.queryByText('No active ports')).not.toBeInTheDocument();
    traffic.unmount();

    const logs = render(<LogsPage events={[]} loading error={null} onRefresh={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading events…');
    expect(screen.queryByText('No events yet')).not.toBeInTheDocument();
    logs.unmount();

    // Once a load has come back empty, the pages say so plainly.
    render(<TrafficPage ports={[]} traffic={{}} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('No active ports')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
