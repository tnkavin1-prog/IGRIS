import { useCallback, useRef, type MouseEvent, type PointerEvent } from 'react';

interface Options {
  /** Fired on a click that did NOT turn into a drag (pointer or keyboard). */
  onClick?: () => void;
  /** Targets inside these never start a drag (use '' to allow everything). */
  ignoreSelector?: string;
  threshold?: number;
}

const DEFAULT_IGNORE = 'button,input,textarea,select,a,dialog,[data-no-drag]';

export function useWindowDrag({
  onClick,
  ignoreSelector = DEFAULT_IGNORE,
  threshold = 4,
}: Options = {}) {
  const st = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !window.hudWindow) return;
      if (ignoreSelector && (e.target as Element).closest(ignoreSelector)) return;
      st.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [ignoreSelector],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const s = st.current;
      if (!s || s.id !== e.pointerId || s.dragging) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) >= threshold) {
        s.dragging = true;
        window.hudWindow?.beginGesture({ kind: 'move', snap: !e.altKey });
      }
    },
    [threshold],
  );

  const finish = useCallback(
    (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      st.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      if (s.dragging) window.hudWindow?.endGesture();
      else if (!cancelled) onClick?.();
    },
    [onClick],
  );

  const handleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      // Pointer clicks are handled in pointerup. Here: keyboard (detail===0)
      // or no preload bridge (browser dev).
      if (!onClick) return;
      if (e.detail !== 0 && window.hudWindow) return;
      onClick();
    },
    [onClick],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: PointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => finish(e, true),
    onClick: handleClick,
  };
}
