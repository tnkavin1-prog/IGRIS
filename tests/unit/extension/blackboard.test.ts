import { describe, expect, it } from 'vitest';
import { TOOL_BY_NAME, validateToolArgs } from '@gbl/shared';

describe('teach_visual_blackboard tool definition', () => {
  const tool = TOOL_BY_NAME.get('teach_visual_blackboard');

  it('exists in the tool catalog with correct category and approval policy', () => {
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('visual');
    expect(tool?.approval).toBe('never');
  });

  it('validates a complete blackboard lesson payload', () => {
    const validArgs = {
      title: 'Equilateral Triangle & Inradius',
      topic: 'Geometry & Mensuration',
      diagram_type: 'geometry',
      latex_formula: '\\text{Area} = \\frac{\\sqrt{3}}{4}a^2, \\quad r = \\frac{a}{2\\sqrt{3}}',
      svg_markup: '<svg viewBox="0 0 500 320"><polygon points="250,75 146,255 354,255"/></svg>',
      steps: [
        'An equilateral triangle has all three sides equal to a.',
        'The altitude is (√3/2)a.',
        'The inradius r is a / (2√3).',
      ],
      teaching_narration:
        'Notice how the altitude divides the triangle into two 30-60-90 triangles.',
      open_in_new_tab: false,
    };

    const result = validateToolArgs(tool!.parameters, validArgs);
    expect(result.ok).toBe(true);
  });

  it('requires title, svg_markup, and steps', () => {
    const missingArgs = {
      topic: 'Geometry',
    };
    const result = validateToolArgs(tool!.parameters, missingArgs);
    expect(result.ok).toBe(false);
  });
});

describe('open_teaching_blackboard_tab tool definition', () => {
  const tool = TOOL_BY_NAME.get('open_teaching_blackboard_tab');

  it('exists in the tool catalog with correct properties', () => {
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('visual');
    expect(tool?.approval).toBe('never');
  });

  it('validates without requiring optional parameters', () => {
    const result = validateToolArgs(tool!.parameters, {});
    expect(result.ok).toBe(true);
  });
});
