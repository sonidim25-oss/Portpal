import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useUpdateCheck } from './useUpdateCheck';
import type { PortPalGateway, UpdateMetadata } from '../lib/tauri';

const metadata: UpdateMetadata = { version: '0.5.2', currentVersion: '0.5.1' };

function gatewayWith(checkUpdate: PortPalGateway['checkUpdate']): PortPalGateway {
  return { checkUpdate } as unknown as PortPalGateway;
}

describe('useUpdateCheck', () => {
  it('reports the pending version once the check resolves', async () => {
    const { result } = renderHook(() => useUpdateCheck(gatewayWith(async () => metadata)));

    await waitFor(() => expect(result.current).toEqual(metadata));
  });

  it('stays null when the backend reports no update', async () => {
    const checkUpdate = vi.fn(async () => null);
    const { result } = renderHook(() => useUpdateCheck(gatewayWith(checkUpdate)));

    await waitFor(() => expect(checkUpdate).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  // Offline, GitHub down, or a malformed manifest must not reach the user: the
  // check is a background nicety, not something worth an error on every launch.
  it('swallows a failed check instead of surfacing it', async () => {
    const checkUpdate = vi.fn(async () => {
      throw new Error('network unreachable');
    });
    const { result } = renderHook(() => useUpdateCheck(gatewayWith(checkUpdate)));

    await waitFor(() => expect(checkUpdate).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('checks once per mount rather than on a timer', async () => {
    const checkUpdate = vi.fn(async () => metadata);
    const { result, rerender } = renderHook(() => useUpdateCheck(gatewayWith(checkUpdate)));

    await waitFor(() => expect(result.current).toEqual(metadata));
    rerender();
    rerender();
    expect(checkUpdate).toHaveBeenCalledTimes(1);
  });

  // A check that resolves after the component is gone must not set state.
  it('ignores a result that arrives after unmount', async () => {
    let release: (value: UpdateMetadata) => void = () => {};
    const pending = new Promise<UpdateMetadata>((resolve) => {
      release = resolve;
    });
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener('error', onError);

    const { unmount } = renderHook(() => useUpdateCheck(gatewayWith(() => pending)));
    unmount();
    release(metadata);
    await pending;

    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });
});
