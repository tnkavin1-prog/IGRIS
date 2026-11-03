import type { ToastState } from './controller';
import { Icon, IconButton, type IconName } from './ui';

function toneIcon(tone: ToastState['tone']): IconName {
  switch (tone) {
    case 'success':
      return 'check';
    case 'warn':
      return 'alert';
    case 'error':
      return 'alert';
    default:
      return 'info';
  }
}

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
    >
      <span className="toast-icon">
        <Icon name={toneIcon(toast.tone)} size={15} />
      </span>
      <span className="toast-message">{toast.message}</span>
      <IconButton label="Dismiss notification" onClick={onDismiss} className="toast-close">
        <Icon name="close" size={14} />
      </IconButton>
    </div>
  );
}
