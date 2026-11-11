import { useState, type FormEvent } from 'react';
import { HudIcon } from './HudIcon.js';

export interface SkillLauncherProps {
  onExecuteGoal?: (goal: string) => void;
  cpuUsage?: number;
  memoryUsagePercent?: number;
}

interface SpecialistSkill {
  id: string;
  name: string;
  tile: string;
  color: string;
  category: string;
  desc: string;
  goal: string;
}

const CATEGORIES = ['All', 'Windows', 'Office', 'Blender', 'Creative', 'Dev & Web'] as const;

const SKILLS: SpecialistSkill[] = [
  {
    id: 'settings',
    name: 'Settings',
    tile: '⚙',
    color: '#4b5563',
    category: 'Windows',
    desc: 'Toggle system options',
    goal: 'Open Windows Settings and show me the current display and sound options.',
  },
  {
    id: 'task-manager',
    name: 'Task Manager',
    tile: 'TM',
    color: '#0f766e',
    category: 'Windows',
    desc: 'Kill heavy processes',
    goal: 'Open Task Manager and identify the processes using the most CPU and memory.',
  },
  {
    id: 'word',
    name: 'Word',
    tile: 'W',
    color: '#2b579a',
    category: 'Office',
    desc: 'Draft & format docs',
    goal: 'Create a Word document with a polished project status report and save it to my Documents folder.',
  },
  {
    id: 'excel',
    name: 'Excel',
    tile: 'X',
    color: '#217346',
    category: 'Office',
    desc: 'Sheets, formulas, charts',
    goal: 'Create an Excel budget spreadsheet with formulas and a chart.',
  },
  {
    id: 'powerpoint',
    name: 'PowerPoint',
    tile: 'P',
    color: '#d24726',
    category: 'Office',
    desc: 'Generate slides',
    goal: 'Generate a PowerPoint slide deck summarizing this week’s work.',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    tile: 'O',
    color: '#0a64ad',
    category: 'Office',
    desc: 'Triage & reply',
    goal: 'Open Outlook and summarize my unread messages.',
  },
  {
    id: 'render',
    name: 'Render scene',
    tile: 'Bl',
    color: '#ea7600',
    category: 'Blender',
    desc: 'Cycles / Eevee render',
    goal: 'Check Blender and render the current scene with Eevee to a PNG.',
  },
  {
    id: 'modifiers',
    name: 'Add modifiers',
    tile: 'Bl',
    color: '#ea7600',
    category: 'Blender',
    desc: 'Model by voice',
    goal: 'Add a subdivision surface and bevel modifier to the selected Blender object.',
  },
  {
    id: 'photoshop',
    name: 'Photoshop',
    tile: 'Ps',
    color: '#0b2a4a',
    category: 'Creative',
    desc: 'Edit & export',
    goal: 'Inspect the installed Creative Cloud apps and prepare a Photoshop batch export action.',
  },
  {
    id: 'figma',
    name: 'Figma',
    tile: 'F',
    color: '#a259ff',
    category: 'Creative',
    desc: 'Design frames',
    goal: 'Open Figma and outline the frames in the current design file.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    tile: '</>',
    color: '#1f9cf0',
    category: 'Dev & Web',
    desc: 'Code by voice',
    goal: 'Open VS Code in the Gematron workspace and show the current TypeScript errors.',
  },
  {
    id: 'chrome',
    name: 'Chrome',
    tile: 'C',
    color: '#4285f4',
    category: 'Dev & Web',
    desc: 'Browse & automate',
    goal: 'Open Chrome and summarize the page I am currently looking at.',
  },
  {
    id: 'kimi',
    name: 'Kimi K3 Arena Bridge',
    tile: 'K3',
    color: '#10b981',
    category: 'Dev & Web',
    desc: 'Autonomous context packing & code sync',
    goal: 'Connect Kimi K3 in Arena to E:\\Gematron and upgrade active workspace files.',
  },
];

export function SkillLauncherPanel({ onExecuteGoal }: SkillLauncherProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [customGoal, setCustomGoal] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = SKILLS.filter((skill) => {
    const matchesCategory = category === 'All' || skill.category === category;
    const haystack = `${skill.name} ${skill.desc} ${skill.category}`.toLowerCase();
    return matchesCategory && haystack.includes(query.trim().toLowerCase());
  });

  const execute = (goal: string, label: string) => {
    setFeedback(`Dispatched: ${label}`);
    onExecuteGoal?.(goal);
    window.setTimeout(() => setFeedback(null), 3000);
  };

  const handleCustomSubmit = (event: FormEvent) => {
    event.preventDefault();
    const goal = customGoal.trim();
    if (!goal) return;
    execute(goal, 'custom skill');
    setCustomGoal('');
  };

  return (
    <div>
      <div className="search">
        <HudIcon name="search" size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills — Windows, Office, Blender, Creative…"
          aria-label="Search skills"
        />
      </div>

      <div className="cats">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            className={`chip ${category === item ? 'on' : ''}`}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid">
        {filtered.map((skill) => (
          <button key={skill.id} className="sk" onClick={() => execute(skill.goal, skill.name)}>
            <span className="tile" style={{ background: skill.color }}>
              {skill.tile}
            </span>
            <div className="at">
              <b>{skill.name}</b>
              <span>{skill.desc}</span>
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--mu)' }}>
          No skills match “{query}”.
        </div>
      )}

      <div className="h3">Custom dispatch</div>
      <div className="card">
        <form className="goal" onSubmit={handleCustomSubmit}>
          <input
            value={customGoal}
            onChange={(event) => setCustomGoal(event.target.value)}
            placeholder="Describe a specialist task…"
            aria-label="Custom skill instruction"
          />
          <button className="btn" type="submit" disabled={!customGoal.trim()}>
            Dispatch
          </button>
        </form>
        {feedback ? (
          <div className="cons" style={{ marginTop: 0 }}>
            <HudIcon name="check" size={13} />
            <span>{feedback}</span>
          </div>
        ) : (
          <div className="cons" style={{ marginTop: 0 }}>
            <HudIcon name="zap" size={13} />
            <span>Skills run through the autonomous co-pilot.</span>
          </div>
        )}
      </div>
    </div>
  );
}
