import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  PRIMING_PROMPT,
  parseToolCalls,
  executeToolCalls,
  formatToolResults,
} from '../../scripts/lib/kimi-agent-core.mjs';

test('Kimi Agent Core - Tool Parsing & Execution Suite', async (t) => {
  await t.test('1. parseToolCalls correctly extracts tool blocks', () => {
    const sample = `
I need to check the files first:
[TOOL:LIST_DIR path="apps/desktop-hud"]
Now let me read the main file:
[TOOL:READ_FILE path="apps/desktop-hud/src/main/index.ts"]
And run git status:
[TOOL:RUN_COMMAND cmd="git status --short"]
And search for CompactHUD:
[TOOL:SEARCH query="CompactHUD"]
    `;

    const calls = parseToolCalls(sample);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].type, 'LIST_DIR');
    assert.equal(calls[0].param, 'apps/desktop-hud');
    assert.equal(calls[1].type, 'READ_FILE');
    assert.equal(calls[1].param, 'apps/desktop-hud/src/main/index.ts');
    assert.equal(calls[2].type, 'RUN_COMMAND');
    assert.equal(calls[2].param, 'git status --short');
    assert.equal(calls[3].type, 'SEARCH');
    assert.equal(calls[3].param, 'CompactHUD');
  });

  await t.test('2. parseToolCalls handles empty or non-tool messages', () => {
    assert.deepEqual(parseToolCalls(''), []);
    assert.deepEqual(parseToolCalls('Yes, I can access your files! What should we do?'), []);
  });

  await t.test('3. executeToolCalls handles LIST_DIR and READ_FILE', async () => {
    const calls = [
      { type: 'LIST_DIR', param: 'scripts/lib' },
      { type: 'READ_FILE', param: 'package.json' },
    ];

    const results = await executeToolCalls(calls, 'E:\\Gematron');
    assert.equal(results.length, 2);
    assert.equal(results[0].success, true);
    assert.ok(results[0].output.includes('context-packer.mjs'));

    assert.equal(results[1].success, true);
    assert.ok(results[1].output.includes('gemini-browser-live'));
  });

  await t.test('4. executeToolCalls security guard blocks path traversal', async () => {
    const calls = [{ type: 'READ_FILE', param: '../../Windows/System32/drivers/etc/hosts' }];

    const results = await executeToolCalls(calls, 'E:\\Gematron');
    assert.equal(results[0].success, false);
    assert.ok(
      results[0].output.includes('Security violation') || results[0].output.includes('traversal'),
    );
  });

  await t.test('5. executeToolCalls SEARCH finds matching tokens', async () => {
    const calls = [{ type: 'SEARCH', param: 'ModelSwitchboard' }];

    const results = await executeToolCalls(calls, 'E:\\Gematron');
    assert.equal(results[0].success, true);
    assert.ok(results[0].output.includes('ModelSwitchboard'));
  });

  await t.test('6. formatToolResults formats cleanly for Arena chat injection', () => {
    const toolResults = [
      { type: 'READ_FILE', param: 'notes/demo.txt', success: true, output: 'Hello from disk!' },
    ];
    const syncedFiles = [{ relativePath: 'apps/desktop-hud/src/renderer/CompactHUD.tsx' }];

    const formatted = formatToolResults(toolResults, syncedFiles);
    assert.ok(formatted.includes('[GEMATRON BRIDGE EXECUTION FEEDBACK]'));
    assert.ok(
      formatted.includes(
        'Successfully written & backed up: `apps/desktop-hud/src/renderer/CompactHUD.tsx`',
      ),
    );
    assert.ok(formatted.includes('Hello from disk!'));
  });
});
