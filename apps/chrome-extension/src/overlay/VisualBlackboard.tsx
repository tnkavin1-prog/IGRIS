import { useState, useEffect } from 'react';
import type { VisualBlackboardLesson } from '@gbl/shared';
import { Icon } from '../sidepanel/ui';
import { Spatial3DViewer } from './Spatial3DViewer';
import { buildSessionExportBundle, downloadFile } from '../tools/session-export';

export interface VisualBlackboardProps {
  lesson: VisualBlackboardLesson | null;
  onPopOutTab: () => void;
  onTriggerPrompt: (prompt: string) => void;
  onSelectSampleLesson?: (sample: VisualBlackboardLesson) => void;
}

const SAMPLE_LESSONS: VisualBlackboardLesson[] = [
  {
    id: 'sample_triangle_inradius',
    title: 'Equilateral Triangle & Inradius',
    topic: 'Geometry & Mensuration',
    diagramType: 'geometry',
    latexFormula:
      '\\text{Area} = \\frac{\\sqrt{3}}{4}a^2, \\quad r = \\frac{a}{2\\sqrt{3}} = \\frac{\\Delta}{s}',
    svgMarkup: `<svg viewBox="0 0 500 320" xmlns="http://www.w3.org/2000/svg" style="background:rgba(14,16,22,0.9);font-family:ui-monospace,monospace;">
      <defs>
        <filter id="chalkGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.45"/>
        </filter>
        <pattern id="chalkGrid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chalkGrid)" rx="10" />

      <!-- Shaded Incircle -->
      <circle cx="250" cy="195" r="58" fill="rgba(255,255,255,0.1)" stroke="#ffffff" stroke-width="2.5" stroke-dasharray="6 3" filter="url(#chalkGlow)"/>
      <circle cx="250" cy="195" r="3.5" fill="#ffffff"/>
      <text x="258" y="192" fill="#ffffff" font-size="13" font-weight="bold">Incenter (I)</text>

      <!-- Altitude Dashed Line -->
      <line x1="250" y1="75" x2="250" y2="255" stroke="rgba(255,255,255,0.8)" stroke-width="2" stroke-dasharray="5 4"/>
      <!-- Right angle marker -->
      <polyline points="250,243 262,243 262,255" fill="none" stroke="#ffffff" stroke-width="1.5"/>
      <text x="256" y="140" fill="#ffffff" font-size="12">h = (√3/2)a</text>

      <!-- Inradius Line -->
      <line x1="250" y1="195" x2="250" y2="255" stroke="#ffffff" stroke-width="2.8"/>
      <text x="232" y="230" fill="#ffffff" font-size="13" font-weight="bold">r</text>

      <!-- Equilateral Triangle ABC -->
      <polygon points="250,75 146,255 354,255" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linejoin="round" filter="url(#chalkGlow)"/>

      <!-- Vertex Labels -->
      <text x="245" y="60" fill="#ffffff" font-size="16" font-weight="bold">A (60°)</text>
      <text x="120" y="270" fill="#ffffff" font-size="16" font-weight="bold">B</text>
      <text x="360" y="270" fill="#ffffff" font-size="16" font-weight="bold">C</text>
      <text x="250" y="280" fill="rgba(255,255,255,0.75)" font-size="14" text-anchor="middle">Base side = a</text>

      <!-- Side lengths -->
      <text x="180" y="160" fill="rgba(255,255,255,0.75)" font-size="13">Side a</text>
      <text x="310" y="160" fill="rgba(255,255,255,0.75)" font-size="13">Side a</text>
    </svg>`,
    steps: [
      'For an equilateral triangle of side "a", all three internal angles are 60° and all sides are equal.',
      'The altitude (height) is derived using Pythagoras theorem: h = √(a² - (a/2)²) = (√3 / 2)a.',
      'Total Area Δ = 1/2 × base × height = 1/2 × a × (√3/2)a = (√3 / 4)a².',
      'Semi-perimeter s = (a + a + a) / 2 = 3a / 2.',
      'The inradius r is given by r = Δ / s = ((√3/4)a²) / (3a/2) = a / (2√3).',
    ],
    teachingNarration:
      'Notice how the altitude divides the equilateral triangle into two 30-60-90 right triangles. The incenter is simultaneously the centroid, which divides the altitude in a 2:1 ratio, meaning the inradius is exactly one-third of the total height!',
    createdAt: Date.now(),
  },
  {
    id: 'sample_circle_sector',
    title: 'Sector of a Circle & Arc Length',
    topic: 'Geometry & Mensuration',
    diagramType: 'geometry',
    latexFormula:
      '\\text{Area} = \\frac{\\theta}{360^\\circ} \\times \\pi r^2, \\quad \\text{Length of Arc } l = \\frac{\\theta}{360^\\circ} \\times 2\\pi r',
    svgMarkup: `<svg viewBox="0 0 500 320" xmlns="http://www.w3.org/2000/svg" style="background:rgba(14,16,22,0.9);font-family:ui-monospace,monospace;">
      <defs>
        <pattern id="chalkGrid2" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chalkGrid2)" rx="10" />

      <!-- Full ghost circle -->
      <circle cx="250" cy="160" r="110" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-dasharray="4 4"/>

      <!-- Shaded Sector (60 deg: from -30 deg to 30 deg) -->
      <path d="M 250 160 L 345.26 105 A 110 110 0 0 1 345.26 215 Z" fill="rgba(255,255,255,0.12)" stroke="#ffffff" stroke-width="3"/>

      <!-- Center point O -->
      <circle cx="250" cy="160" r="3.5" fill="#ffffff"/>
      <text x="228" y="165" fill="#ffffff" font-size="15" font-weight="bold">O</text>

      <!-- Radii labels -->
      <text x="285" y="125" fill="#ffffff" font-size="13" font-weight="bold">radius r</text>
      <text x="285" y="200" fill="#ffffff" font-size="13" font-weight="bold">radius r</text>

      <!-- Angle arc θ -->
      <path d="M 285 140 A 40 40 0 0 1 285 180" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="2"/>
      <text x="295" y="165" fill="#ffffff" font-size="15" font-weight="bold">θ</text>

      <!-- Arc length highlight -->
      <path d="M 345.26 105 A 110 110 0 0 1 345.26 215" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
      <text x="360" y="165" fill="#ffffff" font-size="14" font-weight="bold">Arc l = (θ/360°)×2πr</text>
    </svg>`,
    steps: [
      'A complete circle represents a full revolution of 360° with area πr² and circumference 2πr.',
      'A sector with central angle θ represents the exact fraction (θ / 360°) of the entire circle.',
      'Therefore, the length of the bounding circular arc is l = (θ / 360°) × 2πr.',
      'The area of the shaded sector is Area = (θ / 360°) × πr².',
      'Alternative formula linking arc length and area: Area = 1/2 × arc length (l) × radius (r).',
    ],
    teachingNarration:
      'Think of a sector as a slice of pizza! The fraction of the crust you get is θ/360 times the circumference, and the amount of pizza you eat is θ/360 times the total circle area.',
    createdAt: Date.now(),
  },
  {
    id: 'sample_trapezium',
    title: 'Trapezium Area Derivation',
    topic: 'Geometry & Mensuration',
    diagramType: 'geometry',
    latexFormula: '\\text{Area} = \\frac{1}{2} \\times (a + b) \\times h',
    svgMarkup: `<svg viewBox="0 0 500 320" xmlns="http://www.w3.org/2000/svg" style="background:rgba(14,16,22,0.9);font-family:ui-monospace,monospace;">
      <defs>
        <pattern id="chalkGrid3" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#chalkGrid3)" rx="10" />

      <!-- Trapezium polygon -->
      <polygon points="170,100 330,100 420,240 80,240" fill="rgba(255,255,255,0.08)" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>

      <!-- Parallel sides top & bottom arrows -->
      <text x="250" y="90" fill="#ffffff" font-size="14" text-anchor="middle" font-weight="bold">Parallel side (a)</text>
      <text x="250" y="265" fill="#ffffff" font-size="14" text-anchor="middle" font-weight="bold">Parallel side (b)</text>

      <!-- Height perpendicular line h -->
      <line x1="170" y1="100" x2="170" y2="240" stroke="rgba(255,255,255,0.85)" stroke-width="2.5" stroke-dasharray="5 4"/>
      <polyline points="170,228 182,228 182,240" fill="none" stroke="#ffffff" stroke-width="1.5"/>
      <text x="145" y="175" fill="#ffffff" font-size="14" font-weight="bold">h</text>

      <!-- Diagonal split line showing 2 triangles -->
      <line x1="170" y1="100" x2="420" y2="240" stroke="rgba(255,255,255,0.7)" stroke-width="1.8" stroke-dasharray="4 4"/>
      <text x="280" y="180" fill="rgba(255,255,255,0.85)" font-size="12">Diagonal divides into 2 triangles</text>

      <!-- Vertices -->
      <text x="155" y="95" fill="#ffffff" font-size="15" font-weight="bold">A</text>
      <text x="340" y="95" fill="#ffffff" font-size="15" font-weight="bold">B</text>
      <text x="430" y="255" fill="#ffffff" font-size="15" font-weight="bold">C</text>
      <text x="65" y="255" fill="#ffffff" font-size="15" font-weight="bold">D</text>
    </svg>`,
    steps: [
      'A trapezium has one pair of parallel sides (a and b) separated by a perpendicular distance (height h).',
      'Draw diagonal AC to divide the trapezium into two non-overlapping triangles: ΔABC and ΔADC.',
      'Area of triangle 1 (top, base a) = 1/2 × a × h.',
      'Area of triangle 2 (bottom, base b) = 1/2 × b × h.',
      'Sum the two areas: Total Area = 1/2 × a × h + 1/2 × b × h = 1/2 × (a + b) × h.',
    ],
    teachingNarration:
      'Notice that the area is simply the average of the two parallel sides multiplied by the height between them: Average base × height!',
    createdAt: Date.now(),
  },
];

