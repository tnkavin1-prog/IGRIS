#!/usr/bin/env node
/**
 * lmarena.mjs - drive LMArena through the Chrome DevTools Protocol.
 *
 * Works against a Chrome started by scripts/chrome-launch.ps1 with
 * --remote-debugging-port=9222, so it needs no clicks, no focus and no
 * screenshots. That makes it immune to the focus-stealing problems that
 * plague pixel automation.
 *
 * Commands:
 *   node scripts/lmarena.mjs status
 *   node scripts/lmarena.mjs text
 *   node scripts/lmarena.mjs model "kimi-k3"
 *   node scripts/lmarena.mjs send "your prompt"       (waits for the reply)
 *   node scripts/lmarena.mjs save <file.md>
 *   node scripts/lmarena.mjs chat "<prompt>" <file.md>
 *
 * Exit codes: 0 ok, 1 error, 2 no page, 3 credits/limit detected
 */

const PORT = Number(process.env.CDP_PORT || 9222);
const HOST = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- CDP client
class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
      setTimeout(() => reject(new Error('ws timeout')), 10000);
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'cdp error'));
        else resolve(msg.result);
      }
    });
    return this;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 60000);
    });
  }

  /** Evaluate a JS expression in the page and return its value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    }
    return r.result?.value;
  }

  close() { try { this.ws.close(); } catch { } }
}

// ------------------------------------------------------------------- helpers
async function listTargets() {
  const res = await fetch(`${HOST}/json/list`);
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`);
  return res.json();
}

async function attach() {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === 'page');
  const want = process.env.CDP_TARGET;
  const page = want
    ? pages.find((p) => p.url.includes(want) || p.title.includes(want))
    : pages.find((p) => /arena\.ai/.test(p.url)) ||
      pages.find((p) => !/^(chrome|devtools|about)/.test(p.url)) ||
      pages[0];
  if (!page) throw Object.assign(new Error('no page target'), { code: 2 });
  const cdp = await new Cdp(page.webSocketDebuggerUrl).connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return { cdp, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Readable page text, trimmed. */
const READ_TEXT = `(() => {
  const t = document.body ? (document.body.innerText || document.body.textContent || '') : '';
  return t.replace(/\\n{3,}/g, '\\n\\n').trim();
})()`;

/** Describes the composer + model chip + any limit banner. */
const READ_STATE = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const body = clean(document.body ? (document.body.innerText || document.body.textContent || '') : '');
  const lower = body.toLowerCase();

  const ta = document.querySelector('textarea');
  const editable = document.querySelector('[contenteditable="true"]');
  const composer = ta || editable;

  const btns = [...document.querySelectorAll('button')].map((b) => ({
    label: clean(b.getAttribute('aria-label')),
    text: clean(b.textContent).slice(0, 40),
    disabled: !!b.disabled,
  }));

  const sendBtn = btns.find((b) => /send/i.test(b.label) || /^send/i.test(b.text));
  const stopBtn = btns.find((b) => /stop/i.test(b.label) || /^stop/i.test(b.text));

  const limitHits = [
    'usage limit', 'out of credits', 'no credits', 'credit limit',
    'reached your limit', 'upgrade to continue', 'quota',
  ].filter((k) => lower.includes(k));

  // The model chip usually sits next to the composer
  const chipTexts = [...document.querySelectorAll('button, [role="button"], [role="combobox"]')]
    .map((el) => clean(el.textContent))
    .filter((t) => t.length > 0 && t.length < 40);

  return {
    url: location.href,
    title: document.title,
    hasTextarea: !!ta,
    hasEditable: !!editable,
    composerKind: ta ? 'textarea' : (editable ? 'contenteditable' : 'none'),
    composerValue: composer ? (editorValue(composer)) : null,
    generating: !!stopBtn,
    hasSendButton: !!sendBtn,
    sendDisabled: sendBtn ? sendBtn.disabled : null,
    limitHit: limitHits.length > 0,
    limitTerms: limitHits,
    chips: chipTexts.filter((t, i, a) => a.indexOf(t) === i).slice(0, 40),
    bodyLen: body.length,
    bodyHead: body.slice(0, 600),
  };

  function editorValue(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
    return el.innerText;
  }
})()`;

/** Type text into the composer using the React-safe native setter. */
function typeScript(text) {
  return `(() => {
  const text = ${JSON.stringify(text)};
  const ta = document.querySelector('textarea');
  const editable = document.querySelector('[contenteditable="true"]');
  const el = ta || editable;
  if (!el) return { ok: false, why: 'no composer' };
  el.focus();
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  return { ok: true, len: text.length, kind: ta ? 'textarea' : 'contenteditable' };
})()`;
}

/** Press the send button, or fall back to Enter. */
const SEND_SCRIPT = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const btns = [...document.querySelectorAll('button')];
  const byLabel = btns.find((b) => /send message|^send$/i.test(clean(b.getAttribute('aria-label'))));
  const byType = btns.find((b) => (b.getAttribute('type') || '').toLowerCase() === 'submit');
  const target = byLabel || byType;
  if (target && !target.disabled) { target.click(); return { ok: true, via: 'button' }; }
  const el = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
  if (!el) return { ok: false, why: 'no composer' };
  el.focus();
  const ev = (type, key, code) => new KeyboardEvent(type, {
    key, code, bubbles: true, cancelable: true, keyCode: 13, which: 13,
  });
  el.dispatchEvent(ev('keydown', 'Enter', 'Enter'));
  el.dispatchEvent(ev('keypress', 'Enter', 'Enter'));
  el.dispatchEvent(ev('keyup', 'Enter', 'Enter'));
  return { ok: true, via: 'enter' };
})()`;

