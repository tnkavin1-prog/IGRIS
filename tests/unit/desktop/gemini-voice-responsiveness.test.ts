import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiLiveService } from '../../../apps/desktop-hud/src/main/gemini-live.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';
import { autonomousAgent, type AgentSession } from '../../../apps/desktop-hud/src/main/autonomous-agent.js';

describe('Gemini voice responsiveness', () => {
  let cdpClient: CDPClient;
  let service: GeminiLiveService;

  beforeEach(() => {
    cdpClient = new CDPClient(9222, '127.0.0.1');
    service = new GeminiLiveService(cdpClient, {
      nativeInput: new NativeInputService({ mockMode: true }),
      computerVision: new ComputerVisionService({ mockMode: true }),
      appManager: new AppManagerService({ mockMode: true }),
    });
  });

  it('acknowledges an autonomous goal before the desktop session finishes', async () => {
    let finishAgent!: (session: AgentSession) => void;
    const pendingAgent = new Promise<AgentSession>((resolve) => {
      finishAgent = resolve;
    });
    const session: AgentSession = {
      id: 'agent_voice_1',
      goal: 'Prepare a current-affairs briefing',
      status: 'running',
      steps: [],
      currentStepIndex: 0,
      startedAt: Date.now(),
      iterations: 0,
      maxIterations: 30,
    };
    const isRunning = vi.spyOn(autonomousAgent, 'isSessionRunning').mockReturnValue(false);
    const getSession = vi.spyOn(autonomousAgent, 'getSession').mockReturnValue(session);
    const startSession = vi.spyOn(autonomousAgent, 'startSession').mockReturnValue(pendingAgent);
    const sent: any[] = [];
    (service as any).socket = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
    };

    try {
      const toolRun = (service as any).handleToolCalls([
        { id: 'autonomous_voice_1', name: 'autonomous_goal', args: { goal: session.goal } },
      ]);
      await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
      const completedBeforeAgent = await Promise.race([
        toolRun.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
      ]);

      expect(completedBeforeAgent).toBe(true);
      const response = sent.find((entry) => entry.toolResponse)?.toolResponse.functionResponses[0];
      expect(response.response.result).toMatchObject({
        success: true,
        accepted: true,
        status: 'running',
        sessionId: 'agent_voice_1',
      });
      finishAgent({ ...session, status: 'completed' });
    } finally {
      startSession.mockRestore();
      getSession.mockRestore();
      isRunning.mockRestore();
      service.dispose();
    }
  });

  it('falls back to one visual screenshot when Chrome DevTools page reading fails', async () => {
    (service as any).isSetupComplete = true;
    const shot = {
      data: 'aGVsbG8=',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    };
    const capture = vi.spyOn(service.vision, 'captureScreen').mockResolvedValue(shot as any);
    const readPage = vi.spyOn(cdpClient, 'readPage').mockRejectedValue(
      new Error('Chrome DevTools port is unavailable'),
    );
    const sent: any[] = [];
    (service as any).socket = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
    };

    try {
      await (service as any).handleToolCalls([
        { id: 'browser_read_fallback', name: 'browser_read', args: {} },
      ]);

      expect(readPage).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledTimes(1);
      const videoPackets = sent.filter((entry) => entry.realtimeInput?.video);
      expect(videoPackets).toHaveLength(1);
      expect(videoPackets[0].realtimeInput.video).toEqual({
        mimeType: 'image/jpeg',
        data: 'aGVsbG8=',
      });
      expect(sent.some((entry) => entry.toolResponse)).toBe(true);
    } finally {
      readPage.mockRestore();
      capture.mockRestore();
      service.dispose();
    }
  });
  it('allows a voice stop command while the autonomous agent owns the computer', async () => {
    const isRunning = vi.spyOn(autonomousAgent, 'isSessionRunning').mockReturnValue(true);
    const stopSession = vi.spyOn(autonomousAgent, 'stopSession').mockResolvedValue({ stopped: true });
    const sent: any[] = [];
    (service as any).socket = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
    };

    try {
      await (service as any).handleToolCalls([
        { id: 'stop_agent_voice', name: 'stop_autonomous_task', args: {} },
      ]);
      expect(stopSession).toHaveBeenCalledTimes(1);
      const response = sent.find((entry) => entry.toolResponse)?.toolResponse.functionResponses[0];
      expect(response.response.result).toMatchObject({ success: true, stopped: true, status: 'cancelled' });
    } finally {
      stopSession.mockRestore();
      isRunning.mockRestore();
      service.dispose();
    }
  });
});
