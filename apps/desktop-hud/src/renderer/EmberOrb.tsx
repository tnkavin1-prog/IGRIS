import { useEffect, useRef } from 'react';

export type EmberOrbState = 'idle' | 'listening' | 'speaking' | 'thinking';

interface EmberOrbProps {
  state: EmberOrbState;
}

interface Params {
  bright: number;
  ripple: number;
  aura: number;
  ring: number;
  sat: number;
  spin: number;
  breath: number;
  particles: number;
}

interface OrbStateDef extends Params {
  scale: number;
  label: string;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

const STATES: Record<EmberOrbState, OrbStateDef> = {
  idle: {
    scale: 0.95,
    bright: 0.7,
    ripple: 0.06,
    aura: 1.0,
    ring: 0,
    particles: 0,
    sat: 0,
    spin: 0.05,
    breath: 1.0,
    label: 'Idle',
  },
  listening: {
    scale: 1.0,
    bright: 1.0,
    ripple: 0.16,
    aura: 1.1,
    ring: 1,
    particles: 1,
    sat: 0,
    spin: 0.05,
    breath: 0.3,
    label: 'Listening',
  },
  speaking: {
    scale: 1.0,
    bright: 1.0,
    ripple: 0.16,
    aura: 1.1,
    ring: 1,
    particles: 1,
    sat: 0,
    spin: 0.08,
    breath: 0.3,
    label: 'Speaking',
  },
  thinking: {
    scale: 0.85,
    bright: 0.85,
    ripple: 0.03,
    aura: 0.8,
    ring: 0,
    particles: 0,
    sat: 1,
    spin: 0.9,
    breath: 0,
    label: 'Thinking',
  },
};

const PARAM_KEYS: (keyof Params)[] = [
  'bright',
  'ripple',
  'aura',
  'ring',
  'sat',
  'spin',
  'breath',
  'particles',
];

const STOPS: Array<[number, number, number, number]> = [
  [0.0, 36, 62, 86],
  [0.45, 31, 66, 72],
  [0.85, 19, 53, 54],
  [1.0, 16, 45, 30],
];

const CHAMPAGNE = '245,224,196';
const EMBER = '232,185,138';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const P = new Uint8Array(512);
(() => {
  const p = [...Array(256).keys()];
  let s = 1337;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const tmp = p[i] ?? 0;
    p[i] = p[j] ?? 0;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255] ?? 0;
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h: number, x: number, y: number) => {
  switch (h & 3) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    default:
      return -x - y;
  }
};

function noise2(x: number, y: number) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x);
  const v = fade(y);
  const at = (index: number) => P[index] ?? 0;
  const aa = at(at(X) + Y);
  const ab = at(at(X) + Y + 1);
  const ba = at(at(X + 1) + Y);
  const bb = at(at(X + 1) + Y + 1);
  return lerp(
    lerp(grad(aa, x, y), grad(ba, x - 1, y), u),
    lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u),
    v,
  );
}

const fbm = (x: number, y: number) =>
  noise2(x, y) * 0.6 + noise2(x * 2.1, y * 2.1) * 0.28 + noise2(x * 4.3, y * 4.3) * 0.12;

