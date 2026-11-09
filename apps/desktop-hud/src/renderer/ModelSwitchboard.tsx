import React, { useState } from 'react';

export interface ModelSwitchboardProps {
  onDispatchTest?: (modelKey: 'deepseek' | 'glm', prompt: string) => void;
}

export function ModelSwitchboard({ onDispatchTest }: ModelSwitchboardProps) {
  const [activeModel, setActiveModel] = useState<'deepseek' | 'glm'>('deepseek');
  const [testPrompt, setTestPrompt] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);

  const models = [
    {
      key: 'gemini' as const,
      name: 'Gemini 3.8 Flash',
      role: 'Master Brain & Chief Architect',
      status: 'Active Supervisor',
      cost: 'Antigravity Native',
      color: '#4285f4',
      badge: 'Master Intelligence'
    },
    {
      key: 'deepseek' as const,
      name: 'DeepSeek V4.1 Flash Free',
      role: 'Backend Architecture, Logic & Code',
      status: 'Verified Zero-Cost',
      cost: 'Free Tier (OpenCode)',
      color: '#00f0ff',
      badge: 'Primary Dev Agent'
    },
    {
      key: 'glm' as const,
      name: 'GLM 5.3 Flash Free',
      role: 'Frontend UI/UX, React, SVG & Animations',
      status: 'Verified Zero-Cost',
      cost: 'Free Tier (OpenCode)',
      color: '#a855f7',
      badge: 'Secondary Dev Agent'
    }
  ];

  const handleTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim()) return;
    setStatusText(`Dispatched test to ${activeModel.toUpperCase()}...`);
    onDispatchTest?.(activeModel, testPrompt.trim());
    setTestPrompt('');
    setTimeout(() => setStatusText(null), 4000);
  };

  return (
    <div className="model-switchboard" style={{
      padding: '16px',
      background: 'rgba(10, 15, 25, 0.85)',
      backdropFilter: 'blur(20px)',
      borderRadius: '16px',
      border: '1px solid rgba(168, 85, 247, 0.3)',
      color: '#e6f1ff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🧠</span>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#a855f7', letterSpacing: '0.5px' }}>
            TRI-MODEL ORCHESTRATION SWITCHBOARD
          </h3>
        </div>
        <span style={{
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '12px',
          background: 'rgba(168, 85, 247, 0.15)',
          color: '#a855f7',
          border: '1px solid rgba(168, 85, 247, 0.3)'
        }}>
          100% Free Tier Verified
        </span>
      </div>

      {statusText && (
        <div style={{
          padding: '8px 12px',
          marginBottom: '12px',
          borderRadius: '8px',
          background: 'rgba(0, 255, 136, 0.15)',
          border: '1px solid rgba(0, 255, 136, 0.4)',
          color: '#00ff88',
          fontSize: '12px'
        }}>
          ⚡ {statusText}
        </div>
      )}

      {/* Tri-Model Hierarchy Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        {models.map(m => (
          <div
            key={m.key}
            style={{
              padding: '12px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${m.color}33`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#ffffff' }}>{m.name}</span>
                <span style={{
                  fontSize: '9px',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: `${m.color}22`,
                  color: m.color,
                  border: `1px solid ${m.color}44`
                }}>
                  {m.badge}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#8892b0' }}>{m.role}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: '#00ff88', fontWeight: 500 }}>{m.status}</div>
              <div style={{ fontSize: '10px', color: '#8892b0' }}>{m.cost}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Model Selection and Direct Dispatch */}
      <div style={{
        padding: '12px',
        borderRadius: '10px',
        background: 'rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        <div style={{ fontSize: '12px', color: '#8892b0', marginBottom: '8px' }}>
          Direct AI Model Dispatcher (Zero Cost OpenCode Session):
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={() => setActiveModel('deepseek')}
            style={{
              flex: 1,
              padding: '6px',
              borderRadius: '6px',
              border: activeModel === 'deepseek' ? '1px solid #00f0ff' : '1px solid rgba(255, 255, 255, 0.1)',
              background: activeModel === 'deepseek' ? 'rgba(0, 240, 255, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              color: activeModel === 'deepseek' ? '#00f0ff' : '#8892b0',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500
            }}
          >
            DeepSeek V4.1 (Backend)
          </button>
          <button
            type="button"
            onClick={() => setActiveModel('glm')}
            style={{
              flex: 1,
              padding: '6px',
              borderRadius: '6px',
              border: activeModel === 'glm' ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.1)',
              background: activeModel === 'glm' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              color: activeModel === 'glm' ? '#a855f7' : '#8892b0',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500
            }}
          >
            GLM 5.3 (Frontend)
          </button>
        </div>

        <form onSubmit={handleTest} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            placeholder={`Prompt ${activeModel === 'deepseek' ? 'DeepSeek (Logic)' : 'GLM (UI)'}...`}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#ffffff',
              fontSize: '11px',
              outline: 'none'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: activeModel === 'deepseek' ? '#00f0ff' : '#a855f7',
              border: 'none',
              color: '#000000',
              fontWeight: 600,
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            Execute
          </button>
        </form>
      </div>
    </div>
  );
}
