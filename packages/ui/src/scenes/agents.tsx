import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  syncCanvasSize,
  clearCanvas,
  drawText,
  startGameLoop,
} from '../engine/renderer.js';
import {
  COLORS,
  getStateColor,
  type AgentState,
} from '../assets/sprites.js';
import {
  drawCharacter,
  drawRoom,
  getCS,
  getWorkstationPosition,
  updateCharacterPosition,
  type CharacterType,
  type AnimState,
} from '../engine/pixel-characters.js';

/* ── Types ─────────────────────────────────────────────────── */

interface AgentInfo {
  id: string;
  name: string;
  tier: string;
  state: AgentState;
  currentJob: string | null;
}

interface RoomSlot {
  tier: CharacterType;
  label: string;
  col: number;
  row: number;
}

/* ── Room Layout ───────────────────────────────────────────── */
// 3-column castle layout — rooms share walls for a connected world feel

const ROOM_GRID: RoomSlot[] = [
  { tier: 'king',       label: 'Throne Room',   col: 1, row: 0 },
  { tier: 'nobility',   label: 'Council Hall',  col: 0, row: 1 },
  { tier: 'knight',     label: 'War Room',      col: 1, row: 1 },
  { tier: 'sentinel',   label: 'Watchtower',    col: 2, row: 1 },
  { tier: 'squire',     label: 'Workshop',      col: 0, row: 2 },
  { tier: 'healer',     label: 'Sanctum',       col: 1, row: 2 },
  { tier: 'blacksmith', label: 'Forge',         col: 2, row: 2 },
  { tier: 'scribe',     label: 'Scriptorium',   col: 0, row: 3 },
  { tier: 'judge',      label: 'Tribunal',      col: 1, row: 3 },
];

const DEFAULT_AGENTS: AgentInfo[] = [
  { id: '1', name: 'The Crown',      tier: 'king',       state: 'idle', currentJob: null },
  { id: '2', name: 'Lord Regent',    tier: 'nobility',   state: 'idle', currentJob: null },
  { id: '3', name: 'Sir Galahad',    tier: 'knight',     state: 'idle', currentJob: null },
  { id: '4', name: 'Page Turner',    tier: 'squire',     state: 'idle', currentJob: null },
  { id: '5', name: 'Brother Aldric', tier: 'healer',     state: 'idle', currentJob: null },
  { id: '6', name: 'Night Watch',    tier: 'sentinel',   state: 'idle', currentJob: null },
  { id: '7', name: 'Chronicler',     tier: 'scribe',     state: 'idle', currentJob: null },
  { id: '8', name: 'Lord Justice',   tier: 'judge',      state: 'idle', currentJob: null },
  { id: '9', name: 'Iron Forge',     tier: 'blacksmith', state: 'idle', currentJob: null },
];

/* ── Component ─────────────────────────────────────────────── */

