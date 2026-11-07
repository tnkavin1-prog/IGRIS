import { useState, useEffect, useRef } from 'react';
import type { VisualBlackboardLesson } from '@gbl/shared';
import { Spatial3DViewer } from '../overlay/Spatial3DViewer';
import { buildSessionExportBundle, downloadFile } from '../tools/session-export';

const DEFAULT_SAMPLE_LESSON: VisualBlackboardLesson = {
  id: 'lesson_equilateral_triangle',
  title: 'Equilateral Triangle: Altitude, Area & Inradius',
  topic: 'Geometry & Mensuration (SSC CGL / Tier-1)',
  diagramType: 'geometry',
  latexFormula:
    '\\text{Area} = \\frac{\\sqrt{3}}{4}a^2, \\quad h = \\frac{\\sqrt{3}}{2}a, \\quad r = \\frac{a}{2\\sqrt{3}} = \\frac{\\Delta}{s}',
  svgMarkup: `<svg viewBox="0 0 600 380" xmlns="http://www.w3.org/2000/svg" style="background:#09120e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
    <defs>
      <filter id="chalkGlowLg" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.35"/>
      </filter>
      <pattern id="chalkGridLg" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#chalkGridLg)" rx="12" />

    <!-- Incircle (Inradius r) -->
    <circle cx="300" cy="235" r="70" fill="rgba(110,231,183,0.14)" stroke="#6ee7b7" stroke-width="3" stroke-dasharray="7 4" filter="url(#chalkGlowLg)"/>
    <circle cx="300" cy="235" r="4.5" fill="#6ee7b7"/>
    <text x="312" y="232" fill="#6ee7b7" font-size="14" font-weight="bold">Incenter (I)</text>

    <!-- Altitude (Height h) -->
    <line x1="300" y1="90" x2="300" y2="305" stroke="#fde047" stroke-width="2.5" stroke-dasharray="6 4"/>
    <polyline points="300,290 315,290 315,305" fill="none" stroke="#fde047" stroke-width="1.8"/>
    <text x="308" y="160" fill="#fde047" font-size="13" font-weight="bold">Altitude h = (√3/2)a</text>

    <!-- Inradius vector -->
    <line x1="300" y1="235" x2="300" y2="305" stroke="#38bdf8" stroke-width="3.5"/>
    <text x="278" y="275" fill="#38bdf8" font-size="15" font-weight="bold">r</text>

    <!-- Triangle ABC Perimeter -->
    <polygon points="300,90 175,305 425,305" fill="none" stroke="#f8fafc" stroke-width="3.6" stroke-linejoin="round" filter="url(#chalkGlowLg)"/>

    <!-- Vertex Labels -->
    <text x="295" y="70" fill="#f8fafc" font-size="18" font-weight="bold">A (60°)</text>
    <text x="145" y="325" fill="#f8fafc" font-size="18" font-weight="bold">B (60°)</text>
    <text x="435" y="325" fill="#f8fafc" font-size="18" font-weight="bold">C (60°)</text>

    <!-- Side and Base dimensions -->
    <text x="300" y="340" fill="#94a3b8" font-size="15" text-anchor="middle">Base side BC = a</text>
    <text x="205" y="190" fill="#94a3b8" font-size="14">Side AB = a</text>
    <text x="380" y="190" fill="#94a3b8" font-size="14">Side AC = a</text>
  </svg>`,
  steps: [
    'Definition: In an equilateral triangle, all three sides are equal (a) and each internal angle is 60°.',
    'Altitude Derivation: Dropping a perpendicular from vertex A bisects base BC into two segments of length a/2. By Pythagoras theorem: h = √(a² - (a/2)²) = √(3a²/4) = (√3 / 2)a.',
    'Area Formula: Total Area Δ = 1/2 × base × height = 1/2 × a × ((√3/2)a) = (√3 / 4)a².',
    'Semi-perimeter (s): s = (a + a + a) / 2 = 3a / 2.',
    'Inradius (r): For any polygon with area Δ and semi-perimeter s, r = Δ / s. Substituting gives r = ((√3/4)a²) / (3a/2) = a / (2√3).',
    'Circumradius (R): R = a / √3. Crucial ratio: R : r = 2 : 1.',
  ],
  teachingNarration:
    'Notice that in an equilateral triangle, the centroid, circumcenter, orthocenter, and incenter all coincide at the exact same point! The centroid divides the altitude in a 2:1 ratio from vertex to base, which immediately proves that the circumradius R is twice the inradius r.',
  createdAt: Date.now(),
};

