import { useState } from 'react';
import type { VisualBlackboardLesson } from '../main/types.js';

export interface VisualBlackboardProps {
  lesson: VisualBlackboardLesson | null;
  onTriggerPrompt: (prompt: string) => void;
  onSelectSampleLesson: (sample: VisualBlackboardLesson) => void;
}

export const SAMPLE_LESSONS: VisualBlackboardLesson[] = [
  {
    id: 'sample_triangle_inradius',
    title: 'Equilateral Triangle & Inradius Proof',
    topic: 'Geometry & Mensuration',
    diagramType: 'geometry',
    latexFormula:
      '\\text{Area} = \\frac{\\sqrt{3}}{4}a^2, \\quad r = \\frac{a}{2\\sqrt{3}} = \\frac{\\Delta}{s}',
    svgMarkup: `<svg viewBox="0 0 500 320" xmlns="http://www.w3.org/2000/svg" style="background:rgba(14,16,22,0.92);font-family:ui-monospace,monospace;">
      <defs>
        <pattern id="chalkGrid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chalkGrid)" rx="10" />

      <!-- Incircle -->
      <circle cx="250" cy="195" r="58" fill="rgba(255,255,255,0.08)" stroke="#ffffff" stroke-width="2.2" stroke-dasharray="6 3"/>
      <circle cx="250" cy="195" r="3.5" fill="#ffffff"/>
      <text x="258" y="192" fill="#ffffff" font-size="13" font-weight="bold">Incenter (I)</text>

      <!-- Altitude -->
      <line x1="250" y1="75" x2="250" y2="255" stroke="rgba(255,255,255,0.8)" stroke-width="1.8" stroke-dasharray="5 4"/>
      <text x="256" y="140" fill="#ffffff" font-size="12">h = (√3/2)a</text>

      <!-- Inradius Line -->
      <line x1="250" y1="195" x2="250" y2="255" stroke="#ffffff" stroke-width="2.6"/>
      <text x="232" y="230" fill="#ffffff" font-size="13" font-weight="bold">r</text>

      <!-- Triangle ABC -->
      <polygon points="250,75 146,255 354,255" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>

      <text x="245" y="60" fill="#ffffff" font-size="16" font-weight="bold">A (60°)</text>
      <text x="120" y="270" fill="#ffffff" font-size="16" font-weight="bold">B</text>
      <text x="360" y="270" fill="#ffffff" font-size="16" font-weight="bold">C</text>
      <text x="250" y="280" fill="rgba(255,255,255,0.75)" font-size="14" text-anchor="middle">Base side = a</text>
    </svg>`,
    steps: [
      'For an equilateral triangle of side "a", all three internal angles are 60° and all sides are equal.',
      'The altitude h is derived by Pythagoras: h = √(a² - (a/2)²) = (√3 / 2)a.',
      'Total Area Δ = 1/2 × base × height = 1/2 × a × (√3/2)a = (√3 / 4)a².',
      'Semi-perimeter s = (a + a + a) / 2 = 3a / 2.',
      'The inradius r is given by r = Δ / s = ((√3/4)a²) / (3a/2) = a / (2√3).',
    ],
    teachingNarration:
      'The altitude divides the triangle into two 30-60-90 right triangles. The incenter is identical to the centroid, which divides the altitude in a 2:1 ratio, meaning the inradius is exactly one-third of the altitude h!',
    createdAt: Date.now(),
  },
  {
    id: 'sample_quadratic_formula',
    title: 'Quadratic Formula Proof via Completing the Square',
    topic: 'Algebra & Polynomials',
    diagramType: 'formula',
    latexFormula: 'ax^2 + bx + c = 0 \\implies x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    svgMarkup: `<svg viewBox="0 0 500 320" xmlns="http://www.w3.org/2000/svg" style="background:rgba(14,16,22,0.92);font-family:ui-monospace,monospace;">
      <defs>
        <pattern id="chalkGridQuad" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chalkGridQuad)" rx="10" />

      <!-- Completing the square geometric representation -->
      <rect x="70" y="70" width="160" height="160" fill="rgba(255,255,255,0.12)" stroke="#ffffff" stroke-width="2.5" />
      <text x="150" y="155" fill="#ffffff" font-size="18" text-anchor="middle">x²</text>

      <rect x="230" y="70" width="80" height="160" fill="rgba(255,255,255,0.06)" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 3" />
      <text x="270" y="155" fill="#ffffff" font-size="14" text-anchor="middle">(b/2a)x</text>

      <rect x="70" y="230" width="160" height="80" fill="rgba(255,255,255,0.06)" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 3" />
      <text x="150" y="275" fill="#ffffff" font-size="14" text-anchor="middle">(b/2a)x</text>

      <rect x="230" y="230" width="80" height="80" fill="rgba(255,255,255,0.2)" stroke="#ffffff" stroke-width="2.5" />
      <text x="270" y="275" fill="#ffffff" font-size="14" text-anchor="middle">(b/2a)²</text>
    </svg>`,
    steps: [
      'Start with standard quadratic polynomial: ax² + bx + c = 0 (a ≠ 0).',
      'Divide through by leading coefficient a: x² + (b/a)x + c/a = 0.',
      'Move the constant term to the right side: x² + (b/a)x = -c/a.',
      'Complete the square by adding (b / 2a)² to both sides: (x + b / 2a)² = (b² - 4ac) / 4a².',
      'Take square root of both sides: x + b/2a = ±√(b² - 4ac) / 2a.',
      'Isolate x: x = (-b ± √(b² - 4ac)) / 2a.',
    ],
    teachingNarration:
      'The discriminant Δ = b² - 4ac determines root nature: Δ > 0 gives two real distinct roots, Δ = 0 gives a double root, and Δ < 0 gives complex conjugate roots.',
    createdAt: Date.now(),
  },
  {
    id: 'sample_circle_sector',
    title: 'Circle Sector & Arc Length Formula',
    topic: 'Mensuration & Geometry',
    diagramType: 'mensuration',
    latexFormula:
      '\\text{Area} = \\frac{\\theta}{360^\\circ} \\pi r^2, \\quad \\text{Arc } l = \\frac{\\theta}{360^\\circ} 2\\pi r',
    svgMarkup: `<svg viewBox="0 0 500 320" xmlns="http://www.w3.org/2000/svg" style="background:rgba(14,16,22,0.92);font-family:ui-monospace,monospace;">
      <defs>
        <pattern id="chalkGridSec" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chalkGridSec)" rx="10" />

      <!-- Ghost circle -->
      <circle cx="250" cy="160" r="110" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" stroke-dasharray="4 4"/>

      <!-- Shaded Sector -->
      <path d="M 250 160 L 345.26 105 A 110 110 0 0 1 345.26 215 Z" fill="rgba(255,255,255,0.12)" stroke="#ffffff" stroke-width="2.8"/>

      <!-- Center O -->
      <circle cx="250" cy="160" r="3.5" fill="#ffffff"/>
      <text x="228" y="165" fill="#ffffff" font-size="15" font-weight="bold">O</text>

      <text x="285" y="125" fill="#ffffff" font-size="13">radius r</text>
      <text x="285" y="200" fill="#ffffff" font-size="13">radius r</text>
      <text x="365" y="165" fill="#ffffff" font-size="14" font-weight="bold">Arc l</text>
    </svg>`,
    steps: [
      'A full circle subtends 360° at the center with circumference 2πr and area πr².',
      'A sector with central angle θ represents the fraction (θ / 360°) of the complete circle.',
      'Arc length: l = (θ / 360°) × 2πr.',
      'Sector area: A = (θ / 360°) × πr².',
      'Relation with arc length: Sector Area = (1/2) × l × r.',
    ],
    teachingNarration:
      'Notice that Sector Area = 1/2 × l × r has the exact same structure as the area of a triangle (1/2 × base × height), where the curved arc acts as the base and radius acts as height!',
    createdAt: Date.now(),
  },
];

export function VisualBlackboard({
  lesson,
  onTriggerPrompt,
  onSelectSampleLesson,
}: VisualBlackboardProps) {
  const current: VisualBlackboardLesson = lesson || SAMPLE_LESSONS[0]!;
  const [activeStep, setActiveStep] = useState(0);

  return (
    <div className="blackboard-container">
      {/* Blackboard Top Bar */}
      <div className="blackboard-top">
        <div className="blackboard-title-group">
          <span className="blackboard-badge">{current.topic || 'Visual Lesson'}</span>
          <h3 className="blackboard-title">{current.title}</h3>
        </div>

        <div className="sample-lessons-select">
          <select
            className="blackboard-select"
            value={current.id}
            onChange={(e) => {
              const selected = SAMPLE_LESSONS.find((s) => s.id === e.target.value);
              if (selected) {
                setActiveStep(0);
                onSelectSampleLesson(selected);
              }
            }}
          >
            {SAMPLE_LESSONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mathematical Formula Banner */}
      {current.latexFormula ? (
        <div className="blackboard-formula-card">
          <div className="formula-label">Governing Formula</div>
          <div className="formula-math">$$ {current.latexFormula} $$</div>
        </div>
      ) : null}

      {/* Chalkboard SVG Visual Canvas */}
      {current.svgMarkup ? (
        <div
          className="chalkboard-canvas-frame"
          dangerouslySetInnerHTML={{ __html: current.svgMarkup }}
        />
      ) : null}

      {/* Proof / Derivation Steps */}
      {current.steps && current.steps.length > 0 ? (
        <div className="derivation-steps-section">
          <div className="steps-header">
            <span>Step-by-Step Proof</span>
            <span className="steps-count">
              {current.steps.length} {current.steps.length === 1 ? 'Step' : 'Steps'}
            </span>
          </div>

          <div className="steps-list">
            {current.steps.map((step, idx) => (
              <div
                key={idx}
                className={`step-item ${activeStep === idx ? 'is-active-step' : ''}`}
                onClick={() => setActiveStep(idx)}
              >
                <div className="step-num">{idx + 1}</div>
                <div className="step-content">{step}</div>
                <button
                  type="button"
                  className="step-explain-btn"
                  title="Ask Gemini Live to explain this step"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerPrompt(
                      `Please explain step ${idx + 1} of the ${current.title} derivation in detail: "${step}"`,
                    );
                  }}
                >
                  Explain
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Teacher Intuition / Commentary */}
      {current.teachingNarration ? (
        <div className="teacher-narration-card">
          <div className="narration-header">
            <span className="teacher-spark">✦</span>
            <span>Teacher Intuition</span>
          </div>
          <p className="narration-text">{current.teachingNarration}</p>
        </div>
      ) : null}
    </div>
  );
}
