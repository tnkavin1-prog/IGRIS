/**
 * Kimi Live Agent Core
 * Core protocol parser, tool executor, and response formatter for bidirectional
 * web-to-local PC agent control between LMSYS Arena and E:\Gematron.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { validateAndResolvePath } from './code-syncer.mjs';

const execAsync = promisify(exec);

/**
 * System prompt injected to prime Kimi K3 as an active local PC agent on E:\Gematron.
 */
export const PRIMING_PROMPT = `[GEMATRON LIVE AGENT PROTOCOL ACTIVATED]
You are now directly connected to the user's Windows PC workstation at \`E:\\Gematron\` via the Gematron Live Bridge.

CRITICAL INSTRUCTIONS:
1. When the user asks "Can you access my local files?" or "Can you access E drive?", ALWAYS answer YES! Confirm enthusiastically that you have full real-time access to their E:\\Gematron workspace.
2. Whenever you need to explore files, inspect code, run terminal commands, or update files on E:\\Gematron, emit one or more tool blocks. The Gematron Live Bridge will intercept them, execute them on the user's PC, and send the real results back to you in this chat.

AVAILABLE TOOLS:
- List folder contents:
  [TOOL:LIST_DIR path="apps/desktop-hud"]
- Read a file:
  [TOOL:READ_FILE path="apps/desktop-hud/src/main/index.ts"]
- Search workspace files for text:
  [TOOL:SEARCH query="CompactHUD"]
- Run shell command inside E:\\Gematron:
  [TOOL:RUN_COMMAND cmd="git status"]
- Create or modify a file (wrap complete code inside standard fenced block with // FILE: header):
  \`\`\`ts
  // FILE: notes/example.ts
  export const hello = "world";
  \`\`\`
- Delete a file:
  \`\`\`text
  // DELETE_FILE: notes/old.txt
  \`\`\`

Acknowledge this activation by replying:
"Yes! I am connected to your E:\\Gematron workspace via the Gematron Live Bridge. I can browse your folders, read files, write code, run commands, and control your local system. What would you like me to do?"`;

/**
 * Unified regex pattern to extract tool calls in chronological appearance order
 */
const UNIFIED_TOOL_REGEX =
  /\[TOOL:(READ_FILE|LIST_DIR|SEARCH|RUN_COMMAND)\s+(?:(?:path|query|cmd)=)?["']?([^"'\]]+)["']?\]/gi;

/**
 * Parses all tool calls present in the assistant message text in order of appearance.
 *
 * @param {string} text - Raw message text
 * @returns {Array<{ type: string, param: string, raw: string }>}
 */
export function parseToolCalls(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const calls = [];
  UNIFIED_TOOL_REGEX.lastIndex = 0;

  let match;
  while ((match = UNIFIED_TOOL_REGEX.exec(text)) !== null) {
    const type = match[1].toUpperCase();
    const param = (match[2] || '').trim();
    if (param) {
      calls.push({
        type,
        param,
        raw: match[0],
      });
    }
  }

  return calls;
}

/**
 * Safely executes a list of tool calls on the local workstation.
 * Strict containment inside projectRoot (defaults to E:\Gematron).
 *
 * @param {Array<{ type: string, param: string }>} toolCalls
 * @param {string} [projectRoot=process.cwd()]
 * @returns {Promise<Array<{ type: string, param: string, success: boolean, output: string }>>}
 */