export function BlackboardApp() {
  const [lesson, setLesson] = useState<VisualBlackboardLesson>(DEFAULT_SAMPLE_LESSON);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [gridStyle, setGridStyle] = useState<'grid' | 'dots' | 'clean'>('grid');
  const canvasRef = useRef<HTMLDivElement>(null);

  // Sync with Chrome storage and runtime messages
  useEffect(() => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local
          .get('gbl_active_blackboard')
          .then((data) => {
            if (data?.gbl_active_blackboard) {
              setLesson(data.gbl_active_blackboard as VisualBlackboardLesson);
            }
          })
          .catch(() => undefined);
      }

      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        const listener = (message: { type?: string; lesson?: VisualBlackboardLesson }) => {
          if (message?.type === 'GBL_BLACKBOARD_UPDATE' && message.lesson) {
            setLesson(message.lesson);
            setActiveStep(0);
          }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');

  const handleExportSvg = () => {
    if (!lesson) return;
    const blob = new Blob([lesson.svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${lesson.title.replace(/\s+/g, '_').toLowerCase()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    if (!lesson) return;
    const bundle = buildSessionExportBundle([], lesson);
    downloadFile(bundle.markdown, `${bundle.filenameBase}.md`, 'text/markdown;charset=utf-8');
  };

  const handleExportHtml = () => {
    if (!lesson) return;
    const bundle = buildSessionExportBundle([], lesson);
    downloadFile(bundle.html, `${bundle.filenameBase}.html`, 'text/html;charset=utf-8');
  };

  return (
    <div className={`blackboard-full-layout grid-${gridStyle}`}>
      {/* 1. Classroom Top Navigation */}
      <header className="blackboard-header">
        <div className="header-left">
          <div className="gemini-teacher-badge">
            <span className="sparkle">✦</span>
            <span>Gemini Visual Academic Blackboard</span>
          </div>
          <h1 className="header-title">{lesson.title}</h1>
          {lesson.topic ? <span className="header-topic">{lesson.topic}</span> : null}
        </div>

        <div className="header-right">
          {/* 2D / 3D Spatial Selector */}
          <div className="grid-selector">
            <button
              type="button"
              className={`grid-btn ${viewMode === '2d' ? 'is-active' : ''}`}
              onClick={() => setViewMode('2d')}
            >
              2D Sketch
            </button>
            <button
              type="button"
              className={`grid-btn ${viewMode === '3d' ? 'is-active' : ''}`}
              onClick={() => setViewMode('3d')}
            >
              3D Spatial
            </button>
          </div>

          <div className="grid-selector">
            <button
              type="button"
              className={`grid-btn ${gridStyle === 'grid' ? 'is-active' : ''}`}
              onClick={() => setGridStyle('grid')}
            >
              Grid
            </button>
            <button
              type="button"
              className={`grid-btn ${gridStyle === 'dots' ? 'is-active' : ''}`}
              onClick={() => setGridStyle('dots')}
            >
              Dots
            </button>
            <button
              type="button"
              className={`grid-btn ${gridStyle === 'clean' ? 'is-active' : ''}`}
              onClick={() => setGridStyle('clean')}
            >
              Slate
            </button>
          </div>

          <button
            type="button"
            className="action-btn"
            title="Export Markdown file for GitHub or Google Drive"
            onClick={handleExportMarkdown}
          >
            📄 Export Markdown
          </button>
          <button
            type="button"
            className="action-btn"
            title="Export self-contained HTML study note"
            onClick={handleExportHtml}
          >
            🌐 Export HTML
          </button>
          <button type="button" className="action-btn" onClick={handleExportSvg}>
            📥 Export SVG
          </button>
          <button type="button" className="action-btn print-btn" onClick={() => window.print()}>
            🖨️ Print
          </button>
        </div>
      </header>

      {/* 2. Main Teaching Arena */}
      <main className="blackboard-arena">
        {/* Left: Chalkboard Drawing Canvas */}
        <section className="canvas-section">
          <div className="chalkboard-frame">
            <div className="frame-wood-trim">
              <span className="chalk-label">
                {viewMode === '3d'
                  ? '3D Spatial Interactive Geometry'
                  : '2D Chalkboard Mathematical Sketch'}{' '}
                · Tier 1 AI Tutor
              </span>
            </div>
            {viewMode === '3d' ? (
              <div
                style={{
                  padding: '12px',
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Spatial3DViewer initialShape="rhombus_prism" />
              </div>
            ) : (
              <div
                className="chalk-drawing-surface"
                ref={canvasRef}
                dangerouslySetInnerHTML={{ __html: lesson.svgMarkup }}
              />
            )}
          </div>

          {/* Teacher Narration Box */}
          {lesson.teachingNarration ? (
            <div className="teacher-narration-banner">
              <div className="teacher-badge-tag">
                <span>👨‍🏫 Teacher's Intuition & Proof Insight:</span>
              </div>
              <p className="teacher-narration-text">{lesson.teachingNarration}</p>
            </div>
          ) : null}
        </section>

        {/* Right: Formulas & Step-by-Step Derivation */}
        <aside className="derivation-sidebar">
          {/* Formula Card */}
          {lesson.latexFormula ? (
            <div className="formula-card">
              <div className="card-header">
                <span className="card-kicker">GOVERNING FORMULAS</span>
              </div>
              <div className="formula-body">
                <code className="latex-render">{lesson.latexFormula}</code>
              </div>
            </div>
          ) : null}

          {/* Step-by-Step Walkthrough */}
          <div className="steps-card">
            <div className="card-header">
              <span className="card-kicker">STEP-BY-STEP MATHEMATICAL PROOF</span>
              <span className="step-count">
                {activeStep + 1} / {lesson.steps.length}
              </span>
            </div>

            <div className="steps-list">
              {lesson.steps.map((stepText, idx) => (
                <div
                  key={idx}
                  className={`step-item ${idx === activeStep ? 'is-active' : ''}`}
                  onClick={() => setActiveStep(idx)}
                >
                  <div className="step-num-badge">{idx + 1}</div>
                  <div className="step-body">
                    <p className="step-paragraph">{stepText}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
