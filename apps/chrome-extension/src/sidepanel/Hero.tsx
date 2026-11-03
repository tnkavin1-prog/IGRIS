import type { CSSProperties } from 'react';
import type { PanelSnapshot } from './controller';
import { statusMeta } from './status';
import { Badge, Icon, LevelBars, type IconName } from './ui';

function orbIcon(status: PanelSnapshot['status']): IconName {
  if (status === 'speaking') return 'wave';
  if (status === 'thinking') return 'spark';
  if (status === 'acting' || status === 'awaiting-approval') return 'shield';
  if (status === 'listening') return 'mic';
  if (status === 'error' || status === 'quota') return 'alert';
  if (status === 'requesting-mic') return 'mic';
  return 'spark';
}

export function Hero({ snapshot }: { snapshot: PanelSnapshot }) {
  const meta = statusMeta(snapshot.status, snapshot.statusDetail);
  const level = Math.max(snapshot.micLevel * 6, snapshot.outputLevel * 4);
  const live = !['idle', 'closed', 'error', 'quota'].includes(snapshot.status);

  return (
    <section className="hero">
      <div className="hero-copy">
        <div className={`eyebrow tone-${meta.tone}`}>
          <span className="eyebrow-line" />
          {meta.label}
        </div>
        <h2>{meta.title}</h2>
        <p>{meta.detail}</p>
        <div className="hero-badges">
          <Badge tone={live ? 'green' : 'neutral'} icon={live ? 'wave' : 'spark'}>
            {live ? 'Live audio' : 'Ready to start'}
          </Badge>
          {snapshot.resumable ? (
            <Badge tone="violet" icon="shield">
              Resumable
            </Badge>
          ) : null}
          {snapshot.settings.browserControl && snapshot.model.toolCalling ? (
            <Badge tone="cyan" icon="globe">
              Browser tools
            </Badge>
          ) : (
            <Badge tone="neutral" icon="monitor">
              Conversation only
            </Badge>
          )}
        </div>
      </div>

      <div className="orb-stage">
        <div
          className={`orb orb-${meta.orb} ${live ? 'is-live' : ''}`}
          style={{ '--level': Math.min(1, level) } as CSSProperties}
        >
          <div className="orb-halo" />
          <div className="orb-ring ring-a" />
          <div className="orb-ring ring-b" />
          <div className="orb-ring ring-c" />
          <div className="orb-core">
            <Icon name={orbIcon(snapshot.status)} size={28} />
          </div>
          <div className="orb-spark spark-a" />
          <div className="orb-spark spark-b" />
          <div className="orb-spark spark-c" />
        </div>
        <div className="orb-floor" />
        <div className="hero-meter">
          <LevelBars
            level={live ? Math.max(snapshot.micLevel, snapshot.outputLevel) : 0}
            active={live}
            bars={22}
          />
        </div>
      </div>
    </section>
  );
}
