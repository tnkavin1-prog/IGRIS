import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { NOTES_DIR } from './runtime-paths.js';
import type { WorkflowStepInput } from './types.js';

export interface AppAlias {
  alias: string;
  targetApp: string;
  arguments?: string[];
  lastUsed: number;
  useCount: number;
}

export interface TaskRecipe {
  id: string;
  name: string;
  goal: string;
  description?: string;
  steps: WorkflowStepInput[];
  successCount: number;
  lastExecuted: number;
}

export interface UserPreferences {
  theme: string;
  voice: string;
  autoApprove: boolean;
  alwaysOnTop: boolean;
  defaultBrowser: string;
  favoriteApps: string[];
  customHotkeys: Record<string, string>;
  soundEffectsEnabled?: boolean;
  soundVolume?: number;
  wakeWordEnabled?: boolean;
}

export interface RecentContextEntry {
  id: string;
  timestamp: number;
  summary: string;
  category: 'workflow' | 'dialogue' | 'app_interaction';
  metadata?: Record<string, any>;
}

export interface JarvisMemoryData {
  version: string;
  updatedAt: number;
  preferences: UserPreferences;
  appAliases: Record<string, AppAlias>;
  taskRecipes: TaskRecipe[];
  recentContext: RecentContextEntry[];
}

