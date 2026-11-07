/**
 * Tool-call orchestration: validate → inspect → approve → execute → verify →
 * report. This is the only place that decides whether an action needs consent.
 *
 * The model cannot grant itself permission. Page content cannot grant
 * permission. Only the user's click in the approval sheet can.
 */
import {
  ERROR_CODES,
  LIMITS,
  TOOL_BY_NAME,
  ToolError,
  assessActionRisk,
  validateToolArgs,
  type ApprovalRequest,
  type AppSettings,
  type LiveFunctionCall,
  type LiveFunctionResponse,
  type LiveModelSpec,
  type ToolDefinition,
  type ToolEntry,
} from '@gbl/shared';
import type { LiveSessionManager } from '../live/session-manager.js';
import type { ToolExecutor, ToolPreparation } from '../tools/executor.js';

const APPROVAL_TIMEOUT_MS = 120_000;
const EXECUTION_TIMEOUT_MS = 25_000;

const TOOL_TITLES: Record<string, string> = {
  get_browser_state: 'Inspect browser',
  get_active_tab: 'Active tab',
  list_tabs: 'List tabs',
  open_tab: 'Open tab',
  switch_tab: 'Switch tab',
  close_tab: 'Close tab',
  navigate_to_url: 'Navigate',
  go_back: 'Go back',
  go_forward: 'Go forward',
  reload_tab: 'Reload page',
  wait_for_navigation: 'Wait for page',
  get_current_url: 'Read URL',
  get_page_title: 'Read title',
  get_page_snapshot: 'Read page',
  read_visible_content: 'Read visible text',
  read_full_page_text: 'Read full text',
  extract_headings: 'Extract headings',
  extract_links: 'Extract links',
  extract_images: 'Extract images',
  find_text_on_page: 'Find text',
  find_element: 'Find element',
  get_element_state: 'Inspect element',
  get_page_structure: 'Page structure',
  extract_table_data: 'Extract table',
  click_element: 'Click',
  hover_element: 'Hover',
  scroll_page: 'Scroll',
  scroll_to_element: 'Scroll to element',
  type_text: 'Type',
  clear_input: 'Clear field',
  select_dropdown: 'Select option',
  set_checkbox: 'Set checkbox',
  press_key: 'Press key',
  focus_element: 'Focus element',
  wait_for_element: 'Wait for element',
  wait_for_text: 'Wait for text',
  submit_form: 'Submit form',
  capture_viewport: 'Capture viewport',
  describe_visible_page: 'Describe page',
  click_visual_target: 'Visual click',
  compare_page_states: 'Compare states',
  teach_visual_blackboard: 'Draw Blackboard',
  open_teaching_blackboard_tab: 'Open Blackboard Tab',
  search_google_images: 'Search images',
  open_image_result: 'Open image result',
  search_bookmarks: 'Search bookmarks',
  search_history: 'Search history',
  list_downloads: 'List downloads',
  download_link: 'Download file',
  cancel_download: 'Cancel download',
  set_zoom: 'Set zoom',
  find_official_document: 'Find document',
  download_verified_document: 'Download document',
  summarize_webpage: 'Summarize page',
};

