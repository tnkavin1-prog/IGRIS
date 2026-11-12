import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionExportPayload } from './types.js';
import { NOTES_DIR } from './runtime-paths.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || isNaN(ms)) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function sanitizeMarkdownCell(str: string): string {
  if (!str) return '-';
  return str.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

/**
 * Generate a comprehensive Markdown autonomous execution dossier
 */
export function generateAuditMarkdown(payload: SessionExportPayload): string {
  const task = payload.currentTask;
  const totalSteps = task?.steps.length ?? 0;
  const completedSteps = task?.steps.filter((s) => s.status === 'completed').length ?? 0;
  const failedSteps = task?.steps.filter((s) => s.status === 'failed').length ?? 0;
  const totalDuration =
    task?.startedAt && task?.completedAt ? task.completedAt - task.startedAt : undefined;

  let md = `# 🛡️ Gematron Assistant Audit Dossier\n\n`;
  md += `> **System:** Gematron Assistant - Autonomous Agent v3.8  \n`;
  md += `> **Timestamp:** ${new Date().toLocaleString()}  \n`;
  md += `> **Context Window:** \`${payload.activeTabTitle || 'Desktop Workspace'}\`  \n\n`;

  // 1. Executive Mission Summary
  md += `## 1. Executive Summary\n\n`;
  md += `| Attribute | Details |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Mission Goal** | ${sanitizeMarkdownCell(task?.goal || 'Interactive Voice & Academic Session')} |\n`;
  md += `| **Task ID** | \`${task?.id || 'N/A'}\` |\n`;
  md += `| **Status** | **${(task?.status || 'COMPLETED').toUpperCase()}** |\n`;
  md += `| **Total Steps** | ${totalSteps} (${completedSteps} completed, ${failedSteps} failed) |\n`;
  md += `| **Execution Latency** | ${formatDuration(totalDuration)} |\n`;
  md += `| **Started At** | ${task?.startedAt ? new Date(task.startedAt).toISOString() : 'N/A'} |\n`;
  md += `| **Completed At** | ${task?.completedAt ? new Date(task.completedAt).toISOString() : 'N/A'} |\n\n`;

  // 2. Sub-steps Execution Matrix
  if (task && task.steps.length > 0) {
    md += `## 2. Autonomous Action Pipeline Execution Matrix\n\n`;
    md += `| # | Action Step | Action Type | Latency | Status | Details |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: | :--- |\n`;

    task.steps.forEach((st, idx) => {
      const stepLatency =
        st.startedAt && st.completedAt ? st.completedAt - st.startedAt : undefined;
      const statusIcon =
        st.status === 'completed'
          ? '✅ COMPLETED'
          : st.status === 'failed'
            ? '❌ FAILED'
            : st.status === 'running'
              ? '⚙️ RUNNING'
              : '⏳ PENDING';

      let details = '';
      if (st.params?.appName) details += `App: \`${st.params.appName}\` `;
      if (st.params?.command) details += `Cmd: \`${st.params.command}\` `;
      if (st.params?.url) details += `URL: \`${st.params.url}\` `;
      if (st.params?.x !== undefined && st.params?.y !== undefined)
        details += `Coord: (${st.params.x}, ${st.params.y}) `;
      if (st.error) details += `**Error:** ${st.error}`;
      if (!details) details = '-';

      const safeDesc = sanitizeMarkdownCell(st.description);
      const safeAction = sanitizeMarkdownCell(st.actionType);
      const safeDetails = sanitizeMarkdownCell(details);

      md += `| ${idx + 1} | ${safeDesc} | \`${safeAction}\` | ${formatDuration(stepLatency)} | ${statusIcon} | ${safeDetails} |\n`;
    });
    md += `\n`;
  }

  // 3. Captured Screenshots & Visual Verification
  if (payload.screenshots && payload.screenshots.length > 0) {
    md += `## 3. Visual Verification Artifacts (${payload.screenshots.length})\n\n`;
    payload.screenshots.forEach((shot, i) => {
      md += `### Artifact 3.${i + 1}: ${shot.title}\n`;
      md += `> **Captured At:** ${new Date(shot.timestamp).toLocaleTimeString()}  \n\n`;
      md += `![${shot.title}](data:${shot.mimeType || 'image/jpeg'};base64,${shot.base64Data})\n\n`;
    });
  }

  // 4. Visual Blackboard Derivations (if present)
  if (payload.blackboard) {
    md += `## 4. Visual Blackboard Derivation: ${payload.blackboard.title}\n\n`;
    if (payload.blackboard.latexFormula) {
      md += `### Governing Formulas\n\n$$\n${payload.blackboard.latexFormula}\n$$\n\n`;
    }
    if (payload.blackboard.steps && payload.blackboard.steps.length > 0) {
      md += `### Derivation Steps\n\n`;
      payload.blackboard.steps.forEach((s, idx) => {
        md += `${idx + 1}. ${s}\n`;
      });
      md += `\n`;
    }
    if (payload.blackboard.teachingNarration) {
      md += `### Insight Narration\n\n> ${payload.blackboard.teachingNarration}\n\n`;
    }
    if (payload.blackboard.svgMarkup) {
      md += `### SVG Chalkboard Geometry\n\n\`\`\`xml\n${payload.blackboard.svgMarkup}\n\`\`\`\n\n`;
    }
  }

  // 5. Full Interaction Audit Log
  md += `## 5. Dialogue & Action Telemetry Log\n\n`;
  const conversation = payload.conversation || [];
  for (const msg of conversation) {
    const timeStr = msg.at ? ` [${new Date(msg.at).toLocaleTimeString()}]` : '';
    if (msg.kind === 'user') {
      md += `### 👤 User${timeStr}:\n${msg.text}\n\n`;
    } else if (msg.kind === 'assistant') {
      md += `### ✦ Assistant${timeStr}:\n${msg.text}\n\n`;
    } else if (msg.kind === 'tool') {
      md += `*⚙️ Action Executed${timeStr}:* **${msg.title || msg.name || 'Tool'}**  \n`;
      if (msg.detail) md += `> \`${msg.detail}\`\n\n`;
    } else if (msg.kind === 'system') {
      md += `> ℹ️ **System Security Notice${timeStr}:** ${msg.title ? `[${msg.title}] ` : ''}${msg.text}\n\n`;
    }
  }

  return md;
}

