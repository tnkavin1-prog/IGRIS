import { useEffect, useRef, useState } from 'react';
import type { HudDisplayMode } from '../../main/types.js';

/**
 * Morphs `.window` (the visible surface) between sizes INSIDE a window that
 * main has already enlarged (grow) or will shrink afterwards (shrink).
 * Returns the mode whose view should be rendered: on shrink the swap is
 * delayed by half the morph so content never sits in a half-collapsed card.
 *
 * Usage (App shell):
 *   const renderMode = useModeTransition(displayMode);
 *   <div key={renderMode} className="mode-view">{view[renderMode]}</div>
 */
export function useModeTransition(mode: HudDisplayMode): HudDisplayMode {
  const [renderMode, setRenderMode] = useState(mode);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const bridge = window.hudWindow;
    const root = document.documentElement;
    const clear = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };

    const off = bridge?.onModeChanged((p) => {
      clear();
      root.dataset.anchorX = p.anchorX;
      root.dataset.anchorY = p.anchorY;
      const el = document.querySelector<HTMLElement>('.window');
      if (!el || p.durationMs === 0) {
        setRenderMode(p.to);
        return;
      }
      const d = p.durationMs;
      const startDelay = p.growing ? 32 : 0; // wait for main to enlarge the window

      // 1) pin the OLD surface size (no transition)
      el.style.transition = 'none';
      el.style.width = `${p.fromSurface.width}px`;
      el.style.height = `${p.fromSurface.height}px`;
      void el.offsetWidth; // commit

      // 2) morph to the NEW size
      timers.current.push(
        window.setTimeout(() => {
          el.style.transition = `width ${d}ms var(--hud-ease-out), height ${d}ms var(--hud-ease-out)`;
          el.style.width = `${p.toSurface.width}px`;
          el.style.height = `${p.toSurface.height}px`;
        }, startDelay),
      );
      // 3) hand sizing back to CSS once the window has settled
      timers.current.push(
        window.setTimeout(
          () => {
            el.style.transition = '';
            el.style.width = '';
            el.style.height = '';
          },
          startDelay + d + (p.growing ? 60 : 120),
        ),
      );
      // content swap
      if (p.growing) setRenderMode(p.to);
      else timers.current.push(window.setTimeout(() => setRenderMode(p.to), d / 2));
    });

    return () => {
      off?.();
      clear();
    };
  }, []);

  // Safety net: if no transition event arrives (browser dev, missed IPC), converge.
  useEffect(() => {
    const t = window.setTimeout(() => setRenderMode(mode), 500);
    return () => window.clearTimeout(t);
  }, [mode]);

  return renderMode;
}