async function waitForReply(cdp, { timeoutMs = 240000, quietMs = 4000 } = {}) {
  const started = Date.now();
  let lastLen = -1;
  let lastChange = Date.now();
  let sawGenerating = false;

  while (Date.now() - started < timeoutMs) {
    const st = await cdp.eval(`(() => {
      const btns = [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label')||'') + ' ' + (b.textContent||''));
      const generating = btns.some(s => /stop/i.test(s));
      const body = document.body ? (document.body.innerText || document.body.textContent || '') : '';
      const lower = body.toLowerCase();
      const limited = ['usage limit','out of credits','no credits','credit limit','reached your limit','upgrade to continue']
        .some(k => lower.includes(k));
      return { generating, len: body.length, limited };
    })()`);

    if (st.limited) return { ok: false, limited: true };

    if (st.generating) {
      sawGenerating = true;
      lastChange = Date.now();
    } else {
      if (st.len !== lastLen) {
        lastLen = st.len;
        lastChange = Date.now();
      } else if (sawGenerating && Date.now() - lastChange > quietMs) {
        return { ok: true, limited: false };
      } else if (!sawGenerating && Date.now() - started > 12000 && Date.now() - lastChange > quietMs) {
        // never saw a stop button; assume it finished quickly
        return { ok: true, limited: false, note: 'no-generating-observed' };
      }
    }
    await sleep(600);
  }
  return { ok: false, timeout: true };
}

