/**
 * Application Skill Framework
 *
 * Defines the contracts every application skill (Windows, Office, Blender,
 * Adobe, OpenCode, ...) must implement, plus a registry that discovers and
 * executes skills in a uniform, fault-tolerant way.
 */

/**
 * A single parameter accepted by a skill action.
 */
export interface SkillActionParam {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Describes one executable action exposed by a skill.
 */
export interface SkillActionDefinition {
  name: string;
  description: string;
  parameters?: SkillActionParam[];
  dangerous?: boolean;
}

/**
 * Uniform result envelope returned by every skill execution.
 */
export interface SkillResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Contract implemented by every application skill.
 */
export interface ApplicationSkill {
  id: string;
  name: string;
  targetApp: string;
  description: string;
  isAvailable(): Promise<boolean>;
  getActions(): SkillActionDefinition[];
  execute(action: string, params: Record<string, unknown>): Promise<SkillResult>;
  verify(action: string, result: SkillResult): Promise<boolean>;
}

/**
 * Catalog entry describing a registered skill and its actions.
 */
export interface SkillCatalogEntry {
  id: string;
  name: string;
  targetApp: string;
  description: string;
  actions: SkillActionDefinition[];
}

/**
 * Registry of application skills.
 *
 * Skills are keyed by their `id`; registering an id twice replaces the
 * previous registration, which keeps module re-initialization idempotent.
 */
export class SkillRegistry {
  private skills = new Map<string, ApplicationSkill>();

  /**
   * Registers (or replaces) a skill.
   *
   * @throws If the skill is malformed.
   */
  public registerSkill(skill: ApplicationSkill): void {
    if (!skill || typeof skill !== 'object') {
      throw new TypeError('registerSkill requires an ApplicationSkill object.');
    }
    if (typeof skill.id !== 'string' || skill.id.trim().length === 0) {
      throw new TypeError('ApplicationSkill.id must be a non-empty string.');
    }
    if (typeof skill.execute !== 'function') {
      throw new TypeError(`ApplicationSkill "${skill.id}" must implement execute().`);
    }
    if (typeof skill.getActions !== 'function') {
      throw new TypeError(`ApplicationSkill "${skill.id}" must implement getActions().`);
    }
    this.skills.set(skill.id, skill);
  }

  /**
   * Removes a skill from the registry.
   *
   * @returns `true` when a skill was removed.
   */
  public unregisterSkill(id: string): boolean {
    return this.skills.delete(id);
  }

  /**
   * Returns a registered skill by id.
   */
  public getSkill(id: string): ApplicationSkill | undefined {
    return this.skills.get(id);
  }

  /**
   * Returns all registered skills in registration order.
   */
  public listSkills(): ApplicationSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Reports whether a skill id is registered.
   */
  public hasSkill(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * Executes an action on a registered skill.
   *
   * Never throws: missing skills, unknown actions and skill failures are all
   * reported through the returned `SkillResult`. Execution time is measured
   * and reported in `executionTimeMs`.
   */
  public async executeAction(
    skillId: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<SkillResult> {
    const startedAt = Date.now();

    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill "${skillId}" is not registered.`,
        executionTimeMs: Date.now() - startedAt,
      };
    }

    if (typeof action !== 'string' || action.trim().length === 0) {
      return {
        success: false,
        error: 'Action name must be a non-empty string.',
        executionTimeMs: Date.now() - startedAt,
      };
    }

    // Reject actions the skill does not advertise, when the action list is
    // readable. A failing getActions() must not prevent execution.
    try {
      const actions = skill.getActions();
      if (Array.isArray(actions) && actions.length > 0 && !actions.some((a) => a.name === action)) {
        return {
          success: false,
          error: `Skill "${skillId}" does not define action "${action}".`,
          executionTimeMs: Date.now() - startedAt,
        };
      }
    } catch {
      // Action enumeration is advisory only; continue with execution.
    }

    try {
      const result = await skill.execute(action, params ?? {});
      if (!result || typeof result !== 'object') {
        return {
          success: false,
          error: `Skill "${skillId}" returned an invalid result for action "${action}".`,
          executionTimeMs: Date.now() - startedAt,
        };
      }
      return {
        ...result,
        success: Boolean(result.success),
        executionTimeMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        success: false,
        error: `Skill "${skillId}" failed on action "${action}": ${describeError(error)}`,
        executionTimeMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Verifies a previously produced result using the owning skill.
   *
   * @returns `false` for unknown skills, failed results or verifier errors.
   */
  public async verifyActionResult(
    skillId: string,
    action: string,
    result: SkillResult,
  ): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return false;
    }
    if (!result || !result.success) {
      return false;
    }
    try {
      return Boolean(await skill.verify(action, result));
    } catch {
      return false;
    }
  }

  /**
   * Exports a serializable catalog of all registered skills and actions.
   */
  public exportCatalog(): SkillCatalogEntry[] {
    return this.listSkills().map((skill) => {
      let actions: SkillActionDefinition[];
      try {
        const declared = skill.getActions();
        actions = Array.isArray(declared) ? declared : [];
      } catch {
        actions = [];
      }
      return {
        id: skill.id,
        name: skill.name,
        targetApp: skill.targetApp,
        description: skill.description,
        actions,
      };
    });
  }
}

/**
 * Produces a readable message from an unknown thrown value.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Default shared registry instance.
 */
export const skillRegistry = new SkillRegistry();
