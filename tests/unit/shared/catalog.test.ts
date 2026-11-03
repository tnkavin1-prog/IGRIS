import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MODEL_IDS,
  DEFAULT_MODEL_ID,
  DEFAULT_SETTINGS,
  LIVE_CLOSE_REASONS,
  LIVE_MODELS,
  TOOLS,
  TOOL_BY_NAME,
  buildFunctionDeclarations,
  getModel,
  isKnownModel,
  isToolName,
  toGeminiParameters,
  validateToolArgs,
} from '@gbl/shared';

describe('tool catalog', () => {
  it('contains exactly 52 tools with unique names', () => {
    expect(TOOLS).toHaveLength(52);
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(TOOL_BY_NAME.size).toBe(names.length);
  });

  it('documents every tool for the model', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(30);
      expect(tool.description, tool.name).not.toMatch(/TODO|FIXME/);
      expect([
        'navigation',
        'reading',
        'interaction',
        'visual',
        'images',
        'browser',
        'task',
      ]).toContain(tool.category);
      expect(['never', 'conditional', 'always']).toContain(tool.approval);
    }
  });

  it('keeps the approval policy explicit for consequential tools', () => {
    const always = TOOLS.filter((tool) => tool.approval === 'always')
      .map((tool) => tool.name)
      .sort();
    expect(always).toEqual([
      'cancel_download',
      'click_visual_target',
      'close_tab',
      'download_link',
      'download_verified_document',
      'submit_form',
    ]);
  });

  it('only assigns optional Chrome permissions to the tools that need them', () => {
    const permissions = new Set(
      TOOLS.flatMap((tool) => (tool.permission ? [tool.permission] : [])),
    );
    expect([...permissions].sort()).toEqual(['bookmarks', 'downloads', 'history']);
    // Read-only lookups may run without a confirmation prompt; anything that
    // writes to disk must always be approved.
    for (const tool of TOOLS) {
      if (tool.permission === 'downloads' && tool.name !== 'list_downloads') {
        expect(tool.approval, tool.name).toBe('always');
      }
    }
  });

  it('validates an empty argument object against every tool without throwing', () => {
    for (const tool of TOOLS) {
      const result = validateToolArgs(tool.parameters, {});
      expect(typeof result.ok, tool.name).toBe('boolean');
      if (!result.ok) {
        expect(result.errors.length, tool.name).toBeGreaterThan(0);
        expect(result.errors.length, tool.name).toBeLessThanOrEqual(8);
      }
    }
  });

  it('rejects unknown arguments for every tool', () => {
    for (const tool of TOOLS) {
      const result = validateToolArgs(tool.parameters, { __injected: 'x' });
      expect(result.ok, tool.name).toBe(false);
    }
  });

  it('builds Gemini declarations from the same catalog', () => {
    const declarations = buildFunctionDeclarations();
    expect(declarations).toHaveLength(TOOLS.length);
    for (const [index, declaration] of declarations.entries()) {
      const tool = TOOLS[index]!;
      expect(declaration.name).toBe(tool.name);
      expect(declaration.description).toBe(tool.description);
      expect(declaration.behavior).toBe('NON_BLOCKING');
      expect(declaration.parameters).toEqual(toGeminiParameters(tool.parameters));
    }
  });

  it('exposes a name guard for untrusted model output', () => {
    expect(isToolName('get_page_snapshot')).toBe(true);
    expect(isToolName('drop_database')).toBe(false);
    expect(isToolName('')).toBe(false);
  });
});

describe('model registry', () => {
  it('keeps the verified agent model as the default', () => {
    expect(DEFAULT_MODEL_ID).toBe('gemini-3.8-live');
    expect(getModel(undefined).id).toBe(DEFAULT_MODEL_ID);
    expect(getModel('not-a-model').id).toBe(DEFAULT_MODEL_ID);
    expect(DEFAULT_SETTINGS.modelId).toBe(DEFAULT_MODEL_ID);
  });

  it('marks only the fast model as tool-capable', () => {
    const fast = getModel('gemini-3.8-live');
    const extended = getModel('gemini-3.8-live-extended-thinking');
    expect(fast.toolCalling).toBe(true);
    expect(fast.requiresThinkingLevel).toBe(false);
    expect(fast.supportsScheduling).toBe(true);
    expect(extended.toolCalling).toBe(false);
    expect(extended.requiresThinkingLevel).toBe(true);
    expect(extended.supportsScheduling).toBe(false);
    expect(extended.defaultThinkingLevel).toBe('MEDIUM');
  });

  it('offers the bridge exactly the models it can mint', () => {
    expect(ALLOWED_MODEL_IDS).toEqual(LIVE_MODELS.map((model) => model.id));
    expect(ALLOWED_MODEL_IDS).toHaveLength(2);
    for (const id of ALLOWED_MODEL_IDS) expect(isKnownModel(id)).toBe(true);
    expect(isKnownModel('gemini-2.0-flash')).toBe(false);
  });

  it('gives every close code an operator-facing explanation', () => {
    for (const code of [1000, 1006, 1007, 1011, 4000, 4001, 4003, 4290]) {
      expect(LIVE_CLOSE_REASONS[code]).toBeTruthy();
    }
  });
});