export async function executeToolCalls(toolCalls, projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const results = [];

  for (const call of toolCalls) {
    try {
      switch (call.type) {
        case 'READ_FILE': {
          const { resolved: fullPath, relative: safeRelPath } = validateAndResolvePath(
            root,
            call.param,
          );

          if (!fs.existsSync(fullPath)) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: `File not found: ${safeRelPath}`,
            });
            break;
          }

          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: `Path is a directory, not a file. Use LIST_DIR instead.`,
            });
            break;
          }

          // Cap single file read at 150KB
          const MAX_READ_BYTES = 150 * 1024;
          if (stats.size > MAX_READ_BYTES) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: `File size (${(stats.size / 1024).toFixed(1)} KB) exceeds 150 KB read limit.`,
            });
            break;
          }

          const content = fs.readFileSync(fullPath, 'utf8');
          results.push({
            type: call.type,
            param: call.param,
            success: true,
            output: content,
          });
          break;
        }

        case 'LIST_DIR': {
          let targetDir = root;
          if (call.param && call.param !== '.' && call.param !== '/') {
            const { resolved } = validateAndResolvePath(root, call.param);
            targetDir = resolved;
          }

          if (!fs.existsSync(targetDir)) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: `Directory not found: ${call.param}`,
            });
            break;
          }

          const entries = fs.readdirSync(targetDir, { withFileTypes: true });
          const formatted = entries
            .filter((e) => !['.git', 'node_modules', '.chrome-debug-profile'].includes(e.name))
            .map((e) => {
              if (e.isDirectory()) return `${e.name}/`;
              return e.name;
            })
            .sort((a, b) => {
              const aIsDir = a.endsWith('/');
              const bIsDir = b.endsWith('/');
              if (aIsDir && !bIsDir) return -1;
              if (!aIsDir && bIsDir) return 1;
              return a.localeCompare(b);
            });

          results.push({
            type: call.type,
            param: call.param,
            success: true,
            output: formatted.length > 0 ? formatted.join('\n') : '(empty directory)',
          });
          break;
        }

        case 'SEARCH': {
          const query = call.param.toLowerCase().trim();
          if (!query || query.length < 2) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: 'Search query must be at least 2 characters.',
            });
            break;
          }

          const matches = [];
          const MAX_MATCHES = 20;

          function searchRecursive(dir, relPrefix = '') {
            if (matches.length >= MAX_MATCHES) return;
            let entries;
            try {
              entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }

            for (const entry of entries) {
              if (matches.length >= MAX_MATCHES) break;
              if (
                ['.git', 'node_modules', 'dist', '.chrome-debug-profile', 'backups'].includes(
                  entry.name,
                )
              ) {
                continue;
              }

              const relPath = path.join(relPrefix, entry.name).replace(/\\/g, '/');
              const fullPath = path.join(dir, entry.name);

              if (entry.isDirectory()) {
                searchRecursive(fullPath, relPath);
              } else if (entry.isFile()) {
                // Check filename match
                if (entry.name.toLowerCase().includes(query)) {
                  matches.push(`${relPath} (filename match)`);
                } else {
                  // Check file contents (text files only)
                  try {
                    const stats = fs.statSync(fullPath);
                    if (stats.size < 100 * 1024) {
                      const text = fs.readFileSync(fullPath, 'utf8');
                      const lines = text.split('\n');
                      for (let i = 0; i < lines.length; i++) {
                        if (lines[i].toLowerCase().includes(query)) {
                          matches.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
                          if (matches.length >= MAX_MATCHES) break;
                        }
                      }
                    }
                  } catch {
                    // Unreadable/binary file: skip content search.
                  }
                }
              }
            }
          }

          searchRecursive(root);

          results.push({
            type: call.type,
            param: call.param,
            success: true,
            output:
              matches.length > 0
                ? matches.join('\n')
                : `No matches found for "${query}" in workspace.`,
          });
          break;
        }

        case 'RUN_COMMAND': {
          const cmd = call.param.trim();
          // Safety guard: reject destructive commands
          const lowerCmd = cmd.toLowerCase();
          if (
            lowerCmd.includes('rm -rf /') ||
            lowerCmd.includes('format ') ||
            lowerCmd.includes('del /f /s /q c:')
          ) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: 'Command rejected: high-risk destructive command blocked by security guard.',
            });
            break;
          }

          try {
            const { stdout, stderr } = await execAsync(cmd, {
              cwd: root,
              timeout: 30000,
              maxBuffer: 500 * 1024,
            });

            const out = (stdout || '') + (stderr ? `\n[STDERR]: ${stderr}` : '');
            results.push({
              type: call.type,
              param: call.param,
              success: true,
              output: out.trim() || '(Command completed with no output)',
            });
          } catch (cmdErr) {
            results.push({
              type: call.type,
              param: call.param,
              success: false,
              output: `Command failed: ${cmdErr.message}`,
            });
          }
          break;
        }

        default:
          results.push({
            type: call.type,
            param: call.param,
            success: false,
            output: `Unknown tool: ${call.type}`,
          });
      }
    } catch (err) {
      results.push({
        type: call.type,
        param: call.param,
        success: false,
        output: `Error executing ${call.type}: ${err.message}`,
      });
    }
  }

  return results;
}

/**
 * Formats tool execution results and file sync confirmations into a clean markdown
 * feedback response that gets injected back into Kimi's chatbox.
 *
 * @param {Array<{ type: string, param: string, success: boolean, output: string }>} toolResults
 * @param {Array<{ relativePath: string, isDelete?: boolean }>} syncedFiles
 * @returns {string} Formatted response string
 */
export function formatToolResults(toolResults = [], syncedFiles = []) {
  if (toolResults.length === 0 && syncedFiles.length === 0) {
    return '';
  }

  let text = '[GEMATRON BRIDGE EXECUTION FEEDBACK]\n';

  if (syncedFiles.length > 0) {
    text += '\n### Files Synchronized on E:\\Gematron:\n';
    for (const file of syncedFiles) {
      if (file.isDelete) {
        text += `- Deleted \`${file.relativePath}\` (backed up to backups/kimi-history/)\n`;
      } else {
        text += `- Successfully written & backed up: \`${file.relativePath}\`\n`;
      }
    }
  }

  if (toolResults.length > 0) {
    text += '\n### Tool Results:\n';
    for (const res of toolResults) {
      text += `\n#### ${res.type} ("${res.param}") [${res.success ? 'SUCCESS' : 'FAILED'}]:\n`;
      if (res.type === 'READ_FILE' && res.success) {
        const ext = path.extname(res.param).slice(1) || 'txt';
        text += `\`\`\`${ext}\n${res.output}\n\`\`\`\n`;
      } else {
        text += `\`\`\`\n${res.output}\n\`\`\`\n`;
      }
    }
  }

  text += '\nYou may now analyze these results and continue your response or next action.';
  return text.trim();
}
