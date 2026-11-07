import type { ConversationEntry, VisualBlackboardLesson } from '@gbl/shared';

export interface SessionExportBundle {
  markdown: string;
  html: string;
  json: string;
  filenameBase: string;
}

export function buildSessionExportBundle(
  conversation: ConversationEntry[],
  blackboard: VisualBlackboardLesson | null,
  activeDomain?: string,
): SessionExportBundle {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dateFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const topic = blackboard?.topic || 'Academic Problem Solving & Study Session';
  const title = blackboard?.title || 'Gemini Academic Study Session';
  const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const filenameBase = `gemini_study_session_${safeTitle}_${timestamp.slice(0, 10)}`;

  // 1. Generate Markdown
  let md = `# ${title}\n\n`;
  md += `> **Academic Domain:** ${topic}  \n`;
  md += `> **Generated on:** ${dateFormatted}  \n`;
  if (activeDomain) md += `> **Source Context:** \`${activeDomain}\`  \n`;
  md += `> **Engine:** Gemini Tier-1 AI Academic Teacher & Visual Blackboard  \n\n`;
  md += `---\n\n`;

  if (blackboard) {
    md += `## 📐 Mathematical & Geometric Visual Derivation\n\n`;
    if (blackboard.latexFormula) {
      md += `### Governing Formulas\n\n`;
      md += `$$\n${blackboard.latexFormula}\n$$\n\n`;
    }
    if (blackboard.steps && blackboard.steps.length > 0) {
      md += `### Step-by-Step Proof & Derivation\n\n`;
      blackboard.steps.forEach((step, idx) => {
        md += `${idx + 1}. **Step ${idx + 1}:** ${step}\n`;
      });
      md += `\n`;
    }
    if (blackboard.teachingNarration) {
      md += `### 👨‍🏫 Teacher Insight & Intuition\n\n`;
      md += `> ${blackboard.teachingNarration}\n\n`;
    }
    if (blackboard.svgMarkup) {
      md += `### Chalkboard Diagram (SVG)\n\n`;
      md += `\`\`\`xml\n${blackboard.svgMarkup}\n\`\`\`\n\n`;
    }
    md += `---\n\n`;
  }

  md += `## 💬 Dialogue & Question Log\n\n`;
  for (const entry of conversation) {
    if (entry.kind === 'user') {
      md += `### 👤 Student Question:\n\n${entry.text}\n\n`;
    } else if (entry.kind === 'assistant') {
      md += `### ✦ Gemini Teacher Response:\n\n${entry.text}\n\n`;
    } else if (entry.kind === 'tool' && entry.status === 'ok') {
      md += `*⚙️ Action Executed: ${entry.title}${entry.detail ? ` (${entry.detail})` : ''}*\n\n`;
    }
  }

  md += `---\n*Saved and exported with Gemini Browser Live — Ready for GitHub, Google Drive, and Notion.*`;

  // 2. Generate Standalone HTML
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: rgba(14, 16, 24, 0.98); color: #ffffff; padding: 40px 20px; line-height: 1.6; max-width: 900px; margin: 0 auto; }
    h1 { color: #ffffff; border-bottom: 2px solid rgba(255, 255, 255, 0.2); padding-bottom: 12px; font-weight: 600; }
    h2 { color: #ffffff; margin-top: 32px; font-weight: 500; border-bottom: 1px solid rgba(255, 255, 255, 0.12); padding-bottom: 8px; }
    h3 { color: rgba(255, 255, 255, 0.9); font-weight: 500; }
    .meta-box { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 12px; padding: 16px; margin-bottom: 24px; color: rgba(255, 255, 255, 0.8); }
    .formula-card { background: rgba(255, 255, 255, 0.06); border-left: 4px solid #ffffff; padding: 14px 18px; border-radius: 8px; font-family: monospace; font-size: 15px; color: #ffffff; margin: 16px 0; border: 1px solid rgba(255, 255, 255, 0.1); border-left-width: 4px; }
    .step-card { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
    .step-num { font-weight: bold; color: #ffffff; margin-right: 8px; }
    .chalk-frame { background: rgba(10, 12, 18, 0.95); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 16px; padding: 16px; display: flex; justify-content: center; margin: 20px 0; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7); }
    .chalk-frame svg { max-width: 100%; height: auto; }
    .dialogue-card { background: rgba(255, 255, 255, 0.04); border-radius: 10px; padding: 14px; margin-bottom: 12px; border: 1px solid rgba(255, 255, 255, 0.1); }
    .user-dialogue { border-left: 3px solid rgba(255, 255, 255, 0.6); }
    .gemini-dialogue { border-left: 3px solid #ffffff; background: rgba(255, 255, 255, 0.07); }
    .badge { font-size: 11px; font-weight: bold; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; display: inline-block; margin-bottom: 6px; letter-spacing: 0.04em; }
    .badge-user { background: rgba(255, 255, 255, 0.15); color: #ffffff; }
    .badge-ai { background: rgba(255, 255, 255, 0.25); color: #ffffff; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta-box">
    <div><strong>Domain:</strong> ${topic}</div>
    <div><strong>Date:</strong> ${dateFormatted}</div>
    ${activeDomain ? `<div><strong>Context:</strong> ${activeDomain}</div>` : ''}
  </div>

  ${
    blackboard
      ? `
    <h2>📐 Mathematical & Visual Blackboard Derivation</h2>
    ${blackboard.latexFormula ? `<div class="formula-card">$$ ${blackboard.latexFormula} $$</div>` : ''}
    ${blackboard.svgMarkup ? `<div class="chalk-frame">${blackboard.svgMarkup}</div>` : ''}
    ${
      blackboard.steps && blackboard.steps.length > 0
        ? `
      <h3>Proof Steps</h3>
      ${blackboard.steps.map((s, i) => `<div class="step-card"><span class="step-num">Step ${i + 1}:</span> ${s}</div>`).join('')}
    `
        : ''
    }
    ${blackboard.teachingNarration ? `<div style="background:rgba(88,28,135,0.25);border:1px solid rgba(168,85,247,0.4);border-radius:8px;padding:14px;margin-top:16px;"><strong>👨‍🏫 Teacher Insight:</strong> ${blackboard.teachingNarration}</div>` : ''}
  `
      : ''
  }

  <h2>💬 Dialogue & Questions</h2>
  ${conversation
    .map((entry) => {
      if (entry.kind === 'user') {
        return `<div class="dialogue-card user-dialogue"><span class="badge badge-user">Student Question</span><p>${entry.text}</p></div>`;
      }
      if (entry.kind === 'assistant') {
        return `<div class="dialogue-card gemini-dialogue"><span class="badge badge-ai">Gemini Teacher</span><p>${entry.text}</p></div>`;
      }
      return '';
    })
    .join('')}
</body>
</html>`;

  // 3. Generate JSON
  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      title,
      topic,
      activeDomain,
      blackboard,
      conversation,
    },
    null,
    2,
  );

  return { markdown: md, html, json, filenameBase };
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
