import { useState, useRef, useEffect, type FormEvent, type CSSProperties } from 'react';
import { HudIcon } from './HudIcon.js';
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
import { SkillLauncherPanel } from './SkillLauncherPanel.js';
import { ModelSwitchboard } from './ModelSwitchboard.js';
import { HUD_ACCENTS, appearanceStyle, type HudAppearance } from './appearance.js';

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
  onCollapseToBar?: () => void;
  onCollapseToOrb?: () => void;
  onOpenEmber?: () => void;
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
  appearance: HudAppearance;
  onAppearanceChange: (appearance: HudAppearance) => void;
  onAutoApproveChange?: (enabled: boolean) => void;
}

type ViewName = 'chat' | 'blackboard' | 'workflow' | 'skills' | 'models' | 'radar';

const APPROVAL_MODES = ['Ask first', 'Smart', 'Auto-approve', 'View only'] as const;
type ApprovalMode = (typeof APPROVAL_MODES)[number];

const RADAR_POSITIONS = [
  [76, 73],
  [31, 84],
  [8, 55],
  [39, 12],
  [80, 24],
  [62, 36],
] as const;

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
  const stripped = raw
    .replace(/^(gemini|deepseek|glm|kimi|claude|llama)[-_]?/i, '')
    .replace(/[-_]live$/i, '')
    .trim();
  const words = stripped
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return [prefix, ...words].filter(Boolean).join(' ') || 'Gemini 3.8';
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
  telemetry,
  onTogglePin,
  onCollapseToBar,
  onCollapseToOrb,
  onOpenEmber,
  onClose,
  onStartSession,
  onStopSession,
  onSendText,
  onSelectSampleLesson,
  onExportSession,
  onApproveStep,
  onRejectStep,
  onScanDesktop,
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
  appearance,
  onAppearanceChange,
  onAutoApproveChange,
}: CompactHUDProps) {
  const [activeView, setActiveView] = useState<ViewName>('chat');
  const [showSheet, setShowSheet] = useState(false);
  const [draft, setDraft] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    settings.autoApprove ? 'Smart' : 'Ask first',
  );
  const [radarEnabled, setRadarEnabled] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isLive =
    status === 'connecting' ||
    status === 'listening' ||
    status === 'speaking' ||
    status === 'thinking';

  const modelLabel = formatModelLabel(settings.modelId);

  const statusText =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'listening'
        ? 'Listening…'
        : status === 'speaking'
          ? 'Speaking…'
          : status === 'thinking'
            ? 'Thinking…'
            : status === 'error'
              ? 'Offline'
              : 'Online';

  let tabDisplay = 'Desktop';
  if (activeTab) {
    if (activeTab.url?.startsWith('file:')) {
      const parts = activeTab.url.split('/');
      tabDisplay = decodeURIComponent(parts[parts.length - 1] || 'Local File').slice(0, 26);
    } else if (activeTab.title) {
      tabDisplay = activeTab.title.slice(0, 26);
    } else if (activeTab.url) {
      try {
        tabDisplay = new URL(activeTab.url).hostname.replace(/^www\./, '').slice(0, 26);
      } catch {
        tabDisplay = activeTab.url.slice(0, 26);
      }
    }
  }

  const activeTool = [...conversation]
    .reverse()
    .find((message) => message.kind === 'tool' && message.status === 'running');

  const totalSteps = currentTask?.steps.length ?? 0;
  const completedSteps =
    currentTask?.steps.filter((step) => step.status === 'completed').length ?? 0;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const latestUserTranscript = [...conversation]
    .reverse()
    .find((message) => message.kind === 'user' && message.text)?.text;
  const latestAssistantTranscript = [...conversation]
    .reverse()
    .find((message) => message.kind === 'assistant' && message.text)?.text;
  const liveTranscript =
    status === 'speaking' || status === 'thinking'
      ? latestAssistantTranscript || latestUserTranscript || null
      : latestUserTranscript || latestAssistantTranscript || null;

  const approvalLabel = approvalMode === 'Smart' ? 'Smart approve' : approvalMode;

  useEffect(() => {
    if (blackboardLesson) setActiveView('blackboard');
  }, [blackboardLesson]);

  useEffect(() => {
    if (pendingApproval) setActiveView('workflow');
  }, [pendingApproval]);

  useEffect(() => {
    if (scrollRef.current && activeView === 'chat') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation, activeView]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowSheet(false);
        setActiveView('chat');
        inputRef.current?.focus();
      }
      if (event.ctrlKey && event.code === 'Space') {
        event.preventDefault();
        if (isLive) onStopSession();
        else onStartSession();
      }
      if (event.key === 'Escape') setShowSheet(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLive, onStartSession, onStopSession]);

  const selectView = (view: ViewName) => {
    setActiveView(view);
    setShowSheet(false);
    if (view === 'radar') onRefreshWindows?.();
  };

  const focusComposer = () => {
    setShowSheet(false);
    setActiveView('chat');
    inputRef.current?.focus();
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSendText(text);
  };

  const handleSuggestion = (prompt: string) => {
    if (isLive) {
      onSendText(prompt);
      return;
    }
    setActiveView('chat');
    setDraft(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const runGoal = (goal: string) => {
    const value = goal.trim();
    if (!value) return;
    setActiveView('workflow');
    setGoalDraft('');
    onStartAutonomousTask(value);
  };

  const handleGoalSubmit = (event: FormEvent) => {
    event.preventDefault();
    runGoal(goalDraft);
  };

  const applyApprovalMode = (mode: ApprovalMode) => {
    setApprovalMode(mode);
    onAutoApproveChange?.(mode === 'Smart' || mode === 'Auto-approve');
  };

  const cycleApprovalMode = () => {
    const index = APPROVAL_MODES.indexOf(approvalMode);
    const next = APPROVAL_MODES[(index + 1) % APPROVAL_MODES.length] ?? 'Smart';
    applyApprovalMode(next);
  };

  const radarControllable = runningWindows.filter(
    (windowItem, index) => radarEnabled[String(windowItem.hwnd)] ?? index < 4,
  ).length;

  const updateAppearance = (next: Partial<HudAppearance>) => {
    onAppearanceChange({ ...appearance, ...next });
  };

  return (
    <div
      className={`agent-shell ${isLive ? 'voice' : ''} ${isMaximized ? 'is-maximized' : ''}`}
      data-mode="full"
      style={appearanceStyle(appearance) as CSSProperties}
    >
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
              style={{ left: `${normX}px`, top: `${normY}px` }}
              aria-hidden="true"
            >
              <div className="crosshair-ring ring-outer" />
              <div className="crosshair-ring ring-inner" />
              <div className="crosshair-reticle" />
            </div>
          );
        })()}

      <div className="panel glass">
        <header className="head app-drag-region">
          <div className="brand">
            <div className="orb" style={{ '--s': '26px' } as CSSProperties} />
            <div className="bt">
              <b>Gematron</b>
              <span className="stat">
                <i className="dot" />
                <em style={{ fontStyle: 'normal' }}>{statusText}</em>
              </span>
            </div>
          </div>
          <button className="model" onClick={() => selectView('models')} title="Model switchboard">
            <span>{modelLabel}</span>
            <HudIcon name="chevron" size={12} />
          </button>
          <div className="sp" />
          <button
            className="ib"
            data-tip="Command palette · Ctrl K"
            onClick={focusComposer}
            title="Command palette"
          >
            <HudIcon name="command" size={17} />
          </button>
          <button
            className={`ib ${isPinned ? 'on' : ''}`}
            data-tip={isPinned ? 'Unpin from top' : 'Pin on top'}
            onClick={onTogglePin}
            title={isPinned ? 'Unpin' : 'Pin on top'}
          >
            <HudIcon name="pin" size={17} />
          </button>
          <button
            className="ib"
            data-tip="Export conversation"
            onClick={onExportSession}
            title="Export conversation"
          >
            <HudIcon name="export" size={17} />
          </button>
          <button
            className="ib"
            data-tip="Compact bar"
            onClick={onCollapseToBar}
            title="Compact bar"
          >
            <HudIcon name="bari" size={17} />
          </button>
          <button
            className="ib"
            data-tip="Collapse to orb"
            onClick={onCollapseToOrb}
            title="Collapse to orb"
          >
            <HudIcon name="orbi" size={17} />
          </button>
          <button className="ib x" data-tip="Hide to tray" onClick={onClose} title="Close">
            <HudIcon name="close" size={17} />
          </button>
        </header>

        <nav className="rail">
          <button
            className={`rb ${activeView === 'chat' ? 'on' : ''}`}
            data-tip="Chat"
            onClick={() => selectView('chat')}
            title="Chat"
          >
            <HudIcon name="chat" size={17} />
          </button>
          <button
            className={`rb ${activeView === 'blackboard' ? 'on' : ''}`}
            data-tip="Visual Blackboard — LaTeX & drawings"
            onClick={() => selectView('blackboard')}
            title="Visual Blackboard"
          >
            <HudIcon name="board" size={17} />
            {blackboardLesson && <span className="nb" />}
          </button>
          <button
            className={`rb ${activeView === 'workflow' ? 'on' : ''}`}
            data-tip="Gematron Co-Pilot — autonomous workflow"
            onClick={() => selectView('workflow')}
            title="Co-Pilot"
          >
            <HudIcon name="zap" size={17} />
            {pendingApproval && <span className="nb" />}
          </button>
          <button
            className={`rb ${activeView === 'skills' ? 'on' : ''}`}
            data-tip="Skills Launcher"
            onClick={() => selectView('skills')}
            title="Skills"
          >
            <HudIcon name="grid" size={17} />
          </button>
          <button
            className={`rb ${activeView === 'models' ? 'on' : ''}`}
            data-tip="Model Switchboard"
            onClick={() => selectView('models')}
            title="Models"
          >
            <HudIcon name="models" size={17} />
          </button>
          <button
            className={`rb ${activeView === 'radar' ? 'on' : ''}`}
            data-tip="Desktop Radar"
            onClick={() => selectView('radar')}
            title="Desktop Radar"
          >
            <HudIcon name="radar" size={17} />
          </button>
          <div className="sp" />
          <button
            className={`rb ${showSheet ? 'on' : ''}`}
            data-tip="System & controls"
            onClick={() => setShowSheet((open) => !open)}
            title="System & controls"
          >
            <HudIcon name="sliders" size={17} />
          </button>
        </nav>

        <section className="main">
          <div className="ctx">
            <span className="chip live">
              <HudIcon name="eye" size={13} />
              Seeing <b>{activeTab ? tabDisplay : 'Desktop'}</b>
            </span>
            <button className="chip" title="Co-pilot approval mode" onClick={cycleApprovalMode}>
              <HudIcon name="shield" size={13} />
              <span>{approvalLabel}</span>
            </button>
            <span className="chip mono">
              CPU {Math.round(telemetry?.cpuUsage ?? 0)}% · RAM{' '}
              {Math.round(telemetry?.memoryUsagePercent ?? 0)}%
            </span>
            {chromeConnected && (
              <span className="chip mono" title="Chrome DevTools Protocol connected">
                CDP
              </span>
            )}
          </div>

          <div className="views">
            <div className={`view ${activeView === 'chat' ? 'on' : ''}`} ref={scrollRef}>
              <div className="msg sys">Today · Model: {modelLabel}</div>
              {conversation.length === 0 ? (
                <>
                  <div className="msg ag">
                    <div className="orb av" style={{ '--s': '26px' } as CSSProperties} />
                    <div className="bubble">
                      I&apos;m ready. Talk, type, or let me see your screen.
                    </div>
                  </div>
                  <div className="msg ag">
                    <div className="orb av" style={{ '--s': '26px' } as CSSProperties} />
                    <div className="acts">
                      <button className="act" onClick={onScanDesktop}>
                        <span
                          className="tile"
                          style={{ background: 'linear-gradient(135deg,#7c5cff,#22d3ee)' }}
                        >
                          G
                        </span>
                        <div className="at">
                          <b>Scan this screen</b>
                          <span>Send the desktop to vision</span>
                        </div>
                        <i className="st" />
                      </button>
                      <button
                        className="act"
                        onClick={() => handleSuggestion('Summarize the page I am looking at.')}
                      >
                        <span className="tile" style={{ background: '#4285f4' }}>
                          C
                        </span>
                        <div className="at">
                          <b>Summarize the active tab</b>
                          <span>Chrome · {tabDisplay}</span>
                        </div>
                        <i className="st" />
                      </button>
                      <button className="act" onClick={() => selectView('workflow')}>
                        <span className="tile" style={{ background: '#7c5cff' }}>
                          ⚡
                        </span>
                        <div className="at">
                          <b>Plan a workflow</b>
                          <span>Deploy a multi-app autonomous run</span>
                        </div>
                        <i className="st" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                conversation.slice(-50).map((entry) => {
                  if (entry.kind === 'user') {
                    return (
                      <div key={entry.id} className="msg user">
                        <div className="bubble">{entry.text}</div>
                      </div>
                    );
                  }
                  if (entry.kind === 'assistant') {
                    return (
                      <div key={entry.id} className="msg ag">
                        <div className="orb av" style={{ '--s': '26px' } as CSSProperties} />
                        <div className="bubble">
                          {entry.text}
                          {entry.imageUrl && (
                            <div style={{ marginTop: 8 }}>
                              <img
                                src={entry.imageUrl}
                                alt="Screenshot"
                                style={{ maxWidth: '100%', borderRadius: 8 }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  if (entry.kind === 'tool') {
                    return (
                      <div key={entry.id} className="msg ag">
                        <div className="orb av" style={{ '--s': '26px' } as CSSProperties} />
                        <div className="acts">
                          <div
                            className={`act ${
                              entry.status === 'running'
                                ? 'run'
                                : entry.status === 'error'
                                  ? 'q'
                                  : 'ok'
                            }`}
                          >
                            <span
                              className="tile"
                              style={{ background: 'linear-gradient(135deg,#7c5cff,#22d3ee)' }}
                            >
                              {(entry.title || entry.text || 'T').charAt(0).toUpperCase()}
                            </span>
                            <div className="at">
                              <b>{entry.title || 'Tool action'}</b>
                              <span>{entry.detail || entry.text || 'Working…'}</span>
                            </div>
                            <i className="st" />
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (entry.kind === 'system') {
                    return (
                      <div key={entry.id} className="msg sys">
                        {entry.title && <strong>{entry.title}: </strong>}
                        {entry.text}
                      </div>
                    );
                  }
                  return null;
                })
              )}
              {activeTool && (
                <div className="cons">
                  <span className="run">
                    <i className="st" />
                  </span>
                  <span>{activeTool.title || 'Working'}…</span>
                </div>
              )}
            </div>

            <div className={`view ${activeView === 'blackboard' ? 'on' : ''}`}>
              <VisualBlackboard
                lesson={blackboardLesson}
                onTriggerPrompt={(prompt) => onSendText(prompt)}
                onSelectSampleLesson={onSelectSampleLesson}
              />
            </div>

            <div className={`view ${activeView === 'workflow' ? 'on' : ''}`}>
              {pendingApproval && (
                <div className="apv" style={{ marginBottom: 10 }}>
                  <div className="aph">
                    <HudIcon name="shield" size={14} />
                    Approval needed
                  </div>
                  <p>{pendingApproval.step.description}</p>
                  <small>Confirm to execute this high-impact action.</small>
                  <div className="apb">
                    <button
                      className="btn ghost sm"
                      onClick={() => onRejectStep(pendingApproval.task.id, pendingApproval.step.id)}
                    >
                      Deny
                    </button>
                    <button
                      className="btn sm"
                      onClick={() =>
                        onApproveStep(pendingApproval.task.id, pendingApproval.step.id)
                      }
                    >
                      Approve
                    </button>
                  </div>
                </div>
              )}

              <div className="card" style={{ marginBottom: 10 }}>
                <form className="goal" onSubmit={handleGoalSubmit}>
                  <input
                    value={goalDraft}
                    onChange={(event) => setGoalDraft(event.target.value)}
                    placeholder="Describe a goal — e.g. Prepare the weekly sales report"
                    aria-label="Describe an autonomous goal"
                  />
                  <button className="btn" type="submit" disabled={!goalDraft.trim()}>
                    Run
                  </button>
                </form>
                <div className="seg" role="group" aria-label="Co-pilot approval mode">
                  {APPROVAL_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={approvalMode === mode ? 'on' : ''}
                      aria-pressed={approvalMode === mode}
                      onClick={() => applyApprovalMode(mode)}
                    >
                      {mode === 'Smart' ? 'Smart' : mode}
                    </button>
                  ))}
                </div>
              </div>

              {currentTask ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div className="h3" style={{ margin: '4px 2px' }}>
                      {currentTask.goal}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      <button
                        className="btn sm ghost"
                        onClick={
                          currentTask.status === 'paused' ? onResumeWorkflow : onPauseWorkflow
                        }
                      >
                        {currentTask.status === 'paused' ? 'Resume' : 'Pause'}
                      </button>
                      <button className="btn sm danger" onClick={onEmergencyStop}>
                        Stop
                      </button>
                    </div>
                  </div>
                  <div className="prog">
                    <i style={{ width: `${progressPercent}%` }} />
                  </div>
                  <ul className="wfl">
                    {currentTask.steps.map((step, index) => (
                      <li
                        key={step.id || index}
                        className={
                          step.status === 'completed'
                            ? 'ok'
                            : step.status === 'running'
                              ? 'run'
                              : step.status === 'needs_approval'
                                ? 'wait'
                                : 'q'
                        }
                      >
                        <span className="tile" style={{ background: '#7c5cff' }}>
                          {step.actionType?.charAt(0)?.toUpperCase() || '·'}
                        </span>
                        <div className="at">
                          <b>{step.description}</b>
                          <span>{step.actionType}</span>
                        </div>
                        <i className="st" />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <div className="h3">Autonomous engine</div>
                  <div className="card">
                    <p style={{ color: 'var(--mu)', fontSize: 12, lineHeight: 1.5 }}>
                      Deploy multi-app workflows across your desktop. Describe the outcome and the
                      co-pilot plans, asks, and executes each step.
                    </p>
                    <div className="mac" style={{ marginTop: 10 }}>
                      <button
                        className="chip"
                        onClick={() =>
                          runGoal(
                            'Launch Notepad and write an autonomous executive report from the latest session.',
                          )
                        }
                      >
                        <HudIcon name="document" size={12} />
                        Notepad log
                      </button>
                      <button
                        className="chip"
                        onClick={() =>
                          runGoal(
                            'Search Google for state of the art AI computer-use agents and summarize the findings.',
                          )
                        }
                      >
                        <HudIcon name="search" size={12} />
                        Google search
                      </button>
                      <button
                        className="chip"
                        onClick={() =>
                          runGoal('Launch Calculator and capture the screen metrics into a note.')
                        }
                      >
                        <HudIcon name="calculator" size={12} />
                        Calculator
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div className="h3">Saved workflows</div>
              <div className="mac">
                <button
                  className="chip"
                  onClick={() => runGoal('Run my morning setup across the desktop.')}
                >
                  <HudIcon name="zap" size={12} />
                  Morning setup
                </button>
                <button
                  className="chip"
                  onClick={() => runGoal('Clean up my desktop and Downloads folder safely.')}
                >
                  <HudIcon name="zap" size={12} />
                  Clean desktop
                </button>
                <button
                  className="chip"
                  onClick={() => runGoal('Enable focus mode and silence distracting windows.')}
                >
                  <HudIcon name="zap" size={12} />
                  Focus mode
                </button>
              </div>
            </div>

            <div className={`view ${activeView === 'skills' ? 'on' : ''}`}>
              <SkillLauncherPanel
                onExecuteGoal={(goal) => runGoal(goal)}
                cpuUsage={telemetry?.cpuUsage}
                memoryUsagePercent={telemetry?.memoryUsagePercent}
              />
            </div>

            <div className={`view ${activeView === 'models' ? 'on' : ''}`}>
              <ModelSwitchboard
                onDispatchTest={(modelKey, prompt) =>
                  onStartAutonomousTask(`Dispatch to ${modelKey}: ${prompt}`)
                }
              />
            </div>

            <div className={`view ${activeView === 'radar' ? 'on' : ''}`}>
              <div className="radar">
                {runningWindows.slice(0, 6).map((windowItem, index) => {
                  const position = RADAR_POSITIONS[index] ?? [50, 50];
                  return (
                    <i
                      key={`blip-${windowItem.hwnd}`}
                      className={`blip ${
                        (radarEnabled[String(windowItem.hwnd)] ?? index < 4) ? '' : 'off'
                      }`}
                      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
                    />
                  );
                })}
              </div>
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--mu)',
                  fontSize: 11.5,
                  marginBottom: 10,
                }}
              >
                {runningWindows.length} windows · {radarControllable} controllable
              </div>
              {runningWindows.slice(0, 8).map((windowItem, index) => (
                <div
                  key={`radar-row-${windowItem.hwnd}`}
                  className={`rrow ${index === 0 ? 'foc' : ''}`}
                >
                  <span
                    className="tile"
                    style={{
                      background:
                        index === 0
                          ? '#4285f4'
                          : index === 1
                            ? '#1f9cf0'
                            : index === 2
                              ? '#217346'
                              : '#4b5563',
                    }}
                  >
                    {windowItem.processName?.charAt(0)?.toUpperCase() || 'W'}
                  </span>
                  <div className="at">
                    <b>{(windowItem.title || windowItem.processName).slice(0, 28)}</b>
                    <span>
                      {index === 0 ? 'Focused · Gematron is looking here' : `PID ${windowItem.pid}`}
                    </span>
                  </div>
                  <span className="cpu">{windowItem.pid % 24}%</span>
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      onFocusWindow?.(windowItem.hwnd || windowItem.title, windowItem.title)
                    }
                  >
                    Focus
                  </button>
                  <button
                    className={`sw ${
                      (radarEnabled[String(windowItem.hwnd)] ?? index < 4) ? 'on' : ''
                    }`}
                    aria-label={`Toggle control for ${windowItem.title || windowItem.processName}`}
                    onClick={() =>
                      setRadarEnabled((current) => ({
                        ...current,
                        [String(windowItem.hwnd)]: !(current[String(windowItem.hwnd)] ?? index < 4),
                      }))
                    }
                  />
                </div>
              ))}
              {runningWindows.length === 0 && (
                <div className="card" style={{ textAlign: 'center', color: 'var(--mu)' }}>
                  No windows detected.
                  <div style={{ marginTop: 8 }}>
                    <button className="btn sm ghost" onClick={onRefreshWindows}>
                      Refresh radar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="stage">
            <div className="orb" style={{ '--s': '62px' } as CSSProperties} />
            <div className="stx">
              <small>{isLive ? 'Listening…' : 'Ready'}</small>
              <div className="cap">
                {liveTranscript || (isLive ? 'Speak freely…' : 'Voice inactive')}
              </div>
              <div className="wave" style={{ height: 22 }}>
                {Array.from({ length: 38 }).map((_, index) => (
                  <i
                    key={index}
                    style={
                      {
                        '--d': `${(-Math.random()).toFixed(2)}s`,
                        animationDuration: `${(0.7 + Math.random() * 0.7).toFixed(2)}s`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="composer">
            <div className="chips">
              <button className="chip" onClick={() => selectView('workflow')}>
                <HudIcon name="zap" size={12} />
                Ops
              </button>
              <button
                className="chip"
                onClick={() =>
                  handleSuggestion(
                    'Ask all available models to analyze this screen and propose the best next action.',
                  )
                }
              >
                <HudIcon name="models" size={12} />
                Ask all models
              </button>
              <button
                className="chip"
                onClick={() => handleSuggestion('Summarize the page I am looking at.')}
              >
                <HudIcon name="eye" size={12} />
                Summarize screen
              </button>
              <button
                className="chip"
                onClick={() =>
                  runGoal(
                    'Organize my Downloads folder by file type into folders. Do not delete anything.',
                  )
                }
              >
                <HudIcon name="sparkle" size={12} />
                Clean Downloads
              </button>
              <button
                className="chip"
                onClick={() =>
                  runGoal('Create a budget spreadsheet in Excel with formulas and a chart.')
                }
              >
                <HudIcon name="sparkle" size={12} />
                Budget sheet
              </button>
            </div>
            <form className="irow" onSubmit={handleSend}>
              <div className="field">
                <button
                  className="ib"
                  type="button"
                  onClick={onScanDesktop}
                  title="Scan the active screen"
                >
                  <HudIcon name="monitor" size={17} />
                </button>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Say “Hey Gematron” or type a command…"
                  aria-label="Message Gematron"
                />
                <button className="ib" type="submit" disabled={!draft.trim()} title="Send">
                  <HudIcon name="send" size={17} />
                </button>
              </div>
              <button
                className="mic"
                type="button"
                onClick={isLive ? onStopSession : onStartSession}
                title={isLive ? 'Stop session' : 'Start voice session'}
              >
                <HudIcon name="mic" size={21} />
              </button>
              <button
                className="stopb"
                type="button"
                onClick={onStopSession}
                title="Stop everything (Esc)"
              >
                <HudIcon name="stop" size={15} />
              </button>
            </form>
            <div className="foot">
              <span>Ctrl+Space talk</span>
              <span>Ctrl+K commands</span>
              <span>Esc kill switch</span>
            </div>
          </div>
        </section>

        <aside className={`sheet ${showSheet ? 'open' : ''}`}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <div>
              <h4>System &amp; Controls</h4>
              <small style={{ color: 'var(--mu)' }}>
                Everything Gematron can see, hear and touch
              </small>
            </div>
            <button className="ib" onClick={() => setShowSheet(false)} title="Close settings">
              <HudIcon name="close" size={17} />
            </button>
          </div>

          {onOpenEmber && (
            <button
              className="chip"
              style={{ margin: '2px 0 4px' }}
              onClick={() => {
                setShowSheet(false);
                onOpenEmber();
              }}
              title="Return to the Ember voice screen"
            >
              <HudIcon name="orbi" size={13} />
              Ember voice screen
            </button>
          )}

          <div className="h3">Performance</div>
          <div className="card">
            <div className="row">
              <span>CPU</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="meter">
                  <i style={{ width: `${telemetry?.cpuUsage ?? 0}%` }} />
                </div>
                <b style={{ width: 34, textAlign: 'right' }}>
                  {Math.round(telemetry?.cpuUsage ?? 0)}%
                </b>
              </span>
            </div>
            <div className="row">
              <span>RAM</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="meter">
                  <i style={{ width: `${telemetry?.memoryUsagePercent ?? 0}%` }} />
                </div>
                <b style={{ width: 34, textAlign: 'right' }}>
                  {Math.round(telemetry?.memoryUsagePercent ?? 0)}%
                </b>
              </span>
            </div>
          </div>

          <div className="h3">Co-pilot mode</div>
          <div className="seg" role="group" aria-label="Co-pilot mode">
            {APPROVAL_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={approvalMode === mode ? 'on' : ''}
                aria-pressed={approvalMode === mode}
                onClick={() => applyApprovalMode(mode)}
              >
                {mode === 'Ask first' ? 'Ask first' : mode}
              </button>
            ))}
          </div>
          <small style={{ display: 'block', color: 'var(--mu)', margin: '7px 2px 0' }}>
            Safe actions run automatically; risky ones (delete, move, send) ask.
          </small>

          <div className="h3">Voice</div>
          <div className="card">
            <div className="row">
              <div>
                Acoustic sound
                <small>Gematron speaks replies aloud</small>
              </div>
              <button
                className={`sw ${soundMuted ? '' : 'on'}`}
                onClick={onToggleSoundMute}
                aria-label="Toggle acoustic sound"
              />
            </div>
            <div className="row">
              <span>Volume</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={soundVolume}
                  onChange={(event) => onSoundVolumeChange?.(parseFloat(event.target.value))}
                />
                <b style={{ width: 34, textAlign: 'right' }}>
                  {Math.round((soundVolume ?? 0.5) * 100)}%
                </b>
              </span>
            </div>
            <div className="row">
              <div>
                Wake word “Hey Gematron”
                <small>Always-on, processed locally</small>
              </div>
              <button className="sw on" aria-label="Toggle wake word" />
            </div>
            <div className="row">
              <span>Push-to-talk</span>
              <kbd>Ctrl + Space</kbd>
            </div>
          </div>

          <div className="h3">Permissions</div>
          <div className="card">
            <div className="row">
              <div>
                Screen vision
                <small>Read active windows</small>
              </div>
              <button className="sw on" aria-label="Toggle screen vision" />
            </div>
            <div className="row">
              <div>
                Keyboard &amp; mouse control
                <small>Click, type, drag</small>
              </div>
              <button className="sw on" aria-label="Toggle input control" />
            </div>
            <div className="row">
              <div>
                File system
                <small>Read &amp; move files</small>
              </div>
              <button className="sw on" aria-label="Toggle file system access" />
            </div>
            <div className="row">
              <div>
                Send messages / email
                <small>Always ask first</small>
              </div>
              <button className="sw" aria-label="Toggle message sending" />
            </div>
          </div>

          <div className="h3">Appearance</div>
          <div className="card">
            <div className="row">
              <span>Accent</span>
              <div className="swatches">
                {HUD_ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    className={appearance.accentId === accent.id ? 'on' : ''}
                    style={{
                      background: `linear-gradient(135deg, ${accent.a1}, ${accent.a2})`,
                    }}
                    aria-label={`Use ${accent.id} accent`}
                    onClick={() => updateAppearance({ accentId: accent.id })}
                  />
                ))}
              </div>
            </div>
            <div className="row">
              <span>Glass transparency</span>
              <input
                type="range"
                min="35"
                max="98"
                value={Math.round(appearance.opacity * 100)}
                onChange={(event) =>
                  updateAppearance({ opacity: Number(event.target.value) / 100 })
                }
                aria-label="Glass opacity"
              />
            </div>
          </div>

          {exportNotice && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--mu)' }}>
              <HudIcon name="check" size={12} /> {exportNotice}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
