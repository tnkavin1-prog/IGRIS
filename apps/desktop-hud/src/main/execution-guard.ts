/**
 * ExecutionGuard — exactly-once and serialized execution for voice tool calls.
 *
 * The voice model can issue the same mutating command several times within a
 * single turn (primary attempt, then "alternative approaches" after a failure,
 * or overlapping tools that perform the same side effect). Without a guard,
 * one spoken "open a new tab" can cascade into many tabs and browser windows.
 *
 * Three policies:
 *  - exactly-once: identical tool+args within a short window share one
 *    execution; late duplicates receive the original result, never a re-run.
 *  - serialized: input-mutating actions run one at a time so mouse/keyboard
 *    sequences can never interleave, but intentional repeats still execute.
 *  - passthrough: read-only tools execute immediately.
 */

export type ExecutionPolicy = 'exactly-once' | 'serialized' | 'passthrough';

export interface GuardedResult extends Record<string, unknown> {
  deduplicated?: boolean;
  dedupNote?: string;
}

const EXACTLY_ONCE_WINDOWS_MS: Record<string, number> = {
  browser_open_tab: 4000,
  open_youtube: 4000,
  navigate_to_url: 3000,
  launch_application: 5000,
  open_blender: 10000,
  download_scene: 10000,
  autonomous_goal: 10000,
  close_window: 3000,
  browser_close_tab: 3000,
  browser_duplicate_tab: 3000,
  browser_close_duplicates: 5000,
  tile_windows: 4000,
};

const SERIALIZED_TOOLS = new Set([
  'browser_click',
  'browser_fill_form',
  'browser_upload_files',
  'execute_application_skill',
  'computer_uia_invoke',
  'computer_uia_set_value',
  'computer_use_click',
  'computer_use_mouse_move',
  'computer_use_mouse_drag',
  'computer_use_scroll',
  'computer_use_type',
  'computer_use_hotkey',
  'press_key',
  'scroll_page',
  'click_element_by_text',
  'click_element_on_screen',
  'find_text_on_screen',
  'maximize_window',
  'minimize_window',
  'restore_window',
  'switch_active_window',
]);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export class ExecutionGuard {
  private inflight = new Map<string, Promise<Record<string, any>>>();
  private recent = new Map<string, { at: number; result: Record<string, any> }>();
  private inputChain: Promise<unknown> = Promise.resolve();

  public policyFor(toolName: string, args: Record<string, unknown>): ExecutionPolicy {
    if (toolName === 'manage_browser_tabs') {
      const action = String(args.action || '');
      return action === 'create' || action === 'close' ? 'exactly-once' : 'passthrough';
    }
    if (EXACTLY_ONCE_WINDOWS_MS[toolName] !== undefined) return 'exactly-once';
    if (SERIALIZED_TOOLS.has(toolName)) return 'serialized';
    return 'passthrough';
  }

  public async execute(
    toolName: string,
    args: Record<string, unknown>,
    fn: () => Promise<Record<string, any>>,
  ): Promise<GuardedResult> {
    const policy = this.policyFor(toolName, args);
    if (policy === 'passthrough') return fn();
    if (policy === 'serialized') return this.serialize(fn);
    return this.executeExactlyOnce(toolName, args, fn);
  }

  private serialize(fn: () => Promise<Record<string, any>>): Promise<GuardedResult> {
    const run = this.inputChain.then(fn, fn);
    this.inputChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async executeExactlyOnce(
    toolName: string,
    args: Record<string, unknown>,
    fn: () => Promise<Record<string, any>>,
  ): Promise<GuardedResult> {
    const windowMs = EXACTLY_ONCE_WINDOWS_MS[toolName] ?? 3000;
    const key = `${toolName}:${stableStringify(args)}`;

    const existing = this.inflight.get(key);
    if (existing) {
      const shared = await existing;
      return {
        ...shared,
        deduplicated: true,
        dedupNote:
          'An identical command was already in progress; its result was shared instead of executing a second time. Do NOT retry this command.',
      };
    }

    const cached = this.recent.get(key);
    if (cached && Date.now() - cached.at < windowMs) {
      return {
        ...cached.result,
        deduplicated: true,
        dedupNote:
          'An identical command already completed moments ago; the duplicate was suppressed. Do NOT retry this command.',
      };
    }

    const promise = fn();
    this.inflight.set(key, promise);
    try {
      const result = await promise;
      this.recent.set(key, { at: Date.now(), result });
      if (this.recent.size > 200) {
        const cutoff = Date.now() - 60000;
        for (const [k, v] of this.recent) {
          if (v.at < cutoff) this.recent.delete(k);
        }
      }
      return result;
    } finally {
      this.inflight.delete(key);
    }
  }

  public reset(): void {
    this.recent.clear();
    this.inputChain = Promise.resolve();
  }
}
