import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "../ui/controls";

export function Titlebar() {
  return (
    <header className="shell-titlebar" data-tauri-drag-region>
      <div className="shell-titlebar__brand">
        <span className="shell-titlebar__mark" aria-hidden="true">P</span>
        <span>PortPal</span>
      </div>
      <div className="shell-titlebar__controls">
        <IconButton className="shell-titlebar__button" label="Minimize" onClick={() => getCurrentWindow().minimize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
        </IconButton>
        <IconButton className="shell-titlebar__button" label="Maximize" onClick={() => getCurrentWindow().toggleMaximize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" /></svg>
        </IconButton>
        <IconButton className="shell-titlebar__button shell-titlebar__button--close" label="Close" onClick={() => getCurrentWindow().close()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
        </IconButton>
      </div>
    </header>
  );
}
