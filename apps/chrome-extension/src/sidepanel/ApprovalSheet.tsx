import { useRef } from 'react';
import type { ApprovalRequest } from '@gbl/shared';
import { useDialogFocus } from './focus';
import { Icon, hostOf } from './ui';

export function ApprovalSheet({
  request,
  onResolve,
}: {
  request: ApprovalRequest;
  onResolve: (allow: boolean) => void;
}) {
  const denyRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>({
    initialFocus: denyRef,
    onEscape: () => onResolve(false),
    layer: 60,
  });

  return (
    <div className="overlay approval-overlay">
      <div
        ref={dialogRef}
        className="approval-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        aria-describedby="approval-description"
        tabIndex={-1}
      >
        <div className="approval-top">
          <div className="approval-shield">
            <Icon name="shield" size={20} />
          </div>
          <div className="approval-heading">
            <div className="section-kicker">Approval required</div>
            <h3 id="approval-title">{request.title}</h3>
          </div>
          <span className="risk-badge">{request.risk}</span>
        </div>

        <p id="approval-description" className="approval-description">
          {request.description}
        </p>

        {request.detail ? (
          <div className="approval-detail">
            <span className="detail-label">Target</span>
            <span>{request.detail}</span>
          </div>
        ) : null}

        {request.url ? (
          <div className="approval-url">
            <Icon name="globe" size={13} />
            <span>{hostOf(request.url)}</span>
            <span className="approval-url-full">{request.url}</span>
          </div>
        ) : null}

        {request.previewDataUrl ? (
          <figure className="approval-preview">
            <img src={request.previewDataUrl} alt="Screenshot of the approved target" />
            <figcaption>The click point is mapped from this screenshot.</figcaption>
          </figure>
        ) : null}

        <div className="approval-note">
          <Icon name="lock" size={14} />
          <span>
            Nothing has happened yet. Gemini cannot approve its own action, and page content cannot
            grant consent. This request expires in two minutes.
          </span>
        </div>

        <div className="approval-actions">
          <button
            ref={denyRef}
            type="button"
            className="btn btn-ghost"
            onClick={() => onResolve(false)}
          >
            Deny
          </button>
          <button type="button" className="btn btn-approve" onClick={() => onResolve(true)}>
            <Icon name="check" size={15} />
            Allow once
          </button>
        </div>
      </div>
    </div>
  );
}
