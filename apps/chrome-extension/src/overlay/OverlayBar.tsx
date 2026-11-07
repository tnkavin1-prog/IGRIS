/**
 * Window chrome for the overlay panel only.
 *
 * The side panel keeps its normal header; the overlay gets a slim drag strip
 * with minimize-to-orb and close, so the frame can be moved out of the way
 * without leaving the page.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../sidepanel/ui';
import { overlay } from './bridge';

interface OverlayBarProps {
  onMinimize: () => void;
}

export function OverlayBar({ onMinimize }: OverlayBarProps) {
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    drag.current = { x: event.screenX, y: event.screenY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    overlay.dragStart();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const origin = drag.current;
    if (!origin) return;
    const dx = event.screenX - origin.x;
    const dy = event.screenY - origin.y;
    if (dx === 0 && dy === 0) return;
    drag.current = { x: event.screenX, y: event.screenY };
    overlay.drag(dx, dy);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }
    overlay.dragEnd();
  };

  return (
    <div className="overlay-bar">
      <div
        className="overlay-grip"
        role="separator"
        aria-label="Drag to move the assistant"
        title="Drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span />
        <span />
        <span />
      </div>
      <div className="overlay-actions">
        <button
          type="button"
          className="overlay-btn"
          aria-label="Open in side panel (follows across all tabs)"
          title="Dock to side panel"
          onClick={async () => {
            try {
              await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
              overlay.close();
            } catch (err) {
              console.error('Failed to open side panel', err);
            }
          }}
        >
          <Icon name="monitor" size={13} />
        </button>
        <button
          type="button"
          className="overlay-btn"
          aria-label="Minimize to an orb"
          title="Minimize"
          onClick={onMinimize}
        >
          <Icon name="minus" size={13} />
        </button>
        <button
          type="button"
          className="overlay-btn"
          aria-label="Close the assistant"
          title="Close"
          onClick={() => overlay.close()}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  );
}