// -------------------------------------------------------------------- command
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const command = (cmd || 'status').toLowerCase();

  let cdp, page;
  try {
    ({ cdp, page } = await attach());
  } catch (e) {
    console.error(`error=no_page detail=${e.message}`);
    process.exit(2);
  }

  try {
    switch (command) {
      case 'status': {
        const st = await cdp.eval(READ_STATE);
        st.targetTitle = page.title;
        console.log(JSON.stringify(st, null, 2));
        process.exit(st.limitHit ? 3 : 0);
      }

      case 'text': {
        const t = await cdp.eval(READ_TEXT);
        console.log(t);
        process.exit(0);
      }

      case 'save': {
        const file = rest[0];
        if (!file) { console.error('usage: save <file>'); process.exit(1); }
        const t = await cdp.eval(READ_TEXT);
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
        await fs.writeFile(file, t, 'utf8');
        console.log(`saved=${file} chars=${t.length}`);
        process.exit(0);
      }

      case 'eval': {
        // Run arbitrary page JS: `eval "<expression>"` or `eval --file <path>`
        let src = rest[0];
        let waitMs = 0;
        if (src === '--file') {
          const fs = await import('node:fs/promises');
          src = await fs.readFile(rest[1], 'utf8');
          waitMs = Number(rest[2] || 0);
        } else if (src === '--wait') {
          waitMs = Number(rest[1] || 0);
          src = rest[2];
        }
        if (!src) { console.error('usage: eval "<js>"'); process.exit(1); }
        const r = await cdp.eval(src);
        if (waitMs) await sleep(waitMs);
        console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
        process.exit(0);
      }

      case 'goto': {
        const url = rest[0];
        if (!url) { console.error('usage: goto <url>'); process.exit(1); }
        await cdp.send('Page.navigate', { url });
        await sleep(Number(rest[1] || 5000));
        const st = await cdp.eval(`({ url: location.href, title: document.title, len: (document.body ? document.body.innerText.length : 0) })`);
        console.log(JSON.stringify(st, null, 2));
        process.exit(0);
      }

      case 'click': {
        // Real (trusted) mouse click on the first element whose text matches.
        const text = rest[0];
        if (!text) { console.error('usage: click "<text>"'); process.exit(1); }
        const rect = await cdp.eval(`(() => {
          const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
          const want = ${JSON.stringify(text)}.toLowerCase();
          const els = [...document.querySelectorAll('button,a,[role=button],[role=link]')];
          const el = els.find((e) => clean(e.textContent).toLowerCase() === want)
            || els.find((e) => clean(e.textContent).toLowerCase().includes(want));
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, label: clean(el.textContent).slice(0, 50) };
        })()`);
        if (!rect) { console.error(`error=not_found text=${text}`); process.exit(1); }
        const send = (type) => cdp.send('Input.dispatchMouseEvent', {
          type, x: rect.x, y: rect.y, button: 'left', clickCount: 1,
        });
        await send('mousePressed');
        await sleep(60);
        await send('mouseReleased');
        console.log(`clicked=${rect.label} at ${Math.round(rect.x)},${Math.round(rect.y)}`);
        await sleep(Number(rest[1] || 2500));
        process.exit(0);
      }

      case 'model': {
        const want = (rest[0] || '').toLowerCase();
        if (!want) { console.error('usage: model <name>'); process.exit(1); }
        // Click the chip that shows the current model, then the option matching `want`.
        const r = await cdp.eval(`(async () => {
          const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
          const want = ${JSON.stringify(want)};
          const clickables = [...document.querySelectorAll('button,[role="button"],[role="combobox"],[role="option"],[role="menuitem"]')];
          const current = clickables.find(el => clean(el.textContent).toLowerCase().includes(want));
          if (current && !document.querySelector('[role="listbox"]')) {
            current.click();
            await new Promise(r => setTimeout(r, 900));
          }
          const opts = [...document.querySelectorAll('[role="option"],[role="menuitem"],button')];
          const hit = opts.find(el => clean(el.textContent).toLowerCase().includes(want));
          if (hit) { hit.click(); await new Promise(r => setTimeout(r, 600)); return { ok: true, picked: clean(hit.textContent).slice(0,60) }; }
          return { ok: false, seen: opts.map(o => clean(o.textContent)).filter(Boolean).slice(0,30) };
        })()`);
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.ok ? 0 : 1);
      }

      case 'send':
      case 'chat': {
        const prompt = rest[0];
        if (!prompt) { console.error('usage: send "<prompt>"'); process.exit(1); }
        const outFile = command === 'chat' ? rest[1] : null;

        const typed = await cdp.eval(typeScript(prompt));
        if (!typed?.ok) { console.error(`error=${typed?.why}`); process.exit(1); }
        await sleep(400);

        const sent = await cdp.eval(SEND_SCRIPT);
        console.log(`sent_via=${sent?.via || 'unknown'}`);

        const res = await waitForReply(cdp);
        if (res.limited) {
          console.log('limited=1');
          const t = await cdp.eval(READ_TEXT);
          if (outFile) {
            const fs = await import('node:fs/promises');
            await fs.writeFile(outFile, t, 'utf8');
          }
          process.exit(3);
        }
        if (!res.ok) { console.error('error=reply_timeout'); process.exit(1); }

        const t = await cdp.eval(READ_TEXT);
        if (outFile) {
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
          await fs.writeFile(outFile, t, 'utf8');
          console.log(`saved=${outFile} chars=${t.length}`);
        }
        console.log('ok=1');
        process.exit(0);
      }

      default:
        console.error(`unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    cdp.close();
  }
}

main().catch((e) => {
  console.error(`fatal=${e.stack || e.message}`);
  process.exit(1);
});
