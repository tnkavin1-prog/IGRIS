import { useState, useEffect, useRef } from 'react';
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
import { CompactHUD } from './CompactHUD.js';
import { AudioController } from './audio-controller.js';
import { SoundEffectsEngine } from './sound-effects.js';
import './types.js';

export function App() {
  const [status, setStatus] = useState<LiveHUDStatus>('idle');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [blackboardLesson, setBlackboardLesson] = useState<VisualBlackboardLesson | null>(null);
  const [activeTab, setActiveTab] = useState<ChromeTabInfo | null>(null);
  const [chromeConnected, setChromeConnected] = useState(false);
  const [settings, setSettings] = useState<HUDSettings>({
    apiKey: '',
    modelId: 'gemini-3.8-live',
    voice: 'Kore',
    autoApprove: true,
    alwaysOnTop: true,
    soundEffectsEnabled: true,
    soundVolume: 0.5,
  });
  const [isPinned, setIsPinned] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [runningWindows, setRunningWindows] = useState<WindowItem[]>([]);
  const [soundMuted, setSoundMuted] = useState(false);
  const [soundVolume, setSoundVolume] = useState(0.5);

  // Autonomous Jarvis Agent state
  const [currentTask, setCurrentTask] = useState<AgenticTask | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    task: AgenticTask;
    step: WorkflowStep;
  } | null>(null);
  const [crosshair, setCrosshair] = useState<CrosshairTarget | null>(null);
  const [boundingBox, setBoundingBox] = useState<BoundingBoxTarget | null>(null);
  const [telemetry, setTelemetry] = useState<NeuralTelemetry | null>({
    active: false,
    workflowActive: false,
  });

  const audioControllerRef = useRef<AudioController | null>(null);
  const soundEngineRef = useRef<SoundEffectsEngine | null>(null);
  const prevCompletedStepsRef = useRef<number>(0);
  const crosshairTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escapeCountRef = useRef(0);
  const lastEscapeTimeRef = useRef(0);

  useEffect(() => {
    // 1. Initialize Audio Controller & Sound Effects Engine
    const audioCtrl = new AudioController((chunk) => {
      if (window.geminiHUD?.gemini) {
        void window.geminiHUD.gemini.sendAudioChunk(chunk);
      }
    });
    audioControllerRef.current = audioCtrl;

    const soundEngine = new SoundEffectsEngine({
      volume: settings.soundVolume ?? 0.5,
      muted: settings.soundEffectsEnabled === false,
    });
    soundEngineRef.current = soundEngine;

    if (!window.geminiHUD) {
      console.warn('[HUD] window.geminiHUD not detected (running outside Electron?)');
      return;
    }

    // 2. Fetch initial state from Main process
    window.geminiHUD.gemini
      .getSettings()
      .then((st) => {
        setSettings(st);
        if (typeof st.soundVolume === 'number') {
          setSoundVolume(st.soundVolume);
          soundEngine.setVolume(st.soundVolume);
        }
        if (typeof st.soundEffectsEnabled === 'boolean') {
          const isMuted = !st.soundEffectsEnabled;
          setSoundMuted(isMuted);
          soundEngine.setMuted(isMuted);
        }
      })
      .catch(() => undefined);

    window.geminiHUD.apps
      .listWindows()
      .then((wins) => {
        if (wins) setRunningWindows(wins);
      })
      .catch(() => undefined);

    window.geminiHUD.windowControl
      .isPinned()
      .then(setIsPinned)
      .catch(() => undefined);
    window.geminiHUD.windowControl
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => undefined);
    window.geminiHUD.cdp
      .getActiveTab()
      .then(setActiveTab)
      .catch(() => undefined);
    window.geminiHUD.cdp
      .getStatus()
      .then((st) => setChromeConnected(st.connected))
      .catch(() => undefined);
    window.geminiHUD.workflow
      .getCurrentTask()
      .then(setCurrentTask)
      .catch(() => undefined);

    // 3. Subscribe to IPC Events
    const cleanups: Array<() => void> = [];

    cleanups.push(
      window.geminiHUD.windowControl.onMaximizedChanged((max) => {
        setIsMaximized(max);
      }),
    );

    cleanups.push(
      window.geminiHUD.cdp.onActiveTabChanged((tab) => {
        setActiveTab(tab);
        setChromeConnected(true);
      }),
    );

    cleanups.push(
      window.geminiHUD.cdp.onConnectionChanged((connected) => {
        setChromeConnected(connected);
      }),
    );

    cleanups.push(
      window.geminiHUD.gemini.onStatusChanged((newStatus) => {
        setStatus(newStatus);
        if (newStatus === 'listening') {
          soundEngine.play('system_online');
        } else if (newStatus === 'idle' || newStatus === 'closed' || newStatus === 'error') {
          audioCtrl.stopCapture();
        }
      }),
    );

    cleanups.push(
      window.geminiHUD.gemini.onConversationMessage((msg) => {
        setConversation((prev) => [...prev, msg]);
      }),
    );

    cleanups.push(
      window.geminiHUD.gemini.onBlackboardLesson((lesson) => {
        setBlackboardLesson(lesson);
      }),
    );

    cleanups.push(
      window.geminiHUD.gemini.onAudioChunk((chunk) => {
        audioCtrl.playChunk(chunk.data);
      }),
    );

    cleanups.push(
      window.geminiHUD.gemini.onInterrupted(() => {
        audioCtrl.clearPlayback();
      }),
    );

    cleanups.push(
      window.geminiHUD.gemini.onAskGeminiPrompt?.((data) => {
        if (!data?.prompt) return;
        soundEngine.play('target_locked');
        const preview = data.prompt.slice(0, 40).replace(/\s+/g, ' ');
        setExportNotice(`Ask Gemini: "${preview}${data.prompt.length > 40 ? '...' : ''}"`);
        setTimeout(() => setExportNotice(null), 3500);
        if (window.geminiHUD?.gemini) {
          void window.geminiHUD.gemini.sendText(data.prompt);
        }
      }) ?? (() => {}),
    );

    // Autonomous workflow events
    cleanups.push(
      window.geminiHUD.workflow.onTaskUpdated((task) => {
        setCurrentTask(task);
        const completedCount = task.steps.filter((s) => s.status === 'completed').length;
        if (completedCount > prevCompletedStepsRef.current || task.status === 'completed') {
          soundEngine.play('step_complete');
        }
        prevCompletedStepsRef.current = completedCount;

        if (
          task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'cancelled'
        ) {
          setPendingApproval(null);
        }
      }),
    );

    cleanups.push(
      window.geminiHUD.workflow.onNeedsApproval((data) => {
        setPendingApproval(data);
        soundEngine.play('approval_needed');
      }),
    );

    // Telemetry, Bounding Boxes and Crosshairs
    cleanups.push(
      window.geminiHUD.telemetry.onCrosshairTarget((target) => {
        setCrosshair(target);
        soundEngine.play('target_locked');
        if (crosshairTimerRef.current) clearTimeout(crosshairTimerRef.current);
        crosshairTimerRef.current = setTimeout(() => {
          setCrosshair(null);
        }, 3000);
      }),
    );

    cleanups.push(
      window.geminiHUD.telemetry.onBoundingBoxTarget((target) => {
        setBoundingBox(target);
        soundEngine.play('target_locked');
        if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
        bboxTimerRef.current = setTimeout(() => {
          setBoundingBox(null);
        }, 3500);
      }),
    );

    cleanups.push(
      window.geminiHUD.workflow.onEmergencyStop((data) => {
        soundEngine.play('emergency_stop');
        setExportNotice(`🛑 EMERGENCY STOP: ${data.reason}`);
        setTimeout(() => setExportNotice(null), 4000);
      }),
    );

    cleanups.push(
      window.geminiHUD.telemetry.onTelemetryUpdated((telem) => {
        setTelemetry(telem);
      }),
    );

    // Global Emergency Killswitch Keydown Handler: Ctrl+Alt+K or Escape x3
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        void handleEmergencyStop('Ctrl+Alt+K shortcut triggered');
        return;
      }

      if (e.key === 'Escape') {
        const now = Date.now();
        if (now - lastEscapeTimeRef.current < 800) {
          escapeCountRef.current += 1;
        } else {
          escapeCountRef.current = 1;
        }
        lastEscapeTimeRef.current = now;

        if (escapeCountRef.current >= 3) {
          escapeCountRef.current = 0;
          e.preventDefault();
          void handleEmergencyStop('Escape x3 emergency stop triggered');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    cleanups.push(() => window.removeEventListener('keydown', handleKeyDown));

    const unlockAudio = () => {
      void soundEngine.unlock();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    cleanups.push(() => window.removeEventListener('pointerdown', unlockAudio));

    return () => {
      audioCtrl.stopCapture();
      soundEngine.close();
      if (crosshairTimerRef.current) clearTimeout(crosshairTimerRef.current);
      if (bboxTimerRef.current) clearTimeout(bboxTimerRef.current);
      cleanups.forEach((c) => c());
    };
  }, []);

  const handleStartSession = async () => {
    if (!window.geminiHUD) return;
    void soundEngineRef.current?.unlock();
    setStatus('connecting');
    const ok = await window.geminiHUD.gemini.connect();
    if (ok) {
      await audioControllerRef.current?.startCapture();
    }
  };

  const handleStopSession = () => {
    if (!window.geminiHUD) return;
    window.geminiHUD.gemini.disconnect();
    audioControllerRef.current?.stopCapture();
    audioControllerRef.current?.clearPlayback();
    setStatus('idle');
  };

  const handleSendText = (text: string) => {
    if (!window.geminiHUD) return;
    window.geminiHUD.gemini.sendText(text);
  };

  const handleTogglePin = async () => {
    if (!window.geminiHUD) return;
    const pinned = await window.geminiHUD.windowControl.togglePin();
    setIsPinned(pinned);
    setExportNotice(pinned ? 'HUD Pinned Always-on-Top' : 'HUD Unpinned');
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleToggleMaximize = async () => {
    if (!window.geminiHUD) return;
    const max = await window.geminiHUD.windowControl.toggleMaximize();
    setIsMaximized(max);
  };

  const handleEmergencyStop = async (reason = 'Emergency killswitch activated') => {
    if (!window.geminiHUD) return;
    await window.geminiHUD.workflow.emergencyStop(reason);
    setExportNotice('🛑 EMERGENCY STOP ACTIVATED - ALL ACTIONS HALTED');
    setTimeout(() => setExportNotice(null), 4000);
  };

  const handlePauseWorkflow = async () => {
    if (!window.geminiHUD) return;
    await window.geminiHUD.workflow.pauseCurrent();
    setExportNotice('Autonomous workflow paused');
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleResumeWorkflow = async () => {
    if (!window.geminiHUD) return;
    await window.geminiHUD.workflow.resumeCurrent();
    setExportNotice('Autonomous workflow resumed');
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleExportSession = async () => {
    if (!window.geminiHUD) return;
    const res = await window.geminiHUD.session.exportNotes({
      conversation,
      blackboard: blackboardLesson,
      activeTabTitle: activeTab?.title || activeTab?.url,
      currentTask,
    });
    if (res.ok) {
      setExportNotice(
        'Autonomous audit dossier & notes saved to E:\\Gemetron\\notes\\ (.md & .html)',
      );
    } else {
      setExportNotice('Export error: ' + (res.error || 'unknown'));
    }
    setTimeout(() => setExportNotice(null), 4000);
  };

  const handleApproveStep = async (taskId: string, stepId: string) => {
    if (!window.geminiHUD) return;
    setPendingApproval(null);
    await window.geminiHUD.workflow.approveStep(taskId, stepId);
    setExportNotice('Step Approved & Resumed');
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleRejectStep = async (taskId: string, stepId: string) => {
    if (!window.geminiHUD) return;
    setPendingApproval(null);
    await window.geminiHUD.workflow.rejectStep(taskId, stepId, 'Rejected by user');
    setExportNotice('Step Execution Denied');
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleScanDesktop = async () => {
    if (!window.geminiHUD) return;
    try {
      const shot = await window.geminiHUD.computer.captureScreen();
      // Push into vision
      await window.geminiHUD.gemini.sendFrame(shot.data);
      setExportNotice(`Desktop Scanned (${shot.width}x${shot.height}) → Gemini Vision`);
    } catch (err) {
      setExportNotice(`Capture error: ${(err as Error).message}`);
    }
    setTimeout(() => setExportNotice(null), 3000);
  };

  const handleShowWindows = async () => {
    if (!window.geminiHUD) return;
    try {
      const wins = await window.geminiHUD.apps.listWindows();
      const listSummary = wins
        .filter((w) => w.isVisible && w.title)
        .slice(0, 5)
        .map((w) => `• [${w.processName}] ${w.title}`)
        .join('\n');

      setConversation((prev) => [
        ...prev,
        {
          id: `sys_win_${Date.now()}`,
          kind: 'system',
          title: 'Active Desktop Windows',
          text: listSummary || 'No interactive top-level windows detected.',
          at: Date.now(),
        },
      ]);
    } catch (err) {
      setExportNotice(`Window discovery error: ${(err as Error).message}`);
      setTimeout(() => setExportNotice(null), 3000);
    }
  };

  const handleToggleSoundMute = () => {
    if (!soundEngineRef.current) return;
    const nextMuted = soundEngineRef.current.toggleMute();
    setSoundMuted(nextMuted);
    setSettings((prev) => ({ ...prev, soundEffectsEnabled: !nextMuted }));
    void window.geminiHUD?.gemini.updateSettings({ soundEffectsEnabled: !nextMuted });
    setExportNotice(nextMuted ? 'Acoustic telemetry muted' : 'Acoustic telemetry online');
    setTimeout(() => setExportNotice(null), 2500);
  };

  const handleSoundVolumeChange = (vol: number) => {
    if (!soundEngineRef.current) return;
    soundEngineRef.current.setVolume(vol);
    setSoundVolume(vol);
    setSettings((prev) => ({ ...prev, soundVolume: vol }));
    void window.geminiHUD?.gemini.updateSettings({ soundVolume: vol });
  };

  const handleRefreshWindows = async () => {
    if (!window.geminiHUD) return;
    try {
      const wins = await window.geminiHUD.apps.listWindows();
      if (wins) setRunningWindows(wins);
    } catch {
      /* ignore */
    }
  };

  const handleFocusWindow = async (query: string | number, title?: string) => {
    if (!window.geminiHUD) return;
    try {
      await window.geminiHUD.apps.focusWindow(query);
      soundEngineRef.current?.play('target_locked');
      await handleRefreshWindows();
      setExportNotice(`Focused window: ${title || query}`);
      setTimeout(() => setExportNotice(null), 2500);
    } catch (err) {
      setExportNotice(`Focus error: ${(err as Error).message}`);
      setTimeout(() => setExportNotice(null), 3000);
    }
  };

  const handleStartAutonomousTask = async (goal: string) => {
    if (!window.geminiHUD) return;
    const task = await window.geminiHUD.workflow.createTask(goal);
    await window.geminiHUD.workflow.startTask(task.id);
    setCurrentTask(task);
    setExportNotice(`Jarvis Pipeline Launched: ${goal}`);
    setTimeout(() => setExportNotice(null), 3000);
  };

  return (
    <CompactHUD
      status={status}
      conversation={conversation}
      blackboardLesson={blackboardLesson}
      activeTab={activeTab}
      chromeConnected={chromeConnected}
      settings={settings}
      isPinned={isPinned}
      isMaximized={isMaximized}
      currentTask={currentTask}
      pendingApproval={pendingApproval}
      crosshair={crosshair}
      boundingBox={boundingBox}
      telemetry={telemetry}
      onTogglePin={handleTogglePin}
      onToggleMaximize={handleToggleMaximize}
      onMinimize={() => window.geminiHUD?.windowControl.minimize()}
      onClose={() => window.geminiHUD?.windowControl.close()}
      onStartSession={handleStartSession}
      onStopSession={handleStopSession}
      onSendText={handleSendText}
      onSelectSampleLesson={(sample) => setBlackboardLesson(sample)}
      onExportSession={handleExportSession}
      onSwitchTab={(tabId) => window.geminiHUD?.cdp.switchTab(tabId)}
      onLaunchChrome={() => window.geminiHUD?.cdp.launchChrome()}
      onApproveStep={handleApproveStep}
      onRejectStep={handleRejectStep}
      onScanDesktop={handleScanDesktop}
      onShowWindows={handleShowWindows}
      onStartAutonomousTask={handleStartAutonomousTask}
      onEmergencyStop={() => handleEmergencyStop('HUD emergency button pressed')}
      onPauseWorkflow={handlePauseWorkflow}
      onResumeWorkflow={handleResumeWorkflow}
      exportNotice={exportNotice}
      runningWindows={runningWindows}
      onFocusWindow={handleFocusWindow}
      onRefreshWindows={handleRefreshWindows}
      soundMuted={soundMuted}
      soundVolume={soundVolume}
      onToggleSoundMute={handleToggleSoundMute}
      onSoundVolumeChange={handleSoundVolumeChange}
    />
  );
}
