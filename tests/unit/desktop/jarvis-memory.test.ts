import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  JarvisMemoryStore,
  DEFAULT_JARVIS_MEMORY,
} from '../../../apps/desktop-hud/src/main/jarvis-memory.js';

describe('JarvisMemoryStore', () => {
  // Use E:\Gemetron\notes directory or a test notes subfolder to guarantee work is on E:
  const testDir = 'E:\\Gemetron\\notes\\test_memory';
  const testFile = join(testDir, `test_jarvis_memory_${Date.now()}.json`);

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testFile)) {
      try {
        unlinkSync(testFile);
      } catch {}
    }
  });

  it('initializes with default data when target file does not exist', () => {
    const memory = new JarvisMemoryStore(testFile);
    expect(existsSync(testFile)).toBe(true);

    const prefs = memory.getPreferences();
    expect(prefs.theme).toBe('dark');
    expect(prefs.voice).toBe('Kore');
    expect(prefs.autoApprove).toBe(true);
    expect(prefs.alwaysOnTop).toBe(true);
    expect(prefs.defaultBrowser).toBe('chrome');

    const aliases = memory.listAliases();
    expect(aliases.length).toBeGreaterThanOrEqual(5);
    expect(memory.getAlias('notepad')).toBeDefined();
    expect(memory.getAlias('calc')).toBeDefined();
    expect(memory.getAlias('chrome')).toBeDefined();

    const recipes = memory.getTaskRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(3);
  });

  it('updates and persists user preferences', () => {
    const memory = new JarvisMemoryStore(testFile);
    const updated = memory.updatePreferences({
      theme: 'cyber-neon',
      voice: 'Fenrir',
      autoApprove: false,
    });

    expect(updated.theme).toBe('cyber-neon');
    expect(updated.voice).toBe('Fenrir');
    expect(updated.autoApprove).toBe(false);

    // Re-instantiate to verify file persistence
    const reloaded = new JarvisMemoryStore(testFile);
    expect(reloaded.getPreferences().theme).toBe('cyber-neon');
    expect(reloaded.getPreferences().voice).toBe('Fenrir');
    expect(reloaded.getPreferences().autoApprove).toBe(false);
  });

  it('manages application aliases with case-insensitivity and usage counts', () => {
    const memory = new JarvisMemoryStore(testFile);

    // Set new custom alias
    const created = memory.setAlias('vscode', 'code.exe', ['--new-window']);
    expect(created.alias).toBe('vscode');
    expect(created.targetApp).toBe('code.exe');
    expect(created.arguments).toEqual(['--new-window']);
    expect(created.useCount).toBe(1);

    // Case-insensitive lookup
    const found = memory.getAlias('VSCODE');
    expect(found).toBeDefined();
    expect(found?.targetApp).toBe('code.exe');

    // Record usage
    memory.recordAliasUsage('VsCode');
    expect(memory.getAlias('vscode')?.useCount).toBe(2);

    // List sorted by useCount
    const all = memory.listAliases();
    const top = all[0];
    expect(top).toBeDefined();

    // Remove alias
    const removed = memory.removeAlias('vscode');
    expect(removed).toBe(true);
    expect(memory.getAlias('vscode')).toBeUndefined();
    expect(memory.removeAlias('nonexistent')).toBe(false);
  });

  it('manages task recipes with search and execution recording', () => {
    const memory = new JarvisMemoryStore(testFile);

    // Get recipe by ID
    const recipeById = memory.getTaskRecipe('recipe_notepad_log');
    expect(recipeById).toBeDefined();
    expect(recipeById?.name).toBe('Notepad Activity Log');

    // Get recipe by fuzzy query / goal substring
    const recipeByGoal = memory.getTaskRecipe('executive report');
    expect(recipeByGoal).toBeDefined();
    expect(recipeByGoal?.id).toBe('recipe_notepad_log');

    // Save custom task recipe
    const saved = memory.saveTaskRecipe({
      name: 'Custom Research Automation',
      goal: 'Autonomous deep literature search on quantum physics',
      description: 'Executes arXiv and Google scholar searches',
      steps: [
        {
          description: 'Search arXiv',
          actionType: 'browser_open_tab',
          params: { url: 'https://arxiv.org' },
        },
      ],
    });

    expect(saved.id).toBeDefined();
    expect(saved.name).toBe('Custom Research Automation');

    // Verify retrieval
    const retrieved = memory.getTaskRecipe(saved.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.steps.length).toBe(1);

    // Record success
    memory.recordRecipeSuccess(saved.id);
    expect(memory.getTaskRecipe(saved.id)?.successCount).toBe(1);
  });

  it('records recent context and enforces max capacity limit of 50', () => {
    const memory = new JarvisMemoryStore(testFile);

    for (let i = 1; i <= 60; i++) {
      memory.addRecentContext({
        summary: `Autonomous step #${i} finished`,
        category: 'workflow',
        metadata: { index: i },
      });
    }

    const contextList = memory.getRecentContext(100);
    expect(contextList.length).toBe(50);
    // Most recent is first (index 60)
    expect(contextList[0]?.summary).toBe('Autonomous step #60 finished');

    const top5 = memory.getRecentContext(5);
    expect(top5.length).toBe(5);

    memory.clearRecentContext();
    expect(memory.getRecentContext().length).toBe(0);
  });

  it('handles corrupted JSON files gracefully by restoring defaults', () => {
    new JarvisMemoryStore(testFile);
    // Corrupt file contents with invalid syntax
    writeFileSync(testFile, 'INVALID_JSON_CORRUPTED_{{{', 'utf8');
    const recovered = new JarvisMemoryStore(testFile);
    expect(recovered.getPreferences().voice).toBe(DEFAULT_JARVIS_MEMORY.preferences.voice);
    expect(recovered.listAliases().length).toBeGreaterThan(0);
  });

  it('generates system context prompt for Gemini Live model grounding', () => {
    const memory = new JarvisMemoryStore(testFile);
    memory.addRecentContext({
      summary: 'Launched Notepad and verified text output',
      category: 'workflow',
    });

    const prompt = memory.buildSystemContextPrompt();
    expect(prompt).toContain('[JARVIS PERSISTENT MEMORY CONTEXT]');
    expect(prompt).toContain('Auto-Approve: true');
    expect(prompt).toContain('notepad');
    expect(prompt).toContain('Launched Notepad and verified text output');
  });

  it('rejects single-character or blank queries to prevent false recipe matches', () => {
    const memory = new JarvisMemoryStore(testFile);
    expect(memory.getTaskRecipe('')).toBeUndefined();
    expect(memory.getTaskRecipe(' ')).toBeUndefined();
    expect(memory.getTaskRecipe('a')).toBeUndefined();
    expect(memory.getTaskRecipe('e')).toBeUndefined();
    expect(memory.getTaskRecipe('to')).toBeUndefined();
  });
});
