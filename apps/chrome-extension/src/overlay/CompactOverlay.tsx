import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { BRIDGE_ORIGIN, BRIDGE_PIN_PATH, type ToolEntry } from '@gbl/shared';
import type { PanelSnapshot, AgentController } from '../sidepanel/controller';
import { isSessionLive } from '../sidepanel/controller';
import { Icon } from '../sidepanel/ui';
import { overlay } from './bridge';
import { VisualBlackboard } from './VisualBlackboard';
import { buildSessionExportBundle, downloadFile } from '../tools/session-export';

export interface CompactOverlayProps {
  snapshot: PanelSnapshot;
  controller: AgentController;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenSettings: () => void;
  onStart: () => void;
  onStop: () => void;
  onSendText: (text: string) => boolean;
}

/**
 * Organic Kinetic Soundwave Cluster
 * Replaces primitive vertical bars with butter-smooth undulating cubic-bezier energy ribbons
 */
function KineticWaveCluster({ state }: { state: 'idle' | 'listening' | 'speaking' | 'thinking' }) {
  return (
    <div className={`kinetic-cluster-container ${state}`} aria-hidden="true">
      <div className="kinetic-bloom" />
      <svg className="kinetic-svg" viewBox="0 0 180 50" fill="none">
        <defs>
          <linearGradient id="kineticGradWhitePrimary" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="kineticGradWhiteSecondary" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {/* Primary fluid wave ribbon */}
        <path
          className="kinetic-ribbon primary"
          d="M 12 25 C 35 12, 55 38, 90 25 C 125 12, 145 38, 168 25"
          stroke="url(#kineticGradWhitePrimary)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        {/* Secondary counter-phase ribbon */}
        <path
          className="kinetic-ribbon secondary"
          d="M 12 25 C 38 36, 58 14, 90 25 C 122 36, 142 14, 168 25"
          stroke="url(#kineticGradWhiteSecondary)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeOpacity="0.85"
        />
        {/* Harmonic tertiary accent ribbon */}
        <path
          className="kinetic-ribbon tertiary"
          d="M 24 25 C 46 19, 68 31, 90 25 C 112 19, 134 31, 156 25"
          stroke="url(#kineticGradWhitePrimary)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeOpacity="0.45"
        />
      </svg>
    </div>
  );
}