/**
 * Generate a standalone high-tech HTML execution dossier
 */
export function generateAuditHtml(payload: SessionExportPayload): string {
  const task = payload.currentTask;
  const totalSteps = task?.steps.length ?? 0;
  const completedSteps = task?.steps.filter((s) => s.status === 'completed').length ?? 0;
  const failedSteps = task?.steps.filter((s) => s.status === 'failed').length ?? 0;
  const totalDuration =
    task?.startedAt && task?.completedAt ? task.completedAt - task.startedAt : undefined;

  const missionStatus = task?.status || 'completed';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gematron Dossier: ${escapeHtml(task?.goal || payload.blackboard?.title || 'Execution Audit')}</title>
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(255, 255, 255, 0.04);
      --card-border: rgba(255, 255, 255, 0.1);
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.35);
      --success: #10b981;
      --danger: #f43f5e;
      --warning: #f59e0b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 40px 24px;
      line-height: 1.6;
      max-width: 960px;
      margin: 0 auto;
    }
    .dossier-header {
      border-bottom: 2px solid var(--accent);
      padding-bottom: 20px;
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
    }
    .dossier-title h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #fff;
    }
    .dossier-title .sub {
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .status-badge {
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .status-badge.completed { background: rgba(16, 185, 129, 0.2); color: var(--success); border: 1px solid var(--success); }
    .status-badge.failed { background: rgba(244, 63, 94, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .status-badge.cancelled { background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid var(--warning); }
    .status-badge.running { background: rgba(56, 189, 248, 0.2); color: var(--accent); border: 1px solid var(--accent); }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      backdrop-filter: blur(10px);
    }
    .metric-card .num {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      font-family: monospace;
    }
    .metric-card .lbl {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    h2 {
      font-size: 18px;
      font-weight: 600;
      margin: 36px 0 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 8px;
    }
    .step-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
      background: var(--card-bg);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--card-border);
    }
    .step-table th, .step-table td {
      padding: 12px 14px;
      text-align: left;
      font-size: 13px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .step-table th {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .badge-latency {
      font-family: monospace;
      font-size: 11px;
      padding: 2px 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 4px;
      color: var(--accent);
    }

    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .gallery-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
    }
    .gallery-card img {
      width: 100%;
      height: auto;
      display: block;
      border-bottom: 1px solid var(--card-border);
    }
    .gallery-info {
      padding: 12px 14px;
      font-size: 12px;
    }

    .dialogue-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .dialogue-card.user { border-left: 3px solid #fff; }
    .dialogue-card.asst { border-left: 3px solid var(--accent); }
    .dialogue-card.tool { border-left: 3px solid var(--warning); background: rgba(245, 158, 11, 0.04); }
    .dialogue-card.system { border-left: 3px solid var(--danger); background: rgba(244, 63, 94, 0.04); }

    .chalk-frame {
      background: #000;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      justify-content: center;
      margin: 16px 0;
    }
    .chalk-frame svg { max-width: 100%; height: auto; }
    .formula-box {
      font-family: monospace;
      font-size: 15px;
      background: rgba(255, 255, 255, 0.06);
      border-left: 4px solid var(--accent);
      padding: 12px;
      border-radius: 6px;
      margin: 12px 0;
    }

    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .step-table, .metric-card, .dialogue-card { border-color: #ddd; background: #fff; }
      .dossier-title h1, .metric-card .num { color: #000; }
    }
  </style>
</head>
<body>
  <div class="dossier-header">
    <div class="dossier-title">
      <h1>${escapeHtml(task?.goal || payload.blackboard?.title || 'Autonomous Mission Audit')}</h1>
      <div class="sub">Gematron Assistant Audit Dossier</div>
    </div>
    <span class="status-badge ${missionStatus}">${missionStatus}</span>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="num">${formatDuration(totalDuration)}</div>
      <div class="lbl">Total Duration</div>
    </div>
    <div class="metric-card">
      <div class="num">${completedSteps} / ${totalSteps}</div>
      <div class="lbl">Steps Completed</div>
    </div>
    ${
      failedSteps > 0
        ? `<div class="metric-card"><div class="num" style="color:var(--danger);">${failedSteps}</div><div class="lbl">Steps Failed</div></div>`
        : ''
    }
    <div class="metric-card">
      <div class="num">${payload.screenshots?.length ?? 0}</div>
      <div class="lbl">Screenshots Verified</div>
    </div>
    <div class="metric-card">
      <div class="num">${escapeHtml(payload.activeTabTitle?.slice(0, 16) || 'Desktop')}</div>
      <div class="lbl">Active Environment</div>
    </div>
  </div>

  ${
    task && task.steps.length > 0
      ? `
  <h2>⚡ Pipeline Execution Matrix</h2>
  <table class="step-table">
    <thead>
      <tr>
        <th style="width: 40px;">#</th>
        <th>Description</th>
        <th>Action Type</th>
        <th>Latency</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${task.steps
        .map((s, idx) => {
          const lat = s.startedAt && s.completedAt ? s.completedAt - s.startedAt : undefined;
          return `<tr>
            <td>${idx + 1}</td>
            <td><strong>${escapeHtml(s.description)}</strong>${s.error ? `<br><small style="color:var(--danger);">${escapeHtml(s.error)}</small>` : ''}</td>
            <td><code>${escapeHtml(s.actionType)}</code></td>
            <td><span class="badge-latency">${formatDuration(lat)}</span></td>
            <td><span class="status-badge ${s.status}">${s.status}</span></td>
          </tr>`;
        })
        .join('')}
    </tbody>
  </table>`
      : ''
  }

  ${
    payload.screenshots && payload.screenshots.length > 0
      ? `
  <h2>📸 Visual Artifacts</h2>
  <div class="gallery-grid">
    ${payload.screenshots
      .map(
        (shot) => `
      <div class="gallery-card">
        <img src="data:${shot.mimeType || 'image/jpeg'};base64,${shot.base64Data}" alt="${escapeHtml(shot.title)}" />
        <div class="gallery-info">
          <strong>${escapeHtml(shot.title)}</strong><br>
          <small style="color:var(--text-muted);">${new Date(shot.timestamp).toLocaleTimeString()}</small>
        </div>
      </div>`,
      )
      .join('')}
  </div>`
      : ''
  }

  ${
    payload.blackboard
      ? `
  <h2>📐 Visual Blackboard Derivation: ${escapeHtml(payload.blackboard.title)}</h2>
  ${payload.blackboard.latexFormula ? `<div class="formula-box">$$ ${escapeHtml(payload.blackboard.latexFormula)} $$</div>` : ''}
  ${payload.blackboard.svgMarkup ? `<div class="chalk-frame">${payload.blackboard.svgMarkup}</div>` : ''}
  ${
    payload.blackboard.steps
      ? payload.blackboard.steps
          .map(
            (s, i) =>
              `<div class="dialogue-card"><strong>Step ${i + 1}:</strong> ${escapeHtml(s)}</div>`,
          )
          .join('')
      : ''
  }`
      : ''
  }

  <h2>💬 Dialogue & Telemetry Audit Log</h2>
  ${(payload.conversation || [])
    .map((m) => {
      let cardClass = 'dialogue-card';
      let prefix = '✦ Assistant';
      if (m.kind === 'user') {
        cardClass += ' user';
        prefix = '👤 User';
      } else if (m.kind === 'tool') {
        cardClass += ' tool';
        prefix = `⚙️ Action: ${escapeHtml(m.title || m.name || 'Tool')}`;
      } else if (m.kind === 'system') {
        cardClass += ' system';
        prefix = '🛡️ Security Barrier';
      } else {
        cardClass += ' asst';
      }
      return `<div class="${cardClass}"><strong>${prefix}:</strong><p style="margin-top:4px;">${escapeHtml(m.text || m.detail || '')}</p></div>`;
    })
    .join('')}
</body>
</html>`;
}

/**
 * Persist audit dossier files to disk in Markdown and HTML
 */
export function exportAuditSession(
  payload: SessionExportPayload,
  notesDir = NOTES_DIR,
): { ok: boolean; mdPath?: string; htmlPath?: string; filename?: string; error?: string } {
  try {
    if (!existsSync(notesDir)) {
      mkdirSync(notesDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const taskName =
      payload.currentTask?.goal ||
      payload.blackboard?.title ||
      payload.activeTabTitle ||
      'audit_dossier';
    const safeTitle =
      taskName
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase()
        .slice(0, 40)
        .replace(/^_+|_+$/g, '') || 'session';

    const baseFilename = `gematron_dossier_${safeTitle}_${timestamp}`;
    const mdPath = join(notesDir, `${baseFilename}.md`);
    const htmlPath = join(notesDir, `${baseFilename}.html`);

    const mdContent = generateAuditMarkdown(payload);
    const htmlContent = generateAuditHtml(payload);

    writeFileSync(mdPath, mdContent, 'utf8');
    writeFileSync(htmlPath, htmlContent, 'utf8');

    return {
      ok: true,
      mdPath,
      htmlPath,
      filename: baseFilename,
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
    };
  }
}
