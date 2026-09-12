import { useEffect, useRef, useState } from 'react';
import { tauriPortPalGateway, type PortPalGateway, type UpdateMetadata } from '../lib/tauri';

/// Checks for a newer release once per app launch.
///
/// Deliberately quiet: the check runs in the background and a failure — offline,
/// GitHub unreachable, a malformed manifest — resolves to "no update" rather than
/// surfacing an error. An updater that greets the user with a toast every time
/// they open the app on a train is worse than one that says nothing.
///
/// Once per mount, not on an interval. The window is hidden rather than closed
/// (see `on_window_event`), so a long-running instance will not re-check until
/// it is actually restarted; that is the intended trade for never nagging.
///
/// The gateway is held in a ref rather than an effect dependency on purpose: a
/// caller passing an inline object would otherwise re-run the check on every
/// render, which is exactly the nagging this is meant to avoid.
export function useUpdateCheck(
  gateway: PortPalGateway = tauriPortPalGateway,
): UpdateMetadata | null {
  const [update, setUpdate] = useState<UpdateMetadata | null>(null);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await gatewayRef.current.checkUpdate();
        if (active && result) setUpdate(result);
      } catch {
        // Silent by design; see the doc comment above.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return update;
}