export function toolTitle(name: string): string {
  return TOOL_TITLES[name] ?? name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface OrchestratorCallbacks {
  onToolStart: (entry: ToolEntry) => void;
  onToolUpdate: (entry: ToolEntry) => void;
  onSystem: (text: string, level?: 'info' | 'warn' | 'error') => void;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  cancelApproval?: (callId: string) => void;
}

export interface OrchestratorDeps {
  executor: ToolExecutor;
  session: () => LiveSessionManager | null;
  getSettings: () => AppSettings;
  model: () => LiveModelSpec;
  callbacks: OrchestratorCallbacks;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new ToolError(ERROR_CODES.TOOL_TIMEOUT, message, {
          hint: 'Re-observe the page before retrying.',
          retryable: true,
        }),
      );
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function hostOf(url: string | undefined): string {
  if (!url) return 'the page';
  try {
    return new URL(url).hostname || 'the page';
  } catch {
    return 'the page';
  }
}

function approvalDescription(
  tool: ToolDefinition,
  prep: ToolPreparation,
  args: Record<string, unknown>,
): string {
  const target = prep.target;
  const host = hostOf(prep.url);
  switch (tool.name) {
    case 'click_element':
      return `Click ${target ? `${target.role} “${target.name.slice(0, 120)}”` : 'an element'} on ${host}.`;
    case 'submit_form':
      return `Submit the form containing “${target?.name.slice(0, 100) ?? 'this field'}” on ${host}.`;
    case 'close_tab':
      return `Close the tab “${prep.detail ?? host}”.`;
    case 'download_link':
    case 'download_verified_document':
      return `Download a file from ${host}.`;
    case 'click_visual_target':
      return `Click ${target ? `${target.role} “${target.name.slice(0, 100)}”` : 'this point'} on ${host}.`;
    case 'press_key':
      return `Press ${String(args.key ?? 'a key')} ${target ? `on ${target.role} “${target.name.slice(0, 100)}”` : 'on the page'}.`;
    default:
      return `${toolTitle(tool.name)} on ${host}.`;
  }
}

function truncateResult(value: unknown, summary: string): unknown {
  const payload = { ok: true, summary, data: value };
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return { ok: true, summary, note: 'The tool result was not JSON-serializable.' };
  }
  if (json.length <= LIMITS.toolResponseChars) return payload;
  return {
    ok: true,
    summary,
    truncated: true,
    note: `The full result was ${json.length} characters. Ask for a narrower read (fewer elements, shorter text, or a specific element).`,
    preview: json.slice(0, 3_000),
  };
}

export class AgentOrchestrator {
  private readonly entries = new Map<string, ToolEntry>();
  private readonly cancelled = new Set<string>();
  private readonly aborters = new Map<string, AbortController>();
  private chain: Promise<void> = Promise.resolve();
  private toolRounds = 0;
  private disposed = false;

  constructor(private readonly deps: OrchestratorDeps) {}

  get roundsThisTurn(): number {
    return this.toolRounds;
  }

  beginUserTurn(): void {
    this.toolRounds = 0;
    this.cancelled.clear();
  }

  handleToolCalls(calls: LiveFunctionCall[]): void {
    if (this.disposed) return;
    this.chain = this.chain
      .then(async () => {
        for (const call of calls) {
          if (this.disposed) return;
          await this.handleCall(call);
        }
      })
      .catch((error) => {
        this.deps.callbacks.onSystem(`Tool queue failed: ${(error as Error).message}`, 'error');
      });
  }

  cancelToolCalls(ids: string[]): void {
    for (const id of ids) {
      this.cancelled.add(id);
      this.aborters.get(id)?.abort();
      this.aborters.delete(id);
      this.deps.callbacks.cancelApproval?.(id);
      const entry = this.entries.get(id);
      if (entry && entry.status === 'running') {
        this.updateEntry({ ...entry, status: 'cancelled', durationMs: Date.now() - entry.at });
      }
    }
  }

  private updateEntry(entry: ToolEntry): void {
    this.entries.set(entry.callId, entry);
    this.deps.callbacks.onToolUpdate(entry);
  }

  private sendResponse(call: LiveFunctionCall, response: LiveFunctionResponse['response']): void {
    const session = this.deps.session();
    if (!session) return;
    session.sendToolResponses([{ id: call.id, name: call.name, response }]);
  }

  private sendError(call: LiveFunctionCall, error: ToolError): void {
    this.sendResponse(call, {
      error: {
        message: error.message,
        code: error.code,
        ...(error.hint ? { hint: error.hint } : {}),
      },
    });
  }

