import type { HudDisplayMode } from './types.js';
import type { AnchorX, AnchorY, ResizeEdge, Size } from './display-mode.js';

export const HUD_IPC = {
  gestureStart: 'hud:gesture-start',
  gestureEnd: 'hud:gesture-end',
  setIgnoreMouse: 'hud:set-ignore-mouse',
  modeChanged: 'hud:mode-changed',
  visibility: 'hud:visibility',
} as const;

export type GestureRequest =
  | { kind: 'move'; snap?: boolean }
  | { kind: 'resize'; edge: ResizeEdge };

export interface ModeChangedPayload {
  from: HudDisplayMode;
  to: HudDisplayMode;
  growing: boolean;
  anchorX: AnchorX;
  anchorY: AnchorY;
  /** Visible-surface sizes (gutter excluded). */
  fromSurface: Size;
  toSurface: Size;
  /** 0 when the OS asks for reduced motion. */
  durationMs: number;
}

export interface VisibilityPayload {
  visible: boolean;
}