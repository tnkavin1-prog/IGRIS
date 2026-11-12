import { Fragment, useEffect, useState } from 'react';
import type { ConversationMessage, HUDSettings, LiveHUDStatus } from '../main/types.js';
import { EmberOrb, type EmberOrbState } from './EmberOrb.js';

export interface EmberHUDProps {
  status: LiveHUDStatus;
  conversation: ConversationMessage[];
  settings: HUDSettings;
  soundMuted: boolean;
  soundVolume: number;
  onMinimize: () => void;
  onClose: () => void;
  onStartSession: () => void;
  onStopSession: () => void;
  onToggleSoundMute: () => void;
  onSoundVolumeChange: (volume: number) => void;
  onAutoApproveChange: (enabled: boolean) => void;
  onWakeWordChange: (enabled: boolean) => void;
  onCollapseToBar: () => void;
  onCollapseToOrb: () => void;
  onOpenConsole: () => void;
}

const PILLS: Array<{ id: EmberOrbState; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'listening', label: 'Listen' },
  { id: 'speaking', label: 'Speak' },
  { id: 'thinking', label: 'Think' },
];

function formatModelLabel(modelId: string): string {
  const raw = (modelId || 'gemini-3.8').trim();
  const lower = raw.toLowerCase();
  const prefix = lower.includes('gemini')
    ? 'Gemini'
    : lower.includes('deepseek')
      ? 'DeepSeek'
      : lower.includes('glm')
        ? 'GLM'
        : lower.includes('kimi')
          ? 'Kimi'
          : lower.includes('claude')
            ? 'Claude'
            : lower.includes('llama')
              ? 'Llama'
              : '';
  const words = raw
    .replace(/^(gemini|deepseek|glm|kimi|claude|llama)[-_]?/i, '')
    .replace(/[-_]live$/i, '')
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return [prefix, ...words].filter(Boolean).join(' ') || 'Gemini 3.8';
}

function orbStateFor(status: LiveHUDStatus): EmberOrbState {
  if (status === 'listening') return 'listening';
  if (status === 'speaking') return 'speaking';
  if (status === 'thinking' || status === 'connecting') return 'thinking';
  return 'idle';
}

function statusTextFor(status: LiveHUDStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return 'Speaking';
    case 'thinking':
      return 'Thinking';
    case 'error':
      return 'Signal lost';
    case 'closed':
      return 'Idle';
    default:
      return 'Idle';
  }
}