export const DEFAULT_JARVIS_MEMORY: JarvisMemoryData = {
  version: '2.0.0',
  updatedAt: Date.now(),
  preferences: {
    theme: 'dark',
    voice: 'Kore',
    autoApprove: false,
    alwaysOnTop: true,
    defaultBrowser: 'chrome',
    favoriteApps: ['chrome', 'notepad', 'calc', 'terminal', 'explorer'],
    soundEffectsEnabled: true,
    soundVolume: 0.5,
    customHotkeys: {
      killswitch: 'Ctrl+Alt+K',
      emergencyStop: 'Escape x3',
      summon: 'gemetron://summon',
    },
  },
  appAliases: {
    notepad: { alias: 'notepad', targetApp: 'notepad.exe', lastUsed: Date.now(), useCount: 1 },
    editor: { alias: 'editor', targetApp: 'notepad.exe', lastUsed: Date.now(), useCount: 1 },
    calc: { alias: 'calc', targetApp: 'calc.exe', lastUsed: Date.now(), useCount: 1 },
    calculator: { alias: 'calculator', targetApp: 'calc.exe', lastUsed: Date.now(), useCount: 1 },
    terminal: { alias: 'terminal', targetApp: 'powershell.exe', lastUsed: Date.now(), useCount: 1 },
    powershell: {
      alias: 'powershell',
      targetApp: 'powershell.exe',
      lastUsed: Date.now(),
      useCount: 1,
    },
    shell: { alias: 'shell', targetApp: 'powershell.exe', lastUsed: Date.now(), useCount: 1 },
    chrome: { alias: 'chrome', targetApp: 'chrome.exe', lastUsed: Date.now(), useCount: 1 },
    browser: { alias: 'browser', targetApp: 'chrome.exe', lastUsed: Date.now(), useCount: 1 },
    explorer: { alias: 'explorer', targetApp: 'explorer.exe', lastUsed: Date.now(), useCount: 1 },
    files: { alias: 'files', targetApp: 'explorer.exe', lastUsed: Date.now(), useCount: 1 },
  },
  taskRecipes: [
    {
      id: 'recipe_notepad_log',
      name: 'Notepad Activity Log',
      goal: 'Launch Notepad and write autonomous executive report',
      description: 'Spawns Notepad and types verified autonomous agent summary',
      steps: [
        {
          description: 'Launch Windows Notepad editor',
          actionType: 'launch_app',
          params: { appName: 'notepad' },
        },
        {
          description: 'Focus Notepad editor window',
          actionType: 'switch_window',
          params: { windowTitle: 'Notepad' },
        },
        {
          description: 'Type autonomous agent notes into Notepad',
          actionType: 'computer_type',
          params: { text: '[Jarvis Session Log]\nStatus: Complete.\n' },
        },
        {
          description: 'Capture screenshot of active Notepad window for verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ],
      successCount: 1,
      lastExecuted: Date.now(),
    },
    {
      id: 'recipe_google_search',
      name: 'Google Research Extraction',
      goal: 'Search Google for state of art AI computer use agents',
      description: 'Navigates Chrome to Google and extracts page overview',
      steps: [
        {
          description: 'Open Google search in Chrome tab',
          actionType: 'browser_open_tab',
          params: { url: 'https://www.google.com/search?q=state+of+art+AI+computer+use+agents' },
        },
        {
          description: 'Read search results page text and headings',
          actionType: 'browser_read',
          params: {},
        },
        {
          description: 'Capture search results viewport',
          actionType: 'computer_screenshot',
          params: {},
        },
      ],
      successCount: 1,
      lastExecuted: Date.now(),
    },
    {
      id: 'recipe_youtube_search',
      name: 'YouTube Multimodal Verification',
      goal: 'Search YouTube for multimodal AI co-pilots and verify page',
      description: 'Opens YouTube video query and verifies Chrome viewport',
      steps: [
        {
          description: 'Open YouTube in Google Chrome',
          actionType: 'browser_open_tab',
          params: { url: 'https://www.youtube.com/results?search_query=multimodal+AI+co-pilots' },
        },
        {
          description: 'Verify YouTube search results page loaded',
          actionType: 'browser_read',
          params: {},
        },
        {
          description: 'Capture Chrome viewport verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ],
      successCount: 1,
      lastExecuted: Date.now(),
    },
  ],
  recentContext: [],
};

export class JarvisMemoryStore {
  private filePath: string;
  private memoryData: JarvisMemoryData;

  constructor(filePath = join(NOTES_DIR, 'jarvis_memory.json')) {
    this.filePath = filePath;
    this.memoryData = this.load();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  /**
   * Load data from disk or initialize with defaults
   */
  public load(): JarvisMemoryData {
    if (!existsSync(this.filePath)) {
      const initial: JarvisMemoryData = JSON.parse(JSON.stringify(DEFAULT_JARVIS_MEMORY));
      this.memoryData = initial;
      this.save();
      return initial;
    }

    try {
      const content = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as Partial<JarvisMemoryData>;
      const merged: JarvisMemoryData = {
        version: parsed.version || DEFAULT_JARVIS_MEMORY.version,
        updatedAt: parsed.updatedAt || Date.now(),
        preferences: { ...DEFAULT_JARVIS_MEMORY.preferences, ...(parsed.preferences || {}) },
        appAliases: { ...DEFAULT_JARVIS_MEMORY.appAliases, ...(parsed.appAliases || {}) },
        taskRecipes:
          Array.isArray(parsed.taskRecipes) && parsed.taskRecipes.length > 0
            ? parsed.taskRecipes
            : [...DEFAULT_JARVIS_MEMORY.taskRecipes],
        recentContext: Array.isArray(parsed.recentContext) ? parsed.recentContext : [],
      };
      this.memoryData = merged;
      return merged;
    } catch (err) {
      console.warn(
        `[JarvisMemoryStore] Corrupted memory file at ${this.filePath}. Reinitializing with defaults:`,
        err,
      );
      const fallback: JarvisMemoryData = JSON.parse(JSON.stringify(DEFAULT_JARVIS_MEMORY));
      this.memoryData = fallback;
      this.save();
      return fallback;
    }
  }

  /**
   * Persist current state to disk using atomic rename
   */
  public save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.memoryData.updatedAt = Date.now();
      const serialized = JSON.stringify(this.memoryData, null, 2);
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      writeFileSync(tmpPath, serialized, 'utf8');
      try {
        renameSync(tmpPath, this.filePath);
      } catch {
        writeFileSync(this.filePath, serialized, 'utf8');
        try {
          unlinkSync(tmpPath);
        } catch {}
      }
    } catch (err) {
      console.error(`[JarvisMemoryStore] Failed to save memory to ${this.filePath}:`, err);
    }
  }

  public getRawData(): JarvisMemoryData {
    return JSON.parse(JSON.stringify(this.memoryData));
  }

  // Preferences
  public getPreferences(): UserPreferences {
    return { ...this.memoryData.preferences };
  }

  public updatePreferences(partial: Partial<UserPreferences>): UserPreferences {
    this.memoryData.preferences = { ...this.memoryData.preferences, ...partial };
    this.save();
    return this.getPreferences();
  }

  // App Aliases
  public getAlias(aliasName: string): AppAlias | undefined {
    const norm = aliasName.trim().toLowerCase();
    return this.memoryData.appAliases[norm];
  }

  public setAlias(aliasName: string, targetApp: string, args?: string[]): AppAlias {
    const norm = aliasName.trim().toLowerCase();
    const existing = this.memoryData.appAliases[norm];
    const updated: AppAlias = {
      alias: norm,
      targetApp,
      arguments: args,
      lastUsed: Date.now(),
      useCount: (existing?.useCount ?? 0) + 1,
    };
    this.memoryData.appAliases[norm] = updated;
    this.save();
    return updated;
  }

  public removeAlias(aliasName: string): boolean {
    const norm = aliasName.trim().toLowerCase();
    if (this.memoryData.appAliases[norm]) {
      delete this.memoryData.appAliases[norm];
      this.save();
      return true;
    }
    return false;
  }

  public recordAliasUsage(aliasName: string): void {
    const norm = aliasName.trim().toLowerCase();
    if (this.memoryData.appAliases[norm]) {
      this.memoryData.appAliases[norm].useCount += 1;
      this.memoryData.appAliases[norm].lastUsed = Date.now();
      this.save();
    }
  }

  public listAliases(): AppAlias[] {
    return Object.values(this.memoryData.appAliases).sort((a, b) => b.useCount - a.useCount);
  }

  // Task Recipes
  public getTaskRecipes(): TaskRecipe[] {
    return [...this.memoryData.taskRecipes];
  }

  public getTaskRecipe(idOrQuery: string): TaskRecipe | undefined {
    const q = idOrQuery.toLowerCase().trim();
    if (!q) return undefined;
    return this.memoryData.taskRecipes.find((r) => {
      const idMatch = r.id.toLowerCase() === q;
      const nameMatch = r.name.toLowerCase() === q;
      const goalMatch =
        q.length >= 3 &&
        (r.goal.toLowerCase().includes(q) ||
          (r.goal.length >= 5 && q.includes(r.goal.toLowerCase())));
      return idMatch || nameMatch || goalMatch;
    });
  }

  public saveTaskRecipe(
    input: Omit<TaskRecipe, 'id' | 'successCount' | 'lastExecuted'> & { id?: string },
  ): TaskRecipe {
    const id = input.id || `recipe_${Date.now()}`;
    const existingIdx = this.memoryData.taskRecipes.findIndex((r) => r.id === id);

    const recipe: TaskRecipe = {
      id,
      name: input.name,
      goal: input.goal,
      description: input.description,
      steps: input.steps,
      successCount:
        existingIdx >= 0 ? (this.memoryData.taskRecipes[existingIdx]?.successCount ?? 0) : 0,
      lastExecuted: Date.now(),
    };

    if (existingIdx >= 0) {
      this.memoryData.taskRecipes[existingIdx] = recipe;
    } else {
      this.memoryData.taskRecipes.push(recipe);
    }

    this.save();
    return recipe;
  }

  public recordRecipeSuccess(recipeId: string): void {
    const recipe = this.memoryData.taskRecipes.find((r) => r.id === recipeId);
    if (recipe) {
      recipe.successCount += 1;
      recipe.lastExecuted = Date.now();
      this.save();
    }
  }

  // Recent Context
  public addRecentContext(entry: Omit<RecentContextEntry, 'id' | 'timestamp'>): RecentContextEntry {
    const fullEntry: RecentContextEntry = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      summary: entry.summary,
      category: entry.category,
      metadata: entry.metadata,
    };

    this.memoryData.recentContext.unshift(fullEntry);
    // Keep last 50 items
    if (this.memoryData.recentContext.length > 50) {
      this.memoryData.recentContext = this.memoryData.recentContext.slice(0, 50);
    }
    this.save();
    return fullEntry;
  }

  public getRecentContext(limit = 10): RecentContextEntry[] {
    return this.memoryData.recentContext.slice(0, limit);
  }

  public clearRecentContext(): void {
    this.memoryData.recentContext = [];
    this.save();
  }

  /**
   * Construct a contextual grounding summary for the Gemini Live assistant
   */
  public buildSystemContextPrompt(): string {
    const prefs = this.getPreferences();
    const topAliases = this.listAliases()
      .slice(0, 5)
      .map((a) => `\`${a.alias}\` -> ${a.targetApp}`)
      .join(', ');
    const topRecipes = this.getTaskRecipes()
      .slice(0, 3)
      .map((r) => `"${r.name}" (${r.goal})`)
      .join('; ');
    const recent = this.getRecentContext(3)
      .map((c) => `- [${new Date(c.timestamp).toLocaleTimeString()}] ${c.summary}`)
      .join('\n');

    return `
[JARVIS PERSISTENT MEMORY CONTEXT]
User Preferences: Auto-Approve: ${prefs.autoApprove}, AlwaysOnTop: ${prefs.alwaysOnTop}, Default Browser: ${prefs.defaultBrowser}
Frequent App Aliases: ${topAliases || 'None'}
Available Pre-configured Recipes: ${topRecipes || 'None'}
Recent Working Context:
${recent || 'None recorded yet.'}
`.trim();
  }
}
