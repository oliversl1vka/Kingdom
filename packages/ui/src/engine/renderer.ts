import { COLORS, type SpriteMetadata } from '../assets/sprites.js';

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

export function createRenderer(canvas: HTMLCanvasElement): RenderContext {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  return {
    canvas,
    ctx,
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Resize canvas to match its CSS display size × devicePixelRatio
 * so text and shapes render crisply at any resolution.
 */
export function syncCanvasSize(canvas: HTMLCanvasElement): RenderContext {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  return { canvas, ctx, width: rect.width, height: rect.height };
}

export function clearCanvas(rc: RenderContext): void {
  rc.ctx.fillStyle = COLORS.background;
  rc.ctx.fillRect(0, 0, rc.width, rc.height);
}

export function drawSprite(
  rc: RenderContext,
  image: HTMLImageElement,
  sprite: SpriteMetadata,
  frame: number,
  x: number,
  y: number,
  scale = 2
): void {
  const frameIndex = frame % sprite.frameCount;
  rc.ctx.drawImage(
    image,
    frameIndex * sprite.width, 0,
    sprite.width, sprite.height,
    x, y,
    sprite.width * scale, sprite.height * scale
  );
}

export function drawHealthBar(
  rc: RenderContext,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number
): void {
  // Background
  rc.ctx.fillStyle = '#333';
  rc.ctx.fillRect(x, y, width, height);

  // Fill
  const color = ratio > 0.6 ? COLORS.healthGreen : ratio > 0.3 ? COLORS.healthYellow : COLORS.healthRed;
  rc.ctx.fillStyle = color;
  rc.ctx.fillRect(x, y, width * Math.min(ratio, 1), height);

  // Border
  rc.ctx.strokeStyle = COLORS.text;
  rc.ctx.strokeRect(x, y, width, height);
}

export function drawText(
  rc: RenderContext,
  text: string,
  x: number,
  y: number,
  size = 12,
  color = COLORS.text
): void {
  rc.ctx.font = `${size}px 'Courier New', monospace`;
  rc.ctx.fillStyle = color;
  rc.ctx.fillText(text, x, y);
}

/**
 * Start the game loop with requestAnimationFrame.
 * Returns a cancel function.
 */
export function startGameLoop(
  render: (deltaMs: number, frameCount: number) => void
): () => void {
  let lastTime = performance.now();
  let frameCount = 0;
  let animId = 0;

  function loop(time: number) {
    const delta = time - lastTime;
    lastTime = time;
    frameCount++;
    render(delta, frameCount);
    animId = requestAnimationFrame(loop);
  }

  animId = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(animId);
}
