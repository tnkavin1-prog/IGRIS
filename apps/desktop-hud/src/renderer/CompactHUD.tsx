import { useState, useRef, useEffect, type FormEvent } from 'react';
import type {
  AgenticTask,
  BoundingBoxTarget,
  ChromeTabInfo,
  ConversationMessage,
  CrosshairTarget,
  HUDSettings,
  LiveHUDStatus,
  NeuralTelemetry,
  VisualBlackboardLesson,
  WindowItem,
  WorkflowStep,
} from '../main/types.js';
import { VisualBlackboard } from './VisualBlackboard.js';

export interface CompactHUDProps {
  status: LiveHUDStatus;
  conversation: ConversationMessage[];
  blackboardLesson: VisualBlackboardLesson | null;
  activeTab: ChromeTabInfo | null;
  chromeConnected: boolean;
  settings: HUDSettings;
  isPinned: boolean;
  isMaximized: boolean;
  currentTask: AgenticTask | null;
  pendingApproval: { task: AgenticTask; step: WorkflowStep } | null;
  crosshair: CrosshairTarget | null;
  boundingBox: BoundingBoxTarget | null;
  telemetry: NeuralTelemetry | null;
  onTogglePin: () => void;
  onToggleMaximize: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onStartSession: () => void;
  onStopSession: () => void;
  onSendText: (text: string) => void;
  onSelectSampleLesson: (sample: VisualBlackboardLesson) => void;
  onExportSession: () => void;
  onSwitchTab: (tabId: string) => void;
  onLaunchChrome: () => void;
  onApproveStep: (taskId: string, stepId: string) => void;
  onRejectStep: (taskId: string, stepId: string) => void;
  onScanDesktop: () => void;
  onShowWindows: () => void;
  onStartAutonomousTask: (goal: string) => void;
  onEmergencyStop: () => void;
  onPauseWorkflow: () => void;
  onResumeWorkflow: () => void;
  exportNotice: string | null;
  runningWindows?: WindowItem[];
  onFocusWindow?: (query: string | number, title?: string) => void;
  onRefreshWindows?: () => void;
  soundMuted?: boolean;
  soundVolume?: number;
  onToggleSoundMute?: () => void;
  onSoundVolumeChange?: (volume: number) => void;
}

/**
 * Organic Kinetic Soundwave Cluster
 * Monochromatic porcelain white glowing wave ribbons
 */
