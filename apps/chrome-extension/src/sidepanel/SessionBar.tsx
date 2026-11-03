import type { PanelSnapshot } from './controller';
import { isSessionLive } from './controller';
import { Icon, Spinner, useElapsed } from './ui';

function formatToken(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'Token expired';
  const minutes = Math.floor(ms / 60_000);
  return minutes > 0 ? `Token ${minutes}m` : 'Token <1m';
}

export function SessionBar({
  snapshot,
  onStart,
  onStop,
  onMute,
}: {
  snapshot: PanelSnapshot;
  onStart: () => void;
  onStop: () => void;
  onMute: () => void;
}) {
  const live = isSessionLive(snapshot.status);
  const elapsed = useElapsed(snapshot.sessionStartedAt);
  const busy = snapshot.starting || snapshot.ending;

  return (
    <section className="session-card">
      <div className="session-top">
        <div>
          <div className="section-kicker">Live session</div>
          <div className="session-title">
            {live ? (
              <>
                <span className="live-dot" /> On air{' '}
                <span className="session-clock">{elapsed}</span>
              </>
            ) : (
              'Ready when you are'
            )}
          </div>
        </div>
        <div className="session-meta">
          {snapshot.tokenExpiresAt && live ? (
            <span className="token-pill" title="Ephemeral token lifetime">
              <Icon name="key" size={12} />
              {formatToken(snapshot.tokenExpiresAt)}
            </span>
          ) : null}
          <span className="model-pill">{snapshot.model.shortLabel}</span>
        </div>
      </div>

      <div className="session-actions">
        {live ? (
          <>
            <button type="button" className="btn btn-danger" onClick={onStop} disabled={busy}>
              {snapshot.ending ? <Spinner size={15} /> : <Icon name="stop" size={15} />}
              End session
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${snapshot.micMuted ? 'is-muted' : ''}`}
              onClick={onMute}
              aria-pressed={snapshot.micMuted}
              title={snapshot.micMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <Icon name={snapshot.micMuted ? 'micOff' : 'mic'} size={16} />
              {snapshot.micMuted ? 'Muted' : 'Mute'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-start"
            onClick={onStart}
            disabled={busy}
          >
            {snapshot.starting ? <Spinner size={16} /> : <Icon name="play" size={15} />}
            {snapshot.starting ? 'Starting…' : 'Start live'}
          </button>
        )}
        <div className="audio-status">
          <div className="audio-row">
            <Icon name="mic" size={13} />
            <span className="audio-meter">
              <i style={{ width: `${Math.min(100, snapshot.micLevel * 900)}%` }} />
            </span>
          </div>
          <div className="audio-row">
            <Icon name="volume" size={13} />
            <span className="audio-meter output">
              <i style={{ width: `${Math.min(100, snapshot.outputLevel * 700)}%` }} />
            </span>
          </div>
        </div>
      </div>

      <div className="session-foot">
        <span>
          <Icon name="lock" size={12} /> Key stays in the local bridge
        </span>
        <span>
          <Icon name="wave" size={12} /> 16 kHz in · 24 kHz out
        </span>
        <span>
          <Icon name="headphones" size={12} /> Headphones recommended
        </span>
      </div>
    </section>
  );
}
