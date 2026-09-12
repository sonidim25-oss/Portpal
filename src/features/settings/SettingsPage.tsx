import { useEffect, useState } from 'react';
import { tauriPortPalGateway, type PortPalGateway, type UpdateMetadata } from '../../lib/tauri';

const TEXT_SIZES = [
  { label: 'Standard', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Larger', value: 1.3 },
];

const AUTOSTART_KEY = 'portpal_autostart';
export const CURRENT_VERSION = '0.5.1';

export function SettingsPage({
  fontScale,
  onFontScale,
  launchAtLogin: controlledLaunch,
  onLaunchAtLoginChange,
  currentVersion = CURRENT_VERSION,
  initialUpdate = null,
  gateway = tauriPortPalGateway,
}: {
  fontScale: number;
  onFontScale(value: number): void;
  launchAtLogin?: boolean;
  onLaunchAtLoginChange?: (enabled: boolean) => void;
  currentVersion?: string;
  /** Result of the launch-time check, so following the sidebar dot lands on
   *  the install control instead of an idle "Check for updates" button. */
  initialUpdate?: UpdateMetadata | null;
  gateway?: PortPalGateway;
}) {
  const [internalLaunch, setInternalLaunch] = useState(() => {
    try {
      return localStorage.getItem(AUTOSTART_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'up-to-date' | 'installing' | 'error'
  >(initialUpdate ? 'available' : 'idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateMetadata | null>(initialUpdate);
  const [updateError, setUpdateError] = useState<string | null>(null);

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

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    setUpdateError(null);
    try {
      const result = await gateway.checkUpdate();
      if (result) {
        setUpdateInfo(result);
        setUpdateStatus('available');
      } else {
        setUpdateInfo(null);
        setUpdateStatus('up-to-date');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUpdateError(message);
      setUpdateStatus('error');
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateStatus('installing');
    setUpdateError(null);
    try {
      await gateway.installUpdate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUpdateError(message);
      setUpdateStatus('error');
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

      <section className="secondary-settings-section">
        <div className="secondary-settings-row">
          <div>
            <h3>Software updates</h3>
            <p>PortPal v{currentVersion}</p>
          </div>
          <button
            type="button"
            className="ui-button"
            onClick={handleCheckUpdate}
            disabled={updateStatus === 'checking' || updateStatus === 'installing'}
          >
            {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {updateStatus === 'up-to-date' && (
          <p className="secondary-update-status" role="status">
            PortPal is up to date (v{currentVersion}).
          </p>
        )}

        {updateStatus === 'available' && updateInfo && (
          <div className="secondary-update-box">
            <div className="secondary-update-header">
              <strong>Version {updateInfo.version} is available</strong>
              {updateInfo.date && (
                <span className="secondary-mono">{updateInfo.date.split('T')[0]}</span>
              )}
            </div>
            {updateInfo.body && <p className="secondary-update-notes">{updateInfo.body}</p>}
            <div>
              <button
                type="button"
                className="ui-button ui-button--primary"
                onClick={handleInstallUpdate}
              >
                Download &amp; install update
              </button>
            </div>
          </div>
        )}

        {updateStatus === 'installing' && (
          <div className="secondary-update-box" role="status">
            <p>Downloading and installing update… PortPal will restart when complete.</p>
          </div>
        )}

        {updateStatus === 'error' && (
          <p className="secondary-update-error" role="alert">
            {updateError ?? 'Unable to check for updates.'}
          </p>
        )}
      </section>
    </div>
  );
}
