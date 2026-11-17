import { useEffect } from 'react';

export function useClickThrough(selector = '.window, .rz-h, [data-hit]'): void {
  useEffect(() => {
    const bridge = window.hudWindow;
    if (!bridge) return;
    let ignoring: boolean | null = null;
    let raf = 0;
    let px = 0;
    let py = 0;

    const apply = (v: boolean) => {
      if (v === ignoring) return;
      ignoring = v;
      bridge.setIgnoreMouse(v);
    };
    const test = () => {
      raf = 0;
      const el = document.elementFromPoint(px, py);
      apply(!(el && el.closest(selector)));
    };
    const onMove = (e: MouseEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(test);
    };
    const resync = () => {
      ignoring = null; // main force-resets during gestures
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('pointerup', resync, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', resync);
      if (raf) cancelAnimationFrame(raf);
      bridge.setIgnoreMouse(false);
    };
  }, [selector]);
}
