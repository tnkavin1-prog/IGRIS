/**
 * Small, dependency-free UI primitives and a consistent icon set.
 * Icons are inline SVG so the extension ships without network fonts or images.
 */
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';

export type IconName =
  | 'settings'
  | 'close'
  | 'mic'
  | 'micOff'
  | 'play'
  | 'stop'
  | 'send'
  | 'shield'
  | 'check'
  | 'alert'
  | 'spark'
  | 'globe'
  | 'monitor'
  | 'storage'
  | 'headphones'
  | 'chevron'
  | 'trash'
  | 'key'
  | 'plug'
  | 'volume'
  | 'wave'
  | 'history'
  | 'bookmark'
  | 'download'
  | 'lock'
  | 'refresh'
  | 'external'
  | 'copy'
  | 'eye'
  | 'eyeOff'
  | 'info'
  | 'bot'
  | 'user'
  | 'terminal'
  | 'clock'
  | 'wifi'
  | 'wifiOff'
  | 'search'
  | 'wand'
  | 'arrowRight'
  | 'dots';

const PATHS: Record<IconName, ReactNode> = {
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </>
  ),
  micOff: (
    <>
      <path d="M9 9v2a3 3 0 0 0 4.6 2.5M15 10V5a3 3 0 0 0-5.6-1.5M5 10a7 7 0 0 0 11.4 5.5M19 10a7 7 0 0 1-.5 2.6M12 17v5M8 22h8M3 3l18 18" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  send: <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />,
  shield: (
    <>
      <path d="M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-4Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  alert: (
    <>
      <path d="M10.3 3.5 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15.5 20 18l2.5 1-2.5 1-1 2.5-1-2.5L15.5 19l2.5-1 1-2.5Z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  headphones: (
    <>
      <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
      <rect x="2" y="14" width="4" height="7" rx="2" />
      <rect x="18" y="14" width="4" height="7" rx="2" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 9-9M17 4l3 3M14 7l3 3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  wave: <path d="M2 12h2l2-7 3 14 3-11 3 8 2-4h5" />,
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  refresh: (
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M3 21v-5h5M21 3v5h-5" />
  ),
  external: (
    <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.3 3.3M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M8 14h.01M16 14h.01M9 18h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3M13 15h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  wifi: <path d="M2 8.5a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0M12 19h.01" />,
  wifiOff: (
    <path d="M2 8.5a16 16 0 0 1 6.2-2.6M15 6.2a16 16 0 0 1 7 2.3M5 12a11 11 0 0 1 4.2-2.1M14.8 10a11 11 0 0 1 4.2 2M8.5 15.5a6 6 0 0 1 7 0M12 19h.01M3 3l18 18" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  wand: (
    <path d="m15 4 1.2 3.3L19.5 8.5l-3.3 1.2L15 13l-1.2-3.3L10.5 8.5l3.3-1.2L15 4ZM4 20l8-8M3 15l1 1M8 3l1 1M3 9h2" />
  ),
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  className = '',
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export type Tone = 'neutral' | 'violet' | 'cyan' | 'green' | 'amber' | 'red';

export function Badge({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: IconName;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span className={`status-dot tone-${tone} ${pulse ? 'pulse' : ''}`} aria-hidden="true" />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <label htmlFor={id} className="toggle-copy">
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-description">{description}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <label className={`slider-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : String(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
      />
    </label>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function LevelBars({
  level,
  active,
  bars = 18,
}: {
  level: number;
  active: boolean;
  bars?: number;
}) {
  const heights = Array.from({ length: bars }, (_, index) => {
    const wave = Math.sin((index / bars) * Math.PI);
    const jitter = 0.45 + 0.55 * Math.abs(Math.sin(index * 12.9898));
    return Math.max(0.12, wave * jitter);
  });
  return (
    <div
      className={`level-bars ${active ? 'is-active' : ''}`}
      style={{ '--level': Math.min(1, Math.max(0, level)) } as CSSProperties}
      aria-hidden="true"
    >
      {heights.map((height, index) => (
        <span
          key={index}
          style={{ height: `${Math.max(8, height * 100)}%`, animationDelay: `${index * 38}ms` }}
        />
      ))}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="text-button copy-button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? 'Copied' : label}
    </button>
  );
}

export function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return '00:00';
  const total = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function timeOf(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
