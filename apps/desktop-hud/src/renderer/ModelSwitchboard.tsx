import { useState, type FormEvent } from 'react';
import { HudIcon } from './HudIcon.js';

export interface ModelSwitchboardProps {
  onDispatchTest?: (modelKey: 'deepseek' | 'glm' | 'kimi', prompt: string) => void;
}

type DispatchModel = 'deepseek' | 'glm' | 'kimi';

interface SwitchboardModel {
  key: string;
  name: string;
  provider: string;
  tags: string[];
  latency: string;
  dispatch?: DispatchModel;
}

const MODELS: SwitchboardModel[] = [
  {
    key: 'gemini',
    name: 'Gemini 3.8 Flash',
    provider: 'Google · master brain',
    tags: ['Vision', 'Voice', '1M ctx'],
    latency: '420ms',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek V4.1 Flash',
    provider: 'DeepSeek · backend architecture',
    tags: ['Reasoning', 'Math', 'Free'],
    latency: '680ms',
    dispatch: 'deepseek',
  },
  {
    key: 'glm',
    name: 'GLM 5.3 Flash',
    provider: 'Zhipu AI · frontend and UI',
    tags: ['Agentic', 'Tools', 'Free'],
    latency: '540ms',
    dispatch: 'glm',
  },
  {
    key: 'kimi',
    name: 'Kimi K3',
    provider: 'Arena bridge · full-stack',
    tags: ['Computer use', 'Code'],
    latency: '510ms',
    dispatch: 'kimi',
  },
  {
    key: 'llama',
    name: 'Llama 3 · Local',
    provider: 'On-device (Ollama)',
    tags: ['Offline', 'Private'],
    latency: '90ms',
  },
];

const DISPATCH_LABELS: Record<DispatchModel, string> = {
  deepseek: 'DeepSeek V4.1',
  glm: 'GLM 5.3',
  kimi: 'Kimi K3',
};

export function ModelSwitchboard({ onDispatchTest }: ModelSwitchboardProps) {
  const [autoRoute, setAutoRoute] = useState(true);
  const [selectedModel, setSelectedModel] = useState('gemini');
  const [dispatchModel, setDispatchModel] = useState<DispatchModel>('deepseek');
  const [testPrompt, setTestPrompt] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);

  const handleTest = (event: FormEvent) => {
    event.preventDefault();
    const prompt = testPrompt.trim();
    if (!prompt) return;
    setStatusText(`Dispatched test to ${DISPATCH_LABELS[dispatchModel]}`);
    onDispatchTest?.(dispatchModel, prompt);
    setTestPrompt('');
    window.setTimeout(() => setStatusText(null), 4000);
  };

  return (
    <div>
      <div className="row" style={{ paddingTop: 2 }}>
        <div>
          Auto-route by task
          <small>Vision → Gemini · Reasoning → DeepSeek · Offline → Local</small>
        </div>
        <button
          className={`sw ${autoRoute ? 'on' : ''}`}
          onClick={() => setAutoRoute((enabled) => !enabled)}
          aria-label="Toggle auto-route by task"
        />
      </div>
      <div style={{ height: 8 }} />

      {MODELS.map((model) => (
        <button
          key={model.key}
          className={`mc ${selectedModel === model.key ? 'on' : ''}`}
          onClick={() => {
            setSelectedModel(model.key);
            if (model.dispatch) setDispatchModel(model.dispatch);
          }}
        >
          <i className="rd" />
          <div className="at">
            <b>{model.name}</b>
            <span>{model.provider}</span>
            <div className="tags">
              {model.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <span className="lat">{model.latency}</span>
        </button>
      ))}

      <div className="h3">Direct dispatch</div>
      <div className="card">
        <div className="seg" role="group" aria-label="Dispatch model">
          {(['kimi', 'deepseek', 'glm'] as DispatchModel[]).map((key) => (
            <button
              key={key}
              type="button"
              className={dispatchModel === key ? 'on' : ''}
              aria-pressed={dispatchModel === key}
              onClick={() => setDispatchModel(key)}
            >
              {DISPATCH_LABELS[key]}
            </button>
          ))}
        </div>
        <form className="goal" style={{ marginTop: 10, marginBottom: 0 }} onSubmit={handleTest}>
          <input
            value={testPrompt}
            onChange={(event) => setTestPrompt(event.target.value)}
            placeholder={`Prompt ${DISPATCH_LABELS[dispatchModel]}…`}
            aria-label="Test prompt"
          />
          <button className="btn" type="submit" disabled={!testPrompt.trim()}>
            Execute
          </button>
        </form>
        {statusText ? (
          <div className="cons" style={{ marginTop: 8 }}>
            <HudIcon name="check" size={13} />
            <span>{statusText}</span>
          </div>
        ) : (
          <div className="cons" style={{ marginTop: 8 }}>
            <HudIcon name="zap" size={13} />
            <span>Zero-cost session · routed through OpenCode.</span>
          </div>
        )}
      </div>
    </div>
  );
}
