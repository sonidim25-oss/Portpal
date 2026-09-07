import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "../ui/controls";

async function handleMinimize() {
  try {
    await getCurrentWindow().minimize();
  } catch (error) {
    console.error("Minimize failed", error);
  }
}

async function handleClose() {
  try {
    await getCurrentWindow().close();
  } catch (error) {
    console.error("Close failed", error);
  }
}

async function handleToggleMaximize() {
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
    }
  }
}

export function Titlebar() {
  return (
    <header className="shell-titlebar" data-tauri-drag-region onDoubleClick={handleToggleMaximize}>
      <div className="shell-titlebar__controls">
        <IconButton className="shell-titlebar__button" label="Minimize" onClick={handleMinimize}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
        </IconButton>
        <IconButton className="shell-titlebar__button" label="Maximize" onClick={handleToggleMaximize}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" /></svg>
        </IconButton>
        <IconButton className="shell-titlebar__button shell-titlebar__button--close" label="Close" onClick={handleClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
        </IconButton>
      </div>
    </header>
  );
}
