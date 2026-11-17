import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationMessage, HUDSettings, LiveHUDStatus } from '../main/types.js';
import { EmberOrb, type EmberOrbState } from './EmberOrb.js';
import { HudIcon } from './HudIcon.js';
import { useWindowDrag } from './hooks/useWindowDrag.js';
import { useClickThrough } from './hooks/useClickThrough.js';
import { installGrain } from './grain.js';

export interface EmberHUDProps {
  status: LiveHUDStatus;
  conversation: ConversationMessage[];
  settings: HUDSettings;
  soundMuted: boolean;
  soundVolume: number;
  isPinned: boolean;
  onTogglePin: () => void;
  notice?: string | null;
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

/**
 * Longest caption tail kept in the DOM. Spoken answers can be several hundred
 * words; the box only shows the last two lines, so this is purely a memory
 * bound that stays far larger than what can ever be on screen.
 */
const TRANSCRIPT_MAX_WORDS = 140;

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
  if (status === 'thinking') return 'thinking';
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
  isPinned,
  onTogglePin,
  notice,
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
  const sheetRef = useRef<HTMLDialogElement>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Words already committed to the screen for this turn, so only newly spoken
  // words animate in instead of the whole paragraph.
  const renderedWordsRef = useRef<{ turnId: string; count: number }>({ turnId: '', count: 0 });
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

  const { words, display, turnId } = useMemo(() => {
    let lastUser = '';
    let lastAssistant = '';
    let assistantId = '';
    let userId = '';
    for (let i = conversation.length - 1; i >= 0 && !(lastUser && lastAssistant); i--) {
      const m = conversation[i];
      if (!m) continue;
      const t = m.text?.trim();
      if (!t) continue;
      if (m.kind === 'user' && !lastUser) {
        lastUser = t;
        userId = m.id;
      } else if (m.kind === 'assistant' && !lastAssistant) {
        lastAssistant = t;
        assistantId = m.id;
      }
    }
    const transcript =
      status === 'speaking' || status === 'thinking'
        ? lastAssistant || lastUser
        : status === 'listening'
          ? lastUser
          : '';
    // Keep the tail of a long answer so the caption can scroll with the voice
    // instead of stopping after a fixed snippet.
    const all = transcript.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const words = all.slice(-TRANSCRIPT_MAX_WORDS);
    return {
      words,
      display: words.join(' '),
      turnId:
        status === 'speaking' || status === 'thinking'
          ? assistantId || userId || 'turn'
          : status === 'listening'
            ? userId || 'user'
            : '',
    };
  }, [conversation, status]);

