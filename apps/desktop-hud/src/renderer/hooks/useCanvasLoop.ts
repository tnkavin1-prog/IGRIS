import { useEffect, useRef, type RefObject } from 'react';

export interface CanvasFrame {
  ctx: CanvasRenderingContext2D;
  /** CSS px (context is already scaled by dpr). */
  width: number;
  height: number;
  dpr: number;
  /** seconds since mount */
  time: number;
  /** seconds since previous frame (clamped to 50 ms) */
  dt: number;
}

export interface CanvasLoopOptions {
  /** Target fps; function form lets idle drop to 30 and active go to 60. */
  fps?: number | (() => number);
  paused?: boolean;
  maxDpr?: number;
}

export function useCanvasLoop(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: (f: CanvasFrame) => void,
  options: CanvasLoopOptions = {},
): void {
  const drawRef = useRef(draw);
  const optsRef = useRef(options);
  drawRef.current = draw;
  optsRef.current = options;
  const paused = options.paused === true;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const t0 = performance.now();
    let raf = 0;
    let running = false;
    let last = 0;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let windowVisible = true;

    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, optsRef.current.maxDpr ?? 2);
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (now: number, dt: number) =>
      drawRef.current({ ctx, width: cssW, height: cssH, dpr, time: (now - t0) / 1000, dt });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const f = optsRef.current.fps;
      const fps = typeof f === 'function' ? f() : (f ?? 60);
      const elapsed = now - last;
      if (elapsed < 1000 / fps - 2) return; // frame pacing; 2 ms slop avoids 60->30 aliasing
      last = now;
      paint(now, Math.min(elapsed, 50) / 1000);
    };

    const sync = () => {
      const shouldRun = !paused && windowVisible && !document.hidden && !reduce.matches;
      if (shouldRun && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
      if (!running && cssW > 0) paint(performance.now(), 0); // one static frame
    };

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      cssW = entry.contentRect.width;
      cssH = entry.contentRect.height;
      fit();
      if (!running) paint(performance.now(), 0);
    });
    ro.observe(canvas);

    // Monitor / scale-factor changes (drag between displays, Windows scaling slider)
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      fit();
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDprChange, { once: true });
    };
    watchDpr();

    reduce.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    const offVis = window.hudWindow?.onVisibility(({ visible }) => {
      windowVisible = visible;
      sync();
    });
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
      reduce.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      offVis?.();
    };
  }, [canvasRef, paused]);
}

/**
 * Pre-render a soft glow ONCE; per frame just drawImage() it.
 * Never use ctx.shadowBlur or createRadialGradient inside the frame loop.
 */
export function makeGlowSprite(
  size: number,
  [r, g, b]: [number, number, number],
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, size, size);
  return c;
}
