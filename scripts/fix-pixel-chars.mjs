#!/usr/bin/env node
/**
 * Fix pixel-characters.ts by extracting clean sections and recomposing.
 * 
 * Issues in the current file:
 * 1. Agent functions (drawDoorway, drawCorridor, drawRoomWithFadeIn) inserted
 *    inside the healer array in the SPRITES object (~lines 561-640)
 * 2. Agent function (drawSoundIndicator) inserted inside the squire array
 *    in the SPRITES object (~lines 701-789)
 * 3. drawPixelCharacter function truncated mid-expression at ~line 1100
 * 4. drawFurniture switch/function body not closed at ~line 1773
 * 5. Duplicate function names (drawCharacter at ~280 and ~1785, drawRoom at ~1005 and ~1770)
 * 6. Forward reference: SQUIRE_IDLE_FRAMES references SQUIRE_SPRITE before it's defined
 * 
 * Strategy: Extract clean sections in correct order, skip corrupted/duplicate sections.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const filePath = join(process.cwd(), 'packages/ui/src/engine/pixel-characters.ts');
const lines = readFileSync(filePath, 'utf-8').split('\n');

console.log(`Read ${lines.length} lines from pixel-characters.ts`);

// Helper: extract lines (1-indexed, inclusive)
function extract(start, end) {
  return lines.slice(start - 1, end);
}

// Helper: find line containing exact text
function findLine(text, startFrom = 0) {
  for (let i = startFrom; i < lines.length; i++) {
    if (lines[i].includes(text)) return i + 1; // return 1-indexed
  }
  return -1;
}

// Helper: find line matching regex
function findLineRegex(regex, startFrom = 0) {
  for (let i = startFrom; i < lines.length; i++) {
    if (regex.test(lines[i])) return i + 1;
  }
  return -1;
}

// Find key landmarks
const kingSpriteLine = findLine('const KING_SPRITE');
const healerSpriteLine = findLine('const HEALER_SPRITE');
const sentinelSpriteLine = findLine('const SENTINEL_SPRITE');
const nobilitySpriteLine = findLine('const NOBILITY_SPRITE');
const squireSpriteLine = findLine('const SQUIRE_SPRITE');
const scribeSpriteLine = findLine('const SCRIBE_SPRITE');
const judgeSpriteLine = findLine('const JUDGE_SPRITE');
const blacksmithSpriteLine = findLine('const BLACKSMITH_SPRITE');
const spriteMapLine = findLine('const SPRITE_MAP');
const paletteMapLine = findLine('const PALETTE_MAP');
const idleFrameDurLine = findLine('const IDLE_FRAME_DURATION');
const drawSpriteDefLine = findLine('function drawSpriteDef');
const idleAnimFrameLine = findLine('function getIdleAnimationFrame');

// Find the exported drawCharacter (the good one)
const exportDrawCharLine = findLine('export function drawCharacter(');
// Find the exported drawRoom (the good one)  
const exportDrawRoomLine = findLine('export function drawRoom(');
// Find getWorkstationPosition
const getWSPosLine = findLine('export function getWorkstationPosition');
// Find lightenColor  
const lightenColorLine = findLine('function lightenColor(color');
// Find the movement section
const movementLine = findLine('// ─── Character movement');
// Find the speech bubbles section
const speechLine = findLine('// ─── Speech bubbles');
// Find the furniture section header (the good furniture drawing functions)
const furnitureLine = findLine('function drawThrone(');
// Find drawFurniture export
const drawFurnitureLine = findLine('export function drawFurniture(');
// Find the unclosed break before main character draw
const mainCharDrawComment = findLine('// ─── Main character draw');
// Find tiled wall
const tiledWallLine = findLine('// ─── Tiled wall');
// Find tiled floor
const tiledFloorLine = findLine('// ─── Tiled floor');
// Find room furniture dispatch
const roomFurnitureLine = findLine('// ─── Room furniture');
// Find decoration helpers
const decorHelpersLine = findLine('// ─── Decoration helpers');
// Find room lighting
const roomLightingLine = findLine('// ─── Room lighting');
// Find ambient particles
const ambientParticlesLine = findLine('// ─── Ambient particles');
// Find re-export at end
const reExportLine = findLine('export { getCS, updateMovement }');

// Find the IDLE_FRAMES stuff
const kingIdleFramesLine = findLine('const KING_IDLE_FRAMES');
const idleFramesMapLine = findLine('const IDLE_FRAMES_MAP');

console.log('Key landmarks:');
console.log({
  kingSpriteLine, healerSpriteLine, sentinelSpriteLine, nobilitySpriteLine,
  squireSpriteLine, scribeSpriteLine, judgeSpriteLine, blacksmithSpriteLine,
  spriteMapLine, paletteMapLine, idleFrameDurLine, drawSpriteDefLine,
  kingIdleFramesLine, idleFramesMapLine, idleAnimFrameLine,
  exportDrawCharLine, exportDrawRoomLine, getWSPosLine, lightenColorLine,
  movementLine, speechLine, furnitureLine, drawFurnitureLine,
  mainCharDrawComment, tiledWallLine, roomFurnitureLine, decorHelpersLine,
  roomLightingLine, ambientParticlesLine, reExportLine,
});

// Find end of each sprite constant (find the closing ];)
function findArrayEnd(startLine) {
  let depth = 0;
  for (let i = startLine - 1; i < lines.length; i++) {
    if (lines[i].includes('[')) depth++;
    if (lines[i].includes('];')) {
      depth--;
      if (depth <= 0) return i + 1; // 1-indexed
    }
  }
  return -1;
}

// Find end of function (track braces)
function findFunctionEnd(startLine) {
  let depth = 0;
  let started = false;
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      if (ch === '}') depth--;
    }
    if (started && depth === 0) return i + 1;
  }
  return -1;
}

const output = [];

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: Header, types, palette (lines 1 to just before KING_SPRITE)
// ═══════════════════════════════════════════════════════════════════
output.push(...extract(1, kingSpriteLine - 1));

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: ALL sprite constants (in correct order)
// ═══════════════════════════════════════════════════════════════════
const spriteConstants = [
  [kingSpriteLine, 'KING_SPRITE'],
  [findLine('const KNIGHT_SPRITE'), 'KNIGHT_SPRITE'],
  [healerSpriteLine, 'HEALER_SPRITE'],
  [sentinelSpriteLine, 'SENTINEL_SPRITE'],
  [nobilitySpriteLine, 'NOBILITY_SPRITE'],
  [squireSpriteLine, 'SQUIRE_SPRITE'],
  [scribeSpriteLine, 'SCRIBE_SPRITE'],
  [judgeSpriteLine, 'JUDGE_SPRITE'],
  [blacksmithSpriteLine, 'BLACKSMITH_SPRITE'],
];

for (const [startLine, name] of spriteConstants) {
  if (startLine < 0) { console.error(`Missing sprite: ${name}`); continue; }
  const endLine = findArrayEnd(startLine);
  if (endLine < 0) { console.error(`Can't find end of ${name}`); continue; }
  output.push(...extract(startLine, endLine));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: SPRITE_MAP and PALETTE_MAP
// ═══════════════════════════════════════════════════════════════════
if (spriteMapLine > 0) {
  // Find end of SPRITE_MAP
  const spriteMapEnd = findLine('};', spriteMapLine - 1);
  output.push(...extract(spriteMapLine, spriteMapEnd));
  output.push('');
}
if (paletteMapLine > 0) {
  const paletteMapEnd = findLine('};', paletteMapLine - 1);
  output.push(...extract(paletteMapLine, paletteMapEnd));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: Idle animation frames (now all sprites are defined above)
// ═══════════════════════════════════════════════════════════════════
if (kingIdleFramesLine > 0 && idleFramesMapLine > 0) {
  // Find end of IDLE_FRAMES_MAP (look for closing };)
  const idleMapEnd = findLine('};', idleFramesMapLine - 1);
  output.push(...extract(kingIdleFramesLine, idleMapEnd));
  output.push('');
}
// Idle frame duration
if (idleFrameDurLine > 0) {
  output.push(lines[idleFrameDurLine - 1]);
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: Drawing engine (drawSpriteDef)
// ═══════════════════════════════════════════════════════════════════
if (drawSpriteDefLine > 0) {
  // Find the section comment before it
  const sectionComment = findLine('// ─── Drawing engine', drawSpriteDefLine - 10);
  const startLine = sectionComment > 0 ? sectionComment : drawSpriteDefLine;
  const endLine = findFunctionEnd(drawSpriteDefLine);
  output.push(...extract(startLine, endLine));
  output.push('');
}

// getIdleAnimationFrame
if (idleAnimFrameLine > 0) {
  const endLine = findFunctionEnd(idleAnimFrameLine);
  output.push(...extract(idleAnimFrameLine, endLine));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: getWorkstationPosition, lerp, updateCharacterPosition
// ═══════════════════════════════════════════════════════════════════
if (getWSPosLine > 0) {
  const endLine = findFunctionEnd(getWSPosLine);
  output.push(...extract(getWSPosLine, endLine));
  output.push('');
}

// lerp
const lerpLine = findLine('export function lerp(');
if (lerpLine > 0) {
  const endLine = findFunctionEnd(lerpLine);
  output.push(...extract(lerpLine, endLine));
  output.push('');
}

// CharacterState interface + characterStates + updateCharacterPosition
const charStateIfLine = findLine('interface CharacterState {');
if (charStateIfLine > 0) {
  // Get interface
  const ifEnd = findLine('}', charStateIfLine - 1);
  output.push(...extract(charStateIfLine, ifEnd));
  output.push('');
}

const charStatesLine = findLine('const characterStates');
if (charStatesLine > 0) {
  output.push(lines[charStatesLine - 1]);
  output.push('');
}

const updateCharPosLine = findLine('export function updateCharacterPosition(');
if (updateCharPosLine > 0) {
  const endLine = findFunctionEnd(updateCharPosLine);
  output.push(...extract(updateCharPosLine, endLine));
  output.push('');
}

// lightenColor
if (lightenColorLine > 0) {
  const endLine = findFunctionEnd(lightenColorLine);
  output.push(...extract(lightenColorLine, endLine));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: Particle system
// ═══════════════════════════════════════════════════════════════════
const particleLine = findLine('// ─── Particle system');
if (particleLine > 0) {
  // Extract from particle system through drawRoomParticles
  const drawRoomParticlesLine = findLine('function drawRoomParticles(');
  if (drawRoomParticlesLine > 0) {
    const endLine = findFunctionEnd(drawRoomParticlesLine);
    output.push(...extract(particleLine, endLine));
    output.push('');
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: Character movement (getCS, updateMovement)
// ═══════════════════════════════════════════════════════════════════
if (movementLine > 0) {
  const updateMovEnd = findFunctionEnd(findLine('function updateMovement('));
  output.push(...extract(movementLine, updateMovEnd));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 9: Speech bubbles
// ═══════════════════════════════════════════════════════════════════
if (speechLine > 0) {
  const roundRectEnd = findFunctionEnd(findLine('function roundRect('));
  output.push(...extract(speechLine, roundRectEnd));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 10: Furniture drawing functions
// ═══════════════════════════════════════════════════════════════════
if (furnitureLine > 0) {
  // Find the section comment
  const furnitureComment = findLine('// ─── Furniture drawing');
  const startLine = furnitureComment > 0 ? furnitureComment : furnitureLine;
  
  // Extract all furniture functions up to drawFurniture
  if (drawFurnitureLine > 0) {
    // Get everything from furniture section to before the Main character draw comment
    if (mainCharDrawComment > 0) {
      const sectionLines = extract(startLine, mainCharDrawComment - 1);
      output.push(...sectionLines);
      // Close the drawFurniture function properly
      output.push('  }');
      output.push('}');
      output.push('');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 11: Main exported drawCharacter + drawStatusEffect
// ═══════════════════════════════════════════════════════════════════
if (mainCharDrawComment > 0 && exportDrawCharLine > 0) {
  // drawCharacter through drawStatusEffect
  const dseEnd = findFunctionEnd(findLine('function drawStatusEffect('));
  output.push(lines[mainCharDrawComment - 1]); // comment
  output.push('');
  output.push(...extract(exportDrawCharLine, dseEnd));
  output.push('');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 12: Main exported drawRoom + rendering pipeline
// ═══════════════════════════════════════════════════════════════════
if (exportDrawRoomLine > 0) {
  // Find the room rendering section comment
  const roomRenderComment = findLine('// ─── Room rendering');
  const startLine = roomRenderComment > 0 ? roomRenderComment : exportDrawRoomLine;
  
  // Get the section comment + drawRoom function
  const drawRoomEnd = findFunctionEnd(exportDrawRoomLine);
  output.push(...extract(startLine, drawRoomEnd));
  output.push('');
}

// Tiled wall
if (tiledWallLine > 0) {
  const fn = findLine('function drawTiledWall(');
  const endLine = findFunctionEnd(fn);
  output.push(...extract(tiledWallLine, endLine));
  output.push('');
}

// Tiled floor
if (tiledFloorLine > 0) {
  const fn = findLine('function drawTiledFloor(');
  const endLine = findFunctionEnd(fn);
  output.push(...extract(tiledFloorLine, endLine));
  output.push('');
}

// Room furniture (drawRoomFurniture + all individual room functions)
if (roomFurnitureLine > 0) {
  // From section comment through all room-specific functions until decoration helpers
  const endLine = decorHelpersLine > 0 ? decorHelpersLine - 1 : roomLightingLine - 1;
  output.push(...extract(roomFurnitureLine, endLine));
  output.push('');
}

// Decoration helpers (drawBanner, drawTorch, drawCandle, drawPotion, drawBookcase, drawTapestry v2, drawChair)
if (decorHelpersLine > 0) {
  const endLine = roomLightingLine > 0 ? roomLightingLine - 1 : ambientParticlesLine - 1;
  output.push(...extract(decorHelpersLine, endLine));
  output.push('');
}

// Room lighting
if (roomLightingLine > 0) {
  const fn = findLine('function drawRoomLighting(');
  const endLine = findFunctionEnd(fn);
  output.push(...extract(roomLightingLine, endLine));
  output.push('');
}

// Ambient spawner
if (ambientParticlesLine > 0) {
  const fn = findLine('function spawnRoomParticles(');
  if (fn > 0) {
    const endLine = findFunctionEnd(fn);
    output.push(...extract(ambientParticlesLine, endLine));
    output.push('');
  }
}

// Re-exports
if (reExportLine > 0) {
  output.push(lines[reExportLine - 1]);
}

// Write the fixed file
const outputText = output.join('\n');
writeFileSync(filePath, outputText, 'utf-8');
console.log(`\nWrote ${output.length} lines to pixel-characters.ts`);
console.log('Done!');
