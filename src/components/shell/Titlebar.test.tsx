import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Titlebar } from './Titlebar';

const { mockGetCurrentWindow } = vi.hoisted(() => ({ mockGetCurrentWindow: vi.fn() }));

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mockGetCurrentWindow }));

function mockWindow(overrides: Record<string, unknown> = {}) {
  return {
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => Promise.resolve()),
    maximize: vi.fn(() => Promise.resolve()),
    unmaximize: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    close: vi.fn(() => Promise.resolve()),
    hide: vi.fn(() => Promise.resolve()),
    show: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    unminimize: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('Titlebar window controls', () => {
  beforeEach(() => {
    mockGetCurrentWindow.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCurrentWindow.mockReturnValue(mockWindow());
  });

  it('renders minimize, maximize, and close controls', () => {
    render(<Titlebar />);
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  it('shows error feedback without an unhandled rejection when minimize fails', async () => {
    const onUnhandled = vi.fn();
    window.addEventListener('unhandledrejection', onUnhandled);
    mockGetCurrentWindow.mockReturnValue(
      mockWindow({ minimize: vi.fn(() => Promise.reject(new Error('no perm'))) }),
    );
    render(<Titlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      "Couldn't minimize the window. Try again.",
    );
    expect(console.error).toHaveBeenCalledWith('Minimize failed', expect.anything());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', onUnhandled);
  });

  it('shows error feedback without an unhandled rejection when close fails', async () => {
    const onUnhandled = vi.fn();
    window.addEventListener('unhandledrejection', onUnhandled);
    mockGetCurrentWindow.mockReturnValue(
      mockWindow({ close: vi.fn(() => Promise.reject(new Error('hidden'))) }),
    );
    render(<Titlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      "Couldn't minimize to tray. Try again.",
    );
    expect(console.error).toHaveBeenCalledWith('Close failed', expect.anything());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', onUnhandled);
  });

  it('confirms tray semantics when close (hide to tray) succeeds', async () => {
    const win = mockWindow({ close: vi.fn(() => Promise.resolve()) });
    mockGetCurrentWindow.mockReturnValue(win);
    render(<Titlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Minimized to tray');
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('shows error feedback when maximize fails including the isMaximized fallback', async () => {
    const onUnhandled = vi.fn();
    window.addEventListener('unhandledrejection', onUnhandled);
    mockGetCurrentWindow.mockReturnValue(
      mockWindow({
        toggleMaximize: vi.fn(() => Promise.reject(new Error('toggle denied'))),
        isMaximized: vi.fn(() => Promise.reject(new Error('isMaximized denied'))),
      }),
    );
    render(<Titlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      "Couldn't change the window size. Try again.",
    );
    expect(console.error).toHaveBeenCalledWith(
      'Maximize failed',
      expect.anything(),
      expect.anything(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUnhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', onUnhandled);
  });

  it('falls back to maximize when toggleMaximize fails but the window is not maximized', async () => {
    const win = mockWindow({
      toggleMaximize: vi.fn(() => Promise.reject(new Error('toggle denied'))),
      isMaximized: vi.fn(() => Promise.resolve(false)),
      maximize: vi.fn(() => Promise.resolve()),
    });
    mockGetCurrentWindow.mockReturnValue(win);
    render(<Titlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));

    await waitFor(() => expect(win.maximize).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disables controls while a window operation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetCurrentWindow.mockReturnValue(mockWindow({ minimize: vi.fn(() => pending) }));
    render(<Titlebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Minimize' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Minimize' })).not.toBeDisabled(),
    );
  });

  it('toggles maximize on header double-click', async () => {
    const win = mockWindow({ toggleMaximize: vi.fn(() => Promise.resolve()) });
    mockGetCurrentWindow.mockReturnValue(win);
    render(<Titlebar />);

    fireEvent.doubleClick(screen.getByRole('banner'));

    await waitFor(() => expect(win.toggleMaximize).toHaveBeenCalledTimes(1));
  });
});
