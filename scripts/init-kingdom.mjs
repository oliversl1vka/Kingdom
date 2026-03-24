// Initialize kingdom and submit decree with 20 frontend transformation tasks

const API = 'http://127.0.0.1:7778';

async function run() {
  // Step 1: Initialize kingdom
  const initRes = await fetch(`${API}/api/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_name: 'KingdomOS Frontend Transformation' })
  });
  const initData = await initRes.json();
  console.log('INIT:', JSON.stringify(initData));

  // Step 2: Submit decree with 20 tasks
  const tasks = [
    {
      title: 'Redesign character rendering with proper pixel art proportions',
      description: 'Replace fillRect-based character rendering with proper 16x24 pixel art characters. Each character type needs detailed sprites with outlines, shading gradients, proper body proportions (head, torso, legs, arms), and distinctive features for each role.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Characters have proper pixel art proportions', 'Each of 9 types visually distinct', 'Outlines and shading present']
    },
    {
      title: 'Add multi-frame idle animation for all characters',
      description: 'Create 4-frame idle animation cycles for each character type with breathing, blinking, and role-specific idle motions.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Each character has 4+ idle frames', 'Animations loop smoothly', 'Role-specific idle behaviors']
    },
    {
      title: 'Implement character walking animation system',
      description: 'Add walk cycle animation with pathfinding within rooms. Characters walk between positions.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Characters walk between positions', 'Walk cycles animate', 'Pathfinding avoids furniture']
    },
    {
      title: 'Create detailed tilemap-based room floor rendering',
      description: 'Replace flat floors with proper tile-based rendering using 16x16 tile patterns for stone, wood, carpet, cobblestone.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Floors use tile patterns', 'Tile variants per type', 'Each room has thematic floor']
    },
    {
      title: 'Improve stone wall rendering with depth and detail',
      description: 'Create 3D-effect stone walls with mortar lines, color variation, shadow gradients, and highlights.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Walls have 3D depth effect', 'Color variation per brick', 'Shadow gradients']
    },
    {
      title: 'Add detailed furniture sprites for each room',
      description: 'Create proper pixel art furniture: Throne, Planning Table, Weapon Rack, Workbench, Potion Shelf, etc.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Each room has 2+ furniture pieces', 'Furniture is detailed', 'Size proportional to room']
    },
    {
      title: 'Implement proper lighting system with torch glow',
      description: 'Create radial gradient lighting. Torches emit warm light, room corners darker, flicker animation with embers.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Torches emit radial warm light', 'Room corners darker', 'Flicker animation']
    },
    {
      title: 'Add character speech and thought bubbles',
      description: 'Working characters show task in speech bubble, idle characters show medieval quips. Pixel-art styled.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Working agents show task in bubble', 'Pixel-art bubble styling', 'Auto-hide after timeout']
    },
    {
      title: 'Create unified castle floor plan layout',
      description: 'Replace rigid grid with organic castle floor plan. Throne Room at top, connected by hallways. Doorways between rooms.',
      type: 'design',
      assigned_tier: 'nobility',
      acceptance_criteria: ['Rooms connected by corridors', 'Castle floor plan layout', 'Doorways visible']
    },
    {
      title: 'Add wall decorations and environmental props',
      description: 'Tapestries, wall shields, candle sconces, bookshelves, barrels, crates, rugs, chandeliers.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['4-8 props per room', 'Props match room theme', 'Pixel art quality']
    },
    {
      title: 'Implement proper pixel art color palette system',
      description: 'Unified medieval palette with 4-5 shade ramps per hue for stone, wood, gold, crimson, blue, green.',
      type: 'design',
      assigned_tier: 'squire',
      acceptance_criteria: ['Unified palette with shading ramps', 'All rendering uses palette', '4-5 shades per hue']
    },
    {
      title: 'Add animated environmental effects',
      description: 'Particle systems: torch embers, forge sparks, healing particles, dust motes, dripping water.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Each room has ambient particles', 'Particles have physics', '1-2px sized']
    },
    {
      title: 'Implement character-furniture interaction system',
      description: 'Characters sit at desks, stand at anvils, read at bookshelves. Working state goes to workstation.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Characters interact with furniture', 'Working triggers workstation', 'Idle triggers wandering']
    },
    {
      title: 'Add status-based character visual effects',
      description: 'Idle: subtle glow, Working: golden sparkles, Reviewing: magnifying glass, Stalled: red pulse, Cancelled: gray.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Each state has visual effect', 'Effects overlay character art', '5 distinct visuals']
    },
    {
      title: 'Create character outline and shadow system',
      description: 'Add 1-pixel dark outlines around characters, drop shadow beneath, proper z-sorting.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['1px dark outlines', 'Drop shadows', 'Proper z-sorting']
    },
    {
      title: 'Add room transition animations',
      description: 'Smooth transitions between rooms, door animations, fade effects, corridor connections.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Smooth room transitions', 'Door animations', 'Corridors connect rooms']
    },
    {
      title: 'Implement character info tooltip on hover',
      description: 'Hover shows medieval-styled tooltip with agent name, tier, status, current task, token budget.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Hover shows tooltip', 'Contains agent details', 'Pixel-art styled panel']
    },
    {
      title: 'Add ambient sound indicators (visual)',
      description: 'Visual indicators: forge impact lines, scribe musical notes, healer magic circles, sentinel alerts.',
      type: 'code',
      assigned_tier: 'squire',
      acceptance_criteria: ['Visual sound indicators per room', 'Animated icons', 'Match activity']
    },
    {
      title: 'Create minimap overview panel',
      description: 'Small minimap showing castle layout with colored agent dots. Click to navigate to rooms.',
      type: 'code',
      assigned_tier: 'knight',
      acceptance_criteria: ['Minimap shows layout', 'Agent dots in rooms', 'Click to navigate']
    },
    {
      title: 'Add day/night cycle visual theme',
      description: 'Gradual day/night cycle affecting lighting. Day: warm. Night: blue overlay, prominent torches, stars in windows.',
      type: 'design',
      assigned_tier: 'squire',
      acceptance_criteria: ['Day and night modes', '5-minute cycle', 'Window content changes']
    },
  ];

  const decreeRes = await fetch(`${API}/api/decree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      objective: 'Transform the KingdomOS frontend from basic fillRect rendering to professional pixel art quality. Implement proper character sprites, tilemap rooms, walking animations, furniture, lighting, speech bubbles, and atmospheric effects.',
      priority: 10,
      tasks
    })
  });
  const decreeData = await decreeRes.json();
  console.log('DECREE:', JSON.stringify(decreeData));

  // Check status
  const statusRes = await fetch(`${API}/api/status`);
  const statusData = await statusRes.json();
  console.log('STATUS:', JSON.stringify(statusData));

  // Check tasks
  const tasksRes = await fetch(`${API}/api/tasks`);
  const tasksData = await tasksRes.json();
  console.log('TASKS:', tasksData.length, 'tasks created');

  // Check agents view
  const agentsRes = await fetch(`${API}/api/agents`);
  const agentsData = await agentsRes.json();
  console.log('AGENTS:', agentsData.length, 'agents shown');
}

run().catch(e => console.error(e));
