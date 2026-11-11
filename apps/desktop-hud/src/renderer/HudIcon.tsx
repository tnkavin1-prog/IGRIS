export type HudIconName =
  | 'spark'
  | 'chat'
  | 'board'
  | 'more'
  | 'pin'
  | 'export'
  | 'minus'
  | 'maximize'
  | 'restore'
  | 'close'
  | 'mic'
  | 'micOff'
  | 'keyboard'
  | 'stop'
  | 'ops'
  | 'scan'
  | 'summary'
  | 'plan'
  | 'terminal'
  | 'globe'
  | 'radar'
  | 'workflow'
  | 'skills'
  | 'models'
  | 'play'
  | 'pause'
  | 'chevron'
  | 'send'
  | 'volume'
  | 'mute'
  | 'document'
  | 'cube'
  | 'palette'
  | 'check'
  | 'shield'
  | 'refresh'
  | 'calculator'
  | 'alert'
  | 'search'
  | 'command'
  | 'bari'
  | 'orbi'
  | 'expand'
  | 'eye'
  | 'monitor'
  | 'grid'
  | 'zap'
  | 'sliders'
  | 'sparkle'
  | 'pen'
  | 'eraser';

/** Crisp, consistent 24px stroke icon set for the HUD shell. */
export function HudIcon({ name, size = 14 }: { name: HudIconName; size?: number }) {
  const common = {
    className: 'i',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 2.6l1.9 5.5 5.5 1.9-5.5 1.9-1.9 5.5-1.9-5.5L4.6 10l5.5-1.9L12 2.6z" />
          <path d="M18.4 3.3l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5.5-1.4z" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M20.5 11.6a8.4 8.4 0 0 1-8.4 8.4H8l-4.5 2.6 1.2-4.4a8.4 8.4 0 1 1 15.8-6.6z" />
          <path d="M8.5 10.4h7M8.5 13.6h4.6" />
        </svg>
      );
    case 'board':
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="17" height="13.5" rx="2.8" />
          <path d="M7.5 9h4.4M7.5 12h7.5M8 21h8M12 17.5V21" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.35" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M15.6 3.6l4.8 4.8-2.4.8-3.2 3.2.4 3.2-2 2-3.4-3.4-4.8 4.8-1.4-1.4 4.8-4.8L5 9.4l2-2 3.2.4 3.2-3.2.8-2.4z" />
        </svg>
      );
    case 'export':
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5M12 15V3" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'maximize':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
        </svg>
      );
    case 'restore':
      return (
        <svg {...common}>
          <rect x="4" y="8" width="12" height="12" rx="2" />
          <path d="M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...common}>
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3.5M8.5 21.5h7" />
        </svg>
      );
    case 'micOff':
      return (
        <svg {...common}>
          <path d="M9 9V5.5a3 3 0 0 1 5.9-.7M15 10.5v1a3 3 0 0 1-.9 2.1" />
          <path d="M5.5 10.5v1a6.5 6.5 0 0 0 10.2 5.5M12 18v3.5M8.5 21.5h7M3 3l18 18" />
        </svg>
      );
    case 'keyboard':
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="3" />
          <path d="M6 9h.01M9.5 9h.01M13 9h.01M16.5 9h.01M6 12.5h.01M9.5 12.5h.01M13 12.5h.01M16.5 12.5h.01M8 16h8" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...common}>
          <rect x="5.5" y="5.5" width="13" height="13" rx="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'ops':
      return (
        <svg {...common}>
          <path
            d="M13.2 2L4.5 13.4h5.8L9.2 22l8.9-11.6h-5.9L13.2 2z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case 'scan':
      return (
        <svg {...common}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M3.5 12h17" />
        </svg>
      );
    case 'summary':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 10h11M4 14h16M4 18h9" />
          <path d="M18.5 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z" />
        </svg>
      );
    case 'plan':
      return (
        <svg {...common}>
          <circle cx="5.5" cy="6" r="1.5" />
          <circle cx="5.5" cy="12" r="1.5" />
          <circle cx="5.5" cy="18" r="1.5" />
          <path d="M9.5 6h10M9.5 12h7M9.5 18h10" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="19" height="17" rx="3" />
          <path d="M6.5 8.5L10 12l-3.5 3.5M11.5 15.5h5" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.5 9h17M3.5 15h17M12 3c2.4 2.4 3.6 5.4 3.6 9S14.4 18.6 12 21c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3z" />
        </svg>
      );
    case 'radar':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M12 3a9 9 0 1 1-6.4 2.6M12 6.5a5.5 5.5 0 1 1-3.9 1.6M12 12l6.4-6.4" />
        </svg>
      );
    case 'workflow':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="7" height="6" rx="2" />
          <rect x="14" y="14" width="7" height="6" rx="2" />
          <path d="M10 7h4.5A2.5 2.5 0 0 1 17 9.5V14M14 17H9.5A2.5 2.5 0 0 1 7 14.5V10" />
        </svg>
      );
    case 'skills':
      return (
        <svg {...common}>
          <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3z" />
          <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
        </svg>
      );
    case 'models':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" />
          <path d="M9 2.5V4.5M15 2.5V4.5M9 19.5v2M15 19.5v2M2.5 9h2M2.5 15h2M19.5 9h2M19.5 15h2" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <path d="M7 5.5v13l11-6.5L7 5.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common}>
          <path d="M7 9.5l5 5 5-5" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="M21 3L10.5 13.5M21 3l-6.5 18-4-8.5L2 8.5 21 3z" />
        </svg>
      );
    case 'volume':
      return (
        <svg {...common}>
          <path d="M4 9.5v5h3.4L12 18.6V5.4L7.4 9.5H4z" />
          <path d="M15.4 9a4.2 4.2 0 0 1 0 6M18 6.4a8 8 0 0 1 0 11.2" />
        </svg>
      );
    case 'mute':
      return (
        <svg {...common}>
          <path d="M4 9.5v5h3.4L12 18.6V5.4L7.4 9.5H4z" />
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        </svg>
      );
    case 'document':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
          <path d="M14 3v5h5M8.5 13h7M8.5 16.5h4.5" />
        </svg>
      );
    case 'cube':
      return (
        <svg {...common}>
          <path d="M12 2.8l8 4.5v9.4l-8 4.5-8-4.5V7.3l8-4.5z" />
          <path d="M4.3 7.4L12 11.7l7.7-4.3M12 21.2v-9.5" />
        </svg>
      );
    case 'palette':
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 1 0 0 18h1.1a2.2 2.2 0 0 0 .5-4.3 1.8 1.8 0 0 1 .4-3.5h2.2A4.8 4.8 0 0 0 21 8.4C20.4 5.2 16.6 3 12 3z" />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7.3" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.8" cy="7.3" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.2l2.7 2.7L16.4 9" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 2.7l7.5 3v5.7c0 4.7-3.1 8.2-7.5 9.9-4.4-1.7-7.5-5.2-7.5-9.9V5.7l7.5-3z" />
          <path d="M8.8 12l2.1 2.1 4.3-4.3" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5" />
        </svg>
      );
    case 'calculator':
      return (
        <svg {...common}>
          <rect x="5" y="2.8" width="14" height="18.4" rx="2.6" />
          <path d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 3.2L21.3 19a1.6 1.6 0 0 1-1.4 2.4H4.1A1.6 1.6 0 0 1 2.7 19L12 3.2z" />
          <path d="M12 9.3v4.6M12 17.4h.01" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4.3-4.3" />
        </svg>
      );
    case 'command':
      return (
        <svg {...common}>
          <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
      );
    case 'bari':
      return (
        <svg {...common}>
          <rect x="2" y="8" width="20" height="8" rx="4" />
        </svg>
      );
    case 'orbi':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case 'expand':
      return (
        <svg {...common}>
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'monitor':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'zap':
      return (
        <svg {...common}>
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case 'sliders':
      return (
        <svg {...common}>
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      );
    case 'pen':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      );
    case 'eraser':
      return (
        <svg {...common}>
          <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" />
          <path d="M22 21H7" />
        </svg>
      );
    default:
      return null;
  }
}
