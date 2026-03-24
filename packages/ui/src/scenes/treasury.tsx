import React, { useRef, useEffect, useState } from 'react';
import { syncCanvasSize, clearCanvas, drawText, drawHealthBar, startGameLoop } from '../engine/renderer.js';
import { COLORS } from '../assets/sprites.js';

interface BudgetInfo {
  job_id: string;
  task_title: string;
  budget_tokens: number;
  used_tokens: number;
}

export function TreasuryScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [budgets, setBudgets] = useState<BudgetInfo[]>([]);

  useEffect(() => {
    fetch('/api/treasury')
      .then((r) => r.ok ? r.json() : [])
      .then(setBudgets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const cancel = startGameLoop(() => {
      const rc = syncCanvasSize(canvasRef.current!);
      clearCanvas(rc);
      drawText(rc, 'ROYAL TREASURY', 16, 30, 20, COLORS.gold);

      budgets.forEach((budget, i) => {
        const y = 60 + i * 60;
        const ratio = budget.used_tokens / budget.budget_tokens;

        drawText(rc, budget.task_title, 16, y + 16, 14, COLORS.text);
        drawText(rc, `${budget.used_tokens}/${budget.budget_tokens} tokens`, 16, y + 32, 11, COLORS.text);

        const barX = Math.min(rc.width * 0.4, 400);
        const barW = Math.min(rc.width * 0.4, 400);
        drawHealthBar(rc, barX, y + 8, barW, 16, 1 - ratio);
        drawText(rc, budget.job_id, barX + barW + 12, y + 22, 12, COLORS.mana);
      });
    });

    return cancel;
  }, [budgets]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '300px' }}
    />
  );
}