  private async handleCall(call: LiveFunctionCall): Promise<void> {
    if (this.cancelled.has(call.id)) return;

    const settings = this.deps.getSettings();
    const model = this.deps.model();
    const tool = TOOL_BY_NAME.get(call.name);
    const title = toolTitle(call.name);

    if (!tool) {
      const error = new ToolError(ERROR_CODES.INVALID_ARGS, `Unknown tool "${call.name}".`, {
        retryable: false,
      });
      this.sendError(call, error);
      return;
    }

    if (!settings.browserControl || !model.toolCalling) {
      const error = new ToolError(
        ERROR_CODES.PERMISSION_DENIED,
        'Browser control is disabled for this session.',
        {
          hint: 'Ask the user to enable browser control in Settings and start a new session.',
          retryable: false,
        },
      );
      this.sendError(call, error);
      this.deps.callbacks.onSystem(
        'A tool call was refused because browser control is off.',
        'warn',
      );
      return;
    }

    if (this.toolRounds >= Math.max(1, settings.maxToolSteps)) {
      const error = new ToolError(
        ERROR_CODES.TOOL_TIMEOUT,
        `Tool step limit reached (${settings.maxToolSteps}).`,
        { hint: 'Summarise what you verified and ask the user how to continue.', retryable: false },
      );
      this.sendError(call, error);
      this.deps.callbacks.onSystem('Tool step limit reached for this turn.', 'warn');
      return;
    }
    this.toolRounds += 1;

    const entry: ToolEntry = {
      id: `tool_${crypto.randomUUID()}`,
      kind: 'tool',
      callId: call.id,
      name: call.name,
      title,
      status: 'running',
      at: Date.now(),
    };
    this.entries.set(call.id, entry);
    this.deps.callbacks.onToolStart(entry);

    const validation = validateToolArgs(tool.parameters, call.args ?? {});
    if (!validation.ok) {
      const error = new ToolError(
        ERROR_CODES.INVALID_ARGS,
        `Invalid arguments: ${validation.errors.join('; ')}`,
        { hint: 'Correct the arguments and retry once.', retryable: true },
      );
      this.sendError(call, error);
      this.updateEntry({ ...entry, status: 'error', detail: error.message, durationMs: 0 });
      return;
    }

    const args = validation.value;
    let prep: ToolPreparation;
    try {
      prep = await this.deps.executor.prepare(call.name, args);
    } catch (error) {
      const toolError =
        error instanceof ToolError
          ? error
          : new ToolError(ERROR_CODES.INTERNAL, (error as Error).message, { retryable: true });
      this.sendError(call, toolError);
      this.updateEntry({
        ...entry,
        status: 'error',
        detail: toolError.message,
        durationMs: Date.now() - entry.at,
      });
      return;
    }

    if (prep.detail) {
      this.updateEntry({ ...entry, detail: prep.detail });
    }

    const assessment = this.assess(tool, prep, args, settings);
    if (assessment.level === 'blocked') {
      const error = new ToolError(ERROR_CODES.USER_DENIED, 'This action is blocked by policy.', {
        hint: 'Ask the user to perform it manually.',
        retryable: false,
      });
      this.sendError(call, error);
      this.updateEntry({
        ...entry,
        status: 'denied',
        detail: assessment.reasons.join(' '),
        durationMs: 0,
      });
      return;
    }

    if (assessment.level === 'confirm') {
      if (this.cancelled.has(call.id)) return;
      const request: ApprovalRequest = {
        callId: call.id,
        toolName: tool.name,
        title,
        description: approvalDescription(tool, prep, args),
        ...(prep.detail ? { detail: prep.detail } : {}),
        risk: assessment.label,
        ...(prep.url ? { url: prep.url } : {}),
        ...(prep.previewDataUrl ? { previewDataUrl: prep.previewDataUrl } : {}),
      };
      const approved = await this.askApproval(request);
      if (!approved) {
        const error = new ToolError(ERROR_CODES.USER_DENIED, 'The user denied this action.', {
          hint: 'Do not retry. Ask what they would like instead.',
          retryable: false,
        });
        this.sendError(call, error);
        this.updateEntry({
          ...entry,
          status: 'denied',
          detail: assessment.reasons.join(' '),
          durationMs: Date.now() - entry.at,
        });
        return;
      }
    }

    if (this.cancelled.has(call.id)) {
      this.updateEntry({ ...entry, status: 'cancelled', durationMs: Date.now() - entry.at });
      return;
    }

    const aborter = new AbortController();
    this.aborters.set(call.id, aborter);
    try {
      const execution = await withTimeout(
        this.deps.executor.execute(tool.name, prep.args, {
          callId: call.id,
          signal: aborter.signal,
          prep,
        }),
        EXECUTION_TIMEOUT_MS,
        'The browser operation exceeded its deadline.',
      );
      if (this.cancelled.has(call.id)) {
        this.updateEntry({ ...entry, status: 'cancelled', durationMs: Date.now() - entry.at });
        return;
      }
      this.sendResponse(call, { result: truncateResult(execution.data, execution.summary) });
      if (execution.postImage) {
        const session = this.deps.session();
        if (session) {
          const { base64, prompt } = execution.postImage;
          window.setTimeout(() => {
            session.sendImage(base64, prompt);
          }, 280);
        }
      }
      this.updateEntry({
        ...entry,
        status: 'ok',
        detail: execution.detail ?? prep.detail,
        durationMs: Date.now() - entry.at,
      });
    } catch (error) {
      const toolError =
        error instanceof ToolError
          ? error
          : new ToolError(ERROR_CODES.INTERNAL, (error as Error).message.slice(0, 300), {
              retryable: true,
            });
      this.sendError(call, toolError);
      this.updateEntry({
        ...entry,
        status: 'error',
        detail: toolError.message,
        durationMs: Date.now() - entry.at,
      });
      this.deps.callbacks.onSystem(`${title}: ${toolError.message}`, 'error');
    } finally {
      this.aborters.delete(call.id);
    }
  }

