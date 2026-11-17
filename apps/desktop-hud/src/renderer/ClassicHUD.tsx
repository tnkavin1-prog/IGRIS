import { useState, type CSSProperties } from 'react';
import { HudIcon } from './HudIcon.js';
import type {
  ChromeTabInfo,
  ConversationMessage,
  HUDSettings,
  LiveHUDStatus,
  NeuralTelemetry,
} from '../main/types.js';

export interface ClassicHUDProps {
  status: LiveHUDStatus;
  conversation: ConversationMessage[];
  activeTab: ChromeTabInfo | null;
  chromeConnected: boolean;
  settings: HUDSettings;
  isPinned: boolean;
  isMaximized: boolean;
  telemetry: NeuralTelemetry | null;
  onTogglePin: () => void;
  onClose: () => void;
  onStartSession: () => void;
  onStopSession: () => void;
  onSendText: (text: string) => void;
  onExportSession: () => void;
  onEmergencyStop: () => void;
  exportNotice: string | null;
}

const isLive = (status: LiveHUDStatus) =>
  status === 'connecting' ||
  status === 'listening' ||
  status === 'speaking' ||
  status === 'thinking';

const statusLabel = (status: LiveHUDStatus) =>
  status === 'closed' ? 'Idle' : status.charAt(0).toUpperCase() + status.slice(1);

export function ClassicHUD({
  status,
  conversation,
  settings,
  isPinned,
  isMaximized,
  activeTab,
  chromeConnected,
  telemetry,
  onTogglePin,
  onClose,
  onStartSession,
  onStopSession,
  onSendText,
  onExportSession,
  onEmergencyStop,
  exportNotice,
}: ClassicHUDProps) {
  const live = isLive(status);
  const label = statusLabel(status);
  const [draft, setDraft] = useState('');

  const lastUser = [...conversation]
    .filter((m) => m.kind === 'user' && m.text)
    .pop()?.text;
  const lastAssistant = [...conversation]
    .filter((m) => m.kind === 'assistant' && m.text)
    .pop()?.text;
  const transcript = live ? lastAssistant || lastUser : lastUser || lastAssistant;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSendText(text);
  };

  return (
    <div
      className={`classic-root ${live ? 'voice' : ''} ${isMaximized ? 'maximized' : ''}`}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' } as CSSProperties}
    >
      <div className="classic-bar app-drag-region">
        <div className="classic-brand">
          <span className="classic-dot" />{' '}
          <b>GEMETRON</b>
          <span className="classic-divider">|</span>{' '}
          <span className="classic-model">{settings.modelId || 'Gemini 3.8'}</span>
        </div>
        <div className="classic-status">{label}</div>
        <div className="classic-spacer" />
        <button
          className={`classic-btn ${isPinned ? 'on' : ''}`}
          title={isPinned ? 'Unpin' : 'Pin on top'}
          onClick={onTogglePin}
        >
          <HudIcon name="pin" size={13} />
        </button>
        <button className="classic-btn" title="Export" onClick={onExportSession}>
          <HudIcon name="export" size={13} />
        </button>
        <button className="classic-btn close" title="Close" onClick={onClose}>
          <HudIcon name="close" size={13} />
        </button>
      </div>

      <div className="classic-body">
        <div className="classic-chat">
          {conversation.length === 0 ? (
            <div className="classic-empty">Gemetron · ready</div>
          ) : (
            conversation.map((m, i) => (
              <div
                key={i}
                className={`classic-msg ${m.kind}`}
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <span className="classic-msg-kind">{m.kind === 'user' ? '>' : '<'}</span>{' '}
                {m.text}
              </div>
            ))
          )}
          {exportNotice && (
            <div className="classic-msg system">{exportNotice}</div>
          )}
          {transcript && (
            <div className="classic-msg live">{live ? '…' : ''}{transcript}</div>
          )}
        </div>

        <form className="classic-input-wrap" onSubmit={handleSend}>
          <input
            className="classic-input"
            placeholder="say 'Hey Gemetron' or type a command…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="classic-send"
            title="Send"
          >
            <HudIcon name="send" size={13} />
          </button>
          <button
            type="button"
            className={`classic-mic ${live ? 'on' : ''}`}
            title={live ? 'Stop session' : 'Start session'}
            onClick={live ? onStopSession : onStartSession}
          >
            <HudIcon name={live ? 'stop' : 'mic'} size={15} />
          </button>
        </form>
      </div>

      <div className="classic-foot">
        <span className="classic-chip">
          <HudIcon name="eye" size={11} />{' '}
          {activeTab ? (activeTab.title || 'Desktop') : 'Desktop'}
        </span>
        {chromeConnected && (
          <span className="classic-chip">CDP</span>
        )}
        <span className="classic-chip">
          CPU {Math.round(telemetry?.cpuUsage ?? 0)}% · RAM {Math.round(telemetry?.memoryUsagePercent ?? 0)}%
        </span>
        <button
          className="classic-btn classic-kill"
          title="Emergency stop"
          onClick={onEmergencyStop}
        >
          <HudIcon name="stop" size={13} /> KILL
        </button>
      </div>
    </div>
  );
}