export function AgentsScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [agents, setAgents] = useState<AgentInfo[]>(DEFAULT_AGENTS);

  // Camera state for panning
  const camRef = useRef({ x: 0, y: 0, dragging: false, sx: 0, sy: 0, cx: 0, cy: 0 });

  // Mouse handlers for panning
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const cam = camRef.current;
    cam.dragging = true;
    cam.sx = e.clientX;
    cam.sy = e.clientY;
    cam.cx = cam.x;
    cam.cy = cam.y;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const cam = camRef.current;
    if (!cam.dragging) return;
    cam.x = cam.cx + (e.clientX - cam.sx);
    cam.y = cam.cy + (e.clientY - cam.sy);
  }, []);

  const onMouseUp = useCallback(() => {
    camRef.current.dragging = false;
  }, []);

  // Poll agents every 5 seconds
  useEffect(() => {
    let active = true;
    const poll = () => {
      fetch('/api/agents')
        .then((r) => r.ok ? r.json() : [])
        .then((data: AgentInfo[]) => {
          if (active && Array.isArray(data) && data.length > 0) setAgents(data);
        })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => { active = false; clearInterval(iv); };
  }, []);

  // Main render loop
  useEffect(() => {
    if (!canvasRef.current) return;

    const cancel = startGameLoop((dt, frameCount) => {
      const rc = syncCanvasSize(canvasRef.current!);
      clearCanvas(rc);

      const cam = camRef.current;
      const cols = 3;
      const wallThick = 4;                       // shared wall thickness
      const labelH = 22;

      // ── Compute room sizes to fill the viewport ──
      // Rooms are snug — sharing a thin wall line between them
      const totalW = rc.width;
      const totalH = rc.height;
      const maxRow = Math.max(...ROOM_GRID.map(r => r.row));
      const rows = maxRow + 1;
      const roomW = Math.floor((totalW - wallThick * (cols + 1)) / cols);
      const roomH = Math.floor((totalH - wallThick * (rows + 1) - labelH * rows) / rows);

      // ── Group agents by tier ──
      const agentsByTier = new Map<string, AgentInfo[]>();
      for (const a of agents) {
        const list = agentsByTier.get(a.tier) ?? [];
        list.push(a);
        agentsByTier.set(a.tier, list);
      }

      // ── Draw castle outer frame ──
      const castleW = cols * roomW + (cols + 1) * wallThick;
      const castleH = rows * (roomH + labelH) + (rows + 1) * wallThick;
      const baseX = Math.floor((totalW - castleW) / 2) + cam.x;
      const baseY = Math.max(0, Math.floor((totalH - castleH) / 2)) + cam.y;

      // Outer wall backdrop
      rc.ctx.fillStyle = '#18141e';
      rc.ctx.fillRect(
        baseX - wallThick, baseY - wallThick,
        castleW + wallThick * 2, castleH + wallThick * 2,
      );

      // Outer border
      rc.ctx.strokeStyle = '#3a3040';
      rc.ctx.lineWidth = 3;
      rc.ctx.strokeRect(
        baseX - wallThick, baseY - wallThick,
        castleW + wallThick * 2, castleH + wallThick * 2,
      );

      // ── Draw rooms ──
      for (const slot of ROOM_GRID) {
        const rx = baseX + wallThick + slot.col * (roomW + wallThick);
        const ry = baseY + wallThick + slot.row * (roomH + labelH + wallThick);

        // Room label — parchment-style tab
        const labelW = rc.ctx.measureText(slot.label.toUpperCase()).width || 80;
        const tabW = Math.min(labelW + 20, roomW * 0.6);
        const tabX = rx + (roomW - tabW) / 2;

        rc.ctx.fillStyle = '#2a2030';
        rc.ctx.fillRect(tabX, ry, tabW, labelH);
        rc.ctx.fillStyle = '#3a3040';
        rc.ctx.fillRect(tabX + 1, ry + 1, tabW - 2, labelH - 2);

        // Label text
        drawText(rc, slot.label.toUpperCase(), tabX + 6, ry + 15, 10, '#d4a840');

        const roomTop = ry + labelH;

        // ── Draw the room interior ──
        rc.ctx.save();
        rc.ctx.beginPath();
        rc.ctx.rect(rx, roomTop, roomW, roomH);
        rc.ctx.clip();

        drawRoom(rc.ctx, slot.tier, rx, roomTop, roomW, roomH, frameCount);

        rc.ctx.restore();

        // ── Room border — thin shared wall ──
        rc.ctx.strokeStyle = '#2a1e2e';
        rc.ctx.lineWidth = wallThick;
        rc.ctx.strokeRect(rx, roomTop, roomW, roomH);
        // Inner highlight edge
        rc.ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        rc.ctx.lineWidth = 1;
        rc.ctx.strokeRect(rx + 2, roomTop + 2, roomW - 4, roomH - 4);

        // ── Draw agents ──
        const tierAgents = agentsByTier.get(slot.tier) ?? [];
        const maxVisible = 4;
        const visible = tierAgents.slice(0, maxVisible);
        const overflow = tierAgents.length - visible.length;
        const charScale = Math.min(2.8, roomW / 80);

        visible.forEach((agent, i) => {
          let targetX: number;
          let targetY: number;

          if (agent.state === 'running') {
            const wsPos = getWorkstationPosition(slot.tier);
            targetX = rx + roomW * wsPos.x;
            targetY = roomTop + roomH * wsPos.y;
          } else {
            const spreadX = roomW * 0.7;
            targetX = rx + roomW * 0.15 + i * Math.min(55, spreadX / Math.max(1, visible.length));
            targetY = roomTop + roomH * 0.48;
          }

          const cs = getCS(agent.id, targetX, targetY);
          const updatedPos = updateCharacterPosition(agent.id, cs.x, cs.y, targetX, targetY, dt);
          cs.x = updatedPos.x;
          cs.y = updatedPos.y;

          drawCharacter(
            rc.ctx,
            slot.tier as CharacterType,
            agent.state as AnimState,
            cs.x, cs.y,
            charScale,
            frameCount,
            agent.id,
            agent.currentJob,
          );

          // Name plate
          const nameY = cs.y + 30 * charScale;
          // Background for readability
          const nameText = agent.name;
          rc.ctx.font = '9px monospace';
          const nameW = rc.ctx.measureText(nameText).width;
          rc.ctx.fillStyle = 'rgba(10,8,16,0.6)';
          rc.ctx.fillRect(cs.x - 2, nameY - 8, nameW + 4, 10);
          drawText(rc, nameText, cs.x, nameY, 9, COLORS.text);

          // State badge with background
          const stateColor = getStateColor(agent.state);
          const stateText = agent.state;
          rc.ctx.font = '8px monospace';
          const stateW = rc.ctx.measureText(stateText).width;
          rc.ctx.fillStyle = 'rgba(10,8,16,0.6)';
          rc.ctx.fillRect(cs.x - 2, nameY + 2, stateW + 4, 10);
          drawText(rc, stateText, cs.x, nameY + 11, 8, stateColor);
        });

        // Overflow badge
        if (overflow > 0) {
          const badgeX = rx + roomW - 30;
          const badgeY = roomTop + 8;
          rc.ctx.fillStyle = 'rgba(60,30,80,0.8)';
          rc.ctx.fillRect(badgeX, badgeY, 24, 14);
          rc.ctx.strokeStyle = '#d4a840';
          rc.ctx.lineWidth = 1;
          rc.ctx.strokeRect(badgeX, badgeY, 24, 14);
          drawText(rc, `+${overflow}`, badgeX + 3, badgeY + 11, 9, '#d4a840');
        }

        // Vacant indicator
        if (tierAgents.length === 0) {
          drawText(rc, '— vacant —', rx + roomW * 0.3, roomTop + roomH * 0.55, 10, '#555');
        }
      }

      // ── Castle banner at the very top ──
      const bannerText = 'KINGDOM OS';
      rc.ctx.font = 'bold 14px monospace';
      const btw = rc.ctx.measureText(bannerText).width;
      const bannerX = baseX + (castleW - btw) / 2 - 12;
      const bannerY = baseY - wallThick - 20;

      rc.ctx.fillStyle = 'rgba(20,14,28,0.85)';
      rc.ctx.fillRect(bannerX, bannerY, btw + 24, 18);
      rc.ctx.strokeStyle = '#d4a840';
      rc.ctx.lineWidth = 1;
      rc.ctx.strokeRect(bannerX, bannerY, btw + 24, 18);
      rc.ctx.fillStyle = '#d4a840';
      rc.ctx.font = 'bold 14px monospace';
      rc.ctx.fillText(bannerText, bannerX + 12, bannerY + 14);
    });

    return cancel;
  }, [agents]);

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{
        display: 'block',
        width: '100%',
        height: 'calc(100vh - 44px)',
        cursor: camRef.current.dragging ? 'grabbing' : 'grab',
      }}
    />
  );
}
