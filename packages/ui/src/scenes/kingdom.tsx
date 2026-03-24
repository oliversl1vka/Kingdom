import React, { useState, useEffect } from 'react';
import { COLORS } from '../assets/sprites.js';
import { ConfigPanel } from '../panels/config-panel.js';
import { KingdomControl } from '../panels/kingdom-control.js';

interface ProjectInfo {
  id: string;
  name: string;
  status: string;
}

interface CryptEntry {
  id: string;
  title: string;
  summary: string;
  success: boolean;
  completed_at: string;
}

type Tab = 'control' | 'projects' | 'crypt' | 'config';

export function KingdomScene() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [cryptEntries, setCryptEntries] = useState<CryptEntry[]>([]);
  const [tab, setTab] = useState<Tab>('control');

  useEffect(() => {
    fetch('/api/projects').then((r) => r.ok ? r.json() : []).then(setProjects).catch(() => {});
    fetch('/api/crypt').then((r) => r.ok ? r.json() : []).then(setCryptEntries).catch(() => {});
  }, []);

  return (
    <div style={{ padding: '16px', fontFamily: "'Courier New', monospace" }}>
      <h2 style={{ color: COLORS.gold, marginBottom: '12px' }}>🏰 Kingdom Management</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['control', 'projects', 'crypt', 'config'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '4px 12px',
              background: tab === t ? COLORS.accent : COLORS.panel,
              color: COLORS.text,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'control' && <KingdomControl />}

      {tab === 'projects' && (
        <div>
          {projects.map((p) => (
            <div key={p.id} style={{ padding: '8px', background: COLORS.panel, marginBottom: '4px' }}>
              <strong style={{ color: COLORS.gold }}>{p.name}</strong>
              <span style={{ marginLeft: '12px', color: COLORS.text }}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'crypt' && (
        <div>
          <h3 style={{ color: COLORS.accent, marginBottom: '8px' }}>Crypt of Kings</h3>
          {cryptEntries.map((e) => (
            <div key={e.id} style={{ padding: '6px', background: COLORS.panel, marginBottom: '4px' }}>
              <span style={{ color: e.success ? COLORS.healthGreen : COLORS.healthRed }}>
                {e.success ? '✓' : '✗'}
              </span>
              <span style={{ marginLeft: '8px', color: COLORS.text }}>{e.title}</span>
              <span style={{ marginLeft: '8px', color: COLORS.mana, fontSize: '10px' }}>{e.completed_at}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'config' && <ConfigPanel />}
    </div>
  );
}
