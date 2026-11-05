/**
 * Overlay entry point.
 *
 * Renders the exact same application as the side panel, inside a
 * chrome-extension:// iframe that a content script pins to the page. Running as
 * an extension page (not a content script) is what makes the overlay able to
 * use the microphone, the Live WebSocket, chrome.tabs, and chrome.scripting
 * without fighting the host page's CSP.
 */
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../sidepanel/App';
import '../sidepanel/styles.css';
import './overlay.css';

document.documentElement.dataset.surface = 'overlay';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Overlay render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fatal">
          <div className="fatal-card">
            <div className="section-kicker">Overlay error</div>
            <h2>The overlay hit a render error</h2>
            <pre>{this.state.error.message}</pre>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload overlay
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The overlay root element is missing.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
