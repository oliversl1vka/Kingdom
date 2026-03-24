/**
 * Reconstruct pixel-characters.ts by removing duplicate/conflicting sections
 * from the 4 applied LLM diffs and restoring original functions.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts');
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

console.log(`Current file: ${lines.length} lines`);

// Original drawCharacter and drawStatusEffect (from the diff's removed lines)
const ORIGINAL_DRAW_CHARACTER = `
// ─── Main character draw ───────────────────────────────────────────

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  type: CharacterType,
  state: AnimState,
  x: number, y: number, s: number, frame: number,
  agentId?: string,
  currentJob?: string | null,
) {
  const id = agentId ?? \`\${type}-\${Math.round(x)}\`;
  const sprite = SPRITE_MAP[type];
  const palette = PALETTE_MAP[type];
  const cs = getCS(id, x, y);
  const bob = state === 'idle' ? Math.sin(frame * 0.05) * 1.2 : state === 'working' ? Math.sin(frame * 0.1) * 0.8 : 0;
  const drawY = cs.y + bob;
  const flipH = cs.dir === 'left';

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cs.x + 8 * s, drawY + sprite.length * s + 2, 7 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  drawSpriteDef(ctx, sprite, palette, cs.x, drawY, s, flipH);

  // Walking leg overlay
  if (cs.moving) {
    const lp = Math.sin(cs.wf * 0.3) * 2 * s;
    ctx.fillStyle = palette.B;
    ctx.fillRect(cs.x + 4 * s, drawY + (sprite.length - 3) * s + lp, 3 * s, 2 * s);
    ctx.fillRect(cs.x + 9 * s, drawY + (sprite.length - 3) * s - lp, 3 * s, 2 * s);
  }

  drawStatusEffect(ctx, state, cs.x, drawY, s, frame);
  if (agentId) {
    updateBubble(id, state, currentJob ?? null, frame);
    drawBubble(ctx, id, cs.x + 8 * s, drawY - 4);
  }
}

function drawStatusEffect(ctx: CanvasRenderingContext2D, state: AnimState, x: number, y: number, s: number, frame: number) {
  if (state === 'working') {
    for (let i = 0; i < 3; i++) {
      const a = (frame * 0.08 + i * 2.1) % (Math.PI * 2);
      const sx = x + 8 * s + Math.cos(a) * 12 * s;
      const sy = y + 10 * s + Math.sin(a) * 8 * s;
      const sz = (Math.sin(frame * 0.15 + i) * 0.5 + 1) * s;
      ctx.fillStyle = P.gold[3 + (i % 2)];
      ctx.fillRect(sx, sy, sz, sz);
    }
  } else if (state === 'stalled') {
    const pulse = Math.sin(frame * 0.12) * 0.25 + 0.25;
    ctx.fillStyle = \`rgba(231, 76, 60, \${pulse})\`;
    ctx.fillRect(x - s, y - 2 * s, 18 * s, 24 * s);
    ctx.fillStyle = '#e74c3c';
    ctx.font = \`bold \${10 * s}px sans-serif\`;
    ctx.fillText('!', x + 14 * s, y + 4 * s);
  } else if (state === 'reviewing') {
    ctx.strokeStyle = P.gold[2]; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x + 16 * s, y + 2 * s, 3 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 18 * s, y + 4 * s); ctx.lineTo(x + 20 * s, y + 6 * s); ctx.stroke();
  } else if (state === 'cancelled') {
    ctx.fillStyle = 'rgba(50, 50, 60, 0.4)';
    ctx.fillRect(x - s, y - 2 * s, 18 * s, 24 * s);
  }
}
`.trim().split('\n');

// Original drawFurniture
const ORIGINAL_DRAW_FURNITURE = `
export function drawFurniture(ctx: CanvasRenderingContext2D, roomType: string, x: number, y: number, scale: number) {
  switch(roomType) {
    case 'throneRoom':
      drawThrone(ctx, x + 10 * scale, y + 4 * scale, scale);
      drawPlanningTable(ctx, x + 50 * scale, y + 12 * scale, scale);
      break;
    case 'armory':
      drawWeaponRack(ctx, x + 8 * scale, y + 8 * scale, scale);
      drawWorkbench(ctx, x + 48 * scale, y + 12 * scale, scale);
      break;
    case 'alchemyLab':
      drawPotionShelf(ctx, x + 12 * scale, y + 6 * scale, scale);
      drawScribeDesk(ctx, x + 52 * scale, y + 14 * scale, scale);
      break;
   
  }
}
`.trim().split('\n');

// Build the new file
const output = [];

// Find key line markers
function findLine(text, startFrom = 0) {
  for (let i = startFrom; i < lines.length; i++) {
    if (lines[i].includes(text)) return i;
  }
  return -1;
}

// Section 1: Lines 1-417 (original header through PALETTE_MAP etc, before any drawSpriteDef)
// Find the first drawSpriteDef
const firstDrawSpriteDef = findLine('function drawSpriteDef(');
console.log(`First drawSpriteDef at line ${firstDrawSpriteDef + 1}`);

// Find the ORIGINAL drawSpriteDef (the one in the clean file at line 385)
// It has the signature: function drawSpriteDef(ctx, sprite, palette, x, y, s, flipH, breathOffset?)
// Actually, the ORIGINAL had 7 params, the idle animation one has 8 (breathOffset)
// Let me keep lines 1 through (firstDrawSpriteDef - 1)
// But wait, the drawSpriteDef at firstDrawSpriteDef might be the original or the duplicate

// Let me find ALL drawSpriteDef declarations
const dsd1 = findLine('function drawSpriteDef(', 0);
const dsd2 = findLine('function drawSpriteDef(', dsd1 + 1);
console.log(`drawSpriteDef #1 at line ${dsd1 + 1}, #2 at line ${dsd2 + 1}`);

// Find getWorkstationPosition (known original)
const gwp = findLine('export function getWorkstationPosition');
console.log(`getWorkstationPosition at line ${gwp + 1}`);

// Find drawHealingBasin functions
const dhb1 = findLine('function drawHealingBasin(');
const dhb2 = findLine('function drawHealingBasin(', dhb1 + 1);
console.log(`drawHealingBasin #1 at line ${dhb1 + 1}, #2 at ${dhb2 > -1 ? dhb2 + 1 : 'none'}`);

// Find drawFurniture functions  
const df1 = findLine('export function drawFurniture(');
const df2 = findLine('export function drawFurniture(', df1 + 1);
console.log(`drawFurniture #1 at line ${df1 + 1}, #2 at ${df2 > -1 ? df2 + 1 : 'none'}`);

// Find drawCharacter functions
const dc1 = findLine('export function drawCharacter(');
const dc2 = findLine('export function drawCharacter(', dc1 + 1);
console.log(`drawCharacter #1 at line ${dc1 + 1}, #2 at ${dc2 > -1 ? dc2 + 1 : 'none'}`);

// Find drawRoom
const dr = findLine('export function drawRoom(');
console.log(`drawRoom at line ${dr + 1}`);

// Find the section marker before drawRoom
const roomSection = findLine('// ─── Room rendering');
console.log(`Room rendering section at line ${roomSection + 1}`);

// Now reconstruct:
// Part 1: Lines 1 to (first drawSpriteDef - 1) — original header
for (let i = 0; i < dsd1; i++) output.push(lines[i]);

// Part 2: First drawSpriteDef through its closing brace
// Find closing brace of first drawSpriteDef
let braceDepth = 0;
let dsd1End = dsd1;
for (let i = dsd1; i < lines.length; i++) {
  const line = lines[i];
  for (const ch of line) {
    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
  }
  if (braceDepth === 0 && i > dsd1) {
    dsd1End = i;
    break;
  }
}
console.log(`First drawSpriteDef ends at line ${dsd1End + 1}`);

for (let i = dsd1; i <= dsd1End; i++) output.push(lines[i]);
output.push('');

// Part 3: Skip everything from after first drawSpriteDef to getWorkstationPosition
// This skips: second drawSpriteDef, getIdleAnimationFrame dupes, idle drawCharacter
console.log(`Skipping lines ${dsd1End + 2} to ${gwp}`);

// Part 4: getWorkstationPosition through end of drawHealingBasin #1
for (let i = gwp; i <= dhb1; i++) output.push(lines[i]);
// Continue until closing brace of drawHealingBasin
braceDepth = 0;
let dhb1End = dhb1;
for (let i = dhb1; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
  }
  if (braceDepth === 0 && i > dhb1) {
    dhb1End = i;
    break;
  }
}
console.log(`drawHealingBasin #1 ends at line ${dhb1End + 1}`);
// We already pushed up to dhb1, now push rest
for (let i = dhb1 + 1; i <= dhb1End; i++) output.push(lines[i]);
output.push('');

// Part 5: Original drawFurniture
for (const line of ORIGINAL_DRAW_FURNITURE) output.push(line);
output.push('');

// Part 6: Original drawCharacter + drawStatusEffect
for (const line of ORIGINAL_DRAW_CHARACTER) output.push(line);
output.push('');

// Part 7: drawRoom section to end (original)
const roomStart = roomSection > -1 ? roomSection : dr;
for (let i = roomStart; i < lines.length; i++) {
  // Skip any duplicate drawTiledWall or drawTiledFloor that was already defined
  output.push(lines[i]);
}

// Write output
const result = output.join('\n');
fs.writeFileSync(filePath, result, 'utf-8');
console.log(`\nReconstructed file: ${output.length} lines`);
