import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, LANGUAGES, LIVE_MODELS, VOICES, type AppSettings } from '@gbl/shared';
import type { AgentController, PanelSnapshot } from './controller';
import { useDialogFocus } from './focus';
import { OPTIONAL_PERMISSIONS } from './permissions';
import { Badge, Field, Icon, IconButton, Slider, StatusDot, Toggle, type IconName } from './ui';

type Tab = 'connection' | 'voice' | 'agent' | 'permissions' | 'privacy';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'connection', label: 'Connection', icon: 'plug' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
  { id: 'agent', label: 'Agent', icon: 'bot' },
  { id: 'permissions', label: 'Access', icon: 'shield' },
  { id: 'privacy', label: 'Privacy', icon: 'lock' },
];

function bridgeTone(snapshot: PanelSnapshot): 'green' | 'amber' | 'red' | 'neutral' {
  if (snapshot.bridge.status === 'online') return 'green';
  if (snapshot.bridge.status === 'checking') return 'amber';
  if (snapshot.bridge.status === 'offline') return 'red';
  return 'neutral';
}

export function SettingsPanel({
  controller,
  snapshot,
  onClose,
  highlightSecret = false,
}: {
  controller: AgentController;
  snapshot: PanelSnapshot;
  onClose: () => void;
  highlightSecret?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('connection');
  const [draft, setDraft] = useState<AppSettings>(snapshot.settings);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [controlToken, setControlToken] = useState('');
  const [showControlToken, setShowControlToken] = useState(false);
  const [controlTokenSaved, setControlTokenSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const secretRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({ onEscape: onClose, layer: 50 });

  // `draft` is seeded from the snapshot when the panel mounts. The panel is
  // conditionally rendered, so reopening it always picks up the latest saved
  // settings without a prop-sync effect that would clobber in-progress edits.

  useEffect(() => {
    if (!highlightSecret) return;
    // The panel mounts with the connection tab already selected; this effect
    // only moves focus to the secret field once the dialog is on screen.
    const timer = window.setTimeout(() => secretRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [highlightSecret]);

  useEffect(() => {
    void controller.refreshDevices();
  }, [controller]);

  useEffect(() => {
    let cancelled = false;
    void controller
      .loadControlToken()
      .then((token) => {
        if (!cancelled) setControlTokenSaved(Boolean(token));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [controller]);

  const model = useMemo(
    () => LIVE_MODELS.find((item) => item.id === draft.modelId) ?? LIVE_MODELS[0]!,
    [draft.modelId],
  );

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const result = await controller.updateSettings(draft);
      if (!result.ok) {
        setError(result.error ?? 'Could not save these settings.');
        return;
      }
      setSaved(true);
      controller.toast('Settings saved.', 'success');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const saveSecret = async (): Promise<void> => {
    if (!secret.trim()) {
      controller.toast('Paste the bridge secret first.', 'warn');
      return;
    }
    await controller.saveBridgeSecret(secret);
    setSecret('');
  };

  const saveControlToken = async (): Promise<void> => {
    if (!controlToken.trim()) {
      controller.toast('Paste the control token first.', 'warn');
      return;
    }
    await controller.saveControlToken(controlToken);
    setControlToken('');
    setControlTokenSaved(true);
  };

  const reset = async (): Promise<void> => {
    if (!window.confirm('Restore every setting to its default value?')) return;
    await controller.resetSettings();
    setDraft({ ...DEFAULT_SETTINGS });
    setSaved(true);
  };

  return (
    <div
      className="overlay settings-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        ref={dialogRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="settings-head">
          <div>
            <div className="section-kicker">Configuration</div>
            <h2 id="settings-title">Settings</h2>
          </div>
          <IconButton label="Close settings" onClick={onClose}>
            <Icon name="close" size={18} />
          </IconButton>
        </div>

        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-tab ${tab === item.id ? 'is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {tab === 'connection' ? (
            <>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Local bridge</h3>
                  <Badge tone={bridgeTone(snapshot)} icon="plug">
                    {snapshot.bridge.status === 'online'
                      ? 'Online'
                      : snapshot.bridge.status === 'checking'
                        ? 'Checking'
                        : snapshot.bridge.status === 'offline'
                          ? 'Offline'
                          : 'Unknown'}
                  </Badge>
                </div>
                <p className="section-help">
                  The bridge holds your Gemini API key and mints single-use Live tokens. It listens
                  on loopback only; the key never enters Chrome.
                </p>
                <Field label="Bridge URL" hint="Only 127.0.0.1 or localhost is accepted.">
                  <input
                    type="url"
                    value={draft.bridgeUrl}
                    onChange={(event) => set('bridgeUrl', event.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <div className="inline-row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void controller.checkBridge()}
                  >
                    <Icon name="refresh" size={14} />
                    Test connection
                  </button>
                  {snapshot.bridge.health ? (
                    <span className="inline-note">
                      <StatusDot tone={bridgeTone(snapshot)} />
                      {snapshot.bridge.health.service} v{snapshot.bridge.health.version}
                    </span>
                  ) : snapshot.bridge.error ? (
                    <span className="inline-note error">{snapshot.bridge.error}</span>
                  ) : null}
                </div>
              </section>

              <section className={`settings-section ${highlightSecret ? 'is-highlighted' : ''}`}>
                <div className="settings-section-head">
                  <h3>Bridge secret</h3>
                  {snapshot.secretPresent ? (
                    <Badge tone="green" icon="check">
                      Saved
                    </Badge>
                  ) : (
                    <Badge tone="amber" icon="alert">
                      Required
                    </Badge>
                  )}
                </div>
                <p className="section-help">
                  Copy <code>LOCAL_GATE_SECRET</code> from <code>apps/local-bridge/.env</code>. It
                  is stored in <code>chrome.storage.local</code>, never synced, and never sent
                  anywhere except your loopback bridge.
                </p>
                <div className="secret-row">
                  <input
                    ref={secretRef}
                    type={showSecret ? 'text' : 'password'}
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={
                      snapshot.secretPresent
                        ? 'Saved — enter a new secret to replace'
                        : 'Paste LOCAL_GATE_SECRET'
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <IconButton
                    label={showSecret ? 'Hide secret' : 'Show secret'}
                    onClick={() => setShowSecret((value) => !value)}
                  >
                    <Icon name={showSecret ? 'eyeOff' : 'eye'} size={16} />
                  </IconButton>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void saveSecret()}
                  >
                    Save
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Desktop control token</h3>
                  {controlTokenSaved ? (
                    <Badge tone="green" icon="check">
                      Saved
                    </Badge>
                  ) : (
                    <Badge tone="neutral" icon="info">
                      Optional
                    </Badge>
                  )}
                </div>
                <p className="section-help">
                  The native desktop HUD accepts a per-install token for its control API. Copy the{' '}
                  <code>control-token</code> file from the HUD data folder (
                  <code>%LOCALAPPDATA%\Gemetron</code>) and paste it here. The extension is already
                  trusted by its own origin, so this is only needed for locked-down installations.
                  It is stored in <code>chrome.storage.local</code> and never synced.
                </p>
                <div className="secret-row">
                  <input
                    type={showControlToken ? 'text' : 'password'}
                    value={controlToken}
                    onChange={(event) => setControlToken(event.target.value)}
                    placeholder={
                      controlTokenSaved
                        ? 'Saved — enter a new token to replace'
                        : 'Paste the control token'
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <IconButton
                    label={showControlToken ? 'Hide token' : 'Show token'}
                    onClick={() => setShowControlToken((value) => !value)}
                  >
                    <Icon name={showControlToken ? 'eyeOff' : 'eye'} size={16} />
                  </IconButton>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void saveControlToken()}
                  >
                    Save
                  </button>
                </div>
              </section>

              <div className="info-card">
                <Icon name="terminal" size={16} />
                <div>
                  <b>Start the bridge</b>
                  <code>npm run bridge</code>
                  <span>
                    Keep the terminal window open while you use the extension. The bridge logs every
                    request but never the API key.
                  </span>
                </div>
              </div>
            </>
          ) : null}
          {tab === 'voice' ? (
            <>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Model</h3>
                  <Badge tone="violet" icon="spark">
                    Live API
                  </Badge>
                </div>
                <div className="model-grid">
                  {LIVE_MODELS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`model-card ${draft.modelId === item.id ? 'is-selected' : ''}`}
                      onClick={() => set('modelId', item.id)}
                    >
                      <span className="model-card-top">
                        <b>{item.label}</b>
                        {draft.modelId === item.id ? <Icon name="check" size={15} /> : null}
                      </span>
                      <span className="model-card-description">{item.description}</span>
                      <span className="model-card-badges">
                        <Badge tone={item.toolCalling ? 'cyan' : 'neutral'} icon="globe">
                          {item.toolCalling ? 'Browser tools' : 'Conversation only'}
                        </Badge>
                        <Badge tone="neutral" icon="clock">
                          {item.latency === 'low' ? 'Low latency' : 'Deep reasoning'}
                        </Badge>
                      </span>
                    </button>
                  ))}
                </div>
                {!model.toolCalling ? (
                  <div className="inline-warning">
                    <Icon name="alert" size={14} />
                    This model cannot call browser tools in the current API version. Browser control
                    is disabled while it is selected.
                  </div>
                ) : null}
              </section>

              <section className="settings-section">
                <h3>Voice &amp; language</h3>
                <div className="field-grid">
                  <Field label="Voice">
                    <select
                      value={draft.voice}
                      onChange={(event) => set('voice', event.target.value)}
                    >
                      {!VOICES.some((voice) => voice.id === draft.voice) ? (
                        <option value={draft.voice}>{draft.voice} · custom</option>
                      ) : null}
                      {VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Language">
                    <select
                      value={draft.language}
                      onChange={(event) => set('language', event.target.value)}
                    >
                      {LANGUAGES.map((language) => (
                        <option key={language.id} value={language.id}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {model.requiresThinkingLevel ? (
                  <Field
                    label="Thinking level"
                    hint="Higher levels take longer but reason further ahead."
                  >
                    <div className="segmented">
                      {(['LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
                        <button
                          key={level}
                          type="button"
                          className={draft.thinkingLevel === level ? 'is-active' : ''}
                          onClick={() => set('thinkingLevel', level)}
                        >
                          {level.toLowerCase()}
                        </button>
                      ))}
                    </div>
                  </Field>
                ) : null}
              </section>

              <section className="settings-section">
                <h3>Audio</h3>
                <div className="field-grid">
                  <Field label="Microphone">
                    <select
                      value={draft.inputDeviceId ?? ''}
                      onChange={(event) => set('inputDeviceId', event.target.value || null)}
                    >
                      <option value="">System default</option>
                      {snapshot.devices.inputs.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Output">
                    <select
                      value={draft.outputDeviceId ?? ''}
                      onChange={(event) => set('outputDeviceId', event.target.value || null)}
                    >
                      <option value="">System default</option>
                      {snapshot.devices.outputs.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Slider
                  label="Input gain"
                  value={draft.inputGain}
                  min={0.1}
                  max={3}
                  step={0.05}
                  onChange={(value) => set('inputGain', value)}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
                <Slider
                  label="Playback volume"
                  value={draft.outputVolume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => set('outputVolume', value)}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
                <Slider
                  label="End-of-speech silence"
                  value={draft.vadSilenceMs}
                  min={200}
                  max={2_000}
                  step={50}
                  onChange={(value) => set('vadSilenceMs', value)}
                  format={(value) => `${value} ms`}
                />
                <Slider
                  label="Speech prefix padding"
                  value={draft.vadPrefixMs}
                  min={0}
                  max={500}
                  step={10}
                  onChange={(value) => set('vadPrefixMs', value)}
                  format={(value) => `${value} ms`}
                />
                <Toggle
                  checked={draft.audioCues}
                  onChange={(value) => set('audioCues', value)}
                  label="Audio cues"
                  description="Play a short tone when a session starts and ends."
                />
              </section>
            </>
          ) : null}

          {tab === 'agent' ? (
            <>
              <section className="settings-section">
                <h3>Browser control</h3>
                <Toggle
                  checked={draft.browserControl}
                  onChange={(value) => set('browserControl', value)}
                  label="Allow Gemini to operate the browser"
                  description="Inspect pages, click, type, navigate, and use tools. Every session asks the bridge for a fresh token."
                  disabled={!model.toolCalling}
                />
                <Toggle
                  checked={draft.autoApprove ?? true}
                  onChange={(value) => set('autoApprove', value)}
                  label="Autonomous mode (no approval popups)"
                  description="Let Gemini execute browser actions directly without pausing for approval dialogs on every form or button click."
                />
                <Toggle
                  checked={draft.confirmRisky}
                  onChange={(value) => set('confirmRisky', value)}
                  label="Confirm consequential actions"
                  description="Ask before clicks whose text looks like pay, delete, send, publish, submit, or install. Form submits, downloads, tab closes, and visual clicks always ask, even when this is off."
                />
                <Toggle
                  checked={draft.includeContextOnStart}
                  onChange={(value) => set('includeContextOnStart', value)}
                  label="Send a short page context on connect"
                  description="Includes the active tab title, URL, tab count, and a bounded text preview as untrusted data. No page context is sent when this is off."
                />
                <Toggle
                  checked={draft.autoReconnect}
                  onChange={(value) => set('autoReconnect', value)}
                  label="Reconnect automatically"
                  description="Mint a fresh token and resume the conversation after a network drop or server rotation."
                />
              </section>

              <section className="settings-section">
                <h3>Guardrails</h3>
                <Slider
                  label="Tool steps per turn"
                  value={draft.maxToolSteps}
                  min={1}
                  max={24}
                  step={1}
                  onChange={(value) => set('maxToolSteps', value)}
                  format={(value) => `${value} step${value === 1 ? '' : 's'}`}
                />
                <div className="info-card">
                  <Icon name="shield" size={16} />
                  <div>
                    <b>Policy is enforced in code</b>
                    <span>
                      Sensitive fields are never read or written. Password, one-time-code, and
                      payment inputs are hard-blocked. Page text is framed as untrusted data, and
                      the model cannot approve its own actions.
                    </span>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {tab === 'permissions' ? (
            <>
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Required access</h3>
                  <Badge tone="green" icon="check">
                    Installed
                  </Badge>
                </div>
                <div className="permission-list">
                  <div className="permission-row">
                    <span className="permission-icon">
                      <Icon name="monitor" size={15} />
                    </span>
                    <div>
                      <b>Tabs &amp; scripting</b>
                      <span>Read tab metadata and inject the on-demand page agent.</span>
                    </div>
                    <Badge tone="neutral">Required</Badge>
                  </div>
                  <div className="permission-row">
                    <span className="permission-icon">
                      <Icon name="storage" size={15} />
                    </span>
                    <div>
                      <b>Local storage</b>
                      <span>Keep settings and, if you opt in, the transcript on this device.</span>
                    </div>
                    <Badge tone="neutral">Required</Badge>
                  </div>
                  <div className="permission-row">
                    <span className="permission-icon">
                      <Icon name="globe" size={15} />
                    </span>
                    <div>
                      <b>Website content</b>
                      <span>
                        Read and operate normal http(s) pages when you ask. Chrome-protected pages
                        are never scripted.
                      </span>
                    </div>
                    <Badge tone="neutral">Required</Badge>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Optional capabilities</h3>
                  <Badge tone="violet" icon="key">
                    Ask first
                  </Badge>
                </div>
                <p className="section-help">
                  These are not granted at install. Grant one only when you want the agent to use
                  it. You can revoke it at any time; the agent will ask you to grant it again if
                  needed.
                </p>
                <div className="permission-list">
                  {OPTIONAL_PERMISSIONS.map((permission) => {
                    const granted = snapshot.permissions[permission.id];
                    return (
                      <div className="permission-row" key={permission.id}>
                        <span className="permission-icon">
                          <Icon
                            name={
                              permission.id === 'downloads'
                                ? 'download'
                                : permission.id === 'bookmarks'
                                  ? 'bookmark'
                                  : 'history'
                            }
                            size={15}
                          />
                        </span>
                        <div>
                          <b>{permission.label}</b>
                          <span>{permission.description}</span>
                          <code>{permission.capability}</code>
                        </div>
                        <button
                          type="button"
                          className={`btn btn-sm ${granted ? 'btn-ghost' : 'btn-primary-soft'}`}
                          onClick={() =>
                            void (granted
                              ? controller.revokePermission(permission.id)
                              : controller.grantPermission(permission.id))
                          }
                        >
                          {granted ? 'Revoke' : 'Grant'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}

          {tab === 'privacy' ? (
            <>
              <section className="settings-section">
                <h3>Transcript retention</h3>
                <div className="choice-grid">
                  <button
                    type="button"
                    className={`choice-card ${draft.retention === 'session' ? 'is-selected' : ''}`}
                    onClick={() => set('retention', 'session')}
                  >
                    <span className="choice-top">
                      <b>This session only</b>
                      {draft.retention === 'session' ? <Icon name="check" size={14} /> : null}
                    </span>
                    <span>Clear the transcript when Chrome closes the side panel.</span>
                  </button>
                  <button
                    type="button"
                    className={`choice-card ${draft.retention === 'local' ? 'is-selected' : ''}`}
                    onClick={() => set('retention', 'local')}
                  >
                    <span className="choice-top">
                      <b>Keep on this device</b>
                      {draft.retention === 'local' ? <Icon name="check" size={14} /> : null}
                    </span>
                    <span>Store the last 120 entries in chrome.storage.local. Never synced.</span>
                  </button>
                </div>
                <div className="inline-row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => controller.clearConversation()}
                  >
                    <Icon name="trash" size={14} />
                    Clear transcript now
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <h3>What leaves this device</h3>
                <div className="data-list">
                  <div>
                    <Icon name="mic" size={14} />
                    <span>
                      <b>Audio</b> streams directly from Chrome to the Gemini Live API. The local
                      bridge never receives audio.
                    </span>
                  </div>
                  <div>
                    <Icon name="monitor" size={14} />
                    <span>
                      <b>Page data</b> is sent only through the tools you ask for, or as a bounded
                      context preview when enabled.
                    </span>
                  </div>
                  <div>
                    <Icon name="key" size={14} />
                    <span>
                      <b>The API key</b> stays in the bridge process. Chrome only ever holds a
                      single-use ephemeral token and the bridge gate secret.
                    </span>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <h3>Runtime</h3>
                <div className="runtime-grid">
                  <span>Extension</span>
                  <b>v{snapshot.runtime.extensionVersion}</b>
                  <span>Chrome</span>
                  <b>{snapshot.runtime.chromeVersion}</b>
                  <span>Platform</span>
                  <b>{snapshot.runtime.platform}</b>
                  <span>Bridge</span>
                  <b>{snapshot.runtime.bridgeUrl}</b>
                </div>
                <div className="danger-zone">
                  <div>
                    <b>Reset all settings</b>
                    <span>Restore defaults. The bridge secret and transcript are kept.</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => void reset()}
                  >
                    Reset
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <div className="settings-foot">
          <div className="settings-status">
            {error ? (
              <span className="error-text">
                <Icon name="alert" size={13} /> {error}
              </span>
            ) : saved ? (
              <span className="saved-text">
                <Icon name="check" size={13} /> Saved
              </span>
            ) : (
              <span className="muted-text">Changes apply to the next session.</span>
            )}
          </div>
          <div className="settings-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
