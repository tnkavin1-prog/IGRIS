import type { PanelSnapshot } from './controller';
import { Icon, IconButton, StatusDot } from './ui';

export function Header({
  snapshot,
  onOpenSettings,
  onCheckBridge,
}: {
  snapshot: PanelSnapshot;
  onOpenSettings: () => void;
  onCheckBridge: () => void;
}) {
  const bridge = snapshot.bridge.status;
  const tone =
    bridge === 'online'
      ? 'green'
      : bridge === 'checking'
        ? 'amber'
        : bridge === 'offline'
          ? 'red'
          : 'neutral';
  const label =
    bridge === 'online'
      ? 'Bridge online'
      : bridge === 'checking'
        ? 'Checking bridge'
        : bridge === 'offline'
          ? 'Bridge offline'
          : 'Local bridge';

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <div className="brand-name">
            Gemini <b>Browser Live</b>
          </div>
          <div className="brand-subtitle">voice · vision · action</div>
        </div>
      </div>
      <div className="topbar-actions">
        {snapshot.settings.autoApprove ? (
          <span
            className="auto-pill"
            title="Autonomous mode: Gemini executes browser actions automatically without approval prompts"
          >
            <Icon name="spark" size={13} />
            <span>Autonomous</span>
          </span>
        ) : null}
        <button
          type="button"
          className={`bridge-pill ${bridge}`}
          onClick={onCheckBridge}
          title={snapshot.bridge.error ? snapshot.bridge.error : 'Check the loopback token bridge'}
        >
          <StatusDot tone={tone} pulse={bridge === 'checking'} />
          <span>{label}</span>
        </button>
        <IconButton
          label="Float as in-page overlay"
          onClick={() => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'GBL_POP_TO_OVERLAY' }).catch(() => undefined);
            }
          }}
          className="overlay-button"
        >
          <Icon name="expand" size={17} />
        </IconButton>
        <IconButton label="Open settings" onClick={onOpenSettings} className="settings-button">
          <Icon name="settings" size={18} />
        </IconButton>
      </div>
    </header>
  );
}
