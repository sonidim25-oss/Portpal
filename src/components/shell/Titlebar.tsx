import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "../ui/controls";

type PendingAction = "minimize" | "maximize" | "close" | null;

const STATUS_DURATION_MS = 3000;

export function Titlebar() {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), STATUS_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    setPending("minimize");
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("Minimize failed", error);
      showStatus("Couldn't minimize the window. Try again.");
    } finally {
      setPending(null);
    }
  }, [showStatus]);

  const handleClose = useCallback(async () => {
    setPending("close");
    try {
      // Backend intercepts close (prevent_close + hide): the window hides to
      // the tray instead of quitting, so confirm that affordance on success.
      await getCurrentWindow().close();
      showStatus("Minimized to tray — PortPal keeps running in the background.");
    } catch (error) {
      console.error("Close failed", error);
      showStatus("Couldn't minimize to tray. Try again.");
    } finally {
      setPending(null);
    }
  }, [showStatus]);

  const handleToggleMaximize = useCallback(async () => {
    setPending("maximize");
    const win = getCurrentWindow();
    try {
      await win.toggleMaximize();
      return;
    } catch (error) {
      // Fallback when toggleMaximize permission is missing or fails
      try {
        const maximized = await win.isMaximized();
        if (maximized) {
          await win.unmaximize();
        } else {
          await win.maximize();
        }
        return;
      } catch (fallbackError) {
        console.error("Maximize failed", fallbackError, error);
        showStatus("Couldn't change the window size. Try again.");
      }
    } finally {
      setPending(null);
    }
  }, [showStatus]);

  const busy = pending !== null;

  return (
    <header className="shell-titlebar" data-tauri-drag-region onDoubleClick={() => void handleToggleMaximize()}>
      {status && (
        <div className="shell-titlebar__status" role="status">
          {status}
        </div>
      )}
      <div className="shell-titlebar__controls">
        <IconButton
          className="shell-titlebar__button"
          label="Minimize"
          onClick={() => void handleMinimize()}
          disabled={busy}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
        </IconButton>
        <IconButton
          className="shell-titlebar__button"
          label="Maximize"
          onClick={() => void handleToggleMaximize()}
          disabled={busy}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" /></svg>
        </IconButton>
        <IconButton
          className="shell-titlebar__button shell-titlebar__button--close"
          label="Close"
          onClick={() => void handleClose()}
          disabled={busy}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
        </IconButton>
      </div>
    </header>
  );
}
