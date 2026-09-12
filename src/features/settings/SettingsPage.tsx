import { useEffect, useState } from 'react';
import { tauriPortPalGateway, type PortPalGateway } from '../../lib/tauri';

const TEXT_SIZES = [
  { label: 'Standard', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Larger', value: 1.3 },
];

const AUTOSTART_KEY = 'portpal_autostart';

export function SettingsPage({
  fontScale,
  onFontScale,
  launchAtLogin: controlledLaunch,
  onLaunchAtLoginChange,
  gateway = tauriPortPalGateway,
}: {
  fontScale: number;
  onFontScale(value: number): void;
  launchAtLogin?: boolean;
  onLaunchAtLoginChange?: (enabled: boolean) => void;
  gateway?: PortPalGateway;
}) {
  const [internalLaunch, setInternalLaunch] = useState(() => {
    try {
      return localStorage.getItem(AUTOSTART_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (controlledLaunch !== undefined) return;
    let active = true;
    Promise.resolve(gateway.getAutostart?.())
      .then((enabled) => {
        if (!active || typeof enabled !== 'boolean') return;
        setInternalLaunch(enabled);
        try {
          localStorage.setItem(AUTOSTART_KEY, String(enabled));
        } catch {}
      })
      .catch(() => {
        // Fall back to localStorage value if backend query fails
      });
    return () => {
      active = false;
    };
  }, [controlledLaunch, gateway]);

  const launchAtLogin = controlledLaunch ?? internalLaunch;

  const handleToggle = async () => {
    const next = !launchAtLogin;
    if (onLaunchAtLoginChange) {
      onLaunchAtLoginChange(next);
    } else {
      const prev = internalLaunch;
      setInternalLaunch(next);
      try {
        localStorage.setItem(AUTOSTART_KEY, String(next));
      } catch {}
      try {
        await gateway.setAutostart?.(next);
      } catch {
        setInternalLaunch(prev);
        try {
          localStorage.setItem(AUTOSTART_KEY, String(prev));
        } catch {}
      }
    }
  };

  return (
    <div className="secondary-page">
      <header className="secondary-heading">
        <h2>Settings</h2>
        <p>Appearance &amp; preferences</p>
      </header>
      <section className="secondary-settings-section">
        <div className="secondary-settings-row">
          <div>
            <h3>Text size</h3>
            <p>Scales every label, table and badge in PortPal.</p>
          </div>
          <div className="secondary-size-group" role="group" aria-label="Text size">
            {TEXT_SIZES.map((size) => (
              <button
                key={size.label}
                aria-pressed={fontScale === size.value}
                onClick={() => onFontScale(size.value)}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
        <div className="secondary-settings-preview">
          <span className="secondary-mono">:3000</span>
          <span>vite — my-app</span>
          <span className="secondary-state">Active</span>
        </div>
      </section>

      <section className="secondary-settings-section">
        <div className="secondary-settings-row">
          <div>
            <h3>Launch at login</h3>
            <p>Start PortPal automatically when signing in to Windows.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={launchAtLogin}
            aria-label="Launch at login"
            className="secondary-toggle"
            onClick={handleToggle}
          >
            <span className="secondary-toggle-thumb" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
