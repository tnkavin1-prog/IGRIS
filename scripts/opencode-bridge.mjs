#!/usr/bin/env node
/**
 * E:\Gematron\scripts\opencode-bridge.mjs
 *
 * Official Master Integration Bridge between Gemini (Master Brain) and OpenCode (Execution Engine).
 * Strictly enforces:
 *  - E: Drive project storage (E:\Gematron)
 *  - 100% Free OpenCode models (Zero cost, no OpenCode Go, no paid fallbacks)
 *  - DeepSeek V4.1 Flash (Backend/Logic/API)
 *  - GLM 5.3 Flash (Frontend/UI/SVG/Animations)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT =
  process.env.GEMATRON_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD_FILE = path.join(PROJECT_ROOT, 'logs', 'opencode-server-password.txt');
const SERVER_URL = process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096';

// Allowed verified free models
export const APPROVED_FREE_MODELS = {
  deepseek: {
    id: 'deepseek-v4.1-flash-free',
    providerID: 'opencode',
    name: 'DeepSeek V4.1 Flash Free',
    role: 'Backend Architecture, Logic, API, Database, Core Algorithms',
  },
  glm: {
    id: 'glm-5.3-flash-free',
    providerID: 'opencode',
    name: 'GLM-5.3-Flash Free',
    role: 'Frontend UI/UX, Component Architecture, React, SVG, Animations',
  },
  nemotron: {
    id: 'nemotron-3.5-lightning-free',
    providerID: 'opencode',
    name: 'Nemotron 3.5 Lightning Free',
    role: 'Fast Backend Logic, Systems Engineering, Test Generation',
  },
  mimo: {
    id: 'mimo-v2.6-flash-free',
    providerID: 'opencode',
    name: 'MiMo V2.6 Flash Free',
    role: 'Fast Architecture, Refactoring, Documentation',
  },
};

function getAuthHeader() {
  let password = process.env.OPENCODE_PASSWORD;
  if (!password && fs.existsSync(PASSWORD_FILE)) {
    password = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
  }
  if (!password) {
    throw new Error(`OpenCode server password not found in environment or ${PASSWORD_FILE}`);
  }
  const token = Buffer.from(`opencode:${password}`).toString('base64');
  return `Basic ${token}`;
}

async function request(endpoint, options = {}) {
  const url = `${SERVER_URL}${endpoint}`;
  const headers = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenCode API error ${res.status} on ${endpoint}: ${text}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }
  return await res.text();
}

/**
 * Check OpenCode server health and version
 */
export async function getInfo() {
  return await request('/api/info');
}

/**
 * List verified free models available in OpenCode
 */
export async function getVerifiedModels() {
  const raw = await request('/api/model');
  const allModels = raw.data || [];

  // Filter for approved free models only
  const freeModels = allModels.filter((m) => {
    // Strictly filter out OpenCode Go and paid providers
    if (m.providerID === 'opencode-go') return false;
    if (m.cost && Array.isArray(m.cost)) {
      const isFree = m.cost.every((c) => c.input === 0 && c.output === 0);
      if (!isFree) return false;
    }
    return m.id.endsWith('-free') || m.id.includes('free');
  });

  return freeModels;
}

/**
 * Execute a programming task via OpenCode with a verified free model
 */
