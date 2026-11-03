import { useEffect, useRef } from 'react';
import type { LiveStatus } from '@gbl/shared';
import { Icon } from './ui';

export function Composer({
  value,
  onChange,
  onSend,
  live,
  status,
  onStart,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => boolean;
  live: boolean;
  status: LiveStatus;
  onStart: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!live) return;
    inputRef.current?.focus();
  }, [live]);

  const submit = (): void => {
    if (!value.trim() || !live) return;
    if (onSend(value)) onChange('');
  };

  const placeholder = live
    ? status === 'connecting'
      ? 'Connecting…'
      : 'Type instead of speaking…'
    : 'Start a live session to type or talk';

  return (
    <footer className="composer-wrap">
      <form
        className={`composer ${live ? 'is-live' : 'is-idle'}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <span className="composer-icon" aria-hidden="true">
          <Icon name="spark" size={16} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={!live}
          autoComplete="off"
          spellCheck={false}
          aria-label="Message Gemini"
        />
        {live ? (
          <button
            type="submit"
            className="composer-send"
            disabled={!value.trim()}
            aria-label="Send message"
            title="Send message"
          >
            <Icon name="send" size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="composer-start"
            onClick={onStart}
            aria-label="Start live session"
            title="Start live session"
          >
            <Icon name="mic" size={16} />
          </button>
        )}
      </form>
      <div className="composer-note">
        <span>
          <Icon name="shield" size={11} /> Actions that spend money, submit data, download files, or
          close tabs always ask first.
        </span>
        <span className="composer-hint">Enter to send</span>
      </div>
    </footer>
  );
}
