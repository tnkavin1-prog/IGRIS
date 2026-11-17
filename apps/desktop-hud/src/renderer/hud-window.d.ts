import type {
  GestureRequest,
  ModeChangedPayload,
  VisibilityPayload,
} from '../main/hud-window-ipc.js';

export interface HudWindowBridge {
  beginGesture(req: GestureRequest): void;
  endGesture(): void;
  setIgnoreMouse(ignore: boolean): void;
  onModeChanged(cb: (p: ModeChangedPayload) => void): () => void;
  onVisibility(cb: (p: VisibilityPayload) => void): () => void;
}

declare global {
  interface Window {
    hudWindow?: HudWindowBridge;
  }
}
