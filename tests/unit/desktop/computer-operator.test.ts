import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UniversalComputerOperator,
  type ComputerOperatorOptions,
} from '../../../apps/desktop-hud/src/main/computer-operator.js';
import { SkillRegistry } from '../../../apps/desktop-hud/src/main/skill-framework.js';

/**
 * Every action exercised below short-circuits inside its skill's `mockMode`
 * branch, so no real process is spawned, no network request is made and no
 * host file is read or written.
 */
const PRIMARY_SKILL_IDS = ['windows', 'office', 'blender', 'creative', 'opencode'] as const;

const PRIMARY_ACTIONS: Record<string, string[]> = {
  windows: [
    'getSystemTelemetry',
    'openApp',
    'closeApp',
    'searchFiles',
    'listWindows',
    'focusWindow',
  ],
  office: [
    'createWordDoc',
    'createExcelSheet',
    'createPowerPoint',
    'readWordDoc',
    'readExcelSheet',
  ],
  blender: ['checkBlender', 'renderScene', 'runPython'],
  creative: ['checkCreativeApps', 'renderPhotoshopBatch', 'executeExtendScript'],
  opencode: ['listFreeModels', 'dispatchTask', 'checkService', 'getSessionStatus'],
};

describe('UniversalComputerOperator', () => {
  let operator: UniversalComputerOperator;

  beforeEach(async () => {
    const options: ComputerOperatorOptions = { mockMode: true };
    operator = new UniversalComputerOperator(options);

    // The operator delegates to the module-level skill registry. Reset it so
    // every test starts from a known catalogue instead of inherited state.
    for (const skill of operator.registry.listSkills()) {
      operator.registry.unregisterSkill(skill.id);
    }

    await operator.initialize();
  });

  describe('initialization', () => {
    it('uses the shared SkillRegistry instance', () => {
      expect(operator.registry).toBeInstanceOf(SkillRegistry);
    });

    it('registers exactly the five primary skills', async () => {
      // Registered ids are unique, so re-initializing stays idempotent.
      await operator.initialize();

      const skills = operator.registry.listSkills();
      expect(skills).toHaveLength(5);
      expect(skills.map((skill) => skill.id).sort()).toEqual([...PRIMARY_SKILL_IDS].sort());

      for (const id of PRIMARY_SKILL_IDS) {
        expect(operator.registry.hasSkill(id)).toBe(true);
      }
    });

    it('describes each registered skill with non-empty metadata', () => {
      for (const skill of operator.registry.listSkills()) {
        expect(typeof skill.name).toBe('string');
        expect(skill.name.length).toBeGreaterThan(0);
        expect(typeof skill.targetApp).toBe('string');
        expect(skill.targetApp.length).toBeGreaterThan(0);
        expect(typeof skill.description).toBe('string');
        expect(skill.description.length).toBeGreaterThan(0);
        expect(Array.isArray(skill.getActions())).toBe(true);
      }
    });

    it('reports all skills as available in mock mode', async () => {
      const availability = await Promise.all(
        operator.registry.listSkills().map((skill) => skill.isAvailable()),
      );
      expect(availability.every(Boolean)).toBe(true);
    });
  });

  describe('getCapabilities()', () => {
    it('exports one catalog entry per registered skill', () => {
      const catalog = operator.getCapabilities();

      expect(catalog).toHaveLength(5);
      expect(catalog.map((entry) => entry.id).sort()).toEqual([...PRIMARY_SKILL_IDS].sort());
    });

    it('exports action metadata for every action', () => {
      const catalog = operator.getCapabilities();

      for (const entry of catalog) {
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.targetApp).toBe('string');
        expect(typeof entry.description).toBe('string');
        expect(Array.isArray(entry.actions)).toBe(true);
        expect(entry.actions.length).toBeGreaterThan(0);

        for (const action of entry.actions) {
          expect(typeof action.name).toBe('string');
          expect(action.name.length).toBeGreaterThan(0);
          expect(typeof action.description).toBe('string');
          expect(action.description.length).toBeGreaterThan(0);

          if (action.parameters) {
            expect(Array.isArray(action.parameters)).toBe(true);
            for (const param of action.parameters) {
              expect(typeof param.name).toBe('string');
              expect(typeof param.type).toBe('string');
              expect(typeof param.description).toBe('string');
            }
          }
        }
      }
    });

    it('advertises the expected actions for each primary skill', () => {
      const catalog = operator.getCapabilities();

      for (const [skillId, expected] of Object.entries(PRIMARY_ACTIONS)) {
        const entry = catalog.find((candidate) => candidate.id === skillId);
        expect(entry).toBeDefined();
        const actionNames = entry?.actions.map((action) => action.name) ?? [];
        expect(actionNames).toEqual(expect.arrayContaining(expected));
      }
    });

    it('marks the required parameter on windows:openApp', () => {
      const windows = operator.getCapabilities().find((entry) => entry.id === 'windows');
      const openApp = windows?.actions.find((action) => action.name === 'openApp');
      const nameParam = openApp?.parameters?.find((param) => param.name === 'name');

      expect(nameParam).toBeDefined();
      expect(nameParam?.required).toBe(true);
    });
  });

  describe('direct skill execution', () => {
    describe('windows skill', () => {
      it('returns system telemetry for getSystemTelemetry', async () => {
        const result = await operator.executeSkillAction('windows', 'getSystemTelemetry');

        expect(result.success).toBe(true);
        expect(typeof result.executionTimeMs).toBe('number');

        const data = result.data as {
          platform: string;
          arch: string;
          cpuModel: string;
          cpuCores: number;
          memory: {
            totalMB: number;
            freeMB: number;
            usedPercent: number;
          };
          uptimeHours: number;
        };

        expect(typeof data.platform).toBe('string');
        expect(typeof data.arch).toBe('string');
        expect(data.cpuCores).toBeGreaterThan(0);
        expect(data.memory.totalMB).toBeGreaterThan(0);
        expect(data.memory.freeMB).toBeLessThanOrEqual(data.memory.totalMB);
        expect(data.memory.usedPercent).toBeGreaterThanOrEqual(0);
        expect(data.memory.usedPercent).toBeLessThanOrEqual(100);
        expect(data.uptimeHours).toBeGreaterThanOrEqual(0);
      });

      it('launches an application for openApp', async () => {
        const result = await operator.executeSkillAction('windows', 'openApp', {
          name: 'notepad',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          pid: 1234,
          app: 'notepad',
          launched: true,
        });
      });

      it('terminates a process for closeApp', async () => {
        const result = await operator.executeSkillAction('windows', 'closeApp', {
          processName: 'notepad.exe',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          terminated: true,
          process: 'notepad.exe',
        });
      });

      it('returns deterministic results for searchFiles', async () => {
        const result = await operator.executeSkillAction('windows', 'searchFiles', {
          directory: 'E:\\Gematron',
          query: 'report',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          matches: ['mock_file.txt'],
          count: 1,
        });
      });
    });

    describe('office skill', () => {
      it('creates a Word document for createWordDoc', async () => {
        const result = await operator.executeSkillAction('office', 'createWordDoc', {
          filePath: 'virtual/document.docx',
          title: 'Gematron Report',
          content: 'Quarterly summary.',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          created: true,
          filePath: 'virtual/document.docx',
          title: 'Gematron Report',
        });
      });

      it('creates an Excel workbook for createExcelSheet', async () => {
        const result = await operator.executeSkillAction('office', 'createExcelSheet', {
          filePath: 'virtual/data.xlsx',
          headers: ['Item', 'Value'],
          rows: [
            ['alpha', 1],
            ['beta', 2],
          ],
        });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
          created: true,
          filePath: 'virtual/data.xlsx',
          rowsCount: 2,
        });
      });

      it('creates a presentation for createPowerPoint', async () => {
        const result = await operator.executeSkillAction('office', 'createPowerPoint', {
          filePath: 'virtual/slides.pptx',
          slides: [
            { title: 'One', bullets: ['first'] },
            { title: 'Two', bullets: [] },
          ],
        });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
          created: true,
          filePath: 'virtual/slides.pptx',
          slidesCount: 2,
        });
      });
    });

    describe('blender skill', () => {
      it('detects the Blender installation for checkBlender', async () => {
        const result = await operator.executeSkillAction('blender', 'checkBlender');

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
          installed: true,
          version: '4.2.0 (mock)',
        });
        expect((result.data as { path: string }).path).toContain('blender');
      });

      it('renders a scene for renderScene', async () => {
        const result = await operator.executeSkillAction('blender', 'renderScene', {
          blendFile: 'virtual/scene.blend',
          outputImg: 'virtual/render.png',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          rendered: true,
          outputImg: 'virtual/render.png',
        });
      });
    });

    describe('creative skill', () => {
      it('detects the Adobe suite for checkCreativeApps', async () => {
        const result = await operator.executeSkillAction('creative', 'checkCreativeApps');

        expect(result.success).toBe(true);

        const data = result.data as {
          photoshop: { installed: boolean };
          premiere: { installed: boolean };
          afterEffects: { installed: boolean };
        };

        expect(data.photoshop.installed).toBe(true);
        expect(data.premiere.installed).toBe(true);
        expect(data.afterEffects.installed).toBe(true);
      });

      it('exports a PSD batch for renderPhotoshopBatch', async () => {
        const result = await operator.executeSkillAction('creative', 'renderPhotoshopBatch', {
          psdFile: 'virtual/asset.psd',
          outputDir: 'virtual/export',
          format: 'png',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          exported: true,
          psdFile: 'virtual/asset.psd',
          outputDir: 'virtual/export',
          format: 'png',
        });
      });
    });

    describe('opencode skill', () => {
      it('lists free models for listFreeModels', async () => {
        const result = await operator.executeSkillAction('opencode', 'listFreeModels');

        expect(result.success).toBe(true);

        const models = result.data as Array<{
          id: string;
          name: string;
          cost: number;
        }>;

        expect(models).toHaveLength(2);
        expect(models.map((model) => model.id)).toEqual(
          expect.arrayContaining(['deepseek-v4.1-flash-free', 'glm-5.3-flash-free']),
        );
        expect(models.every((model) => model.cost === 0)).toBe(true);
      });

      it('dispatches a task for dispatchTask', async () => {
        const result = await operator.executeSkillAction('opencode', 'dispatchTask', {
          model: 'glm-5.3-flash-free',
          prompt: 'Refactor the telemetry module.',
          title: 'Test Task',
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          sessionId: 'ses_mock123',
          model: 'glm-5.3-flash-free',
          promptQueued: true,
        });
      });
    });

    it('rejects unknown actions instead of executing them', async () => {
      const result = await operator.executeSkillAction('windows', 'formatHardDrive');

      expect(result.success).toBe(false);
      expect(result.error).toContain('formatHardDrive');
    });
  });

  describe('executeGoal() natural language routing', () => {
    it('routes a word/document goal to office:createWordDoc', async () => {
      const goal = 'Create a word document summarising the sprint';
      const result = await operator.executeGoal(goal);

      expect(result.goal).toBe(goal);
      expect(result.skillId).toBe('office');
      expect(result.action).toBe('createWordDoc');
      expect(result.success).toBe(true);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.data).toMatchObject({
        created: true,
        title: 'Gematron Generated Document',
      });
    });

    it('routes an excel/sheet goal to office:createExcelSheet', async () => {
      const result = await operator.executeGoal('Create an excel spreadsheet of expenses');

      expect(result.skillId).toBe('office');
      expect(result.action).toBe('createExcelSheet');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ created: true, rowsCount: 1 });
    });

    it('routes a powerpoint/slides goal to office:createPowerPoint', async () => {
      const result = await operator.executeGoal('Build powerpoint slides for the launch');

      expect(result.skillId).toBe('office');
      expect(result.action).toBe('createPowerPoint');
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ created: true, slidesCount: 1 });
    });

    it('routes a blender/3d render goal to blender:renderScene', async () => {
      const result = await operator.executeGoal('Render the 3d scene in blender', {
        blendFile: 'virtual/scene.blend',
        outputImg: 'virtual/render.png',
      });

      expect(result.skillId).toBe('blender');
      expect(result.action).toBe('renderScene');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        rendered: true,
        outputImg: 'virtual/render.png',
      });
    });

    it('routes an open/launch goal to windows:openApp', async () => {
      const result = await operator.executeGoal('Open notepad');

      expect(result.skillId).toBe('windows');
      expect(result.action).toBe('openApp');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        pid: 1234,
        app: 'notepad',
        launched: true,
      });
    });

    it('routes a kill/close goal to windows:closeApp', async () => {
      const result = await operator.executeGoal('Kill notepad');

      expect(result.skillId).toBe('windows');
      expect(result.action).toBe('closeApp');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        terminated: true,
        process: 'notepad.exe',
      });
    });

    it('routes a search file goal to windows:searchFiles', async () => {
      const result = await operator.executeGoal('Search files for report');

      expect(result.skillId).toBe('windows');
      expect(result.action).toBe('searchFiles');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        matches: ['mock_file.txt'],
        count: 1,
      });
    });

    it('routes an opencode/deepseek/glm goal to opencode:dispatchTask', async () => {
      const result = await operator.executeGoal('Dispatch an opencode task with deepseek');

      expect(result.skillId).toBe('opencode');
      expect(result.action).toBe('dispatchTask');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        sessionId: 'ses_mock123',
        model: 'deepseek-v4.1-flash-free',
        promptQueued: true,
      });
    });

    it('routes a free-model query to opencode:listFreeModels', async () => {
      const result = await operator.executeGoal('Show me the free models');

      expect(result.skillId).toBe('opencode');
      expect(result.action).toBe('listFreeModels');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('getSystemHealth()', () => {
    it('returns a timestamp and live system metrics', async () => {
      const health = await operator.getSystemHealth();

      expect(typeof health.timestamp).toBe('number');

      const system = health.system as {
        platform: string;
        arch: string;
        cpuCores: number;
        memory: { totalMB: number; freeMB: number; usedPercent: number };
        uptimeHours: number;
      };

      expect(system).not.toBeNull();
      expect(typeof system.platform).toBe('string');
      expect(typeof system.arch).toBe('string');
      expect(system.cpuCores).toBeGreaterThan(0);
      expect(system.memory.totalMB).toBeGreaterThan(0);
      expect(system.memory.freeMB).toBeLessThanOrEqual(system.memory.totalMB);
      expect(system.memory.usedPercent).toBeGreaterThanOrEqual(0);
      expect(system.memory.usedPercent).toBeLessThanOrEqual(100);
      expect(system.uptimeHours).toBeGreaterThanOrEqual(0);
    });

    it('returns a skill availability dictionary for all skills', async () => {
      const health = await operator.getSystemHealth();

      const skills = health.skills as Record<string, boolean>;
      expect(Object.keys(skills).sort()).toEqual([...PRIMARY_SKILL_IDS].sort());
      for (const id of PRIMARY_SKILL_IDS) {
        expect(skills[id]).toBe(true);
      }

      expect(health.registeredSkillsCount).toBe(5);
    });

    it('marks a skill unavailable when its availability probe throws', async () => {
      const creative = operator.registry.getSkill('creative');
      expect(creative).toBeDefined();
      vi.spyOn(creative!, 'isAvailable').mockRejectedValueOnce(new Error('probe failed'));

      const health = await operator.getSystemHealth();
      const skills = health.skills as Record<string, boolean>;

      expect(skills.creative).toBe(false);
      expect(skills.windows).toBe(true);
    });
  });
});
