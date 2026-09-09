import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Titlebar } from './components/shell/Titlebar';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary for the frameless window.
 *
 * Because `decorations: false`, the window controls (minimize, maximize, close)
 * are React components inside the tree. A render-phase exception would unmount
 * everything — including those controls — leaving the user with a blank
 * rectangle and no way to dismiss the window except the tray menu.
 *
 * This boundary catches the crash, preserves the Titlebar chrome, and offers a
 * reload action so the user can recover without hunting for the tray icon.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled render error:', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleDismiss = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="app app-shell" style={{ display: 'grid', gridTemplateRows: 'auto 1fr' }}>
          <Titlebar />
          <main style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-primary, #e4e4e7)',
          }}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{ opacity: 0.6 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              Something went wrong
            </h2>
            <p style={{ margin: 0, maxWidth: '36ch', opacity: 0.7, fontSize: '0.875rem', lineHeight: 1.5 }}>
              An unexpected error crashed the interface. Your ports and processes are unaffected.
            </p>
            <details style={{ maxWidth: '50ch', textAlign: 'left', fontSize: '0.75rem', opacity: 0.5 }}>
              <summary style={{ cursor: 'pointer' }}>Error details</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5rem' }}>
                {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={this.handleReload}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--accent, #3b82f6)',
                  color: '#fff',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}>
                Reload
              </button>
              <button type="button" onClick={this.handleDismiss}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border, #333)',
                  background: 'transparent',
                  color: 'var(--text-primary, #e4e4e7)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}>
                Try to continue
              </button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
