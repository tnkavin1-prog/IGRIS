import { useEffect, useRef } from 'react';
import type { ConversationMessage, LiveHUDStatus, HUDSettings } from '../main/types.js';

export interface BrownOrbHUDProps {
  status: LiveHUDStatus;
  conversation: ConversationMessage[];
  settings: HUDSettings;
  onStartSession: () => void;
  onStopSession: () => void;
  onClose: () => void;
  onCollapseToBar?: () => void;
  onCollapseToOrb?: () => void;
  exportNotice?: string | null;
}

const STATUS_LABEL: Record<LiveHUDStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  listening: 'Listening',
  speaking: 'Speaking',
  thinking: 'Thinking',
  closed: 'Closed',
  error: 'Error',
};

export function BrownOrbHUD({
  status,
  conversation,
  onStartSession,
  onStopSession,
  onClose,
  onCollapseToBar,
  onCollapseToOrb,
  exportNotice,
}: BrownOrbHUDProps) {
  const captionsRef = useRef<HTMLDivElement | null>(null);
  const isLive = ['connecting', 'listening', 'speaking', 'thinking'].includes(status);

  // Auto-scroll captions to the latest message.
  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation]);

  const lastAssistant = [...conversation]
    .reverse()
    .find((m) => m.kind === 'assistant' && (m.text || '').trim().length > 0);
  const lastUser = [...conversation]
    .reverse()
    .find((m) => m.kind === 'user' && (m.text || '').trim().length > 0);

  const captionText =
    status === 'listening'
      ? lastUser?.text || 'Listening…'
      : status === 'speaking' || status === 'thinking'
        ? lastAssistant?.text || '…'
        : lastAssistant?.text || lastUser?.text || 'Ready to talk';

  return (
    <div className="brown-orb-shell" data-status={status}>
      <style>{BROWN_ORB_CSS}</style>

      <div className="brown-orb-header">
        <span className="brown-orb-title">Gemetron</span>
        <div className="brown-orb-header-actions">
          {onCollapseToBar && (
            <button
              type="button"
              className="brown-orb-iconbtn"
              onClick={onCollapseToBar}
              aria-label="Collapse to bar"
            >
              _
            </button>
          )}
          {onCollapseToOrb && (
            <button
              type="button"
              className="brown-orb-iconbtn"
              onClick={onCollapseToOrb}
              aria-label="Collapse to orb"
            >
              ○
            </button>
          )}
          <button type="button" className="brown-orb-iconbtn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div className="brown-orb-stage">
        <div className={`brown-orb ${isLive ? 'live' : ''} ${status}`}>
          <div className="brown-orb-glow" />
          <div className="brown-orb-core">
            <span className="brown-orb-status">{STATUS_LABEL[status]}</span>
          </div>
          <div className="brown-orb-ring r1" />
          <div className="brown-orb-ring r2" />
          <div className="brown-orb-ring r3" />
        </div>
      </div>

      <div className="brown-orb-caption" aria-live="polite">
        <div className="brown-orb-caption-text">{captionText}</div>
      </div>

      {exportNotice && <div className="brown-orb-notice">{exportNotice}</div>}

      <div className="brown-orb-footer">
        <button
          type="button"
          className={`brown-orb-mic ${isLive ? 'active' : ''}`}
          onClick={isLive ? onStopSession : onStartSession}
          aria-label={isLive ? 'Stop session' : 'Start session'}
        >
          {isLive ? '■' : '●'}
        </button>
        <span className="brown-orb-hint">{isLive ? 'Escape to stop' : 'Tap to talk'}</span>
      </div>

      <div className="brown-orb-transcript" ref={captionsRef}>
        {conversation.length === 0 ? (
          <div className="brown-orb-empty">Conversation will appear here.</div>
        ) : (
          conversation.map((m) => (
            <div key={m.id} className={`brown-orb-line ${m.kind}`}>
              <span className="brown-orb-who">
                {m.kind === 'user' ? 'You' : m.kind === 'assistant' ? 'Gemetron' : 'System'}
              </span>
              <span className="brown-orb-msg">{m.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const BROWN_ORB_CSS = `
.brown-orb-shell {
  --brown-0: #1a0e06;
  --brown-1: #2a1609;
  --brown-2: #3d2210;
  --amber-1: #c97a3a;
  --amber-2: #e8a86a;
  --amber-3: #f4c99a;
  --cream: #f5e6d3;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  background: radial-gradient(120% 80% at 50% 0%, #3d2210 0%, #1a0e06 60%, #0f0703 100%);
  color: var(--cream);
  font-family: 'Segoe UI', system-ui, sans-serif;
  overflow: hidden;
  user-select: none;
}
.brown-orb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.brown-orb-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--amber-2);
}
.brown-orb-header-actions { display: flex; gap: 6px; }
.brown-orb-iconbtn {
  width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(232,168,106,0.25);
  background: rgba(255,255,255,0.04); color: var(--amber-2); cursor: pointer; font-size: 14px; line-height: 1;
}
.brown-orb-iconbtn:hover { background: rgba(232,168,106,0.12); }
.brown-orb-stage {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  height: 200px;
  position: relative;
}
.brown-orb {
  position: relative;
  width: 150px; height: 150px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.3s ease;
}
.brown-orb.live { transform: scale(1.04); }
.brown-orb.glow { }
.brown-orb-glow {
  position: absolute; inset: -40px; border-radius: 50%;
  background: radial-gradient(circle, rgba(232,168,106,0.35) 0%, rgba(201,122,58,0.18) 40%, transparent 70%);
  filter: blur(12px);
  animation: brown-pulse 3s ease-in-out infinite;
}
.brown-orb.live .brown-orb-glow { animation-duration: 1.4s; }
.brown-orb-core {
  position: relative; z-index: 2;
  width: 100%; height: 100%; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #e8a86a 0%, #c97a3a 35%, #8a4a1f 70%, #3d2210 100%);
  box-shadow: inset -6px -10px 24px rgba(0,0,0,0.45), inset 4px 4px 16px rgba(255,220,180,0.25), 0 0 40px rgba(201,122,58,0.45);
}
.brown-orb-status {
  font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
  color: #fff5e8; text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.brown-orb-ring {
  position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(232,168,106,0.35);
  animation: brown-spin 8s linear infinite;
}
.brown-orb.live .brown-orb-ring { animation-duration: 3s; }
.brown-orb-ring.r2 { inset: -14px; border-color: rgba(232,168,106,0.18); animation-direction: reverse; animation-duration: 12s; }
.brown-orb-ring.r3 { inset: -28px; border-color: rgba(232,168,106,0.08); animation-duration: 18s; }
.brown-orb-caption {
  flex: 0 0 auto;
  text-align: center;
  padding: 8px 6px 10px;
  min-height: 44px;
}
.brown-orb-caption-text {
  font-size: 15px; line-height: 1.4; color: var(--cream);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.brown-orb-notice {
  font-size: 12px; color: var(--amber-3); text-align: center; margin: 4px 0;
}
.brown-orb-footer {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  margin: 6px 0 8px;
}
.brown-orb-mic {
  width: 46px; height: 46px; border-radius: 50%; border: none;
  background: radial-gradient(circle at 35% 30%, #e8a86a, #c97a3a 60%, #8a4a1f 100%);
  color: #fff5e8; font-size: 18px; cursor: pointer;
  box-shadow: 0 4px 16px rgba(201,122,58,0.45);
  transition: transform 0.15s ease;
}
.brown-orb-mic:hover { transform: scale(1.06); }
.brown-orb-mic.active { background: radial-gradient(circle at 35% 30%, #f4c99a, #e8a86a 60%, #c97a3a 100%); animation: brown-pulse 1.2s ease-in-out infinite; }
.brown-orb-hint { font-size: 11px; color: rgba(245,230,211,0.6); letter-spacing: 0.06em; }
.brown-orb-transcript {
  flex: 1 1 auto;
  overflow-y: auto;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(232,168,106,0.12);
  font-size: 12px;
  min-height: 0;
}
.brown-orb-empty { color: rgba(245,230,211,0.4); font-style: italic; text-align: center; padding: 12px; }
.brown-orb-line { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(232,168,106,0.06); }
.brown-orb-line:last-child { border-bottom: none; }
.brown-orb-who { flex: 0 0 auto; font-weight: 600; color: var(--amber-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.brown-orb-line.user .brown-orb-who { color: var(--amber-3); }
.brown-orb-msg { flex: 1 1 auto; color: var(--cream); word-break: break-word; }
@keyframes brown-pulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.08); opacity: 1; } }
@keyframes brown-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;