function KineticWaveCluster({
  state,
  cpuUsage,
}: {
  state: 'idle' | 'listening' | 'speaking' | 'thinking';
  cpuUsage?: number;
}) {
  const currentCpu = typeof cpuUsage === 'number' ? Math.max(0, Math.min(100, cpuUsage)) : 20;
  const pulseDuration = Math.max(0.6, 2.4 - (currentCpu / 100) * 1.5);
  const glowRadius = Math.max(2, Math.min(16, Math.round((currentCpu / 100) * 16)));
  const pulseStyle = {
    filter: `drop-shadow(0 0 ${glowRadius}px rgba(255, 255, 255, ${currentCpu > 70 ? '0.9' : '0.65'}))`,
    animationDuration: `${pulseDuration.toFixed(2)}s`,
  };

  return (
    <div className={`kinetic-cluster-container ${state}`} style={pulseStyle} aria-hidden="true">
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
        <path
          className="kinetic-ribbon primary"
          d="M 12 25 C 35 12, 55 38, 90 25 C 125 12, 145 38, 168 25"
          stroke="url(#kineticGradWhitePrimary)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          className="kinetic-ribbon secondary"
          d="M 12 25 C 38 36, 58 14, 90 25 C 122 36, 142 14, 168 25"
          stroke="url(#kineticGradWhiteSecondary)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeOpacity="0.85"
        />
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

export function CompactHUD({
  status,
  conversation,
  blackboardLesson,
  activeTab,
  chromeConnected,
  settings,
  isPinned,
  isMaximized,
  currentTask,
  pendingApproval,
  crosshair,
  boundingBox,
  telemetry,
  onTogglePin,
  onToggleMaximize,
  onMinimize,
  onClose,
  onStartSession,
  onStopSession,
  onSendText,
  onSelectSampleLesson,
  onExportSession,
  onSwitchTab,
  onLaunchChrome,
  onApproveStep,
  onRejectStep,
  onScanDesktop,
  onShowWindows,
  onStartAutonomousTask,
  onEmergencyStop,
  onPauseWorkflow,
  onResumeWorkflow,
  exportNotice,
  runningWindows = [],
  onFocusWindow,
  onRefreshWindows,
  soundMuted = false,
  soundVolume = 0.5,
  onToggleSoundMute,
  onSoundVolumeChange,
}: CompactHUDProps) {
  const [activeView, setActiveView] = useState<'chat' | 'blackboard' | 'workflow'>('chat');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showDesktopRadar, setShowDesktopRadar] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const isLive = status === 'listening' || status === 'speaking' || status === 'thinking';

  // Automatically switch to Blackboard view when a lesson arrives
  useEffect(() => {
    if (blackboardLesson) {
      setActiveView('blackboard');
    }
  }, [blackboardLesson]);

  // Automatically switch to Workflow view if approval is required
  useEffect(() => {
    if (pendingApproval) {
      setActiveView('workflow');
    }
  }, [pendingApproval]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (scrollRef.current && activeView === 'chat') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation, activeView]);

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSendText(text);
  };

  // Status computation
  let statusText = 'JARVIS v3.8';
  let kineticState: 'idle' | 'listening' | 'speaking' | 'thinking' = 'idle';

  if (status === 'connecting') {
    statusText = 'Initializing…';
    kineticState = 'thinking';
  } else if (status === 'listening') {
    statusText = 'Voice Online';
    kineticState = 'listening';
  } else if (status === 'speaking') {
    statusText = 'Synthesizing…';
    kineticState = 'speaking';
  } else if (status === 'thinking') {
    statusText = 'Computing…';
    kineticState = 'thinking';
  } else if (status === 'error') {
    statusText = 'Offline (Error)';
    kineticState = 'idle';
  }

  // Active running tool
  const activeTool = [...conversation]
    .reverse()
    .find((m) => m.kind === 'tool' && m.status === 'running');

  // Format tab title display
  let tabDisplay = 'Chrome (Port 9222)';
  if (activeTab) {
    if (activeTab.url?.startsWith('file:')) {
      const parts = activeTab.url.split('/');
      tabDisplay = decodeURIComponent(parts[parts.length - 1] || 'Local File').slice(0, 24);
    } else if (activeTab.title) {
      tabDisplay = activeTab.title.slice(0, 24);
    } else if (activeTab.url) {
      try {
        tabDisplay = new URL(activeTab.url).hostname.replace(/^www\./, '').slice(0, 24);
      } catch {
        tabDisplay = activeTab.url.slice(0, 24);
      }
    }
  }

  // Workflow progress computation
  const totalSteps = currentTask?.steps.length ?? 0;
  const completedSteps = currentTask?.steps.filter((s) => s.status === 'completed').length ?? 0;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div className={`compact-gemini-box ${isMaximized ? 'is-maximized' : ''}`}>
      {/* ────────────────── Target Crosshair Laser Overlay ────────────────── */}
      {crosshair &&
        (() => {
          const isLeftMonitor = crosshair.x < 0;
          const absX = isLeftMonitor ? 1920 - (Math.abs(crosshair.x) % 1920) : crosshair.x % 1920;
          const normX = isMaximized
            ? Math.min(window.innerWidth - 80, Math.max(40, (absX / 1920) * window.innerWidth))
            : Math.min(window.innerWidth - 70, Math.max(30, absX / 4));
          const absY = Math.abs(crosshair.y) % 1080;
          const normY = isMaximized
            ? Math.min(window.innerHeight - 80, Math.max(40, (absY / 1080) * window.innerHeight))
            : Math.min(window.innerHeight - 70, Math.max(30, absY / 4));

          return (
            <div
              className="hud-crosshair-overlay"
              style={{
                left: `${normX}px`,
                top: `${normY}px`,
              }}
              aria-hidden="true"
            >
              <div className="crosshair-ring ring-outer" />
              <div className="crosshair-ring ring-inner" />
              <div className="crosshair-reticle" />
              <div className="crosshair-badge">
                <span className="crosshair-coords">
                  {isLeftMonitor ? '◧ [M2] ' : '◩ '}X:{crosshair.x} Y:{crosshair.y}
                </span>
                {crosshair.label && <span className="crosshair-tag">{crosshair.label}</span>}
              </div>
            </div>
          );
        })()}

      {/* ────────────────── Target Bounding Box Overlay with Futuristic Scanline ────────────────── */}
      {boundingBox &&
        (() => {
          const isLeftMonitor = boundingBox.x < 0;
          const absX = isLeftMonitor
            ? 1920 - (Math.abs(boundingBox.x) % 1920)
            : boundingBox.x % 1920;
          const absY = Math.abs(boundingBox.y) % 1080;
          const normX = isMaximized
            ? Math.min(window.innerWidth - 60, Math.max(10, (absX / 1920) * window.innerWidth))
            : Math.min(window.innerWidth - 60, Math.max(20, absX / 4));
          const normY = isMaximized
            ? Math.min(window.innerHeight - 60, Math.max(10, (absY / 1080) * window.innerHeight))
            : Math.min(window.innerHeight - 60, Math.max(20, absY / 4));
          const normW = isMaximized
            ? Math.max(
                30,
                Math.min(window.innerWidth - normX, (boundingBox.width / 1920) * window.innerWidth),
              )
            : Math.max(40, boundingBox.width / 4);
          const normH = isMaximized
            ? Math.max(
                20,
                Math.min(
                  window.innerHeight - normY,
                  (boundingBox.height / 1080) * window.innerHeight,
                ),
              )
            : Math.max(30, boundingBox.height / 4);

          return (
            <div
              className="hud-target-bbox"
              style={{
                left: `${normX}px`,
                top: `${normY}px`,
                width: `${normW}px`,
                height: `${normH}px`,
              }}
              aria-hidden="true"
            >
              <div className="bbox-corner top-left" />
              <div className="bbox-corner top-right" />
              <div className="bbox-corner bottom-left" />
              <div className="bbox-corner bottom-right" />
              <div className="bbox-scanline" />
              <div className="bbox-reticle" />
              <div className="bbox-badge">
                <span className="bbox-coords">
                  {isLeftMonitor ? '◧ [M2] ' : '◩ '}X:{boundingBox.x} Y:{boundingBox.y} (
                  {boundingBox.width}x{boundingBox.height})
                </span>
                {boundingBox.label && <span className="bbox-tag">{boundingBox.label}</span>}
              </div>
            </div>
          );
        })()}

      {/* ────────────────── Top Header Bar ────────────────── */}
      <div className="compact-header app-drag-region">
        <div className="compact-status no-drag">
          <div className={`gemini-core-indicator ${status}`} aria-hidden="true">
            <span className="core-glow" />
            <span className="core-bar b1" />
            <span className="core-bar b2" />
            <span className="core-bar b3" />
            <span className="core-bar b4" />
          </div>
          <span className="status-label">{statusText}</span>

          {currentTask && currentTask.status === 'running' ? (
            <span className="hud-telemetry-tag pulse">
              AGENT: {completedSteps}/{totalSteps}
            </span>
          ) : currentTask && currentTask.status === 'paused' ? (
            <span className="hud-telemetry-tag warning">PAUSED</span>
          ) : telemetry?.workflowActive ? (
            <span className="hud-telemetry-tag">TELEMETRY ON</span>
          ) : null}

          {telemetry?.cpuUsage !== undefined ? (
            <span
              className={`hud-telemetry-tag ${telemetry.cpuUsage > 75 ? 'warning pulse' : ''}`}
              title={`Live Telemetry: CPU ${telemetry.cpuUsage}% | RAM ${telemetry.memoryUsagePercent ?? 0}% | Procs ${telemetry.processCount ?? 0} | Uptime ${Math.round((telemetry.uptimeSeconds ?? 0) / 60)}m`}
            >
              CPU {Math.round(telemetry.cpuUsage)}% · RAM{' '}
              {Math.round(telemetry.memoryUsagePercent ?? 0)}%
            </span>
          ) : null}

          {/* Autonomous Killswitch & Pause Controls */}
          {currentTask && (currentTask.status === 'running' || currentTask.status === 'paused') ? (
            <div className="hud-emergency-group no-drag">
              {currentTask.status === 'running' ? (
                <button
                  type="button"
                  className="hud-emergency-btn pause"
                  title="Pause autonomous workflow"
                  onClick={onPauseWorkflow}
                >
                  ⏸ Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="hud-emergency-btn resume"
                  title="Resume paused autonomous workflow"
                  onClick={onResumeWorkflow}
                >
                  ▶ Resume
                </button>
              )}
              <button
                type="button"
                className="hud-emergency-btn killswitch"
                title="EMERGENCY STOP (Ctrl+Alt+K / Esc x3): Instantly halt all active steps and release input states"
                onClick={onEmergencyStop}
              >
                🛑 STOP
              </button>
            </div>
          ) : null}

          {/* Autonomous Approval Mode */}
          <div
            className={`compact-auto-pill ${settings.autoApprove ? 'is-active' : ''}`}
            title={
              settings.autoApprove
                ? 'Autonomous Co-Pilot: Auto-approve enabled'
                : 'Autonomous Co-Pilot: Confirmation required'
            }
          >
            <span className="auto-dot" />
            <span>{settings.autoApprove ? 'Auto' : 'Guard'}</span>
          </div>
        </div>

        <div className="compact-top-actions no-drag">
          {/* View: Chat Dialogue */}
          <button
            type="button"
            className={`compact-board-pill ${activeView === 'chat' ? 'is-active' : ''}`}
            title="Chat dialogue & speech transcripts"
            onClick={() => setActiveView('chat')}
          >
            <span>💬 Chat</span>
          </button>

          {/* View: Blackboard */}
          <button
            type="button"
            className={`compact-board-pill ${activeView === 'blackboard' ? 'is-active' : ''} ${blackboardLesson ? 'has-lesson' : ''}`}
            title="Visual Blackboard (LaTeX & Chalkboard drawings)"
            onClick={() => setActiveView('blackboard')}
          >
            <span>📐 Board{blackboardLesson ? ' •' : ''}</span>
          </button>

          {/* View: Autonomous Jarvis Workflow */}
          <button
            type="button"
            className={`compact-board-pill ${activeView === 'workflow' ? 'is-active' : ''} ${pendingApproval ? 'needs-attention' : ''}`}
            title="Autonomous OS Workflow & Multi-App Pipeline"
            onClick={() => setActiveView('workflow')}
          >
            <span>
              ⚡ Jarvis{pendingApproval ? ' (!)' : currentTask?.status === 'running' ? ' ▶' : ''}
            </span>
          </button>

          {/* View: Desktop Radar (Active Apps Minimap) */}
          <button
            type="button"
            className={`compact-board-pill ${showDesktopRadar ? 'is-active' : ''}`}
            title="Desktop Radar: Active running application windows & 1-click focus"
            onClick={() => {
              const next = !showDesktopRadar;
              setShowDesktopRadar(next);
              if (next) onRefreshWindows?.();
            }}
          >
            <span>📡 Radar</span>
          </button>

          {/* Acoustic Telemetry Sound & Volume Controls */}
          <div
            className="compact-sound-group no-drag"
            onContextMenu={(e) => {
              e.preventDefault();
              setShowVolumeSlider(!showVolumeSlider);
            }}
            onMouseLeave={() => setShowVolumeSlider(false)}
          >
            <button
              type="button"
              className={`compact-btn sound-toggle-btn ${soundMuted ? 'is-muted' : ''}`}
              title={
                soundMuted
                  ? 'Acoustic Telemetry Muted (Click to unmute, right-click for volume)'
                  : `Acoustic Telemetry: ${Math.round((soundVolume ?? 0.5) * 100)}% (Click to mute, right-click for volume)`
              }
              onClick={onToggleSoundMute}
            >
              {soundMuted ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
            {showVolumeSlider && (
              <div className="compact-volume-flyout">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={soundVolume}
                  onChange={(e) => onSoundVolumeChange?.(parseFloat(e.target.value))}
                  className="compact-volume-slider"
                  title={`Volume: ${Math.round((soundVolume ?? 0.5) * 100)}%`}
                />
                <span className="volume-percent">{Math.round((soundVolume ?? 0.5) * 100)}%</span>
              </div>
            )}
          </div>

          {/* Pin Always-on-Top */}
          <button
            type="button"
            className={`compact-btn ${isPinned ? 'is-active is-pinned' : ''}`}
            title={isPinned ? 'Pinned Always-on-Top' : 'Click to Pin Window Always-on-Top'}
            onClick={onTogglePin}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M16 4v8l3 3v2h-6v5l-1 1-1-1v-5H5v-2l3-3V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2z" />
            </svg>
          </button>

          {/* Session Export */}
          <button
            type="button"
            className="compact-btn"
            title="Export session study notes to Markdown & HTML"
            onClick={onExportSession}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {/* Minimize Window */}
          <button
            type="button"
            className="compact-btn"
            title="Minimize window"
            onClick={onMinimize}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Maximize / Restore Toggle */}
          <button
            type="button"
            className="compact-btn"
            title={isMaximized ? 'Restore normal window' : 'Maximize window'}
            onClick={onToggleMaximize}
          >
            {isMaximized ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="4" y="4" width="12" height="12" rx="2" />
                <path d="M8 8v12h12V8H8z" />
              </svg>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            )}
          </button>

          {/* Close Window */}
          <button
            type="button"
            className="compact-btn close-btn"
            title="Close Assistant"
            onClick={onClose}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ────────────────── Collapsible Desktop Radar Minimap Widget ────────────────── */}
      {showDesktopRadar && (
        <div className="desktop-radar-widget">
          <div className="radar-header">
            <div className="radar-title-area">
              <span className="radar-pulse-dot" />
              <span className="radar-title">DESKTOP RADAR</span>
              <span className="radar-count-tag">
                {runningWindows?.filter((w) => w.isVisible).length ?? 0} Visible /{' '}
                {runningWindows?.length ?? 0} Total
              </span>
            </div>
            <div className="radar-actions">
              <button
                type="button"
                className="radar-mini-btn"
                title="Refresh active windows list"
                onClick={onRefreshWindows}
              >
                ↻ Refresh
              </button>
              <button
                type="button"
                className="radar-mini-btn close"
                title="Close Radar"
                onClick={() => setShowDesktopRadar(false)}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="radar-windows-list">
            {!runningWindows || runningWindows.length === 0 ? (
              <div className="radar-empty">No active top-level windows detected.</div>
            ) : (
              runningWindows.map((w) => {
                const proc = w.processName.toLowerCase();
                let badge = '🪟';
                if (proc.includes('chrome')) badge = '🌐';
                else if (proc.includes('code')) badge = '💻';
                else if (proc.includes('powershell') || proc.includes('cmd')) badge = '⚡';
                else if (proc.includes('notepad')) badge = '📝';
                else if (proc.includes('calc')) badge = '🧮';
                else if (proc.includes('explorer')) badge = '📁';

                return (
                  <div
                    key={`${w.hwnd}_${w.pid}_${w.title || w.processName}`}
                    className={`radar-window-item ${w.isVisible ? 'is-visible' : 'is-hidden'}`}
                  >
                    <div className="radar-item-left">
                      <span className="radar-app-icon">{badge}</span>
                      <div className="radar-app-info">
                        <div className="radar-app-title" title={w.title}>
                          {w.title ? w.title.slice(0, 36) : `[${w.processName}]`}
                        </div>
                        <div className="radar-app-sub">
                          <span className="radar-proc-name">
                            PID {w.pid} • {w.processName}
                          </span>
                          {w.isIconic ? (
                            <span className="radar-state-tag minimized">MINIMIZED</span>
                          ) : w.isVisible ? (
                            <span className="radar-state-tag visible">ACTIVE</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="radar-item-right">
                      <button
                        type="button"
                        className="radar-focus-btn"
                        title={`Bring ${w.title || w.processName} to foreground`}
                        onClick={() => onFocusWindow?.(w.hwnd || w.title, w.title || w.processName)}
                      >
                        ⚡ Focus
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Export Toast Notification */}
      {exportNotice ? (
        <div className="compact-export-toast">
          <span>✓ {exportNotice}</span>
        </div>
      ) : null}

      {/* ────────────────── Center Body View ────────────────── */}
      {activeView === 'blackboard' ? (
        <div className="compact-body blackboard-view">
          <VisualBlackboard
            lesson={blackboardLesson}
            onTriggerPrompt={(prompt) => onSendText(prompt)}
            onSelectSampleLesson={onSelectSampleLesson}
          />
        </div>
      ) : activeView === 'workflow' ? (
        <div className="compact-body workflow-view">
          {/* Pending Approval Barrier Card */}
          {pendingApproval && (
            <div className="workflow-approval-card">
              <div className="approval-header">
                <span className="approval-icon">🛡️</span>
                <div>
                  <div className="approval-title">CRITICAL SYSTEM BARRIER</div>
                  <div className="approval-subtitle">
                    User consent required to execute high-impact action
                  </div>
                </div>
              </div>
              <div className="approval-desc">
                <strong>Action:</strong> {pendingApproval.step.description}
                {pendingApproval.step.params?.command && (
                  <code>{pendingApproval.step.params.command}</code>
                )}
              </div>
              <div className="approval-actions">
                <button
                  type="button"
                  className="approval-btn approve"
                  onClick={() => onApproveStep(pendingApproval.task.id, pendingApproval.step.id)}
                >
                  ✓ Approve & Execute
                </button>
                <button
                  type="button"
                  className="approval-btn reject"
                  onClick={() => onRejectStep(pendingApproval.task.id, pendingApproval.step.id)}
                >
                  ✕ Deny
                </button>
              </div>
            </div>
          )}

          {/* Current Task Display */}
          {currentTask ? (
            <div className="workflow-task-panel">
              <div className="task-header-row">
                <div className="task-goal-text">
                  <span className="goal-spark">✦</span> {currentTask.goal}
                </div>
                <span className={`task-status-pill ${currentTask.status}`}>
                  {currentTask.status.toUpperCase()}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="workflow-progress-wrapper">
                <div className="workflow-progress-bar" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="workflow-progress-label">
                <span>Pipeline Progress: {progressPercent}%</span>
                <span>
                  Step {(currentTask.activeStepIndex || 0) + 1} of {totalSteps}
                </span>
              </div>

              {/* Steps List */}
              <div className="workflow-steps-list">
                {currentTask.steps.map((st, idx) => {
                  let stepIcon = '⏳';
                  if (st.status === 'completed') stepIcon = '✓';
                  else if (st.status === 'running') stepIcon = '⚙';
                  else if (st.status === 'needs_approval') stepIcon = '⚠️';
                  else if (st.status === 'failed') stepIcon = '✕';

                  return (
                    <div
                      key={st.id || idx}
                      className={`workflow-step-item ${st.status} ${idx === currentTask.activeStepIndex ? 'is-active' : ''}`}
                    >
                      <span className="step-badge">{stepIcon}</span>
                      <div className="step-content">
                        <div className="step-title">{st.description}</div>
                        <div className="step-type">Action: {st.actionType}</div>
                        {st.error && <div className="step-err">{st.error}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="workflow-empty-state">
              <div className="workflow-empty-icon">⚡</div>
              <h3>Autonomous Jarvis Engine Ready</h3>
              <p>Deploy multi-tab and multi-app autonomous workflows across Windows desktop.</p>

              <div className="workflow-presets">
                <button
                  type="button"
                  className="preset-btn"
                  onClick={() =>
                    onStartAutonomousTask('Launch Notepad and write autonomous executive report')
                  }
                >
                  📝 Open Notepad & Write Log
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  onClick={() =>
                    onStartAutonomousTask('Search Google for state of art AI computer use agents')
                  }
                >
                  🔍 Google Search & Extract Dossier
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  onClick={() =>
                    onStartAutonomousTask(
                      'Search YouTube for multimodal AI co-pilots and verify page',
                    )
                  }
                >
                  ▶ YouTube Search & Verify Viewport
                </button>
                <button
                  type="button"
                  className="preset-btn"
                  onClick={() =>
                    onStartAutonomousTask('Launch Calculator and capture screen metrics')
                  }
                >
                  🧮 Calculator Launch & Inspection
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="compact-body" ref={scrollRef}>
          {conversation.length === 0 ? (
            <div className="captions-empty">
              <KineticWaveCluster state={kineticState} cpuUsage={telemetry?.cpuUsage} />
              <p className="captions-text">
                {isLive
                  ? 'Listening… speak your OS automation or academic command'
                  : 'Click the porcelain microphone to start live Jarvis session'}
              </p>
              <span className="captions-dots">···</span>
            </div>
          ) : (
            <div className="captions-stream">
              {conversation.slice(-15).map((entry) => {
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
                      <span className="caption-spark-icon">✦</span>
                      <span>{entry.text}</span>
                    </div>
                  );
                }
                if (entry.kind === 'tool') {
                  return (
                    <div key={entry.id} className={`caption-tool-badge ${entry.status || 'ok'}`}>
                      <span className="caption-spark-icon">⚙️</span>
                      <span>
                        {entry.title || entry.text}
                        {entry.detail ? `: ${entry.detail}` : ''}
                      </span>
                    </div>
                  );
                }
                if (entry.kind === 'system') {
                  return (
                    <div key={entry.id} className="caption-system-notice">
                      {entry.title && <strong>{entry.title}: </strong>}
                      <span>{entry.text}</span>
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

      {/* ────────────────── Quick Actions Flyout ────────────────── */}
      {showQuickActions && (
        <div className="hud-quick-actions-bar">
          <button type="button" className="quick-action-btn" onClick={onScanDesktop}>
            📸 Scan Desktop
          </button>
          <button type="button" className="quick-action-btn" onClick={onShowWindows}>
            ⚡ Active Windows
          </button>
          <button
            type="button"
            className="quick-action-btn"
            onClick={() => {
              setActiveView('workflow');
              setShowQuickActions(false);
            }}
          >
            🚀 Autonomous Plan
          </button>
        </div>
      )}

      {/* ────────────────── Keyboard Input Drawer ────────────────── */}
      {showKeyboard ? (
        <form className="compact-composer" onSubmit={handleSend}>
          <input
            type="text"
            className="compact-composer-input"
            placeholder={
              isLive
                ? 'Type command or task (e.g. "open notepad and write note")…'
                : 'Type message to start session…'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <button type="submit" className="compact-composer-btn" disabled={!draft.trim()}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      ) : null}

      {/* ────────────────── Bottom Footer ────────────────── */}
      <div className="compact-footer">
        <div className="compact-footer-left">
          <div
            className={`compact-tab-pill ${chromeConnected ? 'is-connected' : 'is-disconnected'}`}
            title={
              activeTab
                ? `Active Chrome Tab: ${activeTab.title} (${activeTab.url}) - Click to focus`
                : 'Chrome not connected. Click to launch with port 9222.'
            }
            onClick={() => {
              if (activeTab) onSwitchTab(activeTab.id);
              else onLaunchChrome();
            }}
            role="button"
            tabIndex={0}
          >
            <span className="pill-spark">✦</span>
            <span className="pill-domain">{tabDisplay}</span>
          </div>

          <button
            type="button"
            className={`compact-action-trigger ${showQuickActions ? 'is-active' : ''}`}
            title="Jarvis OS Operations & Computer Vision Tools"
            onClick={() => setShowQuickActions(!showQuickActions)}
          >
            <span>⚡ Ops</span>
          </button>

          {!isLive && (
            <button type="button" className="compact-start-pill" onClick={onStartSession}>
              Start voice
            </button>
          )}
        </div>

        <div className="compact-capsule">
          <button
            type="button"
            className={`capsule-btn mic-btn ${isLive ? 'is-live' : ''}`}
            title={isLive ? 'Listening… (click to end)' : 'Start live voice session'}
            onClick={isLive ? onStopSession : onStartSession}
          >
            {isLive ? (
              <>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                <span className="mic-halo" />
              </>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className={`capsule-btn ${showKeyboard ? 'is-active' : ''}`}
            title="Type a message"
            onClick={() => setShowKeyboard(!showKeyboard)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="6" y1="8" x2="6.01" y2="8" />
              <line x1="10" y1="8" x2="10.01" y2="8" />
              <line x1="14" y1="8" x2="14.01" y2="8" />
              <line x1="18" y1="8" x2="18.01" y2="8" />
              <line x1="8" y1="16" x2="16" y2="16" />
            </svg>
          </button>

          {isLive ? (
            <button
              type="button"
              className="capsule-btn end-btn"
              title="End session"
              onClick={onStopSession}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
