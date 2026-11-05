/**
 * Window chrome for the overlay surface only.
 *
 * The side panel keeps its normal header; the overlay gets a slim drag strip
 * with collapse and close, so the frame can be moved out of the way without
 * leaving the page.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../sidepanel/ui';
import { overlay } from './bridge';

interface OverlayBarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function OverlayBar({ collapsed, onToggleCollapsed }: OverlayBarProps) {
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const origin = drag.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (dx === 0 && dy === 0) return;
    drag.current = { x: event.clientX, y: event.clientY };
    overlay.drag(dx, dy);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (collapsed) return null;

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
          aria-label="Collapse the assistant"
          title="Collapse"
          onClick={onToggleCollapsed}
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