export function EmberHUD({
  status,
  conversation,
  settings,
  soundMuted,
  soundVolume,
  onMinimize,
  onClose,
  onStartSession,
  onStopSession,
  onToggleSoundMute,
  onSoundVolumeChange,
  onAutoApproveChange,
  onWakeWordChange,
  onCollapseToBar,
  onCollapseToOrb,
  onOpenConsole,
}: EmberHUDProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statusVisible, setStatusVisible] = useState(true);
  const [reveal, setReveal] = useState(false);

  const isLive =
    status === 'connecting' ||
    status === 'listening' ||
    status === 'speaking' ||
    status === 'thinking';
  const orbState = orbStateFor(status);
  const statusLabel = statusTextFor(status);
  const modelLabel = formatModelLabel(settings.modelId);

  const messages = conversation.filter((message) => message.text?.trim());
  const lastUser = [...messages].reverse().find((message) => message.kind === 'user')?.text ?? '';
  const lastAssistant =
    [...messages].reverse().find((message) => message.kind === 'assistant')?.text ?? '';

  let transcript: string;
  if (status === 'speaking' || status === 'thinking') {
    transcript = lastAssistant || lastUser;
  } else if (status === 'listening') {
    transcript = lastUser || lastAssistant;
  } else {
    transcript = lastAssistant || lastUser;
  }

  const allWords = transcript.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const clipped = allWords.slice(0, 18);
  const display = clipped.join(' ') + (allWords.length > clipped.length ? '…' : '');

  useEffect(() => {
    setStatusVisible(true);
    const timer = window.setTimeout(() => setStatusVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!display) {
      setReveal(false);
      return;
    }
    setReveal(false);
    const timer = window.setTimeout(() => setReveal(true), 50);
    return () => window.clearTimeout(timer);
  }, [display]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheetOpen]);

  const hint =
    status === 'error'
      ? 'signal lost · click the orb to retry'
      : status === 'connecting'
        ? 'connecting…'
        : status === 'listening'
          ? "speak — i'm listening"
          : status === 'speaking'
            ? 'speaking · click the orb to stop'
            : status === 'thinking'
              ? 'thinking…'
              : 'click the orb to speak';

  const handleOrb = () => {
    if (isLive) onStopSession();
    else onStartSession();
  };

  const handlePill = (id: EmberOrbState) => {
    if (id === 'idle') {
      if (isLive) onStopSession();
      return;
    }
    if (id === 'listening' && !isLive) {
      onStartSession();
    }
  };

  return (
    <div className="ember-root">
      <div className="window" data-state={orbState}>
        <div className="em-util">
          <button
            type="button"
            className="uc"
            aria-label="Open settings"
            onClick={() => setSheetOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="win-controls">
          <button type="button" className="wc" aria-label="Minimize" onClick={onMinimize}>
            –
          </button>
          <button type="button" className="wc close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className={`status ${statusVisible ? 'vis' : ''}`}>{statusLabel}</div>

        <div
          className="orb-wrap"
          role="button"
          tabIndex={0}
          aria-label={isLive ? 'Stop session' : 'Talk to Gematron'}
          onClick={handleOrb}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOrb();
            }
          }}
        >
          <EmberOrb state={orbState} />
        </div>

        <div className={`transcript ${reveal ? 'show' : ''}`} aria-live="polite">
          {clipped.map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              <span style={{ transitionDelay: `${index * 70}ms` }}>{word}</span>
              {index < clipped.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </div>

        <div className="dock">
          <div className="states">
            {PILLS.map((pill) => (
              <button
                type="button"
                key={pill.id}
                className={`pill ${orbState === pill.id ? 'active' : ''}`}
                aria-pressed={orbState === pill.id}
                onClick={() => handlePill(pill.id)}
              >
                {pill.label}
              </button>
            ))}
          </div>
          <div className="hint">{hint}</div>
        </div>

        {sheetOpen && (
          <aside className="em-sheet" aria-label="Settings">
            <div className="em-sheet-head">
              <div>
                <h2>System &amp; controls</h2>
                <p>Everything Gematron can see, hear and touch</p>
              </div>
              <button
                type="button"
                className="em-sheet-close"
                title="Close settings"
                aria-label="Close settings"
                onClick={() => setSheetOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="em-section">
              <div className="em-section-label">Session</div>
              <div className="em-card">
                <div className="em-row">
                  <div>
                    {settings.modelId ? modelLabel : 'Gemini 3.8'}
                    <small>{isLive ? 'Live session active' : 'Ready when you are'}</small>
                  </div>
                  <span className={`em-badge ${isLive ? 'on' : ''}`}>
                    <i />
                    {status === 'error' ? 'Offline' : isLive ? 'Online' : 'Standby'}
                  </span>
                </div>
                <div className="em-row">
                  <span>Display</span>
                  <div className="em-seg" role="group" aria-label="Display mode">
                    <button type="button" className="on" aria-pressed="true">
                      Full
                    </button>
                    <button type="button" onClick={onCollapseToBar} aria-pressed="false">
                      Bar
                    </button>
                    <button type="button" onClick={onCollapseToOrb} aria-pressed="false">
                      Orb
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="em-section">
              <div className="em-section-label">Voice</div>
              <div className="em-card">
                <div className="em-row">
                  <div>
                    Acoustic sound
                    <small>Gematron speaks replies aloud</small>
                  </div>
                  <button
                    type="button"
                    className={`em-switch ${soundMuted ? '' : 'on'}`}
                    aria-label="Toggle acoustic sound"
                    aria-pressed={!soundMuted}
                    onClick={onToggleSoundMute}
                  />
                </div>
                <div className="em-row">
                  <span>Volume</span>
                  <span className="em-range-wrap">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={soundVolume}
                      aria-label="Volume"
                      onChange={(event) => onSoundVolumeChange(parseFloat(event.target.value))}
                    />
                    <b>{Math.round(soundVolume * 100)}%</b>
                  </span>
                </div>
                <div className="em-row">
                  <div>
                    Wake word “Hey Jarvis”
                    <small>Windows speech, local while idle</small>
                  </div>
                  <button
                    type="button"
                    className={`em-switch ${settings.wakeWordEnabled ? 'on' : ''}`}
                    aria-label="Toggle wake word"
                    aria-pressed={settings.wakeWordEnabled === true}
                    onClick={() => onWakeWordChange(!settings.wakeWordEnabled)}
                  />
                </div>
                <div className="em-row">
                  <span>Push-to-talk</span>
                  <kbd>Ctrl + Space</kbd>
                </div>
              </div>
            </div>

            <div className="em-section">
              <div className="em-section-label">Co-pilot</div>
              <div className="em-card">
                <div className="em-row">
                  <div>
                    Smart approve
                    <small>Safe actions run; risky ones ask first</small>
                  </div>
                  <button
                    type="button"
                    className={`em-switch ${settings.autoApprove ? 'on' : ''}`}
                    aria-label="Toggle smart approve"
                    aria-pressed={settings.autoApprove}
                    onClick={() => onAutoApproveChange(!settings.autoApprove)}
                  />
                </div>
              </div>
            </div>

            <button type="button" className="em-sheet-btn" onClick={onOpenConsole}>
              Open advanced console
            </button>
            <div className="em-sheet-foot">Ctrl+Space talk · Ctrl+K commands · Esc stop</div>
          </aside>
        )}
      </div>
      <div className="grain" aria-hidden="true" />
    </div>
  );
}
