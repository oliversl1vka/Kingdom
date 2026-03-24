import React, { useState, useEffect, useRef } from 'react';
import { COLORS } from '../assets/sprites.js';
import {
  initKingdom, submitDecree, summonKingdom, getStatus,
} from '../api/client.js';

const btnStyle: React.CSSProperties = {
  padding: '8px 20px',
  background: COLORS.accent,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '13px',
};

const sectionStyle: React.CSSProperties = {
  background: COLORS.panel,
  padding: '16px',
  marginBottom: '16px',
  borderLeft: `3px solid ${COLORS.gold}`,
};

type StatusData = Awaited<ReturnType<typeof getStatus>>;

export function KingdomControl() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [projectName, setProjectName] = useState('');
  const [decree, setDecree] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setLogs((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const refreshStatus = async () => {
    try {
      const s = await getStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleInit = async () => {
    if (!projectName.trim()) return;
    setBusy(true);
    addLog(`Initializing kingdom for project: ${projectName}...`);
    try {
      await initKingdom(projectName.trim());
      addLog('Kingdom initialized successfully.');
      await refreshStatus();
    } catch (e: unknown) {
      addLog(`Init failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSummon = async () => {
    setBusy(true);
    addLog('Summoning the Kingdom...');
    try {
      await summonKingdom();
      addLog('Kingdom summoned – agents are assembling.');
      await refreshStatus();
    } catch (e: unknown) {
      addLog(`Summon failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDecree = async () => {
    if (!decree.trim()) return;
    setBusy(true);
    const text = decree.trim();
    setDecree('');
    addLog(`📜 Decree issued: "${text}"`);
    try {
      await submitDecree(text);
      addLog('Decree accepted by the King.');
      await refreshStatus();
    } catch (e: unknown) {
      addLog(`Decree failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Status bar */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '16px',
        padding: '10px 16px',
        background: COLORS.panel,
        borderLeft: `3px solid ${status?.running ? COLORS.healthGreen : '#888'}`,
      }}>
        <span style={{ color: status?.running ? COLORS.healthGreen : '#888' }}>
          ● {status?.running ? 'Running' : status?.initialized ? 'Idle' : 'Not Initialized'}
        </span>
        {status && (
          <>
            <span style={{ color: COLORS.text }}>Active: {status.activeJobs}</span>
            <span style={{ color: COLORS.text }}>Queued: {status.queuedJobs}</span>
            <span style={{ color: COLORS.healthGreen }}>Done: {status.completedJobs}</span>
            <span style={{ color: COLORS.healthRed }}>Failed: {status.failedJobs}</span>
          </>
        )}
        <button onClick={refreshStatus} style={{ ...btnStyle, marginLeft: 'auto', padding: '2px 12px', fontSize: '11px', background: '#0f3460' }}>
          Refresh
        </button>
      </div>

      {/* Initialize Section */}
      <div style={sectionStyle}>
        <h3 style={{ color: COLORS.gold, marginBottom: '10px' }}>🏰 Initialize Kingdom</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Project name..."
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInit()}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#0f3460',
              color: COLORS.text,
              border: '1px solid #4a4a5a',
              fontFamily: 'inherit',
              fontSize: '13px',
            }}
          />
          <button onClick={handleInit} disabled={busy || !projectName.trim()} style={{ ...btnStyle, opacity: projectName.trim() ? 1 : 0.5 }}>
            Initialize
          </button>
        </div>
      </div>

      {/* Summon Section */}
      <div style={sectionStyle}>
        <h3 style={{ color: COLORS.gold, marginBottom: '10px' }}>⚔️ Summon Kingdom</h3>
        <p style={{ color: '#888', marginBottom: '10px', fontSize: '12px' }}>
          Start all kingdom agents. The King will begin orchestrating work.
        </p>
        <button onClick={handleSummon} disabled={busy} style={btnStyle}>
          {busy ? 'Summoning...' : 'Summon the Kingdom'}
        </button>
      </div>

      {/* Decree Section */}
      <div style={sectionStyle}>
        <h3 style={{ color: COLORS.gold, marginBottom: '10px' }}>📜 Issue a Decree</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea
            placeholder="Describe the objective for the King..."
            value={decree}
            onChange={(e) => setDecree(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleDecree();
              }
            }}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#0f3460',
              color: COLORS.text,
              border: '1px solid #4a4a5a',
              fontFamily: 'inherit',
              fontSize: '13px',
              minHeight: '60px',
              resize: 'vertical',
            }}
          />
          <button onClick={handleDecree} disabled={busy || !decree.trim()} style={{ ...btnStyle, alignSelf: 'flex-end', opacity: decree.trim() ? 1 : 0.5 }}>
            Send
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={logsRef}
        style={{
          background: '#0a0a14',
          padding: '10px',
          height: '200px',
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#8a8',
          borderLeft: `3px solid #4a4a5a`,
        }}
      >
        {logs.length === 0 && <span style={{ color: '#555' }}>Kingdom activity log will appear here...</span>}
        {logs.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
