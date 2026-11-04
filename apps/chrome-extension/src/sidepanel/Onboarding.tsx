/**
 * First-run onboarding.
 *
 * Four short screens: what the panel is, how to start the bridge, how to pair
 * the panel, and what the agent is allowed to do. The copy deliberately names
 * the security boundary (the API key stays in the bridge) because that is the
 * least obvious part of the architecture.
 */
import { useEffect, useState } from 'react';
import type { AgentController, PanelSnapshot } from './controller';
import { useDialogFocus } from './focus';
import { Badge, Icon, StatusDot, type IconName } from './ui';

interface Step {
  kicker: string;
  title: string;
  lead: string;
  icon: IconName;
}

const STEPS: readonly Step[] = [
  {
    kicker: 'Welcome',
    title: 'Your browser, in conversation',
    lead: 'Gemini Browser Live is a voice-first agent. Talk naturally, interrupt it mid-sentence, and ask it to read, compare, fill, click, or navigate — without giving a cloud service your API key.',
    icon: 'spark',
  },
  {
    kicker: 'Step 1 · Local bridge',
    title: 'Start the bridge on this machine',
    lead: 'The bridge is a tiny loopback server that holds your Gemini API key and mints single-use Live tokens. Chrome never sees the key.',
    icon: 'terminal',
  },
  {
    kicker: 'Step 2 · Pair',
    title: 'Paste the gate secret once',
    lead: 'Copy LOCAL_GATE_SECRET from apps/local-bridge/.env into Settings. It is stored only in chrome.storage.local and is sent only to 127.0.0.1.',
    icon: 'key',
  },
  {
    kicker: 'Step 3 · Guardrails',
    title: 'You stay in control',
    lead: 'Consequential actions — submitting forms, spending money, downloading files, closing tabs, clicking by screenshot — always pause for your approval. Page text is treated as untrusted data, never as instructions.',
    icon: 'shield',
  },
] as const;

function bridgeTone(snapshot: PanelSnapshot): 'green' | 'amber' | 'red' | 'neutral' {
  if (snapshot.bridge.status === 'online') return 'green';
  if (snapshot.bridge.status === 'checking') return 'amber';
  if (snapshot.bridge.status === 'offline') return 'red';
  return 'neutral';
}

function bridgeLabel(snapshot: PanelSnapshot): string {
  switch (snapshot.bridge.status) {
    case 'online':
      return 'Bridge online';
    case 'checking':
      return 'Checking…';
    case 'offline':
      return 'Bridge offline';
    default:
      return 'Not checked yet';
  }
}

export function Onboarding({
  controller,
  snapshot,
  onClose,
  onOpenSettings,
}: {
  controller: AgentController;
  snapshot: PanelSnapshot;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [step, setStep] = useState(0);
  const dialogRef = useDialogFocus<HTMLDivElement>({ onEscape: onClose, layer: 45 });
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;
  const tone = bridgeTone(snapshot);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' && !last) setStep((value) => value + 1);
      if (event.key === 'ArrowLeft' && step > 0) setStep((value) => value - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [last, step]);

  return (
    <div className="overlay onboarding-overlay">
      <div
        ref={dialogRef}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-lead"
        tabIndex={-1}
      >
        <div className="onboarding-glow" aria-hidden="true" />

        <header className="onboarding-head">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="brand-copy">
              <div className="brand-name">
                Gemini <b>Browser Live</b>
              </div>
              <div className="brand-subtitle">voice · vision · action</div>
            </div>
          </div>
          <button type="button" className="text-button" onClick={onClose}>
            Skip
            <Icon name="arrowRight" size={13} />
          </button>
        </header>

        <div className="onboarding-visual" aria-hidden="true">
          <div className={`onboarding-orb ${step === 0 ? 'is-pulsing' : ''}`}>
            <span className="onboarding-orb-ring ring-one" />
            <span className="onboarding-orb-ring ring-two" />
            <Icon name={current.icon} size={30} />
          </div>
        </div>

        <div className="onboarding-copy">
          <div className="section-kicker">{current.kicker}</div>
          <h2 id="onboarding-title">{current.title}</h2>
          <p id="onboarding-lead">{current.lead}</p>

          {step === 1 ? (
            <div className="onboarding-detail">
              <div className="command-block">
                <code>npm run bridge</code>
                <span>Run from the repository root. Keep the terminal open.</span>
              </div>
              <div className="onboarding-status">
                <StatusDot tone={tone} pulse={snapshot.bridge.status === 'checking'} />
                <span>{bridgeLabel(snapshot)}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void controller.checkBridge()}
                >
                  <Icon name="refresh" size={13} />
                  Test
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-detail">
              <div className="onboarding-status">
                <StatusDot tone={tone} pulse={snapshot.bridge.status === 'checking'} />
                <span>{bridgeLabel(snapshot)}</span>
                {snapshot.secretPresent ? (
                  <Badge tone="green" icon="check">
                    Secret saved
                  </Badge>
                ) : (
                  <Badge tone="amber" icon="key">
                    Secret required
                  </Badge>
                )}
              </div>
              <button type="button" className="btn btn-primary-soft" onClick={onOpenSettings}>
                <Icon name="settings" size={15} />
                Open connection settings
              </button>
            </div>
          ) : null}

          {step === 3 ? (
            <ul className="onboarding-rules">
              <li>
                <Icon name="check" size={13} />
                <span>Passwords, one-time codes, and payment fields are hard-blocked.</span>
              </li>
              <li>
                <Icon name="check" size={13} />
                <span>Downloads, bookmarks, and history are opt-in permissions.</span>
              </li>
              <li>
                <Icon name="check" size={13} />
                <span>Every tool call is verified against a fresh page snapshot.</span>
              </li>
            </ul>
          ) : null}
        </div>

        <footer className="onboarding-foot">
          <div className="onboarding-dots" role="tablist" aria-label="Onboarding steps">
            {STEPS.map((item, index) => (
              <button
                key={item.kicker}
                type="button"
                role="tab"
                aria-selected={index === step}
                aria-label={item.kicker}
                className={`onboarding-dot ${index === step ? 'is-active' : ''} ${index < step ? 'is-done' : ''}`}
                onClick={() => setStep(index)}
              />
            ))}
          </div>
          <div className="onboarding-actions">
            {step > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                Back
              </button>
            ) : null}
            {last ? (
              <button type="button" className="btn btn-primary" onClick={onClose}>
                <Icon name="play" size={14} />
                Start using it
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>
                Continue
                <Icon name="arrowRight" size={14} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
