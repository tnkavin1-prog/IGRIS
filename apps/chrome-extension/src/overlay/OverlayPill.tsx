import { isSessionLive, type PanelSnapshot } from '../sidepanel/controller';
import { statusMeta } from '../sidepanel/status';
import { Icon } from '../sidepanel/ui';
import { overlay } from './bridge';
import { useEffect, useRef } from 'react';

/**
 * Compact overlay: the same footprint as the Gemini Live pill. It shows the
 * orb, a status line, a microphone control, and a close control. Clicking the
 * body opens the full panel.
 */
export function OverlayPill({
  snapshot,
  onExpand,
  onStart,
  onMute,
}: {
  snapshot: PanelSnapshot;
  onExpand: () => void;
  onStart: () => void;
  onMute: () => void;
}) {
  const live = isSessionLive(snapshot.status);
  const meta = statusMeta(snapshot.status, snapshot.statusDetail);
  const label = live ? meta.label : 'Ask Gemini';
  const micLabel = live
    ? snapshot.micMuted
      ? 'Unmute microphone'
      : 'Mute microphone'
    : 'Start live session';

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rootRef.current) rootRef.current.dataset.ready = 'true';
  }, []);

  return (
    <div className="overlay-pill" ref={rootRef} data-live={live}>
      <button
        type="button"
        className="overlay-pill-main"
        aria-label={live ? 'Open the live assistant' : 'Open the Gemini assistant'}
        onClick={() => {
          (window as unknown as { __gblClicks?: number }).__gblClicks =
            ((window as unknown as { __gblClicks?: number }).__gblClicks ?? 0) + 1;
          onExpand();
        }}
      >
        <span className="overlay-pill-orb" data-orb={meta.orb} aria-hidden="true">
          <Icon name="spark" size={18} />
        </span>
        <span className="overlay-pill-label">{label}</span>
      </button>
      <button
        type="button"
        className="overlay-pill-btn"
        aria-label={micLabel}
        title={micLabel}
        onClick={live ? onMute : onStart}
      >
        <Icon name={live && snapshot.micMuted ? 'micOff' : 'mic'} size={17} />
      </button>
      <button
        type="button"
        className="overlay-pill-btn"
        aria-label="Close the assistant"
        title="Close"
        onClick={() => overlay.close()}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
