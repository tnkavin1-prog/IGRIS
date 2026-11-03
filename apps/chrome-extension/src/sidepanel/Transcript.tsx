import { useEffect, useRef, useState } from 'react';
import type { ConversationEntry, ToolEntry } from '@gbl/shared';
import { SUGGESTIONS } from './status';
import { Icon, timeOf, type IconName } from './ui';

function toolIcon(name: string): IconName {
  if (name.includes('snapshot') || name.includes('read') || name.includes('extract'))
    return 'search';
  if (name.includes('click') || name.includes('type') || name.includes('select')) return 'wand';
  if (name.includes('tab') || name.includes('navigate') || name.includes('url')) return 'globe';
  if (name.includes('download')) return 'download';
  if (name.includes('bookmark')) return 'bookmark';
  if (name.includes('history')) return 'history';
  if (name.includes('capture') || name.includes('visual')) return 'monitor';
  if (name.includes('submit') || name.includes('close')) return 'shield';
  return 'terminal';
}

function statusLabel(status: ToolEntry['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'ok':
      return 'Done';
    case 'error':
      return 'Failed';
    case 'denied':
      return 'Denied';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function ToolRow({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(entry.detail);
  return (
    <div className={`tool-row tool-${entry.status}`}>
      <button
        type="button"
        className="tool-main"
        onClick={() => hasDetail && setOpen((value) => !value)}
        aria-expanded={hasDetail ? open : undefined}
      >
        <span className="tool-icon">
          <Icon name={toolIcon(entry.name)} size={14} />
        </span>
        <span className="tool-copy">
          <span className="tool-title">
            {entry.title}
            <span className={`tool-status ${entry.status}`}>{statusLabel(entry.status)}</span>
          </span>
          {entry.detail && !open ? <span className="tool-detail">{entry.detail}</span> : null}
        </span>
        <span className="tool-side">
          {typeof entry.durationMs === 'number' && entry.durationMs > 0 ? (
            <span className="tool-time">{Math.round(entry.durationMs)}ms</span>
          ) : null}
          {hasDetail ? <Icon name="chevron" size={13} className={open ? 'rotated' : ''} /> : null}
        </span>
      </button>
      {open && entry.detail ? <div className="tool-expanded">{entry.detail}</div> : null}
    </div>
  );
}

function Entry({ entry }: { entry: ConversationEntry }) {
  if (entry.kind === 'tool') return <ToolRow entry={entry} />;
  if (entry.kind === 'system') {
    return (
      <div className={`system-row system-${entry.level}`}>
        <span className="system-icon">
          <Icon
            name={entry.level === 'error' ? 'alert' : entry.level === 'warn' ? 'info' : 'check'}
            size={12}
          />
        </span>
        <span>{entry.text}</span>
        <time>{timeOf(entry.at)}</time>
      </div>
    );
  }
  const isUser = entry.kind === 'user';
  return (
    <div
      className={`message ${isUser ? 'from-user' : 'from-assistant'} ${entry.final ? '' : 'streaming'}`}
    >
      <div className="message-avatar" aria-hidden="true">
        <Icon name={isUser ? 'user' : 'spark'} size={15} />
      </div>
      <div className="message-body">
        <div className="message-head">
          <span>{isUser ? 'You' : 'Gemini'}</span>
          <time>{timeOf(entry.at)}</time>
        </div>
        <p>
          {entry.text}
          {!entry.final ? <span className="typing-caret" aria-hidden="true" /> : null}
        </p>
      </div>
    </div>
  );
}

export function Transcript({
  entries,
  live,
  onClear,
  onSuggest,
}: {
  entries: ConversationEntry[];
  live: boolean;
  onClear: () => void;
  onSuggest: (prompt: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [entries]);

  const onScroll = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
  };

  return (
    <section className="transcript-section">
      <div className="section-heading">
        <div>
          <div className="section-kicker">Conversation</div>
          <h3>Live transcript &amp; actions</h3>
        </div>
        <button
          type="button"
          className="text-button"
          onClick={onClear}
          disabled={entries.length === 0}
        >
          <Icon name="trash" size={14} />
          Clear
        </button>
      </div>

      <div className="transcript" ref={scrollRef} onScroll={onScroll} aria-live="polite">
        {entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-orb">
              <Icon name="wave" size={22} />
            </div>
            <b>{live ? 'I’m listening.' : 'Nothing here yet.'}</b>
            <span>
              {live
                ? 'Ask me to read, compare, fill, click, or find something in Chrome.'
                : 'Start a live session and ask Gemini to do something in your browser.'}
            </span>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  className="suggestion"
                  onClick={() => onSuggest(suggestion.prompt)}
                >
                  <span>{suggestion.label}</span>
                  <Icon name="arrowRight" size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry) => <Entry key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}