  useEffect(() => {
    setStatusVisible(true);
    const timer = window.setTimeout(() => setStatusVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [status]);

  // Animate the caption in once per spoken turn. Resetting this on every
  // transcription chunk made the whole paragraph blur and re-fade as the answer
  // streamed in.
  useEffect(() => {
    if (!turnId) {
      setReveal(false);
      return;
    }
    setReveal(false);
    const timer = window.setTimeout(() => setReveal(true), 40);
    return () => window.clearTimeout(timer);
  }, [turnId]);

  // Keep the newest spoken line in view, the way live captions behave.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [display, reveal]);

  // Words that are already on screen for this turn. Recording them after paint
  // lets the next chunk animate only the words that were just spoken instead of
  // fading the whole paragraph in again.
  const previousWordCount =
    renderedWordsRef.current.turnId === turnId ? renderedWordsRef.current.count : 0;

  useEffect(() => {
    renderedWordsRef.current = { turnId, count: words.length };
  }, [turnId, words.length]);

  useEffect(() => {
    if (!sheetOpen) return;
    const dialog = sheetRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [sheetOpen]);

  const hint =
    notice ??
    (status === 'error'
      ? 'signal lost · click the orb to retry'
      : status === 'connecting'
        ? 'connecting…'
        : status === 'listening'
          ? "speak — i'm listening"
          : status === 'speaking'
            ? 'speaking · click the orb to stop'
            : status === 'thinking'
              ? 'thinking…'
              : 'click the orb to speak');

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

  useClickThrough();

  const grainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (grainRef.current) installGrain(grainRef.current);
  }, []);

  const surfaceDrag = useWindowDrag();
  const orbDrag = useWindowDrag({ onClick: handleOrb, ignoreSelector: '' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.key === ',') {
        e.preventDefault();
        setSheetOpen(true);
      } else if (e.key === '2') {
        e.preventDefault();
        onCollapseToBar();
      } else if (e.key === '3') {
        e.preventDefault();
        onCollapseToOrb();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCollapseToBar, onCollapseToOrb]);

  const onSheetClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) setSheetOpen(false);
  };

  return (
    <div className="ember-root">
      <div className="window" data-state={orbState} {...surfaceDrag}>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {statusLabel}
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {display}
        </p>
        <div className="em-util">
          <button
            type="button"
            className="uc"
            title="Settings"
            aria-label="Open settings"
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            aria-controls="ember-settings"
            onClick={() => setSheetOpen(true)}
          >
            <HudIcon name="sliders" size={17} />
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

        <div className={`status ${statusVisible ? 'vis' : ''}`} aria-hidden="true">
          {statusLabel}
        </div>

        <button
          type="button"
          className="orb-wrap"
          role="button"
          aria-label={isLive ? 'Stop session' : 'Talk to Gematron'}
          {...orbDrag}
        >
          <EmberOrb state={orbState} />
        </button>

        <div className={`transcript ${reveal ? 'show' : ''}`} aria-hidden="true" ref={transcriptRef}>
          {words.map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              <span
                style={{
                  transitionDelay: `${
                    index < previousWordCount ? 0 : Math.min((index - previousWordCount) * 40, 320)
                  }ms`,
                }}
              >
                {word}
              </span>
              {index < words.length - 1 ? ' ' : null}
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
          <dialog
            ref={sheetRef}
            id="ember-settings"
            className="em-sheet"
            aria-labelledby="ember-settings-title"
            onClick={onSheetClick}
            onCancel={() => setSheetOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.stopPropagation();
            }}
          >
            <div className="em-sheet-head">
              <div>
                <h2 id="ember-settings-title">Settings</h2>
                <p>Your window, voice &amp; controls</p>
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
              <div className="em-section-label">Window size</div>
              <div className="em-layouts" role="group" aria-label="Window size">
                <button
                  type="button"
                  className="on"
                  aria-pressed="true"
                  onClick={() => setSheetOpen(false)}
                >
                  <HudIcon name="expand" size={22} />
                  <span>Full window</span>
                  <small>400 × 600</small>
                </button>
                <button type="button" aria-pressed="false" onClick={onCollapseToBar}>
                  <HudIcon name="bari" size={22} />
                  <span>Compact bar</span>
                  <small>420 × 62</small>
                </button>
                <button type="button" aria-pressed="false" onClick={onCollapseToOrb}>
                  <HudIcon name="orbi" size={22} />
                  <span>Mini orb</span>
                  <small>74 × 74</small>
                </button>
              </div>
              <p className="em-layout-hint">
                Click the mini orb to expand to the bar, then its orb to return here.
              </p>
              <div className="em-card">
                <div className="em-row">
                  <div>
                    Always on top
                    <small>Keep Gematron above other windows</small>
                  </div>
                  <button
                    type="button"
                    className={`em-switch ${isPinned ? 'on' : ''}`}
                    aria-label="Toggle always on top"
                    aria-pressed={isPinned}
                    onClick={onTogglePin}
                  />
                </div>
              </div>
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
              </div>
            </div>

            <div className="em-section">
              <div className="em-section-label">Voice</div>
              <div className="em-card">
                <div className="em-row">
                  <div>
                    Spoken replies &amp; sounds
                    <small>Mute output without stopping the microphone</small>
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
                    Wake word "Hey Gematron"
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
              </div>
            </div>

            <div className="em-section">
              <div className="em-section-label">Co-pilot</div>
              <div className="em-card">
                <div className="em-row">
                  <div>
                    Automatic approval
                    <small>Skip workflow approval prompts. Use with care.</small>
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
            <div className="em-sheet-foot">Esc closes settings · Ctrl+Alt+K emergency stop</div>
          </dialog>
        )}
        <div className="grain" ref={grainRef} aria-hidden="true" />
      </div>
    </div>
  );
}
