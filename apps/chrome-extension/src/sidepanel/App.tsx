/**
 * Side-panel shell.
 *
 * The component tree is intentionally thin: `AgentController` owns every side
 * effect, and React only renders the snapshot it publishes. That keeps a
 * re-render from restarting audio or reconnecting a socket.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AgentController, isSessionLive } from './controller';
import { Header } from './Header';
import { Hero } from './Hero';
import { SessionBar } from './SessionBar';
import { Transcript } from './Transcript';
import { Composer } from './Composer';
import { ApprovalSheet } from './ApprovalSheet';
import { SettingsPanel } from './SettingsPanel';
import { Onboarding } from './Onboarding';
import { Toast } from './Toast';
import { Icon } from './ui';
import { useOverlayShell } from '../overlay/useOverlayShell';
import { OverlayBar } from '../overlay/OverlayBar';
import { OverlayOrb } from '../overlay/OverlayOrb';

interface RuntimeMessage {
  type?: string;
}

export function App() {
  // Lazy state initialisation creates the controller once without reading a
  // ref during render. The controller owns all side effects; React only renders
  // the snapshot it publishes.
  const [controller] = useState(() => new AgentController());

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [settingsHint, setSettingsHint] = useState(false);
  const pendingPrompt = useRef<string | null>(null);
  const {
    overlay: overlaySurface,
    collapsed: overlayCollapsed,
    toggle: toggleOverlay,
    expand: expandOverlay,
  } = useOverlayShell();

  useEffect(() => {
    void controller.init();
    // Teardown is owned by the controller's `pagehide` listener. Disposing here
    // would break React StrictMode's development remount (and the panel never
    // unmounts without the page going away).
  }, [controller]);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setSettingsHint(false);
    void controller.refreshPermissions();
  }, [controller]);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const start = useCallback(() => {
    if (!snapshot.secretPresent) {
      setSettingsHint(true);
      setSettingsOpen(true);
      controller.toast('Add the local bridge secret to start a session.', 'warn');
      return;
    }
    void controller.start();
  }, [controller, snapshot.secretPresent]);

  const stop = useCallback(() => {
    void controller.stop();
  }, [controller]);

  const send = useCallback(
    (text: string): boolean => {
      if (!isSessionLive(snapshot.status)) {
        setDraft(text);
        controller.toast('Start a live session, then send your message.', 'info');
        return false;
      }
      return controller.sendText(text);
    },
    [controller, snapshot.status],
  );

  const suggest = useCallback(
    (prompt: string) => {
      if (isSessionLive(snapshot.status)) {
        if (controller.sendText(prompt)) {
          setDraft('');
        }
        return;
      }
      if (!snapshot.secretPresent) {
        setDraft(prompt);
        setSettingsHint(true);
        setSettingsOpen(true);
        return;
      }
      // Start the session now and send the prompt as soon as the model is
      // listening. This makes the suggestion cards one-click actions.
      pendingPrompt.current = prompt;
      setDraft(prompt);
      void controller.start();
    },
    [controller, snapshot.secretPresent, snapshot.status],
  );

  // Deliver a queued suggestion once the socket reports `listening`.
  useEffect(() => {
    if (snapshot.status !== 'listening') {
      if (
        snapshot.status === 'error' ||
        snapshot.status === 'quota' ||
        snapshot.status === 'closed'
      ) {
        pendingPrompt.current = null;
      }
      return;
    }
    const prompt = pendingPrompt.current;
    if (!prompt) return;
    pendingPrompt.current = null;
    if (controller.sendText(prompt)) {
      setDraft('');
    }
  }, [controller, snapshot.status]);

  // The background worker routes keyboard commands here while the panel is open.
  useEffect(() => {
    const onMessage = (message: RuntimeMessage): void => {
      switch (message?.type) {
        case 'GBL_COMMAND_START':
          start();
          break;
        case 'GBL_COMMAND_STOP':
          stop();
          break;
        case 'GBL_COMMAND_TOGGLE_MIC':
          if (isSessionLive(controller.getSnapshot().status)) controller.toggleMute();
          break;
        case 'GBL_COMMAND_SETTINGS':
          openSettings();
          break;
        default:
          break;
      }
    };
    try {
      chrome.runtime.onMessage.addListener(onMessage);
      return () => chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      return undefined;
    }
  }, [controller, openSettings, start, stop]);

  // Escape closes the topmost surface. Approval deliberately cannot be
  // dismissed with Escape alone — the sheet itself resolves a denial.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (settingsOpen) setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  const live = isSessionLive(snapshot.status);

  // An approval must never be hidden behind a collapsed orb: a consequential
  // action would time out unanswered.
  const approvalPending = Boolean(snapshot.approval);
  useEffect(() => {
    if (overlaySurface && approvalPending && overlayCollapsed) expandOverlay();
  }, [overlaySurface, approvalPending, overlayCollapsed, expandOverlay]);

  if (overlaySurface && overlayCollapsed) {
    return <OverlayOrb snapshot={snapshot} onExpand={expandOverlay} />;
  }

  return (
    <div className="app-shell">
      {overlaySurface ? (
        <OverlayBar collapsed={overlayCollapsed} onToggleCollapsed={toggleOverlay} />
      ) : null}
      <div className="ambient" aria-hidden="true">
        <span className="ambient-blob blob-a" />
        <span className="ambient-blob blob-b" />
        <span className="ambient-grid" />
      </div>

      <Header
        snapshot={snapshot}
        onOpenSettings={openSettings}
        onCheckBridge={() => void controller.checkBridge()}
      />

      <main className="app-main">
        {!snapshot.secretPresent && snapshot.ready ? (
          <div className="setup-banner" role="status">
            <span className="setup-banner-icon">
              <Icon name="key" size={15} />
            </span>
            <div>
              <b>Pair the local bridge</b>
              <span>Paste the gate secret once to unlock live sessions.</span>
            </div>
            <button type="button" className="btn btn-primary-soft btn-sm" onClick={openSettings}>
              Connect
            </button>
          </div>
        ) : null}

        <Hero snapshot={snapshot} />
        <SessionBar
          snapshot={snapshot}
          onStart={start}
          onStop={stop}
          onMute={() => controller.toggleMute()}
        />
        <Transcript
          entries={snapshot.conversation}
          live={live}
          onClear={() => controller.clearConversation()}
          onSuggest={suggest}
        />
      </main>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        live={live}
        status={snapshot.status}
        onStart={start}
      />

      {snapshot.approval ? (
        <ApprovalSheet
          request={snapshot.approval}
          onResolve={(allow) => controller.resolveApproval(allow)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          controller={controller}
          snapshot={snapshot}
          onClose={closeSettings}
          highlightSecret={settingsHint}
        />
      ) : null}

      {!snapshot.onboardingSeen && snapshot.ready ? (
        <Onboarding
          controller={controller}
          snapshot={snapshot}
          onClose={() => controller.dismissOnboarding()}
          onOpenSettings={openSettings}
        />
      ) : null}

      {snapshot.toast ? (
        <Toast toast={snapshot.toast} onDismiss={() => controller.dismissToast()} />
      ) : null}
    </div>
  );
}
