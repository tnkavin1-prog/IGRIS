/**
 * Overlay host (content script).
 *
 * Injected on demand with chrome.scripting when the user asks for the
 * assistant. It does one thing: pin a chrome-extension:// iframe over the page
 * and move/resize it on request. All privileged work happens inside the frame,
 * which is an extension page with its own CSP, microphone access, and
 * chrome.tabs — a content script could not do any of that reliably.
 *
 * The host element uses an open shadow root so the frame is inspectable by
 * tests. Isolation comes from the iframe being a chrome-extension:// origin:
 * the page can never reach inside it, only move its box.
 */

const HOST_ID = 'gbl-overlay-host';
const FRAME_WIDTH = 404;
const FRAME_HEIGHT = 648;
const ORB_SIZE = 64;
const MARGIN = 20;

interface HostMessage {
  source?: string;
  type?: string;
  collapsed?: boolean;
  dx?: number;
  dy?: number;
}

interface OverlayState {
  collapsed: boolean;
  left: number | null;
  top: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function mount(): void {
  const previous = document.getElementById(HOST_ID);
  if (previous) {
    // Already mounted: treat the second request as "show me again".
    previous.style.display = '';
    previous.dispatchEvent(new CustomEvent('gbl-overlay-focus'));
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Inline styles on the host itself, before the shadow root, so a page rule
  // like `div { position: static !important }` cannot dislodge the frame.
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('margin', '0', 'important');
  host.style.setProperty('padding', '0', 'important');
  host.style.setProperty('border', '0', 'important');
  host.style.setProperty('background', 'transparent', 'important');
  host.style.setProperty('pointer-events', 'auto', 'important');

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: ${MARGIN}px;
      bottom: ${MARGIN}px;
      width: ${FRAME_WIDTH}px;
      height: ${FRAME_HEIGHT}px;
      border-radius: 22px;
      overflow: hidden;
      background: #07070d;
      box-shadow:
        0 28px 90px rgba(0, 0, 0, 0.62),
        0 0 0 1px rgba(255, 255, 255, 0.09),
        0 0 0 6px rgba(10, 10, 18, 0.18);
      transition:
        width 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        height 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        border-radius 160ms ease;
      will-change: width, height, left, top;
    }
    .wrap[data-collapsed='true'] {
      width: ${ORB_SIZE}px;
      height: ${ORB_SIZE}px;
      border-radius: 50%;
    }
    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent;
      color-scheme: dark;
    }
    @media (prefers-reduced-motion: reduce) {
      .wrap { transition: none; }
    }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.dataset.collapsed = 'false';

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('overlay.html');
  frame.title = 'Gemini Browser Live assistant';
  frame.setAttribute('allow', 'microphone');
  frame.allow = 'microphone';

  wrap.append(frame);
  shadow.append(style, wrap);
  document.documentElement.append(host);

  const state: OverlayState = { collapsed: false, left: null, top: null };

  const applyGeometry = (): void => {
    if (state.left === null || state.top === null) {
      wrap.style.left = '';
      wrap.style.top = '';
      wrap.style.right = `${MARGIN}px`;
      wrap.style.bottom = `${MARGIN}px`;
      return;
    }
    const width = state.collapsed ? ORB_SIZE : FRAME_WIDTH;
    const height = state.collapsed ? ORB_SIZE : FRAME_HEIGHT;
    const maxLeft = window.innerWidth - width - 4;
    const maxTop = window.innerHeight - height - 4;
    wrap.style.left = `${clamp(state.left, 4, maxLeft)}px`;
    wrap.style.top = `${clamp(state.top, 4, maxTop)}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  };

  const postState = (): void => {
    frame.contentWindow?.postMessage(
      { source: 'gbl-host', type: 'state', collapsed: state.collapsed },
      '*',
    );
  };

  const collapse = (collapsed: boolean): void => {
    state.collapsed = collapsed;
    wrap.dataset.collapsed = String(collapsed);
    applyGeometry();
    postState();
  };

  const remove = (): void => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', applyGeometry);
    host.remove();
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as HostMessage | null;
    if (!data || data.source !== 'gbl-overlay') return;

    switch (data.type) {
      case 'ready':
        postState();
        break;
      case 'collapse':
        collapse(data.collapsed === true);
        break;
      case 'close':
        remove();
        break;
      case 'drag': {
        const dx = Number(data.dx ?? 0);
        const dy = Number(data.dy ?? 0);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        const rect = wrap.getBoundingClientRect();
        state.left = rect.left + dx;
        state.top = rect.top + dy;
        applyGeometry();
        break;
      }
      default:
        break;
    }
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('resize', applyGeometry);

  host.addEventListener('gbl-overlay-focus', () => {
    collapse(false);
    postState();
  });

  applyGeometry();
}

mount();
