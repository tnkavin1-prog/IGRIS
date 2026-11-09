import React, { useState } from 'react';

export interface SkillLauncherProps {
  onExecuteGoal?: (goal: string) => void;
  cpuUsage?: number;
  memoryUsagePercent?: number;
}

export function SkillLauncherPanel({ onExecuteGoal, cpuUsage = 15, memoryUsagePercent = 40 }: SkillLauncherProps) {
  const [selectedSkill, setSelectedSkill] = useState<string>('windows');
  const [customGoal, setCustomGoal] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const skills = [
    {
      id: 'windows',
      name: 'Windows OS Core',
      icon: '🪟',
      desc: 'Process lifecycle, window tiling, file search & organizer',
      status: 'Online',
      actions: [
        'Get real-time CPU & RAM telemetry',
        'Open Notepad and prepare scratchpad',
        'Search files in project workspace',
        'Organize downloads folder by file extension'
      ]
    },
    {
      id: 'office',
      name: 'Microsoft Office COM',
      icon: '📑',
      desc: 'Autonomous Word .docx, Excel .xlsx, and PowerPoint .pptx creation',
      status: 'Ready',
      actions: [
        'Create Word document for project status report',
        'Build Excel spreadsheet with system performance log',
        'Generate PowerPoint slides with architectural diagram'
      ]
    },
    {
      id: 'blender',
      name: 'Blender 3D Engine',
      icon: '🧊',
      desc: 'Headless CLI rendering, Python scene scripting, geometry generation',
      status: 'Ready',
      actions: [
        'Check Blender CLI installation status',
        'Render 3D test scene to PNG',
        'Execute headless Python automation script'
      ]
    },
    {
      id: 'creative',
      name: 'Adobe Creative Suite',
      icon: '🎨',
      desc: 'Photoshop, Premiere Pro, and After Effects JSX ExtendScript pipeline',
      status: 'Ready',
      actions: [
        'Inspect installed Creative Cloud desktop applications',
        'Run Photoshop batch layer export action',
        'Trigger ExtendScript composition render'
      ]
    },
    {
      id: 'opencode',
      name: 'OpenCode Free Models',
      icon: '⚡',
      desc: 'DeepSeek V4.1 Flash & GLM 5.3 Flash 100% free model dispatch',
      status: 'Connected',
      actions: [
        'List verified free OpenCode models',
        'Dispatch backend logic task to DeepSeek V4.1 Flash',
        'Dispatch frontend UI component to GLM 5.3 Flash'
      ]
    }
  ];

  const handleActionClick = (action: string) => {
    setFeedback(`Dispatched: ${action}`);
    onExecuteGoal?.(action);
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customGoal.trim()) return;
    setFeedback(`Executing: ${customGoal.trim()}`);
    onExecuteGoal?.(customGoal.trim());
    setCustomGoal('');
    setTimeout(() => setFeedback(null), 3000);
  };

  const active = skills.find(s => s.id === selectedSkill) || skills[0]!;

  return (
    <div className="skill-launcher-panel" style={{
      padding: '16px',
      background: 'rgba(10, 15, 25, 0.85)',
      backdropFilter: 'blur(20px)',
      borderRadius: '16px',
      border: '1px solid rgba(0, 240, 255, 0.25)',
      color: '#e6f1ff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>⚡</span>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, letterSpacing: '0.5px', color: '#00f0ff' }}>
            UNIVERSAL SKILL LAUNCHER
          </h3>
        </div>
        <span style={{
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '12px',
          background: 'rgba(0, 240, 255, 0.15)',
          color: '#00f0ff',
          border: '1px solid rgba(0, 240, 255, 0.3)'
        }}>
          🖥 CPU {cpuUsage.toFixed(0)}% · 💾 RAM {memoryUsagePercent.toFixed(0)}%
        </span>
      </div>

      {feedback && (
        <div style={{
          padding: '8px 12px',
          marginBottom: '12px',
          borderRadius: '8px',
          background: 'rgba(0, 255, 136, 0.15)',
          border: '1px solid rgba(0, 255, 136, 0.4)',
          color: '#00ff88',
          fontSize: '12px'
        }}>
          ✓ {feedback}
        </div>
      )}

      {/* Skill Tabs */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '14px', paddingBottom: '4px' }}>
        {skills.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelectedSkill(s.id)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: selectedSkill === s.id ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.1)',
              background: selectedSkill === s.id ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              color: selectedSkill === s.id ? '#ffffff' : '#8892b0',
              cursor: 'pointer',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
          >
            <span>{s.icon}</span>
            <span>{s.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Active Skill Card */}
      <div style={{
        padding: '14px',
        borderRadius: '12px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        marginBottom: '14px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>{active.icon}</span>
            <span style={{ fontWeight: 600, fontSize: '14px', color: '#ffffff' }}>{active.name}</span>
          </div>
          <span style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: 'rgba(0, 255, 136, 0.1)',
            color: '#00ff88',
            border: '1px solid rgba(0, 255, 136, 0.3)'
          }}>
            {active.status}
          </span>
        </div>
        <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#8892b0', lineHeight: 1.4 }}>
          {active.desc}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {active.actions.map((act, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleActionClick(act)}
              style={{
                textAlign: 'left',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'rgba(0, 240, 255, 0.06)',
                border: '1px solid rgba(0, 240, 255, 0.15)',
                color: '#ccd6f6',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{act}</span>
              <span style={{ color: '#00f0ff', fontSize: '10px' }}>RUN ▶</span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Goal Runner */}
      <form onSubmit={handleCustomSubmit} style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={customGoal}
          onChange={(e) => setCustomGoal(e.target.value)}
          placeholder={`Instruct ${active.name}...`}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(0, 240, 255, 0.25)',
            color: '#ffffff',
            fontSize: '12px',
            outline: 'none'
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #00f0ff 0%, #0077ff 100%)',
            border: 'none',
            color: '#000000',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          Dispatch
        </button>
      </form>
    </div>
  );
}
