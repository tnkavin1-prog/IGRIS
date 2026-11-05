import { useCallback, useEffect, useState } from 'react';
import { isOverlay, onHostMessage, overlay } from './bridge';

/**
 * Overlay geometry state.
 *
 * Collapsing is owned here rather than by the host so the iframe can shrink to
 * a single orb without the host guessing what to render. The host is told
 * through an effect, so React StrictMode's double-invoke cannot post twice.
 */
export function useOverlayShell(): {
  overlay: boolean;
  collapsed: boolean;
  toggle: () => void;
  expand: () => void;
} {
  const active = isOverlay();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    overlay.ready();
    return onHostMessage(setCollapsed);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    overlay.setCollapsed(collapsed);
  }, [active, collapsed]);

  const toggle = useCallback(() => setCollapsed((current) => !current), []);
  const expand = useCallback(() => setCollapsed(false), []);

  return { overlay: active, collapsed, toggle, expand };
}
