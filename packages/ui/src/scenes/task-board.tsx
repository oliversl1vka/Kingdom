import React, { useEffect, useState } from 'react';
import { COLORS } from '../assets/sprites.js';

interface TaskEntry {
  id: string;
  title: string;
  status: string;
  assigned_agent: string | null;
  level: string;
}

export function TaskBoardScene() {
  const [tasks, setTasks] = useState<TaskEntry[]>([]);

  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.ok ? r.json() : [])
      .then(setTasks)
      .catch(() => {});
  }, []);

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return COLORS.healthGreen;
      case 'running': case 'streaming': return COLORS.gold;
      case 'failed-runtime-crash': case 'failed-review': return COLORS.healthRed;
      case 'stalled': return COLORS.healthRed;
      default: return COLORS.text;
    }
  };

  return (
    <div style={{ padding: '16px', fontFamily: "'Courier New', monospace" }}>
      <h2 style={{ color: COLORS.gold, marginBottom: '12px' }}>📜 Task Scroll Board</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {tasks.map((task) => (
          <div
            key={task.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '6px 12px',
              background: COLORS.panel,
              borderLeft: `3px solid ${statusColor(task.status)}`,
            }}
          >
            <span style={{ color: COLORS.gold, width: '50px' }}>{task.id}</span>
            <span style={{ flex: 1, color: COLORS.text }}>{task.title}</span>
            <span style={{ color: statusColor(task.status), width: '100px' }}>{task.status}</span>
            <span style={{ color: COLORS.mana, width: '80px' }}>{task.assigned_agent ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
