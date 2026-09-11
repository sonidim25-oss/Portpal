import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AppShell } from './AppShell';
import type { PortInfo } from '../../app/types';

const ports: PortInfo[] = [
  {
    port: 3000,
    pid: 4242,
    process_name: 'node',
    project_name: 'portpal',
    project_path: 'C:/projects/portpal',
    protocol: 'TCP',
    start_cmd: 'npm run dev',
  },
  {
    port: 5173,
    pid: 4242,
    process_name: 'node',
    project_name: 'portpal',
    project_path: 'C:/projects/portpal',
    protocol: 'TCP',
    start_cmd: 'npm run dev',
  },
];

describe('AppShell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the active destination and current monitoring status', () => {
    render(
      <AppShell page="ports" onNavigate={() => {}} ports={ports} lastScanAt={Date.now() - 2_000}>
        <div>Ports content</div>
      </AppShell>,
    );

    expect(screen.getByText('PortPal')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Dashboard' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ports' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('1 process, 2 ports')).toBeVisible();
    expect(screen.getByText('Last scan: 2s ago')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeVisible();
  });

  it('keeps all existing destinations in the reference navigation order', () => {
    render(
      <AppShell page="ports" onNavigate={() => {}} ports={ports} lastScanAt={Date.now() - 2_000}>
        <div>Ports content</div>
      </AppShell>,
    );

    const navigation = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
    expect(navigation.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Dashboard',
      'Ports',
      'Traffic',
      'Services',
      'Logs',
      'Settings',
    ]);
  });

  it('keeps the PortPal identity in the sidebar while reserving the titlebar for window controls', () => {
    render(
      <AppShell page="ports" onNavigate={() => {}} ports={ports} lastScanAt={Date.now() - 2_000}>
        <div>Ports content</div>
      </AppShell>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const sidebar = navigation.closest('aside');
    expect(sidebar).not.toBeNull();
    expect(within(sidebar!).getByText('PortPal')).toBeVisible();
    expect(
      within(screen.getByRole('banner'))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Minimize', 'Maximize', 'Close']);
  });

  it('gives compact monitoring users the complete current status', () => {
    render(
      <AppShell page="ports" onNavigate={() => {}} ports={ports} lastScanAt={Date.now() - 2_000}>
        <div>Ports content</div>
      </AppShell>,
    );

    expect(
      screen.getByRole('region', {
        name: 'Monitoring: 1 process, 2 ports. Last scan: 2s ago',
      }),
    ).toBeVisible();
  });
});