export function CompactOverlay({
  snapshot,
  controller,
  expanded,
  onToggleExpand,
  onOpenSettings,
  onStart,
  onStop,
  onSendText,
}: CompactOverlayProps) {
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'blackboard'>('chat');
  const [draft, setDraft] = useState('');
  const [currentHost, setCurrentHost] = useState('Current tab');
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const live = isSessionLive(snapshot.status);

  const handleTogglePin = async () => {
    const next = !isPinned;
    setIsPinned(next);
    const bridgeBase = snapshot.settings?.bridgeUrl || BRIDGE_ORIGIN;
    try {
      await fetch(`${bridgeBase}${BRIDGE_PIN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: next, title: 'Gemini Browser Live' }),
      });
    } catch {
      /* local bridge might be offline; visual feedback still persists */
    }
    setExportNotice(next ? 'Window pinned Always-on-Top' : 'Window unpinned');
    setTimeout(() => setExportNotice(null), 2500);
  };

  // Auto-switch to blackboard and expand when a visual lesson is drawn
  useEffect(() => {
    if (snapshot.activeBlackboard) {
      setActiveTab('blackboard');
      if (!expanded) {
        onToggleExpand();
      }
    }
  }, [snapshot.activeBlackboard]);

  // Export full study session (all Q&A, formulas, blackboard) to Markdown & HTML
  const handleExportSession = () => {
    const bundle = buildSessionExportBundle(
      snapshot.conversation,
      snapshot.activeBlackboard,
      currentHost,
    );
    downloadFile(bundle.markdown, `${bundle.filenameBase}.md`, 'text/markdown;charset=utf-8');
    downloadFile(bundle.html, `${bundle.filenameBase}.html`, 'text/html;charset=utf-8');
    setExportNotice('Session notes saved for Drive/GitHub!');
    setTimeout(() => setExportNotice(null), 3500);
  };

  // Fetch active tab domain and listen for tab switches across Chrome
  useEffect(() => {
    try {
      const updateHostFromTab = (tab?: chrome.tabs.Tab) => {
        if (!tab) return;
        if (typeof tab.id === 'number') setActiveTabId(tab.id);
        if (tab.url?.startsWith('file:')) {
          const filename = tab.url.split('/').pop()?.split('?')[0] || 'Local document';
          setCurrentHost(decodeURIComponent(filename).slice(0, 24));
          return;
        }
        if (tab.title?.includes('.pdf')) {
          setCurrentHost(tab.title.slice(0, 24));
          return;
        }
        if (tab.url) {
          try {
            const url = new URL(tab.url);
            setCurrentHost(
              url.hostname.replace(/^www\./, '') || tab.title?.slice(0, 20) || 'Current tab',
            );
          } catch {
            setCurrentHost(tab.title?.slice(0, 20) || 'Current tab');
          }
        }
      };

      const fallbackQuery = () => {
        if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
        chrome.tabs
          .query({ active: true, windowType: 'normal', lastFocusedWindow: true })
          .then(([tab]) => {
            if (tab) {
              updateHostFromTab(tab);
            } else {
              chrome.tabs
                .query({ active: true, windowType: 'normal' })
                .then(([fallback]) => {
                  updateHostFromTab(fallback);
                })
                .catch(() => undefined);
            }
          })
          .catch(() => undefined);
      };

      if (typeof chrome !== 'undefined' && chrome.storage?.session?.get) {
        chrome.storage.session
          .get(['gbl_active_tab_id'])
          .then((stored) => {
            if (typeof stored?.gbl_active_tab_id === 'number') {
              chrome.tabs
                .get(stored.gbl_active_tab_id)
                .then((tab) => {
                  if (tab) updateHostFromTab(tab);
                  else fallbackQuery();
                })
                .catch(() => fallbackQuery());
            } else {
              fallbackQuery();
            }
          })
          .catch(() => fallbackQuery());
      } else {
        fallbackQuery();
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        const listener = (msg: {
          type?: string;
          tab?: { id?: number; title?: string; url?: string };
        }) => {
          if (msg?.type === 'GBL_ACTIVE_TAB_CHANGED' && msg.tab) {
            updateHostFromTab(msg.tab as chrome.tabs.Tab);
          }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Auto-scroll dialogue stream to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [snapshot.conversation]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.screenX, y: event.screenY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    overlay.dragStart();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const origin = dragRef.current;
    if (!origin) return;
    const dx = event.screenX - origin.x;
    const dy = event.screenY - origin.y;
    if (dx === 0 && dy === 0) return;
    dragRef.current = { x: event.screenX, y: event.screenY };
    overlay.drag(dx, dy);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }
    overlay.dragEnd();
  };

  const handleSend = (e: FormEvent): void => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSendText(text);
  };

  // Status computation
  let statusText = 'Gemini Live';
  let kineticState: 'idle' | 'listening' | 'speaking' | 'thinking' = 'idle';

  if (live) {
    if (snapshot.status === 'listening') {
      statusText = 'Listening...';
      kineticState = 'listening';
    } else if (snapshot.status === 'speaking') {
      statusText = 'Speaking...';
      kineticState = 'speaking';
    } else if (snapshot.status === 'thinking') {
      statusText = 'Thinking...';
      kineticState = 'thinking';
    } else if (snapshot.status === 'awaiting-approval') {
      statusText = 'Action Pending...';
      kineticState = 'thinking';
    } else {
      statusText = 'Listening...';
      kineticState = 'listening';
    }
  } else if (snapshot.starting) {
    statusText = 'Connecting...';
    kineticState = 'thinking';
  }

  // Active running tool
  const activeTool = [...snapshot.conversation]
    .reverse()
    .find((e): e is ToolEntry => e.kind === 'tool' && e.status === 'running');

  // Filter conversation to show speech and tool activity
  const dialogueEntries = snapshot.conversation.filter(
    (e) => e.kind === 'user' || e.kind === 'assistant' || e.kind === 'tool',
  );

  return (
    <div className={`compact-gemini-box ${expanded ? 'is-expanded' : ''}`}>
      {/* 1. Top Header / Drag Strip with Integrated Control Bar */}
      <div
        className="compact-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
      >
        <div className="compact-status">
          <div
            className={`gemini-core-indicator ${live ? snapshot.status : 'idle'}`}
            aria-hidden="true"
          >
            <span className="core-glow" />
            <span className="core-bar b1" />
            <span className="core-bar b2" />
            <span className="core-bar b3" />
            <span className="core-bar b4" />
          </div>
          <span className="status-label">{statusText}</span>
        </div>

        <div className="compact-top-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`compact-board-pill ${activeTab === 'blackboard' ? 'is-active' : ''} ${snapshot.activeBlackboard ? 'has-lesson' : ''}`}
            title="Visual Teaching Blackboard (drawings & formulas)"
            onClick={() => {
              const next = activeTab === 'blackboard' ? 'chat' : 'blackboard';
              setActiveTab(next);
              if (next === 'blackboard' && !expanded) {
                onToggleExpand();
              }
            }}
          >
            <Icon name="board" size={12} />
            <span>Board{snapshot.activeBlackboard ? ' •' : ''}</span>
          </button>

          <button
            type="button"
            className={`compact-auto-pill ${snapshot.settings.autoApprove ? 'is-active' : ''}`}
            title={
              snapshot.settings.autoApprove
                ? 'Autonomous Mode: Enabled (auto-executes non-consequential tools)'
                : 'Autonomous Mode: Off (click to enable)'
            }
            onClick={() =>
              controller.updateSettings({ autoApprove: !snapshot.settings.autoApprove })
            }
          >
            <span className="auto-dot" />
            <span>Auto</span>
          </button>

          <button
            type="button"
            className={`compact-btn ${isPinned ? 'is-active is-pinned' : ''}`}
            title={
              isPinned
                ? 'Always-on-Top Pinned: Window stays on top of all apps (click to unpin)'
                : 'Pin Window Always-on-Top (click to pin above desktop and Chrome)'
            }
            onClick={handleTogglePin}
          >
            <Icon name="pin" size={13} />
          </button>

          <button
            type="button"
            className="compact-btn"
            title="System Settings"
            onClick={onOpenSettings}
          >
            <Icon name="settings" size={13} />
          </button>

          <button
            type="button"
            className="compact-btn"
            title="Export session study notes (Markdown & HTML for Google Drive/GitHub)"
            onClick={handleExportSession}
          >
            <Icon name="download" size={13} />
          </button>

          <button
            type="button"
            className="compact-btn"
            title={expanded ? 'Restore normal view' : 'Maximize window'}
            onClick={onToggleExpand}
          >
            <Icon name={expanded ? 'contract' : 'expand'} size={13} />
          </button>

          <button
            type="button"
            className="compact-btn close-btn"
            title="Close Assistant"
            onClick={() => overlay.close()}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>

      {exportNotice ? (
        <div className="compact-export-toast">
          <span>✓ {exportNotice}</span>
        </div>
      ) : null}

      {/* 2. Center Body: Dynamic Kinetic Waveform / Dialogue Stream OR Visual Blackboard */}
      {activeTab === 'blackboard' ? (
        <div className="compact-body blackboard-view">
          <VisualBlackboard
            lesson={snapshot.activeBlackboard}
            onPopOutTab={() => {
              if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                chrome.tabs
                  .create({ url: chrome.runtime.getURL('blackboard.html') })
                  .catch(() => undefined);
              }
            }}
            onTriggerPrompt={(prompt) => onSendText(prompt)}
            onSelectSampleLesson={(sample) => controller.setBlackboard(sample)}
          />
        </div>
      ) : (
        <div className="compact-body" ref={scrollRef}>
          {dialogueEntries.length === 0 ? (
            <div className="captions-empty">
              <KineticWaveCluster state={kineticState} />
              <p className="captions-text">Captions will show here</p>
              <span className="captions-dots">···</span>
            </div>
          ) : (
            <div className="captions-stream">
              {dialogueEntries.slice(-10).map((entry) => {
                if (entry.kind === 'user') {
                  return (
                    <div key={entry.id} className="caption-bubble user-caption">
                      <span className="caption-speaker">You:</span> {entry.text}
                    </div>
                  );
                }
                if (entry.kind === 'assistant') {
                  return (
                    <div key={entry.id} className="caption-bubble gemini-caption">
                      <span className="caption-spark-icon">
                        <Icon name="spark" size={11} />
                      </span>
                      <span>{entry.text}</span>
                    </div>
                  );
                }
                if (entry.kind === 'tool') {
                  return (
                    <div key={entry.id} className={`caption-tool-badge ${entry.status}`}>
                      <Icon name="spark" size={11} />
                      <span>
                        {entry.title}
                        {entry.detail ? `: ${entry.detail}` : ''}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}

          {activeTool ? (
            <div className="compact-tool-live">
              <span className="tool-spinner" />
              <span>{activeTool.title}…</span>
            </div>
          ) : null}
        </div>
      )}

      {/* 3. Keyboard Composer Drawer */}
      {showKeyboard ? (
        <form className="compact-composer" onSubmit={handleSend}>
          <input
            type="text"
            className="compact-composer-input"
            placeholder={live ? 'Type message and press Enter…' : 'Type to start session…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <button type="submit" className="compact-composer-btn" disabled={!draft.trim()}>
            <Icon name="send" size={13} />
          </button>
        </form>
      ) : null}

      {/* 4. Bottom Footer Controls */}
      <div className="compact-footer">
        <div className="compact-footer-left">
          <div
            className="compact-tab-pill"
            title={`Active Chrome Tab: ${currentHost} (click to focus tab in Chrome)`}
            onClick={() => {
              if (
                typeof chrome !== 'undefined' &&
                chrome.tabs?.update &&
                typeof activeTabId === 'number'
              ) {
                chrome.tabs.update(activeTabId, { active: true }, (tab) => {
                  if (tab?.windowId && chrome.windows?.update) {
                    chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
                  }
                });
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span className="pill-spark">
              <Icon name="spark" size={12} />
            </span>
            <span className="pill-domain">{currentHost}</span>
          </div>
          {!live && (
            <button type="button" className="compact-start-pill" onClick={onStart}>
              Start session
            </button>
          )}
        </div>

        <div className="compact-capsule">
          <button
            type="button"
            className={`capsule-btn mic-btn ${live && snapshot.micMuted ? 'is-muted' : ''} ${live && !snapshot.micMuted ? 'is-live' : ''}`}
            title={
              live
                ? snapshot.micMuted
                  ? 'Unmute microphone'
                  : 'Mute microphone'
                : 'Start live session'
            }
            onClick={live ? () => controller.toggleMute() : onStart}
          >
            <Icon name={live && snapshot.micMuted ? 'micOff' : 'mic'} size={15} />
            {live && !snapshot.micMuted ? <span className="mic-halo" /> : null}
          </button>

          <button
            type="button"
            className={`capsule-btn ${showKeyboard ? 'is-active' : ''}`}
            title="Type a message"
            onClick={() => setShowKeyboard(!showKeyboard)}
          >
            <Icon name="keyboard" size={15} />
          </button>

          {live ? (
            <button
              type="button"
              className="capsule-btn end-btn"
              title="End session"
              onClick={onStop}
            >
              <Icon name="stop" size={13} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
