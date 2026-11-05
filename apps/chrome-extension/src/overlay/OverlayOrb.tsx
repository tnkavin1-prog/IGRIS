import { Icon } from '../sidepanel/ui';
import { isSessionLive } from '../sidepanel/controller';
import type { PanelSnapshot } from '../sidepanel/controller';

/**
 * Collapsed overlay: a single orb, the same footprint as the Gemini Live pill.
 * Clicking it restores the full assistant.
 */
export function OverlayOrb({
  snapshot,
  onExpand,
}: {
  snapshot: PanelSnapshot;
  onExpand: () => void;
}) {
  const live = isSessionLive(snapshot.status);
  const label = live ? 'Expand the live assistant' : 'Open the Gemini assistant';

  return (
    <button
      type="button"
      className="overlay-orb"
      data-live={live}
      aria-label={label}
      title={label}
      onClick={onExpand}
    >
      <Icon name="spark" size={26} />
    </button>
  );
}
