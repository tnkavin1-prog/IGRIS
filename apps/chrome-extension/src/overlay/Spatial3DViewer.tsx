import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type Shape3DType =
  'rhombus_prism' | 'cylinder' | 'cone' | 'sphere' | 'triangular_prism' | 'cuboid';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface Edge3D {
  p1: number;
  p2: number;
  color?: string;
  dashed?: boolean;
}

interface Face3D {
  indices: number[];
  color: string;
}

interface ShapeModel {
  name: string;
  category: string;
  formula: string;
  vertices: Point3D[];
  edges: Edge3D[];
  faces: Face3D[];
  labels: { text: string; pos: Point3D; color: string }[];
}

export function Spatial3DViewer({
  initialShape = 'rhombus_prism',
}: {
  initialShape?: Shape3DType;
}) {
  const [selectedShape, setSelectedShape] = useState<Shape3DType>(initialShape);
  const [rotX, setRotX] = useState<number>(-22);
  const [rotY, setRotY] = useState<number>(35);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const isDragging = useRef<boolean>(false);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const animFrameId = useRef<number | null>(null);

  // Auto-orbit animation loop
  useEffect(() => {
    if (!autoRotate) return;
    let lastTime = performance.now();
    const loop = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;
      setRotY((prev) => (prev + dt * 25) % 360);
      animFrameId.current = requestAnimationFrame(loop);
    };
    animFrameId.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [autoRotate]);

  // Pointer drag rotation
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture unsupported */
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setRotY((y) => y + dx * 0.7);
    setRotX((x) => Math.max(-85, Math.min(85, x - dy * 0.7)));
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* pointer capture unsupported */
    }
  };

  // Define 3D Geometry Models
  const getModel = useCallback((type: Shape3DType): ShapeModel => {
    switch (type) {
      case 'rhombus_prism': {
        // 3D Rhombus Prism: Base rhombus in XZ plane, extruded along Y
        const d1 = 120; // diagonal along X
        const d2 = 80; // diagonal along Z
        const h = 100; // height along Y
        const vertices: Point3D[] = [
          // Bottom rhombus (y = -h/2)
          { x: -d1 / 2, y: -h / 2, z: 0 }, // 0: Left
          { x: 0, y: -h / 2, z: d2 / 2 }, // 1: Front
          { x: d1 / 2, y: -h / 2, z: 0 }, // 2: Right
          { x: 0, y: -h / 2, z: -d2 / 2 }, // 3: Back
          // Top rhombus (y = h/2)
          { x: -d1 / 2, y: h / 2, z: 0 }, // 4
          { x: 0, y: h / 2, z: d2 / 2 }, // 5
          { x: d1 / 2, y: h / 2, z: 0 }, // 6
          { x: 0, y: h / 2, z: -d2 / 2 }, // 7
        ];
        const edges: Edge3D[] = [
          { p1: 0, p2: 1, color: '#ffffff' },
          { p1: 1, p2: 2, color: '#ffffff' },
          { p1: 2, p2: 3, color: '#ffffff' },
          { p1: 3, p2: 0, color: '#ffffff' },
          { p1: 4, p2: 5, color: '#ffffff' },
          { p1: 5, p2: 6, color: '#ffffff' },
          { p1: 6, p2: 7, color: '#ffffff' },
          { p1: 7, p2: 4, color: '#ffffff' },
          { p1: 0, p2: 4, color: '#ffffff' },
          { p1: 1, p2: 5, color: '#ffffff' },
          { p1: 2, p2: 6, color: '#ffffff' },
          { p1: 3, p2: 7, color: '#ffffff' },
          // Diagonals on top base
          { p1: 4, p2: 6, color: 'rgba(255, 255, 255, 0.6)', dashed: true },
          { p1: 5, p2: 7, color: 'rgba(255, 255, 255, 0.6)', dashed: true },
        ];
        const faces: Face3D[] = [
          { indices: [0, 1, 2, 3], color: 'rgba(255, 255, 255, 0.1)' },
          { indices: [4, 5, 6, 7], color: 'rgba(255, 255, 255, 0.12)' },
          { indices: [0, 1, 5, 4], color: 'rgba(255, 255, 255, 0.06)' },
          { indices: [1, 2, 6, 5], color: 'rgba(255, 255, 255, 0.06)' },
        ];
        return {
          name: '3D Rhombus Prism',
          category: '3D Mensuration',
          formula: 'Volume = 1/2 × d₁ × d₂ × h,  Total Area = d₁d₂ + 4ah',
          vertices,
          edges,
          faces,
          labels: [
            { text: 'd₁ (120)', pos: { x: 0, y: h / 2 + 12, z: 0 }, color: '#ffffff' },
            { text: 'Height h', pos: { x: d1 / 2 + 14, y: 0, z: 0 }, color: '#ffffff' },
          ],
        };
      }

      case 'cylinder': {
        const r = 60;
        const h = 120;
        const segments = 16;
        const vertices: Point3D[] = [];
        // Bottom ring (y = -h/2), Top ring (y = h/2)
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          vertices.push({ x: r * Math.cos(theta), y: -h / 2, z: r * Math.sin(theta) });
        }
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          vertices.push({ x: r * Math.cos(theta), y: h / 2, z: r * Math.sin(theta) });
        }
        const edges: Edge3D[] = [];
        for (let i = 0; i < segments; i++) {
          const next = (i + 1) % segments;
          edges.push({ p1: i, p2: next, color: '#ffffff' });
          edges.push({ p1: segments + i, p2: segments + next, color: '#ffffff' });
          if (i % 4 === 0) {
            edges.push({ p1: i, p2: segments + i, color: 'rgba(255, 255, 255, 0.85)' });
          }
        }
        // Center axis
        vertices.push({ x: 0, y: -h / 2, z: 0 }); // 2*segments
        vertices.push({ x: 0, y: h / 2, z: 0 }); // 2*segments + 1
        edges.push({
          p1: 2 * segments,
          p2: 2 * segments + 1,
          color: 'rgba(255, 255, 255, 0.6)',
          dashed: true,
        });
        return {
          name: '3D Right Circular Cylinder',
          category: '3D Mensuration',
          formula: 'Volume = πr²h,  Curved Surface Area = 2πrh,  Total Surface Area = 2πr(r+h)',
          vertices,
          edges,
          faces: [],
          labels: [
            { text: 'Radius r', pos: { x: r / 2, y: h / 2 + 10, z: 0 }, color: '#ffffff' },
            { text: 'Height h', pos: { x: 12, y: 0, z: 0 }, color: '#ffffff' },
          ],
        };
      }

      case 'cone': {
        const r = 65;
        const h = 130;
        const segments = 16;
        const vertices: Point3D[] = [];
        // Base ring (y = -h/2)
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          vertices.push({ x: r * Math.cos(theta), y: -h / 2, z: r * Math.sin(theta) });
        }
        // Apex vertex (y = h/2)
        const apexIdx = vertices.length;
        vertices.push({ x: 0, y: h / 2, z: 0 });
        // Base center
        const centerIdx = vertices.length;
        vertices.push({ x: 0, y: -h / 2, z: 0 });

        const edges: Edge3D[] = [];
        for (let i = 0; i < segments; i++) {
          const next = (i + 1) % segments;
          edges.push({ p1: i, p2: next, color: '#ffffff' });
          if (i % 4 === 0) {
            edges.push({ p1: i, p2: apexIdx, color: 'rgba(255, 255, 255, 0.85)' });
          }
        }
        edges.push({ p1: centerIdx, p2: apexIdx, color: 'rgba(255, 255, 255, 0.6)', dashed: true });
        return {
          name: '3D Right Circular Cone',
          category: '3D Mensuration',
          formula: 'Volume = 1/3 πr²h,  Slant Height l = √(r²+h²),  CSA = πrl',
          vertices,
          edges,
          faces: [],
          labels: [
            { text: 'Radius r', pos: { x: r / 2, y: -h / 2 - 12, z: 0 }, color: '#ffffff' },
            { text: 'Height h', pos: { x: 14, y: 0, z: 0 }, color: '#ffffff' },
            { text: 'Slant l', pos: { x: r / 2 + 14, y: 0, z: 0 }, color: '#ffffff' },
          ],
        };
      }

      case 'sphere': {
        const r = 70;
        const segments = 24;
        const vertices: Point3D[] = [];
        const edges: Edge3D[] = [];

        // Equator ring (XZ)
        const eqStart = vertices.length;
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          vertices.push({ x: r * Math.cos(theta), y: 0, z: r * Math.sin(theta) });
        }
        for (let i = 0; i < segments; i++) {
          edges.push({ p1: eqStart + i, p2: eqStart + ((i + 1) % segments), color: '#ffffff' });
        }

        // Meridian ring (XY)
        const xyStart = vertices.length;
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          vertices.push({ x: r * Math.cos(theta), y: r * Math.sin(theta), z: 0 });
        }
        for (let i = 0; i < segments; i++) {
          edges.push({
            p1: xyStart + i,
            p2: xyStart + ((i + 1) % segments),
            color: 'rgba(255, 255, 255, 0.85)',
          });
        }

        // Longitudinal ring (YZ)
        const yzStart = vertices.length;
        for (let i = 0; i < segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          vertices.push({ x: 0, y: r * Math.cos(theta), z: r * Math.sin(theta) });
        }
        for (let i = 0; i < segments; i++) {
          edges.push({
            p1: yzStart + i,
            p2: yzStart + ((i + 1) % segments),
            color: 'rgba(255, 255, 255, 0.7)',
          });
        }

        return {
          name: '3D Sphere & Great Circles',
          category: '3D Mensuration',
          formula: 'Volume = 4/3 πr³,  Surface Area = 4πr²',
          vertices,
          edges,
          faces: [],
          labels: [{ text: 'Radius r (70)', pos: { x: r / 2, y: 12, z: 0 }, color: '#ffffff' }],
        };
      }

      case 'cuboid':
      default: {
        const l = 110;
        const w = 70;
        const h = 90;
        const vertices: Point3D[] = [
          { x: -l / 2, y: -h / 2, z: -w / 2 },
          { x: l / 2, y: -h / 2, z: -w / 2 },
          { x: l / 2, y: -h / 2, z: w / 2 },
          { x: -l / 2, y: -h / 2, z: w / 2 },
          { x: -l / 2, y: h / 2, z: -w / 2 },
          { x: l / 2, y: h / 2, z: -w / 2 },
          { x: l / 2, y: h / 2, z: w / 2 },
          { x: -l / 2, y: h / 2, z: w / 2 },
        ];
        const edges: Edge3D[] = [
          { p1: 0, p2: 1, color: '#ffffff' },
          { p1: 1, p2: 2, color: '#ffffff' },
          { p1: 2, p2: 3, color: '#ffffff' },
          { p1: 3, p2: 0, color: '#ffffff' },
          { p1: 4, p2: 5, color: '#ffffff' },
          { p1: 5, p2: 6, color: '#ffffff' },
          { p1: 6, p2: 7, color: '#ffffff' },
          { p1: 7, p2: 4, color: '#ffffff' },
          { p1: 0, p2: 4, color: '#ffffff' },
          { p1: 1, p2: 5, color: '#ffffff' },
          { p1: 2, p2: 6, color: '#ffffff' },
          { p1: 3, p2: 7, color: '#ffffff' },
          // Body diagonal
          { p1: 0, p2: 6, color: 'rgba(255, 255, 255, 0.6)', dashed: true },
        ];
        return {
          name: '3D Rectangular Prism (Cuboid)',
          category: '3D Mensuration',
          formula: 'Volume = l × b × h,  Body Diagonal = √(l² + b² + h²)',
          vertices,
          edges,
          faces: [
            { indices: [4, 5, 6, 7], color: 'rgba(255, 255, 255, 0.12)' },
            { indices: [0, 1, 2, 3], color: 'rgba(255, 255, 255, 0.08)' },
          ],
          labels: [
            { text: 'Length l', pos: { x: 0, y: -h / 2 - 12, z: w / 2 }, color: '#ffffff' },
            { text: 'Height h', pos: { x: l / 2 + 12, y: 0, z: w / 2 }, color: '#ffffff' },
            { text: 'Diagonal', pos: { x: 0, y: 0, z: 0 }, color: '#ffffff' },
          ],
        };
      }
    }
  }, []);

  const model = getModel(selectedShape);

  // 3D Matrix Projection
  const radX = (rotX * Math.PI) / 180;
  const radY = (rotY * Math.PI) / 180;
  const cosX = Math.cos(radX);
  const sinX = Math.sin(radX);
  const cosY = Math.cos(radY);
  const sinY = Math.sin(radY);

  const project = (p: Point3D): { px: number; py: number; depth: number } => {
    // Rotate Y
    const x1 = p.x * cosY + p.z * sinY;
    const y1 = p.y;
    const z1 = -p.x * sinY + p.z * cosY;
    // Rotate X
    const x2 = x1;
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = y1 * sinX + z1 * cosX;

    // Perspective projection
    const fov = 380;
    const cameraZ = 280;
    const scale = fov / (cameraZ + z2);
    const centerX = 210;
    const centerY = 130;

    return {
      px: centerX + x2 * scale,
      py: centerY - y2 * scale,
      depth: z2,
    };
  };

  const projectedVertices = model.vertices.map(project);

  return (
    <div className="spatial-3d-container">
      {/* 3D Top Control Bar */}
      <div className="spatial-3d-bar">
        <div className="spatial-shape-selector">
          <button
            type="button"
            className={`shape-pill ${selectedShape === 'rhombus_prism' ? 'is-active' : ''}`}
            onClick={() => setSelectedShape('rhombus_prism')}
          >
            Rhombus
          </button>
          <button
            type="button"
            className={`shape-pill ${selectedShape === 'cylinder' ? 'is-active' : ''}`}
            onClick={() => setSelectedShape('cylinder')}
          >
            Cylinder
          </button>
          <button
            type="button"
            className={`shape-pill ${selectedShape === 'cone' ? 'is-active' : ''}`}
            onClick={() => setSelectedShape('cone')}
          >
            Cone
          </button>
          <button
            type="button"
            className={`shape-pill ${selectedShape === 'sphere' ? 'is-active' : ''}`}
            onClick={() => setSelectedShape('sphere')}
          >
            Sphere
          </button>
          <button
            type="button"
            className={`shape-pill ${selectedShape === 'cuboid' ? 'is-active' : ''}`}
            onClick={() => setSelectedShape('cuboid')}
          >
            Cuboid
          </button>
        </div>

        <button
          type="button"
          className={`orbit-toggle-btn ${autoRotate ? 'is-spinning' : ''}`}
          title={autoRotate ? 'Pause 3D rotation' : 'Start 3D rotation'}
          onClick={() => setAutoRotate(!autoRotate)}
        >
          <span>{autoRotate ? '⏸ Orbit' : '▶ Orbit'}</span>
        </button>
      </div>

      {/* 3D Interactive Canvas */}
      <div
        className="spatial-canvas-touchzone"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="spatial-drag-hint">Drag to rotate 360°</div>
        <svg className="spatial-svg" viewBox="0 0 420 260">
          <defs>
            <filter id="spatialGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="1.5"
                floodColor="#ffffff"
                floodOpacity="0.4"
              />
            </filter>
          </defs>

          {/* 3D Origin Axes Grid */}
          <g opacity="0.35">
            <line x1="210" y1="130" x2="260" y2="130" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="210" y1="130" x2="210" y2="80" stroke="#ffffff" strokeWidth="1.5" />
            <line x1="210" y1="130" x2="180" y2="160" stroke="#ffffff" strokeWidth="1.5" />
          </g>

          {/* Shaded Faces */}
          {model.faces.map((face, fIdx) => {
            const pointsStr = face.indices
              .map((i) => {
                const p = projectedVertices[i];
                return p ? `${p.px.toFixed(1)},${p.py.toFixed(1)}` : '';
              })
              .filter(Boolean)
              .join(' ');
            return pointsStr ? (
              <polygon key={fIdx} points={pointsStr} fill={face.color} stroke="none" />
            ) : null;
          })}

          {/* 3D Edges */}
          {model.edges.map((edge, eIdx) => {
            const p1 = projectedVertices[edge.p1];
            const p2 = projectedVertices[edge.p2];
            if (!p1 || !p2) return null;
            return (
              <line
                key={eIdx}
                x1={p1.px}
                y1={p1.py}
                x2={p2.px}
                y2={p2.py}
                stroke={edge.color || '#f8fafc'}
                strokeWidth={edge.dashed ? 1.8 : 2.4}
                strokeDasharray={edge.dashed ? '4 3' : 'none'}
                strokeLinecap="round"
                filter="url(#spatialGlow)"
              />
            );
          })}

          {/* 3D Vertices */}
          {projectedVertices.map((p, vIdx) => (
            <circle key={vIdx} cx={p.px} cy={p.py} r="2.8" fill="#ffffff" opacity="0.8" />
          ))}

          {/* 3D Dynamic Coordinate Labels */}
          {model.labels.map((lbl, lIdx) => {
            const proj = project(lbl.pos);
            return (
              <text
                key={lIdx}
                x={proj.px}
                y={proj.py}
                fill={lbl.color}
                fontSize="11.5"
                fontWeight="bold"
                textAnchor="middle"
                fontFamily="ui-monospace,monospace"
              >
                {lbl.text}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Governing 3D Formula Badge */}
      <div className="spatial-formula-card">
        <span className="spatial-name">{model.name}</span>
        <code className="spatial-code">{model.formula}</code>
      </div>
    </div>
  );
}