export function VisualBlackboard({
  lesson: activeLesson,
  onPopOutTab,
  onTriggerPrompt,
  onSelectSampleLesson,
}: VisualBlackboardProps) {
  const [selectedSample, setSelectedSample] = useState<VisualBlackboardLesson | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const lesson = activeLesson || selectedSample;

  useEffect(() => {
    setCurrentStepIndex(0);
  }, [lesson?.id]);

  const handlePrevStep = () => {
    if (!lesson) return;
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextStep = () => {
    if (!lesson) return;
    setCurrentStepIndex((prev) => Math.min(lesson.steps.length - 1, prev + 1));
  };

  const handleExportNotes = () => {
    if (!lesson) return;
    const bundle = buildSessionExportBundle([], lesson);
    downloadFile(bundle.markdown, `${bundle.filenameBase}.md`, 'text/markdown;charset=utf-8');
    setExportNotice('Exported Markdown for GitHub/Drive!');
    setTimeout(() => setExportNotice(null), 3000);
  };

  return (
    <div className="compact-blackboard-container">
      {/* 1. Header Toolbar */}
      <div className="blackboard-top-bar">
        <div className="blackboard-title-group">
          <span className="chalk-badge">CHALKBOARD</span>
          <span className="blackboard-lesson-title" title={lesson?.title || 'Academic Tutor'}>
            {lesson?.title || 'Academic Visual Tutor'}
          </span>
          {lesson?.topic ? <span className="blackboard-topic-tag">{lesson.topic}</span> : null}
        </div>

        <div className="blackboard-actions">
          {/* 2D / 3D Spatial Mode Switch */}
          <div className="blackboard-mode-switch">
            <button
              type="button"
              className={`mode-btn ${viewMode === '2d' ? 'is-active' : ''}`}
              title="2D Chalkboard Sketch"
              onClick={() => setViewMode('2d')}
            >
              2D
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === '3d' ? 'is-active' : ''}`}
              title="3D Real-Time Spatial Projection"
              onClick={() => setViewMode('3d')}
            >
              3D
            </button>
          </div>

          <button
            type="button"
            className="blackboard-tool-btn export-btn"
            title="Export session study notes (Markdown & HTML for Google Drive/GitHub)"
            onClick={handleExportNotes}
          >
            <Icon name="download" size={12} />
            <span>Export</span>
          </button>

          <button
            type="button"
            className="blackboard-tool-btn"
            title="Open in dedicated full-screen tab"
            onClick={onPopOutTab}
          >
            <Icon name="external" size={12} />
            <span>Full</span>
          </button>
        </div>
      </div>

      {exportNotice ? (
        <div className="blackboard-export-toast">
          <span>✓ {exportNotice}</span>
        </div>
      ) : null}

      {/* 2. Main Content Area */}
      {lesson ? (
        <div className="blackboard-main-view">
          {/* Formula Callout */}
          {lesson.latexFormula ? (
            <div className="blackboard-formula-banner">
              <span className="formula-spark">✨</span>
              <span className="formula-label">Formula:</span>
              <code className="formula-code">{lesson.latexFormula}</code>
            </div>
          ) : null}

          {/* 2D Chalk Canvas or 3D Spatial Viewer */}
          {viewMode === '3d' ? (
            <Spatial3DViewer initialShape="rhombus_prism" />
          ) : (
            <div
              className="blackboard-canvas-wrapper"
              dangerouslySetInnerHTML={{
                __html: (lesson.svgMarkup || '')
                  .replace(/style="([^"]*)"/gi, (_match, styleContent) => {
                    const cleaned = styleContent.replace(
                      /background:\s*[^;]+;?/gi,
                      'background:transparent;',
                    );
                    return `style="${cleaned}"`;
                  })
                  .replace(
                    /<rect\s+width="100%"\s+height="100%"\s+fill="(?!(?:none|transparent|url\(#chalkGrid))[^"]*"\s*\/?>/gi,
                    '',
                  ),
              }}
            />
          )}

          {/* Step-by-Step Stepper */}
          {lesson.steps && lesson.steps.length > 0 ? (
            <div className="blackboard-stepper-box">
              <div className="stepper-header">
                <span className="stepper-title">
                  Visual Derivation · Step {currentStepIndex + 1} of {lesson.steps.length}
                </span>
                <div className="stepper-nav-btns">
                  <button
                    type="button"
                    className="step-btn"
                    disabled={currentStepIndex === 0}
                    onClick={handlePrevStep}
                  >
                    ◀ Prev
                  </button>
                  <button
                    type="button"
                    className="step-btn"
                    disabled={currentStepIndex === lesson.steps.length - 1}
                    onClick={handleNextStep}
                  >
                    Next ▶
                  </button>
                </div>
              </div>

              <div className="stepper-content">
                <p className="step-text">{lesson.steps[currentStepIndex]}</p>
              </div>

              <div className="stepper-pills">
                {lesson.steps.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`step-pill ${idx === currentStepIndex ? 'is-active' : ''}`}
                    onClick={() => setCurrentStepIndex(idx)}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Teacher Voice Narration Callout */}
          {lesson.teachingNarration ? (
            <div className="blackboard-narration-box">
              <div className="teacher-header">
                <Icon name="spark" size={12} />
                <span>Teacher Insight</span>
              </div>
              <p className="teacher-text">{lesson.teachingNarration}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="blackboard-empty-state">
          <div className="empty-chalk-icon">📐</div>
          <h4 className="empty-title">Academic Blackboard Ready</h4>
          <p className="empty-desc">
            Ask Gemini any math question, geometry proof, or formula derivation. It will draw the
            chalkboard diagram and explain step-by-step!
          </p>

          <div className="sample-prompts-section">
            <span className="sample-label">Try a lesson now:</span>
            <div className="sample-chips-grid">
              {SAMPLE_LESSONS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  className="sample-chip-btn"
                  onClick={() => {
                    setSelectedSample(sample);
                    if (onSelectSampleLesson) onSelectSampleLesson(sample);
                    onTriggerPrompt(
                      `Please explain ${sample.title} with formulas and visual sketches.`,
                    );
                  }}
                >
                  <span className="chip-icon">✏️</span>
                  <span>{sample.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
