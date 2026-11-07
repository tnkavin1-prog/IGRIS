/**
 * Overlay host (content script).
 *
 * Injected on demand with chrome.scripting when the user asks for the
 * assistant. It does one thing: pin a chrome-extension:// iframe over the page
 * and resize/move it on request. All privileged work happens inside the frame,
 * which is an extension page with its own CSP, microphone access, and
 * chrome.tabs — a content script could not do any of that reliably.
 *
 * The host element uses an open shadow root so the frame is inspectable by
 * tests. Isolation comes from the iframe being a chrome-extension:// origin:
 * the page can never reach inside it, only move its box.
 */

const HOST_ID = 'gbl-overlay-host';
const MARGIN = 20;
const POSITION_KEY = 'gbl_overlay_pos';

const SIZES = {
  pill: { width: 380, height: 68, radius: 34 },
  panel: { width: 440, height: 320, radius: 24 },
  expanded: { width: 920, height: 860, radius: 24 },
  orb: { width: 68, height: 68, radius: 34 },
} as const;

type OverlayView = keyof typeof SIZES;

interface HostMessage {
  source?: string;
  type?: string;
  view?: unknown;
  dx?: number;
  dy?: number;
}

interface OverlayState {
  view: OverlayView;
  left: number | null;
  top: number | null;
}