  private assess(
    tool: ToolDefinition,
    prep: ToolPreparation,
    args: Record<string, unknown>,
    settings: AppSettings,
  ): ReturnType<typeof assessActionRisk> {
    // Autonomous Mode: When autoApprove is true, execute all actions by itself without approval prompts
    if (settings.autoApprove) {
      return { level: 'none', reasons: [], label: 'Allowed' };
    }

    if (tool.approval === 'always') {
      return assessActionRisk({
        toolName: tool.name,
        confirmRisky: true,
        ...(prep.riskText ? { targetText: prep.riskText } : {}),
        ...(prep.target?.role ? { targetRole: prep.target.role } : {}),
        ...(prep.target?.type ? { targetType: prep.target.type } : {}),
        ...(prep.inForm !== undefined ? { inForm: prep.inForm } : {}),
        ...(prep.isSubmitLike !== undefined ? { isSubmitLike: prep.isSubmitLike } : {}),
        ...(prep.url ? { url: prep.url } : {}),
      });
    }

    if (tool.approval === 'conditional') {
      const isChatOrSearch =
        /chat|ask|search|prompt|query|message|input|textarea|^send$/i.test(
          prep.target?.name ?? '',
        ) ||
        /chat|search|ask|query|prompt|^send$/i.test(prep.riskText ?? '') ||
        prep.target?.type === 'search' ||
        prep.target?.role === 'combobox' ||
        prep.target?.role === 'searchbox';

      if (isChatOrSearch) {
        return { level: 'none', reasons: [], label: 'Allowed' };
      }

      const assessment = assessActionRisk({
        toolName: tool.name,
        confirmRisky: settings.confirmRisky,
        ...(prep.riskText ? { targetText: prep.riskText } : {}),
        ...(prep.target?.role ? { targetRole: prep.target.role } : {}),
        ...(prep.target?.type ? { targetType: prep.target.type } : {}),
        ...(prep.inForm !== undefined ? { inForm: prep.inForm } : {}),
        ...(prep.isSubmitLike !== undefined ? { isSubmitLike: prep.isSubmitLike } : {}),
        ...(prep.url ? { url: prep.url } : {}),
      });

      if (
        tool.name === 'press_key' &&
        String(args.key ?? '').toLowerCase() === 'enter' &&
        prep.inForm &&
        !isChatOrSearch
      ) {
        return {
          level: 'confirm',
          reasons: ['Enter submits the containing form.'],
          label: 'Submit form',
        };
      }
      return assessment;
    }

    return { level: 'none', reasons: [], label: 'Proceed' };
  }

  private async askApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.disposed) return false;
    let timer = 0;
    try {
      const decision = await Promise.race([
        this.deps.callbacks.requestApproval(request),
        new Promise<boolean>((resolve) => {
          timer = window.setTimeout(() => {
            this.deps.callbacks.cancelApproval?.(request.callId);
            this.deps.callbacks.onSystem(
              'The approval request timed out; the action was not performed.',
              'warn',
            );
            resolve(false);
          }, APPROVAL_TIMEOUT_MS);
        }),
      ]);
      return decision;
    } finally {
      window.clearTimeout(timer);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [id, aborter] of this.aborters) {
      aborter.abort();
      this.deps.callbacks.cancelApproval?.(id);
    }
    this.aborters.clear();
    this.cancelled.clear();
  }
}
