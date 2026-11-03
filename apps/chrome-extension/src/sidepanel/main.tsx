import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the side panel usable even if a render throws; the controller keeps
    // running and a reload restores the persisted state.
    console.error('Side panel render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fatal">
          <div className="fatal-card">
            <div className="section-kicker">Panel error</div>
            <h2>Something in the interface broke</h2>
            <p>
              The audio session is separate from this view, so ending the panel will not leave a
              microphone open. Reload to restore the panel.
            </p>
            <pre>{this.state.error.message}</pre>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload panel
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The side panel root element is missing.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