function isView(value: unknown): value is OverlayView {
  return value === 'pill' || value === 'panel' || value === 'expanded' || value === 'orb';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function mount(): void {
  const previous = document.getElementById(HOST_ID);
  if (previous) {
    previous.remove();
  }

  // Strictly avoid embedding an extension iframe in Chrome's PDF viewer or on PDF documents
  // where extension iframes are blocked by Chromium's PDF Content Security Policy
  const isPdf =
    document.contentType === 'application/pdf' ||
    window.location.href.toLowerCase().includes('.pdf') ||
    window.location.pathname.toLowerCase().endsWith('.pdf') ||
    Boolean(document.querySelector('embed[type="application/pdf"], pdf-viewer'));

  if (isPdf) {
    try {
      chrome.runtime.sendMessage({ type: 'GBL_OVERLAY_BLOCKED' }).catch(() => undefined);
    } catch {
      /* ignore */
    }
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Inline styles on the host itself, before the shadow root, so a page rule
  // like `div { position: static !important }` cannot dislodge the frame.
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('top', '0', 'important');
  host.style.setProperty('left', '0', 'important');
  host.style.setProperty('width', '100vw', 'important');
  host.style.setProperty('height', '100vh', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('margin', '0', 'important');
  host.style.setProperty('padding', '0', 'important');
  host.style.setProperty('border', '0', 'important');
  host.style.setProperty('background', 'transparent', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: ${MARGIN}px;
      top: 24px;
      width: ${SIZES.panel.width}px;
      height: ${SIZES.panel.height}px;
      border-radius: ${SIZES.panel.radius}px;
      overflow: hidden;
      pointer-events: auto;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.04) 40%, rgba(255, 255, 255, 0.01) 100%), rgba(14, 16, 24, 0.45);
      backdrop-filter: blur(36px) saturate(190%) brightness(108%);
      -webkit-backdrop-filter: blur(36px) saturate(190%) brightness(108%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow:
        0 24px 70px -10px rgba(0, 0, 0, 0.55),
        0 0 25px rgba(255, 255, 255, 0.12),
        inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.55),
        inset 0 -1px 1px 0 rgba(0, 0, 0, 0.25);
      transition:
        width 240ms cubic-bezier(0.16, 1, 0.3, 1),
        height 240ms cubic-bezier(0.16, 1, 0.3, 1),
        border-radius 240ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 240ms ease,
        transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
      will-change: width, height, left, top;
    }
    .wrap[data-view='pill'] {
      width: ${SIZES.pill.width}px;
      height: ${SIZES.pill.height}px;
      border-radius: ${SIZES.pill.radius}px;
    }
    .wrap[data-view='panel'] {
      width: ${SIZES.panel.width}px;
      height: ${SIZES.panel.height}px;
      border-radius: ${SIZES.panel.radius}px;
    }
    .wrap[data-view='expanded'] {
      width: min(${SIZES.expanded.width}px, calc(100vw - 32px)) !important;
      height: min(${SIZES.expanded.height}px, calc(100vh - 44px)) !important;
      border-radius: ${SIZES.expanded.radius}px;
    }
    .wrap.is-dragging {
      transition: none !important;
      user-select: none !important;
    }
    .wrap[data-view='orb'] {
      width: ${SIZES.orb.width}px;
      height: ${SIZES.orb.height}px;
      border-radius: ${SIZES.orb.radius}px;
    }
    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent !important;
      background-color: transparent !important;
    }
    @media (prefers-reduced-motion: reduce) {
      .wrap { transition: none; }
    }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.dataset.view = 'panel';

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('overlay.html');
  frame.title = 'Gemini Browser Live assistant';
  frame.setAttribute('allow', 'microphone');
  frame.allow = 'microphone';
  frame.setAttribute('allowtransparency', 'true');
  frame.style.setProperty('background', 'transparent', 'important');
  frame.style.setProperty('background-color', 'transparent', 'important');

  wrap.append(frame);
  shadow.append(style, wrap);
  if (document.body) {
    document.body.append(host);
  } else {
    document.documentElement.append(host);
  }

  const state: OverlayState = { view: 'panel', left: null, top: null };

  const applyGeometry = (): void => {
    const isExpanded = state.view === 'expanded';

    if (isExpanded) {
      // Maximize cleanly over the browser tab with an elegant 16px frosted glass margin
      wrap.style.setProperty('left', '16px', 'important');
      wrap.style.setProperty('top', '16px', 'important');
      wrap.style.setProperty('right', '16px', 'important');
      wrap.style.setProperty('bottom', '16px', 'important');
      wrap.style.setProperty('width', 'calc(100vw - 32px)', 'important');
      wrap.style.setProperty('height', 'calc(100vh - 32px)', 'important');
      wrap.style.setProperty('border-radius', '24px', 'important');
      return;
    }

    // Normal view: compact floating panel
    wrap.style.setProperty('width', `${SIZES.panel.width}px`, 'important');
    wrap.style.setProperty('height', `${SIZES.panel.height}px`, 'important');
    wrap.style.setProperty('border-radius', `${SIZES.panel.radius}px`, 'important');
    wrap.style.removeProperty('bottom');

    if (state.left === null || state.top === null) {
      wrap.style.removeProperty('left');
      wrap.style.setProperty('top', '24px', 'important');
      wrap.style.setProperty('right', `${MARGIN}px`, 'important');
      return;
    }

    const maxLeft = Math.max(16, (window.innerWidth || 1200) - SIZES.panel.width - 16);
    const maxTop = Math.max(16, (window.innerHeight || 800) - SIZES.panel.height - 16);
    state.left = clamp(state.left, 16, maxLeft);
    state.top = clamp(state.top, 16, maxTop);
    wrap.style.setProperty('left', `${state.left}px`, 'important');
    wrap.style.setProperty('top', `${state.top}px`, 'important');
    wrap.style.removeProperty('right');
  };

  // Synchronize overlay position across all tabs
  try {
    const storageArea =
      typeof chrome !== 'undefined' && chrome.storage?.local
        ? chrome.storage.local
        : typeof chrome !== 'undefined' && chrome.storage?.session
          ? chrome.storage.session
          : null;

    if (storageArea) {
      void storageArea
        .get(POSITION_KEY)
        .then((data) => {
          const pos = data?.[POSITION_KEY];
          if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
            state.left = pos.left;
            state.top = pos.top;
            applyGeometry();
          }
        })
        .catch(() => undefined);

      chrome.storage?.onChanged?.addListener((changes) => {
        if (wrap.classList.contains('is-dragging')) return;
        if (changes[POSITION_KEY]) {
          const next = changes[POSITION_KEY].newValue;
          if (next && typeof next.left === 'number' && typeof next.top === 'number') {
            state.left = next.left;
            state.top = next.top;
            applyGeometry();
          }
        }
      });
    }
  } catch {
    /* ignore */
  }

  const postState = (): void => {
    frame.contentWindow?.postMessage({ source: 'gbl-host', type: 'state', view: state.view }, '*');
  };

  const setView = (view: OverlayView): void => {
    state.view = view;
    wrap.dataset.view = view;
    applyGeometry();
  };

  const remove = (): void => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', applyGeometry);
    host.remove();
    chrome.runtime.sendMessage({ type: 'GBL_CLOSE_OVERLAY' }).catch(() => undefined);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as HostMessage | null;
    if (!data || data.source !== 'gbl-overlay') return;

    switch (data.type) {
      case 'ready':
        postState();
        break;
      case 'view':
        if (isView(data.view)) {
          setView(data.view);
          postState();
        }
        break;
      case 'close':
        remove();
        break;
      case 'dragStart': {
        wrap.classList.add('is-dragging');
        const rect = wrap.getBoundingClientRect();
        state.left = rect.left;
        state.top = rect.top;
        break;
      }
      case 'drag': {
        const dx = Number(data.dx ?? 0);
        const dy = Number(data.dy ?? 0);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        state.left = (state.left ?? 0) + dx;
        state.top = (state.top ?? 0) + dy;
        applyGeometry();
        break;
      }
      case 'dragEnd': {
        wrap.classList.remove('is-dragging');
        applyGeometry();
        try {
          const storageArea =
            typeof chrome !== 'undefined' && chrome.storage?.local
              ? chrome.storage.local
              : typeof chrome !== 'undefined' && chrome.storage?.session
                ? chrome.storage.session
                : null;
          if (storageArea && state.left !== null && state.top !== null) {
            void storageArea
              .set({
                [POSITION_KEY]: { left: state.left, top: state.top },
              })
              .catch(() => undefined);
          }
        } catch {
          /* ignore */
        }
        break;
      }
      default:
        break;
    }
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('resize', applyGeometry);

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'GBL_SET_OVERLAY_VISIBLE') {
          host.style.display = msg.visible ? '' : 'none';
          if (msg.visible) applyGeometry();
        }
      });
    }
  } catch {
    /* ignore */
  }

  host.addEventListener('gbl-overlay-focus', () => {
    // A second request from the toolbar means "show me the assistant", so it
    // opens the full panel rather than leaving a pill the user may not notice.
    setView('panel');
  });

  applyGeometry();
}

mount();
