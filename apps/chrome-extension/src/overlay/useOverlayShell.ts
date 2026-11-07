import { useCallback, useEffect, useRef, useState } from 'react';
import { isOverlay, onHostMessage, overlay, type OverlayView } from './bridge';

/**
 * Overlay geometry state.
 *
 * Three views share one iframe: a compact pill (the default idle surface), the
 * full panel, and a 64 px orb. The host owns the box; this hook owns which
 * component is rendered.
 *
 * The overlay is authoritative once the user has chosen a view. The host only
 * reports its own state on mount (to survive an iframe reload) and when a
 * second toolbar click asks for the panel; those reports must not overwrite a
 * click that happened in between.
 */
export function useOverlayShell(): {
  overlay: boolean;
  view: OverlayView;
  setView: (view: OverlayView) => void;
} {
  const active = isOverlay();
  const [view, setView] = useState<OverlayView>('panel');
  const interacted = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    overlay.ready();
    return onHostMessage((next) => {
      if (interacted.current) return;
      setView(next);
    });
  }, [active]);

  const set = useCallback((next: OverlayView) => {
    interacted.current = true;
    setView(next);
    overlay.setView(next);
  }, []);

  return { overlay: active, view, setView: set };
}
