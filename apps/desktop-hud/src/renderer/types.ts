import type { GeminiHUDAPI } from '../main/preload.js';

declare global {
  interface Window {
    geminiHUD: GeminiHUDAPI;
  }
}