export async function executeTask(options) {
  const {
    modelKey = 'nemotron',
    title = 'Gematron Task',
    prompt,
    agent = 'build',
    directory = PROJECT_ROOT,
    maxWaitSeconds = 600,
  } = typeof options === 'string' ? { prompt: options } : options;
  const modelConfig =
    APPROVED_FREE_MODELS[modelKey.toLowerCase()] ||
    Object.values(APPROVED_FREE_MODELS).find((m) => m.id === modelKey);

  if (!modelConfig) {
    throw new Error(
      `Model '${modelKey}' is not an authorized free model! Allowed: ${Object.keys(APPROVED_FREE_MODELS).join(', ')}`,
    );
  }

  console.log(`[OpenCode Bridge] Initializing task with ${modelConfig.name}...`);
  console.log(`[OpenCode Bridge] Project Directory: ${directory}`);

  // 1. Create Session
  const sessionRes = await request('/api/session', {
    method: 'POST',
    body: JSON.stringify({
      title,
      agent,
      model: {
        id: modelConfig.id,
        providerID: modelConfig.providerID,
      },
      location: {
        directory,
      },
    }),
  });

  const sessionID = sessionRes.data?.id;
  if (!sessionID) {
    throw new Error(`Failed to create session: ${JSON.stringify(sessionRes)}`);
  }
  console.log(`[OpenCode Bridge] Session created: ${sessionID}`);

  // 2. Queue Prompt
  const promptRes = await request(`/api/session/${sessionID}/prompt`, {
    method: 'POST',
    body: JSON.stringify({
      text: prompt,
    }),
  });
  console.log(`[OpenCode Bridge] Prompt queued (${promptRes.data?.id})`);

  // 3. Poll until session transitions to idle / succeeded
  const startTime = Date.now();
  let completed = false;
  let finalOutcome = 'unknown';

  while (!completed && Date.now() - startTime < maxWaitSeconds * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const messagesRes = await request(`/api/session/${sessionID}/message`);
      const msgs = messagesRes.data || [];
      const idleMsg = msgs.find((m) => m.type === 'idle');
      const errorMsg = msgs.find((m) => m.finish === 'error');

      if (
        errorMsg &&
        errorMsg.error?.type === 'provider.free-limit' &&
        (!options.fallbackAttempt || options.fallbackAttempt < 3)
      ) {
        console.warn(
          `[OpenCode Bridge] Model ${modelConfig.id} reached free quota limit. Initiating zero-cost resilient fallback...`,
        );
        const fallbackKeys = Object.keys(APPROVED_FREE_MODELS).filter((k) => k !== modelKey);
        if (fallbackKeys.length > 0) {
          const nextKey = fallbackKeys[(options.fallbackAttempt || 0) % fallbackKeys.length];
          console.log(
            `[OpenCode Bridge] Seamlessly switching to verified free model: ${nextKey} (${APPROVED_FREE_MODELS[nextKey].id})`,
          );
          return await executeTask({
            ...options,
            modelKey: nextKey,
            fallbackAttempt: (options.fallbackAttempt || 0) + 1,
          });
        }
      }

      if (idleMsg) {
        completed = true;
        finalOutcome = idleMsg.outcome || 'succeeded';
        console.log(`[OpenCode Bridge] Execution completed with outcome: ${finalOutcome}`);
        break;
      }
    } catch {
      // transient read error during active turn, retry
    }
  }

  if (!completed) {
    throw new Error(
      `OpenCode task timed out after ${maxWaitSeconds} seconds in session ${sessionID}`,
    );
  }

  // 4. Retrieve complete session transcript and diff
  const allMessages = await request(`/api/session/${sessionID}/message`);
  let diff = null;
  try {
    diff = await request(`/api/session/${sessionID}/diff`);
  } catch {
    // diff may be empty if no files changed
  }

  return {
    sessionID,
    model: modelConfig.id,
    provider: modelConfig.providerID,
    outcome: finalOutcome,
    durationMs: Date.now() - startTime,
    messagesCount: allMessages.data?.length || 0,
    diff: diff?.data || null,
    cost: 0,
  };
}

// CLI entrypoint
let isDirectRun = false;
try {
  if (process.argv[1]) {
    isDirectRun =
      fs.realpathSync(process.argv[1]).toLowerCase() === fs.realpathSync(__filename).toLowerCase();
  }
} catch {
  isDirectRun = Boolean(process.argv[1] && process.argv[1].includes('opencode-bridge'));
}

if (isDirectRun) {
  const args = process.argv.slice(2);
  const command = args[0] || 'info';

  (async () => {
    try {
      if (command === 'info') {
        const info = await getInfo();
        console.log('OpenCode Server Info:', JSON.stringify(info, null, 2));
      } else if (command === 'models') {
        const models = await getVerifiedModels();
        console.log(`Verified Free Models (${models.length}):`);
        models.forEach((m) => console.log(` - ${m.providerID}/${m.id} (${m.name})`));
      } else if (command === 'run') {
        const modelArg = args[1] || 'deepseek';
        const promptArg =
          args.slice(2).join(' ') || 'Write status report to E:\\Gematron\\temp\\bridge-test.txt';
        const result = await executeTask({
          modelKey: modelArg,
          prompt: promptArg,
          title: `CLI Execution ${modelArg}`,
        });
        console.log('Execution Result:', JSON.stringify(result, null, 2));
      } else {
        console.log('Usage: node opencode-bridge.mjs [info|models|run <deepseek|glm> <prompt>]');
      }
    } catch (err) {
      console.error('[OpenCode Bridge Error]', err.message);
      process.exit(1);
    }
  })();
}
