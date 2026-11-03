/**
 * A deliberately tiny, auditable JSON-Schema subset.
 *
 * One source of truth per tool:
 *   - `toZodSchema()` produces the runtime validator for untrusted model args.
 *   - `toGeminiParameters()` produces the function-declaration schema.
 *
 * Keeping both derived from the same literal removes the classic class of bug
 * where the declaration and the validator drift apart.
 */
import { z } from 'zod';

export type SchemaNode = ObjectSchema | StringSchema | NumberSchema | BooleanSchema | ArraySchema;

export interface ObjectSchema {
  type: 'object';
  description?: string;
  properties: Record<string, SchemaNode>;
  required?: readonly string[];
  additionalProperties?: false;
}

export interface StringSchema {
  type: 'string';
  description?: string;
  enum?: readonly string[];
  maxLength?: number;
  minLength?: number;
}

export interface NumberSchema {
  type: 'integer' | 'number';
  description?: string;
  minimum?: number;
  maximum?: number;
}

export interface BooleanSchema {
  type: 'boolean';
  description?: string;
}

export interface ArraySchema {
  type: 'array';
  description?: string;
  items: SchemaNode;
  minItems?: number;
  maxItems?: number;
}

/** Gemini function-declaration schema (OpenAPI subset, upper-case types). */
export interface GeminiSchema {
  type: 'OBJECT' | 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'ARRAY';
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

const NUMERIC = /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;

export function toZodSchema(node: SchemaNode): z.ZodTypeAny {
  switch (node.type) {
    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, child] of Object.entries(node.properties)) {
        shape[key] = toZodSchema(child).optional();
      }
      let object = z.object(shape).strict();
      const required = node.required ?? [];
      if (required.length > 0) {
        object = object.superRefine((value, ctx) => {
          for (const key of required) {
            if (value[key] === undefined || value[key] === null) {
              ctx.addIssue({
                code: 'custom',
                path: [key],
                message: `Missing required argument "${key}".`,
              });
            }
          }
        }) as typeof object;
      }
      return object;
    }
    case 'string': {
      let s = z.string();
      if (node.minLength !== undefined) s = s.min(node.minLength);
      if (node.maxLength !== undefined) s = s.max(node.maxLength);
      if (node.enum) {
        const values = node.enum;
        return z.string().refine((v) => values.includes(v), {
          message: `Expected one of: ${values.join(', ')}`,
        });
      }
      return s;
    }
    case 'integer':
    case 'number': {
      const numeric = z.number();
      let bounded = node.type === 'integer' ? numeric.int() : numeric;
      if (node.minimum !== undefined) bounded = bounded.min(node.minimum);
      if (node.maximum !== undefined) bounded = bounded.max(node.maximum);
      return z.preprocess((value) => {
        if (typeof value === 'string' && NUMERIC.test(value.trim())) return Number(value);
        return value;
      }, bounded);
    }
    case 'boolean':
      return z.preprocess((value) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
      }, z.boolean());
    case 'array': {
      let array = z.array(toZodSchema(node.items));
      if (node.minItems !== undefined) array = array.min(node.minItems);
      if (node.maxItems !== undefined) array = array.max(node.maxItems);
      return array;
    }
  }
}

export interface ValidationSuccess {
  ok: true;
  value: Record<string, unknown>;
}
export interface ValidationFailure {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validateToolArgs(schema: ObjectSchema, raw: unknown): ValidationResult {
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const parsed = toZodSchema(schema).safeParse(candidate);
  if (parsed.success) {
    return { ok: true, value: parsed.data as Record<string, unknown> };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { ok: false, errors: errors.slice(0, 8) };
}

/** Convert to the exact shape Gemini expects in functionDeclarations. */
export function toGeminiParameters(node: SchemaNode): GeminiSchema {
  switch (node.type) {
    case 'object': {
      const properties: Record<string, GeminiSchema> = {};
      for (const [key, child] of Object.entries(node.properties)) {
        properties[key] = toGeminiParameters(child);
      }
      const out: GeminiSchema = { type: 'OBJECT', properties };
      if (node.description) out.description = node.description;
      if (node.required?.length) out.required = [...node.required];
      return out;
    }
    case 'string': {
      const out: GeminiSchema = { type: 'STRING' };
      if (node.description) out.description = node.description;
      if (node.enum) out.enum = [...node.enum];
      if (node.maxLength !== undefined) out.maxLength = node.maxLength;
      if (node.minLength !== undefined) out.minLength = node.minLength;
      return out;
    }
    case 'integer':
      return {
        type: 'INTEGER',
        ...(node.description ? { description: node.description } : {}),
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
      } as GeminiSchema;
    case 'number':
      return {
        type: 'NUMBER',
        ...(node.description ? { description: node.description } : {}),
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
      } as GeminiSchema;
    case 'boolean':
      return {
        type: 'BOOLEAN',
        ...(node.description ? { description: node.description } : {}),
      } as GeminiSchema;
    case 'array':
      return {
        type: 'ARRAY',
        items: toGeminiParameters(node.items),
        ...(node.description ? { description: node.description } : {}),
        ...(node.minItems !== undefined ? { minItems: node.minItems } : {}),
        ...(node.maxItems !== undefined ? { maxItems: node.maxItems } : {}),
      } as GeminiSchema;
  }
}

export function emptyObjectSchema(): ObjectSchema {
  return { type: 'object', properties: {}, required: [] };
}