function simVoice(t: number, amp = 1) {
  const phrase = 0.55 + 0.45 * Math.sin(t * 0.9 + Math.sin(t * 0.37) * 2);
  const gate = smoothstep(0.25, 0.6, phrase);
  const syl = Math.abs(Math.sin(t * 6.3 + Math.sin(t * 2.1) * 1.5));
  const n = noise2(t * 3.1, 7.7) * 0.5 + 0.5;
  const rms = clamp((syl * 0.55 + n * 0.35) * gate, 0, 1) * amp;
  return {
    rms,
    bass: rms * (0.5 + 0.5 * Math.sin(t * 1.3)),
    mids: rms * (0.7 + 0.3 * Math.sin(t * 4.7)),
    highs: Math.max(0, syl - 0.6) * gate * 1.6 * amp,
    cent: 400 + 1400 * n,
  };
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h} ${s}% ${l}% / ${a})`;

export function EmberOrb({ state }: EmberOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<EmberOrbState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !wrap || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let time = 0;
    let lightAngle = -2.1;
    let sparkCooldown = 0;

    const params: Params = {
      bright: 0.7,
      ripple: 0.06,
      aura: 1,
      ring: 0,
      sat: 0,
      spin: 0.05,
      breath: 1,
      particles: 0,
    };
    const spring = { x: 0.95, v: 0 };
    const audio = { rms: 0, bass: 0, mids: 0, highs: 0, cent: 1000 };
    const particles: Spark[] = [];

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      width = Math.min(rect.width, 400);
      height = Math.min(rect.height, 380);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(wrap);

    const sprite = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d');
      if (!g) return null;
      const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      rg.addColorStop(0, `rgba(${CHAMPAGNE},1)`);
      rg.addColorStop(0.4, `rgba(${CHAMPAGNE},.5)`);
      rg.addColorStop(1, `rgba(${CHAMPAGNE},0)`);
      g.fillStyle = rg;
      g.fillRect(0, 0, 32, 32);
      return c;
    })();

    const spawnSpark = (cx: number, cy: number, radius: number, count: number) => {
      for (let i = 0; i < count && particles.length < 90; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 18 + Math.random() * 30;
        particles.push({
          x: cx + Math.cos(a) * radius * 1.05,
          y: cy + Math.sin(a) * radius * 1.05,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 6,
          life: 1,
          size: 3 + Math.random() * 7,
        });
      }
    };

    const orbPath = (
      cx: number,
      cy: number,
      radius: number,
      t: number,
      rippleAmt: number,
      bassSwell: number,
    ) => {
      const segments = 140;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const n = fbm(ca * 1.4 + t * 0.25 + 10, sa * 1.4 + t * 0.19 + 10);
        const rad = radius * (1 + n * rippleAmt);
        const x = cx + ca * rad;
        const y = cy + sa * rad * (1 - bassSwell * 0.12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const analyse = (t: number, dt: number) => {
      let rms = 0;
      let bass = 0;
      let mids = 0;
      let highs = 0;
      let cent = 1000;
      const current = stateRef.current;
      if (current === 'speaking') {
        ({ rms, bass, mids, highs, cent } = simVoice(t, 1));
      } else if (current === 'listening') {
        ({ rms, bass, mids, highs, cent } = simVoice(t, 0.7));
      }
      const follow = (cur: number, target: number, attack: number, release: number) =>
        cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? attack : release)));
      audio.rms = follow(audio.rms, rms, 0.05, 0.28);
      audio.bass = follow(audio.bass, bass, 0.06, 0.35);
      audio.mids = follow(audio.mids, mids, 0.05, 0.25);
      audio.highs = follow(audio.highs, highs, 0.03, 0.18);
      audio.cent = follow(audio.cent, cent, 0.4, 0.4);
    };

    const draw = (t: number, dt: number) => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const R0 = 82;

      const hueShift = clamp((audio.cent - 1200) / 1800, -1, 1) * 10;
      const breath = 1 + params.breath * 0.03 * Math.sin((t * Math.PI) / 2);
      const radius = R0 * spring.x * breath;
      const rippleAmt = reduced ? 0 : params.ripple * (0.15 + audio.mids * 0.85);
      const lightX = cx + Math.cos(lightAngle) * radius * 0.42;
      const lightY = cy + Math.sin(lightAngle) * radius * 0.42;

      // ambient aura
      const auraR = radius * 1.9 * (1 + audio.rms * 0.3);
      let g = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, auraR);
      g.addColorStop(0, `rgba(${EMBER},${0.16 * params.bright * params.aura})`);
      g.addColorStop(0.5, `rgba(201,111,74,${0.08 * params.bright * params.aura})`);
      g.addColorStop(0.75, 'rgba(201,111,74,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // orbit ring
      if (params.ring > 0.01) {
        const rr = radius * 1.34;
        const arc = 0.6 + audio.rms * 3.6;
        const rot = t * (0.3 + audio.rms * 1.2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${CHAMPAGNE},${(0.1 + audio.rms * 0.14) * params.ring})`;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, rot, rot + arc);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${CHAMPAGNE},${(0.06 + audio.rms * 0.08) * params.ring})`;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, rot + Math.PI, rot + Math.PI + arc * 0.6);
        ctx.stroke();
      }

      // core sphere
      orbPath(cx, cy, radius, t, rippleAmt, audio.bass);
      g = ctx.createRadialGradient(lightX, lightY, radius * 0.05, cx, cy, radius * 1.28);
      for (const [pos, h, s, l] of STOPS) g.addColorStop(pos, hsl(h + hueShift, s, l));
      ctx.globalAlpha = params.bright;
      ctx.fillStyle = g;
      ctx.fill();

      // glassy sheen
      ctx.globalCompositeOperation = 'screen';
      orbPath(cx, cy, radius, t, rippleAmt, audio.bass);
      g = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, radius * 1.1);
      g.addColorStop(0, `rgba(255,246,232,${0.35 * params.bright})`);
      g.addColorStop(0.6, 'rgba(255,246,232,0)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // rim light
      orbPath(cx, cy, radius, t, rippleAmt, audio.bass);
      ctx.strokeStyle = `rgba(${CHAMPAGNE},${0.1 * params.bright})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // inner light
      ctx.globalCompositeOperation = 'screen';
      const ilR = radius * 0.55;
      g = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, ilR);
      g.addColorStop(0, `rgba(255,240,220,${(0.22 + audio.highs * 0.3) * params.bright})`);
      g.addColorStop(1, 'rgba(255,240,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lightX, lightY, ilR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // particles
      sparkCooldown -= dt;
      if (
        !reduced &&
        params.particles > 0.5 &&
        audio.highs > 0.32 &&
        sparkCooldown <= 0 &&
        sprite
      ) {
        spawnSpark(cx, cy, radius, 2 + ((audio.highs * 4) | 0));
        sparkCooldown = 0.06;
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 0.6 * dt;
        p.vy = p.vy * (1 - 0.6 * dt) - 5 * dt;
        p.life -= dt / 1.3;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        if (!sprite) continue;
        ctx.globalAlpha = p.life * 0.8 * params.bright;
        ctx.drawImage(sprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // thinking satellite
      if (params.sat > 0.01) {
        const a = t * 2.2;
        const rr = radius * 1.34;
        const sx = cx + Math.cos(a) * rr;
        const sy = cy + Math.sin(a) * rr;
        ctx.strokeStyle = `rgba(${CHAMPAGNE},${0.18 * params.sat})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, a - 0.55, a);
        ctx.stroke();
        ctx.fillStyle = `rgba(${CHAMPAGNE},${0.9 * params.sat})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      time += dt;

      analyse(time, dt);

      const k = 1 - Math.exp(-6 * dt);
      const target = STATES[stateRef.current];
      for (const key of PARAM_KEYS) params[key] = lerp(params[key], target[key], k);
      lightAngle += params.spin * dt;

      const targetScale = target.scale * (1 + audio.rms * 0.12);
      const acc = 180 * (targetScale - spring.x) - 22 * spring.v;
      spring.v += acc * dt;
      spring.x = clamp(spring.x + spring.v * dt, 0.7, 1.25);

      draw(time, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
