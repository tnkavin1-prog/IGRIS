import type { ResizeEdge } from '../main/display-mode.js';

const EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']; // corners last => on top

export function ResizeHandles() {
  const end = () => window.hudWindow?.endGesture();
  return (
    <div className="rz" aria-hidden="true">
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`rz-h rz-${edge}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            window.hudWindow?.beginGesture({ kind: 'resize', edge });
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        />
      ))}
    </div>
  );
}
