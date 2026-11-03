import { describe, expect, it } from 'vitest';
import {
  emptyObjectSchema,
  toGeminiParameters,
  toZodSchema,
  validateToolArgs,
  type ObjectSchema,
} from '@gbl/shared';

const personSchema: ObjectSchema = {
  type: 'object',
  description: 'A person record.',
  properties: {
    name: { type: 'string', description: 'Full name.', minLength: 1, maxLength: 80 },
    age: { type: 'integer', description: 'Age in years.', minimum: 0, maximum: 150 },
    score: { type: 'number', minimum: 0, maximum: 1 },
    active: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    role: { type: 'string', enum: ['admin', 'user'] },
  },
  required: ['name'],
};

describe('validateToolArgs', () => {
  it('accepts a minimal valid payload and preserves unknown-free data', () => {
    const result = validateToolArgs(personSchema, { name: 'Ada' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Ada' });
  });

  it('reports missing required fields with their path', () => {
    const result = validateToolArgs(personSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('name');
      expect(result.errors.join(' ')).toContain('Missing required argument');
    }
  });

  it('rejects unknown properties instead of silently dropping them', () => {
    const result = validateToolArgs(personSchema, { name: 'Ada', injected: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('injected');
  });

  it('coerces numeric strings and boolean strings from model output', () => {
    const result = validateToolArgs(personSchema, { name: 'Ada', age: '36', active: 'true' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.age).toBe(36);
      expect(result.value.active).toBe(true);
    }
  });

  it('rejects non-numeric strings for numeric fields', () => {
    const result = validateToolArgs(personSchema, { name: 'Ada', age: 'thirty' });
    expect(result.ok).toBe(false);
  });

  it('enforces integer, range, enum, and length constraints', () => {
    expect(validateToolArgs(personSchema, { name: 'Ada', age: 1.5 }).ok).toBe(false);
    expect(validateToolArgs(personSchema, { name: 'Ada', age: 151 }).ok).toBe(false);
    expect(validateToolArgs(personSchema, { name: 'Ada', score: 2 }).ok).toBe(false);
    expect(validateToolArgs(personSchema, { name: 'Ada', role: 'root' }).ok).toBe(false);
    expect(validateToolArgs(personSchema, { name: '' }).ok).toBe(false);
    expect(validateToolArgs(personSchema, { name: 'x'.repeat(81) }).ok).toBe(false);
    expect(validateToolArgs(personSchema, { name: 'Ada', tags: ['a', 'b', 'c', 'd'] }).ok).toBe(
      false,
    );
  });

  it('treats null, arrays, and primitives as an empty object rather than crashing', () => {
    for (const raw of [null, undefined, [], 'text', 42]) {
      const result = validateToolArgs(personSchema, raw);
      expect(result.ok, String(raw)).toBe(false);
    }
  });

  it('supports the empty-object schema used by no-argument tools', () => {
    expect(validateToolArgs(emptyObjectSchema(), {}).ok).toBe(true);
    expect(validateToolArgs(emptyObjectSchema(), { extra: 1 }).ok).toBe(false);
  });

  it('caps the number of reported errors', () => {
    const wide: ObjectSchema = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `field${index}`,
          { type: 'string' as const, minLength: 5 },
        ]),
      ),
      required: Array.from({ length: 20 }, (_, index) => `field${index}`),
    };
    const result = validateToolArgs(wide, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeLessThanOrEqual(8);
  });
});

describe('toGeminiParameters', () => {
  it('emits the upper-case OpenAPI subset Gemini expects', () => {
    expect(toGeminiParameters(personSchema)).toEqual({
      type: 'OBJECT',
      description: 'A person record.',
      properties: {
        name: { type: 'STRING', description: 'Full name.', minLength: 1, maxLength: 80 },
        age: { type: 'INTEGER', description: 'Age in years.', minimum: 0, maximum: 150 },
        score: { type: 'NUMBER', minimum: 0, maximum: 1 },
        active: { type: 'BOOLEAN' },
        tags: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 3 },
        role: { type: 'STRING', enum: ['admin', 'user'] },
      },
      required: ['name'],
    });
  });

  it('does not emit undefined optional keys', () => {
    const schema = toGeminiParameters({ type: 'object', properties: {} });
    expect(Object.keys(schema).sort()).toEqual(['properties', 'type']);
    expect(schema).not.toHaveProperty('required');
    expect(schema).not.toHaveProperty('description');
  });

  it('produces a schema that zod can validate without throwing', () => {
    expect(() => toZodSchema(personSchema)).not.toThrow();
  });
});
