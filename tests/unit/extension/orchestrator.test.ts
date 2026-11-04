// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  ERROR_CODES,
  ToolError,
  getModel,
  type AppSettings,
  type ApprovalRequest,
  type LiveFunctionResponse,
  type ToolEntry,
} from '@gbl/shared';
import { AgentOrchestrator } from '../../../apps/chrome-extension/src/agent/orchestrator.js';
import type {
  ToolExecution,
  ToolExecutor,
  ToolPreparation,
} from '../../../apps/chrome-extension/src/tools/executor.js';

const SUBMIT_PREP: ToolPreparation = {
  args: { ref: 'element_001' },
  url: 'https://example.com/apply',
  target: { ref: 'element_001', role: 'button', name: 'Submit application', tag: 'button' },
  riskText: 'Submit application',
  inForm: true,
  isSubmitLike: true,
  detail: 'Application form on example.com',
};

interface HarnessOptions {
  settings?: Partial<AppSettings>;
  prep?: ToolPreparation | ((name: string, args: Record<string, unknown>) => ToolPreparation);
  execute?: (
    name: string,
    args: Record<string, unknown>,
    context: { callId: string; signal?: AbortSignal; prep?: ToolPreparation },
  ) => Promise<ToolExecution>;
  approve?: boolean;
  prepareError?: Error;
  executeError?: Error;
}

function harness(options: HarnessOptions = {}) {
  const responses: LiveFunctionResponse[] = [];
  const approvals: ApprovalRequest[] = [];
  const entries = new Map<string, ToolEntry>();
  const system: Array<{ text: string; level: string }> = [];

  const sendToolResponses = vi.fn((batch: LiveFunctionResponse[]) => {
    responses.push(...batch);
  });
  const session = { sendToolResponses, sendImage: vi.fn() };

  const prepare = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (options.prepareError) throw options.prepareError;
    if (typeof options.prep === 'function') return options.prep(name, args);
    return options.prep ?? { args, url: 'https://example.com/page' };
  });

  const execute = vi.fn(
    async (
      name: string,
      args: Record<string, unknown>,
      context: { callId: string; signal?: AbortSignal; prep?: ToolPreparation },
    ) => {
      if (options.executeError) throw options.executeError;
      return options.execute
        ? options.execute(name, args, context)
        : { data: { changed: true }, summary: 'Done.' };
    },
  );

  const executor = { prepare, execute } as unknown as ToolExecutor;
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...options.settings };

  const requestApproval = vi.fn(async (request: ApprovalRequest) => {
    approvals.push(request);
    return options.approve ?? true;
  });

  const orchestrator = new AgentOrchestrator({
    executor,
    session: () => session as never,
    getSettings: () => settings,
    model: () => getModel(settings.modelId),
    callbacks: {
      onToolStart: (entry) => entries.set(entry.callId, entry),
      onToolUpdate: (entry) => entries.set(entry.callId, entry),
      onSystem: (text, level = 'info') => system.push({ text, level }),
      requestApproval,
      cancelApproval: vi.fn(),
    },
  });

  return {
    orchestrator,
    session,
    sendToolResponses,
    prepare,
    execute,
    approvals,
    entries,
    system,
    settings,
    responses,
  };
}

async function waitForResponses(
  session: { sendToolResponses: ReturnType<typeof vi.fn> },
  count: number,
): Promise<void> {
  await vi.waitFor(() => expect(session.sendToolResponses).toHaveBeenCalledTimes(count));
  await Promise.resolve();
}

