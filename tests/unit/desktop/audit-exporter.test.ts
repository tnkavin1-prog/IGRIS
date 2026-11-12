import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateAuditMarkdown,
  generateAuditHtml,
  exportAuditSession,
} from '../../../apps/desktop-hud/src/main/audit-exporter.js';
import type { SessionExportPayload } from '../../../apps/desktop-hud/src/main/types.js';

describe('Audit Exporter', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'gemetron-audit-test-'));
  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  const mockPayload: SessionExportPayload = {
    conversation: [
      {
        id: 'msg_1',
        kind: 'user',
        text: 'Jarvis, execute the quantum simulation verification workflow.',
        at: Date.now() - 5000,
      },
      {
        id: 'msg_2',
        kind: 'assistant',
        text: 'Executing multi-step autonomous plan for quantum simulation.',
        at: Date.now() - 4000,
      },
      {
        id: 'msg_3',
        kind: 'tool',
        name: 'computer_screenshot',
        title: 'Capture Desktop Viewport',
        detail: 'Captured 1920x1080 display buffer',
        at: Date.now() - 3000,
      },
      {
        id: 'msg_4',
        kind: 'system',
        text: 'Action verified against safety policy boundary.',
        at: Date.now() - 2000,
      },
    ],
    blackboard: {
      id: 'bb_1',
      title: 'Schrödinger Hamiltonian Evolution',
      diagramType: 'formula',
      latexFormula: 'i\\hbar \\frac{\\partial}{\\partial t} \\Psi(x, t) = \\hat{H} \\Psi(x, t)',
      svgMarkup: '<svg></svg>',
      steps: [
        'Initialize state vector Psi in Hilbert space',
        'Apply unitary time-evolution operator U(t) = exp(-iHt/hbar)',
        'Compute projective measurement expectation values',
      ],
      createdAt: Date.now() - 1000,
    },
    currentTask: {
      id: 'task_exec_999',
      goal: 'Autonomous Quantum Wavefunction Verification',
      status: 'completed',
      startedAt: Date.now() - 15000,
      completedAt: Date.now(),
      steps: [
        {
          id: 'step_1',
          description: 'Launch scientific workspace',
          actionType: 'launch_app',
          params: { appName: 'notepad.exe' },
          status: 'completed',
          startedAt: Date.now() - 14000,
          completedAt: Date.now() - 12000,
        },
        {
          id: 'step_2',
          description: 'Click primary experiment coordinate',
          actionType: 'computer_click',
          params: { x: 960, y: 540 },
          status: 'completed',
          startedAt: Date.now() - 11000,
          completedAt: Date.now() - 9500,
        },
        {
          id: 'step_3',
          description: 'Type experiment configuration data',
          actionType: 'computer_type',
          params: { text: 'Psi_0 = |0>' },
          status: 'completed',
          startedAt: Date.now() - 9000,
          completedAt: Date.now() - 8000,
        },
      ],
    },
    screenshots: [
      {
        id: 'shot_1',
        title: 'Initial State Viewport',
        base64Data:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        timestamp: Date.now() - 10000,
      },
    ],
    telemetrySummary: {
      totalInputEvents: 14,
      totalScreenshotsTaken: 2,
      activeWindowsDetected: 3,
    },
  };

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // cleanup generated test files
  });

  it('generates rich Markdown dossier with executive summary and steps matrix', () => {
    const md = generateAuditMarkdown(mockPayload);

    expect(md).toContain('# 🛡️ Gematron Assistant Audit Dossier');
    expect(md).toContain('Autonomous Quantum Wavefunction Verification');
    expect(md).toContain('`task_exec_999`');
    expect(md).toContain('**COMPLETED**');

    // Steps matrix table
    expect(md).toContain('Launch scientific workspace');
    expect(md).toContain('`launch_app`');
    expect(md).toContain('✅ COMPLETED');
    expect(md).toContain('Coord: (960, 540)');

    // Visual artifacts & base64 image
    expect(md).toContain('Visual Verification Artifacts (1)');
    expect(md).toContain('data:image/png;base64,iVBOR');

    // Blackboard derivation
    expect(md).toContain('Visual Blackboard Derivation: Schrödinger Hamiltonian Evolution');
    expect(md).toContain('i\\hbar \\frac{\\partial}{\\partial t}');
    expect(md).toContain('Initialize state vector Psi in Hilbert space');

    // Dialogue history
    expect(md).toContain('👤 User');
    expect(md).toContain('✦ Assistant');
    expect(md).toContain('⚙️ Action Executed');
    expect(md).toContain('System Security Notice');
  });

  it('generates cyber-themed standalone HTML report with responsive styling', () => {
    const html = generateAuditHtml(mockPayload);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Gematron Assistant Audit Dossier');
    expect(html).toContain('Autonomous Quantum Wavefunction Verification');

    // Status badge and metric cards
    expect(html).toContain('status-badge completed');
    expect(html).toContain('Steps Completed</div>');
    expect(html).toContain('Total Duration</div>');

    // Table rows
    expect(html).toContain('Launch scientific workspace');
    expect(html).toContain('launch_app');

    // Screenshots
    expect(html).toContain('Initial State Viewport');
    expect(html).toContain('src="data:image/png;base64,iVBOR');

    // Mathematical Blackboard card
    expect(html).toContain('Schrödinger Hamiltonian Evolution');
    expect(html).toContain('Apply unitary time-evolution operator');

    // Dialogue log
    expect(html).toContain('dialogue-card user');
    expect(html).toContain('dialogue-card asst');
    expect(html).toContain('dialogue-card tool');
    expect(html).toContain('dialogue-card system');
  });

  it('persists Markdown and HTML dossiers to disk cleanly', () => {
    const result = exportAuditSession(mockPayload, testDir);

    expect(result.ok).toBe(true);
    expect(result.mdPath).toBeDefined();
    expect(result.htmlPath).toBeDefined();
    expect(result.filename).toBeDefined();

    expect(existsSync(result.mdPath!)).toBe(true);
    expect(existsSync(result.htmlPath!)).toBe(true);

    const mdContent = readFileSync(result.mdPath!, 'utf8');
    expect(mdContent).toContain('Autonomous Quantum Wavefunction Verification');

    const htmlContent = readFileSync(result.htmlPath!, 'utf8');
    expect(htmlContent).toContain('<!DOCTYPE html>');

    // Clean up
    try {
      unlinkSync(result.mdPath!);
      unlinkSync(result.htmlPath!);
    } catch {}
  });

  it('handles empty or minimal payloads without throwing errors', () => {
    const minimalPayload: SessionExportPayload = {
      conversation: [],
      blackboard: null,
    };

    const md = generateAuditMarkdown(minimalPayload);
    expect(md).toContain('# 🛡️ Gematron Assistant Audit Dossier');

    const html = generateAuditHtml(minimalPayload);
    expect(html).toContain('Gematron Assistant Audit Dossier');

    const exportRes = exportAuditSession(minimalPayload, testDir);
    expect(exportRes.ok).toBe(true);

    try {
      if (exportRes.mdPath && existsSync(exportRes.mdPath)) unlinkSync(exportRes.mdPath);
      if (exportRes.htmlPath && existsSync(exportRes.htmlPath)) unlinkSync(exportRes.htmlPath);
    } catch {}
  });

  it('escapes pipe characters and collapses newlines to prevent markdown table corruption', () => {
    const payloadWithPipes: SessionExportPayload = {
      conversation: [],
      blackboard: null,
      currentTask: {
        id: 'task_pipe_1',
        goal: 'Goal with | pipe symbol',
        status: 'completed',
        startedAt: 1000,
        completedAt: 2000,
        steps: [
          {
            id: 'step_pipe',
            description: 'Run pipeline command with | pipe\nand newline',
            actionType: 'run_command',
            params: { command: 'Get-Process | Select-Object -First 5' },
            status: 'completed',
            startedAt: 1000,
            completedAt: 1500,
          },
        ],
      },
    };

    const md = generateAuditMarkdown(payloadWithPipes);
    expect(md).toContain('\\|');
    expect(md).toContain('Get-Process \\| Select-Object');

    // Find table rows
    const lines = md.split('\n');
    const tableRow = lines.find((l) => l.startsWith('| 1 |'));
    expect(tableRow).toBeDefined();

    // Verify unescaped pipe count is exactly 7 (forming 6 table columns: | # | Action Step | Action Type | Latency | Status | Details |)
    // Replace escaped pipes \| before counting
    const unescapedPipes = tableRow!.replace(/\\\|/g, '').split('|').length - 1;
    expect(unescapedPipes).toBe(7);
  });
});
