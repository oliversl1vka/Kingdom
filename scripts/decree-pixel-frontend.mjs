#!/usr/bin/env node
/**
 * Submit the 20-task pixel frontend transformation decree.
 * Includes workspace_path and context_refs so agents get real file content.
 *
 * Usage: node scripts/decree-pixel-frontend.mjs [workspace_path]
 */

const workspacePath = process.argv[2] || 'C:\\Users\\KingdomOS\\Kingdom';
const API = 'http://127.0.0.1:7778';

// Main target files (relative to workspace root)
const PIXEL = 'packages/ui/src/engine/pixel-characters.ts';
const AGENTS = 'packages/ui/src/scenes/agents.tsx';

async function run() {
  // Step 1: Initialize kingdom with workspace path
  console.log(`Initializing kingdom with workspace: ${workspacePath}`);
  const initRes = await fetch(`${API}/api/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_name: 'KingdomOS Frontend Transformation',
      workspace_path: workspacePath,
    }),
  });
  const initData = await initRes.json();
  console.log('INIT:', JSON.stringify(initData));

  // Step 2: Submit decree with 20 tasks + context_refs
  // Line numbers mapped to the fixed 1469-line pixel-characters.ts:
  //   Sprites: 59-266, SPRITE_MAP: 268, PALETTE_MAP: 274
  //   Idle frames: 350-384, drawSpriteDef: 385
  //   Particle system: 476-590, Movement: 595-620
  //   Speech bubbles: 625-675, Furniture drawing: 676-895
  //   drawCharacter (exported): 898-935, drawStatusEffect: 937-962
  //   drawRoom (exported): 966-994, TiledWall: 998, TiledFloor: 1028
  //   Room furniture: 1090-1338, Decoration helpers: 1340-1420
  //   Room lighting: 1421-1436, Ambient particles: 1438-1469
  const tasks = [
    {
      title: 'Redesign character rendering with proper pixel art proportions',
      description: `Replace fillRect-based character rendering with proper 16x24 pixel art characters in ${PIXEL}. Each character type needs detailed sprites with outlines, shading gradients, proper body proportions (head, torso, legs, arms), and distinctive features for each role. The drawCharacter() export is at ~line 898. Modify the existing rendering functions to improve proportions and add per-pixel detail. Keep the Canvas 2D API approach.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Characters have proper pixel art proportions', 'Each of 9 types visually distinct', 'Outlines and shading present', 'Only pixel-characters.ts is modified'],
      context_refs: [{ file: PIXEL, startLine: 1, endLine: 100 }, { file: PIXEL, startLine: 890, endLine: 960 }],
    },
    {
      title: 'Add multi-frame idle animation for all characters',
      description: `Create 4-frame idle animation cycles for each character type in ${PIXEL}. Add breathing (subtle vertical offset), blinking (eye color change frame), and role-specific idle motions (e.g., knight sword sway, scribe page turn). The idle animation data is at ~line 350, IDLE_FRAMES_MAP at ~line 369. Modify drawCharacter() at ~line 898 to use frame selection.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Each character has 4+ idle frames', 'Animations loop smoothly at 200ms intervals', 'Role-specific idle behaviors visible'],
      context_refs: [{ file: PIXEL, startLine: 300, endLine: 415 }],
    },
    {
      title: 'Implement character walking animation system',
      description: `Add walk cycle animation in ${PIXEL}. Characters should have a 4-frame walk cycle with leg movement. The movement system is at ~line 595 (getCS, updateMovement). Add walk frame rendering in drawCharacter() at ~line 898. The movement integration is handled in ${AGENTS} around the tick callback.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Characters have walk cycle with leg movement', 'Walk cycles animate smoothly', '4-frame walk animation per direction'],
      context_refs: [{ file: PIXEL, startLine: 590, endLine: 700 }, { file: AGENTS, startLine: 1, endLine: 50 }],
    },
    {
      title: 'Create detailed tilemap-based room floor rendering',
      description: `Enhance floor rendering in ${PIXEL} with proper tile-based rendering using 16x16 tile patterns. The drawTiledFloor() function is at ~line 1028 and drawRoom() at ~line 966. Improve tile pattern functions for: stone (gray blocks with mortar lines), wood (horizontal planks with grain), carpet (red with border pattern), cobblestone (irregular circles). Each room should use a thematic floor type.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Floors use 16x16 tile patterns', 'At least 4 tile variants (stone, wood, carpet, cobblestone)', 'Each room has a thematic floor type'],
      context_refs: [{ file: PIXEL, startLine: 960, endLine: 1090 }],
    },
    {
      title: 'Improve stone wall rendering with depth and detail',
      description: `Enhance wall rendering in ${PIXEL}. The drawTiledWall() function is at ~line 998. Add mortar line detail (1px lighter lines in a brick pattern), color variation per brick (randomize ±10 shade), shadow gradient (darker at bottom, lighter at top), and a subtle highlight line at top edge. Keep the existing wall height/offset system.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Walls have mortar lines', 'Color variation per brick block', 'Shadow gradient from top to bottom'],
      context_refs: [{ file: PIXEL, startLine: 990, endLine: 1030 }],
    },
    {
      title: 'Add detailed furniture sprites for each room',
      description: `Improve furniture rendering in ${PIXEL}. The furniture drawing section starts at ~line 676 with drawThrone(), drawPlanningTable(), etc. The drawFurniture() export is at ~line 875. Replace basic shapes with more detailed pixel art sprites. Enhance: ornate Throne, Planning Table, Weapon Rack, Workbench, Potion Shelf, Scribe Desk, Healing Basin. Each piece should be 24x24 to 32x32 pixels.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Each room has 2+ detailed furniture pieces', 'Furniture uses pixel-art style (not fillRect blocks)', 'Size proportional to room (24-32px)'],
      context_refs: [{ file: PIXEL, startLine: 670, endLine: 900 }],
    },
    {
      title: 'Implement proper lighting system with torch glow',
      description: `Enhance the lighting system in ${PIXEL}. The drawRoomLighting() is at ~line 1423 and drawTorch() is at ~line 1352. Improve torches to emit warm (orange-yellow) radial gradients. Add a function drawTorchGlow(ctx, x, y, radius, intensity) that uses ctx.createRadialGradient(). Room corners should be darker. Add gentle flicker by varying radius ±2px per frame.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Torches emit warm radial gradient light', 'Room corners are darker', 'Flicker animation visible on torches'],
      context_refs: [{ file: PIXEL, startLine: 1340, endLine: 1440 }],
    },
    {
      title: 'Add character speech and thought bubbles',
      description: `Enhance speech/thought bubbles in ${PIXEL}. The speech bubble system is at ~line 625 with updateBubble() and drawBubble(). Improve the pixel-art styled bubble appearance. Working characters show their current task title. Idle characters show random medieval quips. Bubble should have rounded rect shape with a triangular pointer, white fill, 1px dark border. Auto-hide after 3 seconds.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Working agents show task text in speech bubble', 'Pixel-art bubble with pointer and border', 'Bubbles auto-hide after timeout'],
      context_refs: [{ file: PIXEL, startLine: 620, endLine: 680 }],
    },
    {
      title: 'Create unified castle floor plan layout',
      description: `Design an improved castle floor plan layout. Document the new layout positions for all 9 rooms: Throne Room (top center, largest), Great Hall (center), Workshop (bottom-left), Library (left-center), War Room (right-center), Healing Chamber (top-right), Watchtower (top-left), Scribe Study (bottom-right), Dungeon (bottom-center). Include room dimensions as grid coordinates and corridor connections between adjacent rooms. Output as structured markdown.`,
      type: 'design',
      assigned_tier: 'nobility',
      acceptance_criteria: ['All 9 rooms positioned in castle layout', 'Room dimensions specified', 'Corridor connections mapped between adjacent rooms'],
      context_refs: [{ file: PIXEL, startLine: 1, endLine: 50 }],
    },
    {
      title: 'Add wall decorations and environmental props',
      description: `Enhance decorative props in rooms in ${PIXEL}. The decoration helpers are at ~line 1340 (drawBanner, drawTorch, drawCandle, etc.). Add or improve functions for: drawTapestry, drawWallShield, drawCandelabra, drawBarrel, drawCrate, drawRug. Each prop should be 8-16px pixel art. Integrate 2-4 room-appropriate props per room in the drawRoomFurniture functions starting at ~line 1092.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['4-8 decorative props per room', 'Props match room theme', 'Props are pixel art style (8-16px)'],
      context_refs: [{ file: PIXEL, startLine: 1090, endLine: 1340 }],
    },
    {
      title: 'Implement proper pixel art color palette system',
      description: `Design a unified medieval color palette for the pixel art engine. Define shade ramps (4-5 shades from dark to light) for: Stone (grays), Wood (browns), Gold (yellows), Crimson (reds), Royal Blue (blues), Forest Green (greens), Iron (dark grays), Parchment (warm whites). Each ramp should include a darkest shadow, dark, mid, light, and highlight shade. Output as a structured palette definition (hex codes) in markdown format for developers to implement.`,
      type: 'design',
      assigned_tier: 'squire',
      acceptance_criteria: ['8 color ramps defined with hex codes', 'Each ramp has 4-5 shades', 'Palette suitable for medieval pixel art'],
      context_refs: [],
    },
    {
      title: 'Add animated environmental effects',
      description: `Enhance particle systems in ${PIXEL}. The particle system is at ~line 476 and ambient particles at ~line 1438. Improve room-specific particles: Workshop (orange forge sparks rising and fading), Healing Chamber (green healing sparkles floating upward), Library (dust motes drifting slowly), Dungeon (dripping water droplets falling), Watchtower (wind streaks). Each particle should be 1-2px, have position, velocity, lifespan, color.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Each room type has themed ambient particles', 'Particles have physics (velocity, lifespan)', 'Particles are 1-2px sized'],
      context_refs: [{ file: PIXEL, startLine: 470, endLine: 595 }, { file: PIXEL, startLine: 1430, endLine: 1469 }],
    },
    {
      title: 'Implement character-furniture interaction system',
      description: `Enhance character-furniture interaction in ${PIXEL} and ${AGENTS}. getWorkstationPosition() is at ~line 413. When a character is working (status=running), position them at the room's workstation furniture. When idle, position them at a random spot. The room-specific furniture functions start at ~line 1092 (drawRoomFurniture). The agents.tsx scene passes work status through to the draw call.`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Working characters positioned at workstation furniture', 'Idle characters at random positions', 'Smooth transition between positions'],
      context_refs: [{ file: PIXEL, startLine: 410, endLine: 470 }, { file: AGENTS, startLine: 60, endLine: 189 }],
    },
    {
      title: 'Add status-based character visual effects',
      description: `Enhance visual overlay effects per status in ${PIXEL}. The drawStatusEffect() function is at ~line 937. Improve rendering for: Idle: subtle pulsing white glow (opacity oscillates 0.1-0.3), Working: golden sparkle particles around character, Reviewing: magnifying glass icon above head, Stalled: red pulsing outline, Failed: dark gray desaturation overlay. Applied after drawing the character sprite.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Each status has a distinct visual overlay', 'Effects animate smoothly', '5 distinct status visuals implemented'],
      context_refs: [{ file: PIXEL, startLine: 890, endLine: 965 }],
    },
    {
      title: 'Create character outline and shadow system',
      description: `Enhance outlines and shadows for characters in ${PIXEL}. In drawCharacter() at ~line 898, improve: 1) A 1px dark (#1a1a2e) outline around the character by drawing a slightly larger silhouette behind the character in the outline color. 2) An elliptical drop shadow beneath the character (3px tall, character-width wide, dark with 0.3 alpha). 3) Simple z-sorting: characters further down (higher y) draw on top.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['1px dark outline around all characters', 'Elliptical drop shadow beneath each character', 'Characters have proper z-sorting (back to front)'],
      context_refs: [{ file: PIXEL, startLine: 890, endLine: 960 }],
    },
    {
      title: 'Add room transition animations',
      description: `Add room transition effects in ${PIXEL}. Create drawDoorway(ctx, x, y, width, height) that renders a dark archway between rooms. Add drawCorridor(ctx, fromRoom, toRoom) that draws a connecting hallway between adjacent rooms. When rooms are redrawn, add a subtle fade-in by drawing the room with increasing opacity over 5 frames. drawRoom() is at ~line 966.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Doorway arches visible between connected rooms', 'Corridors drawn connecting adjacent rooms', 'Rooms have subtle fade-in effect on redraw'],
      context_refs: [{ file: PIXEL, startLine: 960, endLine: 1090 }],
    },
    {
      title: 'Implement character info tooltip on hover',
      description: `Add hover tooltips in ${AGENTS}. When mouse hovers over a character sprite, show a medieval-styled tooltip panel with: Agent name (tier title), Current status, Current task title (if working), Token budget used. The tooltip should be a pixel-art styled panel with dark background (#1a1a2e), gold border, parchment text. Track mouse position and hit-test against character positions. Add onMouseMove handler to the canvas.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Hover over character shows tooltip', 'Tooltip contains agent name, tier, status, task', 'Pixel-art styled dark panel with gold border'],
      context_refs: [{ file: AGENTS, startLine: 1, endLine: 189 }],
    },
    {
      title: 'Add ambient sound indicators (visual)',
      description: `Add visual sound-indicator animations in ${PIXEL}. Create drawSoundIndicator(ctx, x, y, type, frame) for: Workshop forge (orange impact lines radiating outward), Scribe study (musical note icons floating up), Healing chamber (concentric magic circles expanding), Watchtower (exclamation alert icons). Indicators should be small (8-12px), animated over 4 frames, and positioned near the relevant furniture. Furniture functions start at ~line 676.`,
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Visual sound indicators for 4+ room types', 'Indicators animate over multiple frames', 'Positioned near relevant furniture'],
      context_refs: [{ file: PIXEL, startLine: 670, endLine: 900 }],
    },
    {
      title: 'Create minimap overview panel',
      description: `Add a minimap component in ${AGENTS}. Draw a small (160x120px) minimap in the top-right corner of the canvas showing the castle layout with simplified colored room rectangles. Each room should show colored dots for agents currently in that room. The minimap should have a dark background with semi-transparent overlay. Room colors: Throne(gold), Workshop(orange), Library(blue), War Room(red), Healing(green), Watchtower(gray), Scribe(brown), Dungeon(dark gray), Great Hall(purple).`,
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Minimap visible in top-right corner', 'Colored agent dots shown in rooms', 'All 9 rooms represented with distinct colors'],
      context_refs: [{ file: AGENTS, startLine: 1, endLine: 189 }, { file: PIXEL, startLine: 1, endLine: 50 }],
    },
    {
      title: 'Add day/night cycle visual theme',
      description: `Design the day/night cycle system for the pixel engine. Specify: 1) A 5-minute full cycle (2.5min day, 30s sunset, 2min night, 30s sunrise). 2) Day mode: warm white ambient, torches subtle. Night mode: dark blue overlay (rgba 0,0,40,0.4), torches prominent, window content shows stars. 3) The overlay should be applied as a final compositing step after all rooms are drawn. 4) Color shift values for each phase. Output as a structured design document in markdown.`,
      type: 'design',
      assigned_tier: 'squire',
      acceptance_criteria: ['Day and night visual modes specified', '5-minute cycle with transition phases', 'Color values and overlay specifications for each phase'],
      context_refs: [{ file: PIXEL, startLine: 1340, endLine: 1440 }],
    },
  ];

  console.log(`\nSubmitting decree with ${tasks.length} tasks...`);
  const decreeRes = await fetch(`${API}/api/decree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      objective: 'Transform the KingdomOS frontend from basic fillRect rendering to professional pixel art quality. Implement proper character sprites, tilemap rooms, walking animations, furniture, lighting, speech bubbles, and atmospheric effects.',
      priority: 10,
      tasks,
    }),
  });
  const decreeData = await decreeRes.json();
  console.log('DECREE:', JSON.stringify(decreeData));

  // Check status
  const statusRes = await fetch(`${API}/api/status`);
  const statusData = await statusRes.json();
  console.log('STATUS:', JSON.stringify(statusData));

  // Check created tasks
  const tasksRes = await fetch(`${API}/api/tasks`);
  const tasksData = await tasksRes.json();
  console.log(`\n✓ ${tasksData.length} tasks created`);
  for (const t of tasksData) {
    if (t.level !== 'epic') {
      const refs = JSON.parse(t.context_refs || '[]');
      console.log(`  [${t.assigned_tier}] ${t.title.slice(0, 60)} — ${refs.length} context refs`);
    }
  }

  console.log('\nDecree submitted. Use /api/summon to start the pipeline.');
}

run().catch((e) => console.error(e));