describe('AgentOrchestrator', () => {
  it('rejects unknown tool names without preparing or executing anything', async () => {
    const test = harness();

    test.orchestrator.handleToolCalls([{ id: 'call-1', name: 'delete_everything', args: {} }]);
    await waitForResponses(test.session, 1);

    expect(test.responses[0]?.response.error?.code).toBe(ERROR_CODES.INVALID_ARGS);
    expect(test.responses[0]?.response.error?.message).toContain('Unknown tool');
    expect(test.prepare).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('refuses every tool when browser control is disabled', async () => {
    const test = harness({ settings: { browserControl: false } });

    test.orchestrator.handleToolCalls([{ id: 'call-1', name: 'get_browser_state', args: {} }]);
    await waitForResponses(test.session, 1);

    expect(test.responses[0]?.response.error?.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(test.prepare).not.toHaveBeenCalled();
    expect(test.system.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('validates arguments before any page interaction', async () => {
    const test = harness();

    test.orchestrator.handleToolCalls([{ id: 'call-1', name: 'navigate_to_url', args: {} }]);
    await waitForResponses(test.session, 1);

    expect(test.responses[0]?.response.error?.code).toBe(ERROR_CODES.INVALID_ARGS);
    expect(test.prepare).not.toHaveBeenCalled();
    expect(test.entries.get('call-1')?.status).toBe('error');
  });

  it('asks for approval before a form submission and honours a denial', async () => {
    const test = harness({ prep: SUBMIT_PREP, approve: false });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'submit_form', args: { ref: 'element_001' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.approvals).toHaveLength(1);
    expect(test.approvals[0]).toMatchObject({
      callId: 'call-1',
      toolName: 'submit_form',
      risk: 'Submit form',
    });
    expect(test.approvals[0]?.description).toContain('example.com');
    expect(test.approvals[0]?.detail).toBe('Application form on example.com');
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.responses[0]?.response.error?.code).toBe(ERROR_CODES.USER_DENIED);
    expect(test.entries.get('call-1')?.status).toBe('denied');
  });

  it('executes an approved action and returns the verified result', async () => {
    const test = harness({
      prep: SUBMIT_PREP,
      execute: async () => ({ data: { submitted: true }, summary: 'Submitted the application.' }),
    });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'submit_form', args: { ref: 'element_001' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.approvals).toHaveLength(1);
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.execute.mock.calls[0]?.[0]).toBe('submit_form');
    expect(test.execute.mock.calls[0]?.[1]).toEqual({ ref: 'element_001' });
    expect(test.responses[0]?.response.result).toEqual({
      ok: true,
      summary: 'Submitted the application.',
      data: { submitted: true },
    });
    expect(test.entries.get('call-1')).toMatchObject({ status: 'ok' });
    expect(typeof test.entries.get('call-1')?.durationMs).toBe('number');
  });

  it('forwards the approved preparation so the executor can re-check the page', async () => {
    const prepared: ToolPreparation = {
      args: { ref: 'element_002' },
      tabId: 7,
      pageUrl: 'https://example.com/checkout',
      documentId: 'doc-abc',
      target: { ref: 'element_002', role: 'button', name: 'Pay now', tag: 'button' },
      detail: 'Checkout on example.com',
    };
    const test = harness({ prep: prepared });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'click_element', args: { ref: 'element_002' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.execute).toHaveBeenCalledTimes(1);
    const context = test.execute.mock.calls[0]?.[2];
    expect(context).toMatchObject({
      callId: 'call-1',
      prep: { tabId: 7, documentId: 'doc-abc', pageUrl: 'https://example.com/checkout' },
    });
    expect(context?.signal).toBeInstanceOf(AbortSignal);
  });

  it('never silently skips the gate for a submit-like click, even when heuristics are off', async () => {
    const test = harness({
      settings: { confirmRisky: false },
      prep: {
        args: { ref: 'element_001' },
        target: { ref: 'element_001', role: 'button', name: 'Submit application', tag: 'button' },
        riskText: 'Submit application',
        isSubmitLike: true,
        inForm: true,
        url: 'https://example.com/apply',
      },
    });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'click_element', args: { ref: 'element_001' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.approvals).toHaveLength(1);
    expect(test.approvals[0]?.risk).toBe('Submit form');
    expect(test.execute).toHaveBeenCalledTimes(1);
  });

  it('lets a benign click through without prompting when heuristics are off', async () => {
    const test = harness({
      settings: { confirmRisky: false },
      prep: {
        args: { text: 'Read more' },
        target: { ref: 'element_002', role: 'button', name: 'Read more', tag: 'button' },
        riskText: 'Read more',
        isSubmitLike: false,
        inForm: false,
        url: 'https://example.com/article',
      },
    });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'click_element', args: { text: 'Read more' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.approvals).toHaveLength(0);
    expect(test.execute).toHaveBeenCalledTimes(1);
  });

  it('enforces the per-turn tool step ceiling and resets on a new user turn', async () => {
    const test = harness({ settings: { maxToolSteps: 1 } });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'get_current_url', args: {} },
      { id: 'call-2', name: 'get_page_title', args: {} },
    ]);
    await waitForResponses(test.session, 2);

    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.responses[0]?.response.result).toBeTruthy();
    expect(test.responses[1]?.response.error?.code).toBe(ERROR_CODES.TOOL_TIMEOUT);
    expect(test.responses[1]?.response.error?.message).toContain('step limit');

    test.orchestrator.beginUserTurn();
    test.orchestrator.handleToolCalls([{ id: 'call-3', name: 'get_current_url', args: {} }]);
    await waitForResponses(test.session, 3);

    expect(test.execute).toHaveBeenCalledTimes(2);
    expect(test.responses[2]?.response.result).toBeTruthy();
  });

  it('truncates oversized tool results instead of blowing the context window', async () => {
    const test = harness({
      execute: async () => ({ data: { text: 'x'.repeat(20_000) }, summary: 'Read a long page.' }),
    });

    test.orchestrator.handleToolCalls([{ id: 'call-1', name: 'get_page_snapshot', args: {} }]);
    await waitForResponses(test.session, 1);

    const result = test.responses[0]?.response.result as {
      ok: boolean;
      truncated?: boolean;
      preview?: string;
      note?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.preview).toHaveLength(3_000);
    expect(result.note).toContain('characters');
  });

  it('returns a typed, actionable error when execution fails', async () => {
    const test = harness({
      executeError: new ToolError(ERROR_CODES.ELEMENT_STALE, 'The element reference expired.', {
        hint: 'Call get_page_snapshot again.',
        retryable: true,
      }),
    });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'click_element', args: { ref: 'element_001' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.responses[0]?.response.error).toMatchObject({
      code: ERROR_CODES.ELEMENT_STALE,
      hint: 'Call get_page_snapshot again.',
    });
    expect(test.entries.get('call-1')?.status).toBe('error');
    expect(test.system.some((entry) => entry.level === 'error')).toBe(true);
  });

  it('reports a preparation failure without executing', async () => {
    const test = harness({
      prepareError: new ToolError(ERROR_CODES.ELEMENT_NOT_FOUND, 'No element matched.'),
    });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'click_element', args: { text: 'Missing' } },
    ]);
    await waitForResponses(test.session, 1);

    expect(test.responses[0]?.response.error?.code).toBe(ERROR_CODES.ELEMENT_NOT_FOUND);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('queues calls sequentially rather than executing them in parallel', async () => {
    let running = 0;
    let maxRunning = 0;
    const test = harness({
      execute: async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { data: {}, summary: 'ok' };
      },
    });

    test.orchestrator.handleToolCalls([
      { id: 'call-1', name: 'get_current_url', args: {} },
      { id: 'call-2', name: 'get_page_title', args: {} },
    ]);
    await waitForResponses(test.session, 2);

    expect(maxRunning).toBe(1);
  });
});
