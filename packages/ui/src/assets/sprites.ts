// Sprite metadata and asset constants for all agent types

export interface SpriteMetadata {
  name: string;
  width: number;
  height: number;
  frameCount: number;
  animationSpeed: number; // frames per second
}

export const AGENT_SPRITES: Record<string, SpriteMetadata> = {
  king: { name: 'king-throne', width: 32, height: 32, frameCount: 8, animationSpeed: 4 },
  nobility: { name: 'nobility-chamber', width: 32, height: 32, frameCount: 8, animationSpeed: 4 },
  knight: { name: 'knight-war-table', width: 24, height: 24, frameCount: 12, animationSpeed: 8 },
  squire: { name: 'squire-workbench', width: 16, height: 16, frameCount: 16, animationSpeed: 12 },
  healer: { name: 'healer-sanctum', width: 24, height: 24, frameCount: 8, animationSpeed: 4 },
  judge: { name: 'judge-tribunal', width: 24, height: 24, frameCount: 8, animationSpeed: 4 },
  scribe: { name: 'scribe-scriptorium', width: 16, height: 16, frameCount: 8, animationSpeed: 6 },
  sentinel: { name: 'sentinel-watchtower', width: 24, height: 24, frameCount: 8, animationSpeed: 4 },
  blacksmith: { name: 'blacksmith-forge', width: 24, height: 24, frameCount: 12, animationSpeed: 8 },
};

export const UI_ELEMENTS = {
  scrollBoard: { width: 256, height: 192 },
  healthBar: { width: 64, height: 8 },
  castle: { width: 128, height: 128 },
};

export const COLORS = {
  background: '#1a1a2e',
  panel: '#16213e',
  accent: '#e94560',
  gold: '#f0c040',
  text: '#e0d6c2',
  healthGreen: '#2ecc71',
  healthYellow: '#f1c40f',
  healthRed: '#e74c3c',
  mana: '#3498db',
};

export type AgentState = 'idle' | 'working' | 'running' | 'reviewing' | 'stalled' | 'cancelled';

export function getStateColor(state: AgentState): string {
  switch (state) {
    case 'idle': return COLORS.text;
    case 'working': return COLORS.healthGreen;
    case 'running': return COLORS.healthGreen;
    case 'reviewing': return COLORS.gold;
    case 'stalled': return COLORS.healthRed;
    case 'cancelled': return '#666';
  }
}
