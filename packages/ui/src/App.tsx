import React, { useState } from 'react';
import { AgentsScene } from './scenes/agents.js';
import { TaskBoardScene } from './scenes/task-board.js';
import { TreasuryScene } from './scenes/treasury.js';
import { KingdomScene } from './scenes/kingdom.js';

type View = 'agents' | 'tasks' | 'treasury' | 'kingdom';

const TAB_LABELS: Record<View, string> = {
  agents: '⚔ Agents',
  tasks: '📜 Tasks',
  treasury: '💰 Treasury',
  kingdom: '🏰 Kingdom',
};

export function App() {
  const [view, setView] = useState<View>('agents');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0e0b14' }}>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '0 8px',
          height: 44,
          background: 'linear-gradient(180deg, #1a1426 0%, #12101c 100%)',
          borderBottom: '2px solid #2a1e2e',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        {/* Crown brand */}
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 'bold',
            color: '#d4a840',
            letterSpacing: 2,
            marginRight: 16,
            textShadow: '0 0 6px rgba(212,168,64,0.3)',
          }}
        >
          KINGDOM OS
        </span>

        {/* Separator */}
        <span style={{ width: 1, height: 24, background: '#3a3040', marginRight: 8 }} />

        {/* Tabs */}
        {(['agents', 'tasks', 'treasury', 'kingdom'] as View[]).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '6px 14px',
                margin: '0 2px',
                background: active
                  ? 'linear-gradient(180deg, #2a2040 0%, #1e1830 100%)'
                  : 'transparent',
                color: active ? '#d4a840' : '#7a7088',
                border: 'none',
                borderBottom: active ? '2px solid #d4a840' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: active ? 'bold' : 'normal',
                textTransform: 'uppercase',
                letterSpacing: 1,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = '#b8a070';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = '#7a7088';
              }}
            >
              {TAB_LABELS[v]}
            </button>
          );
        })}
      </nav>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'agents' && <AgentsScene />}
        {view === 'tasks' && <TaskBoardScene />}
        {view === 'treasury' && <TreasuryScene />}
        {view === 'kingdom' && <KingdomScene />}
      </main>
    </div>
  );
}
