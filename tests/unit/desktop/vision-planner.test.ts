import { describe, it, expect, vi } from 'vitest';
import {
  AGENT_ACTIONS,
  GeminiVisionPlanner,
} from '../../../apps/desktop-hud/src/main/vision-planner.js';
import type {
  AgentObservation,
  AgentSession,
} from '../../../apps/desktop-hud/src/main/autonomous-agent.js';
import type {
  ModelProvider,
  ModelRequest,
} from '../../../apps/desktop-hud/src/main/model-provider.js';
import { ValidationError } from '../../../apps/desktop-hud/src/main/errors.js';

const observation: AgentObservation = {
  windows: [],
  cursor: { x: 10, y: 20 },
  activeWindow: { title: 'Notepad' },
  screenText: 'hello',
  screenshot: { mimeType: 'image/png', width: 800, height: 600, data: 'AAAA' },
} as unknown as AgentObservation;

const session = {
  goal: 'Type hello',
  steps: [],
} as unknown as AgentSession;

function providerReturning(payload: unknown): ModelProvider & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    id: 'stub',
    model: 'stub-1',
    calls,
    generate: vi.fn(async (request: ModelRequest) => {
      calls.push(request);
      return { text: JSON.stringify(payload), provider: 'stub', model: 'stub-1' };
    }),
  };
}

const validDecision = {
  status: 'action',
  description: 'Type hello',
  expectedOutcome: 'Notepad shows hello',
  requiresApproval: false,
  action: 'computer_type',
  paramsJson: JSON.stringify({ text: 'hello' }),
};

describe('GeminiVisionPlanner', () => {
  it('sends the goal, the allowed actions and the interleaved screenshot to the provider', async () => {
    const provider = providerReturning(validDecision);
    const planner = new GeminiVisionPlanner(() => ({ apiKey: 'k', model: 'm' }), { provider });

    const decision = await planner.next(session, observation, [], new AbortController().signal);

    expect(decision.params).toEqual({ text: 'hello' });
    expect(decision.action).toBe('computer_type');

    const request = provider.calls[0]!;
    const texts = (request.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''));
    expect(texts[0]).toContain('Goal: Type hello');
    expect(texts[0]).toContain(AGENT_ACTIONS.join(', '));
    expect(texts[1]).toContain('Observation 1');
    expect(request.content?.[2]).toEqual({
      type: 'image',
      image: { mimeType: 'image/png', data: 'AAAA' },
    });
    expect(request.responseSchema).toBeDefined();
    expect(request.systemInstruction).toContain('untrusted data');
  });

  it('rejects an action that is not in the allowed set', async () => {
    const provider = providerReturning({ ...validDecision, action: 'format_disk' });
    const planner = new GeminiVisionPlanner(() => ({ apiKey: 'k', model: 'm' }), { provider });

    await expect(
      planner.next(session, observation, [], new AbortController().signal),
    ).rejects.toThrow(/unsupported action/);
  });

  it('rejects malformed parameters', async () => {
    const provider = providerReturning({ ...validDecision, paramsJson: '"not-an-object"' });
    const planner = new GeminiVisionPlanner(() => ({ apiKey: 'k', model: 'm' }), { provider });

    await expect(
      planner.next(session, observation, [], new AbortController().signal),
    ).rejects.toThrow(/must be an object/);
  });

  it('returns a verified result only when the provider supplies all fields', async () => {
    const provider = providerReturning({
      succeeded: true,
      goalAchieved: true,
      evidence: 'text visible',
    });
    const planner = new GeminiVisionPlanner(() => ({ apiKey: 'k', model: 'm' }), { provider });

    await expect(
      planner.verify(
        'Type hello',
        observation,
        observation,
        undefined,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ succeeded: true, goalAchieved: true, evidence: 'text visible' });
  });

  it('requires an API key when no provider is injected', async () => {
    const planner = new GeminiVisionPlanner(() => ({ apiKey: '', model: 'm' }));

    const error = await planner
      .next(session, observation, [], new AbortController().signal)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields[0]).toMatchObject({ field: 'apiKey' });
  });
});
