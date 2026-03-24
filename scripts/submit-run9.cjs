// Submit the decree for Run 9 - same 20 pixel art tasks
// Fixes applied: malformed @@ ... @@ hunk header reconstruction, improved prompt instructions
const http = require('http');

const decree = {
  objective: "Pixel Art Castle UI Enhancement - Run 9 (hunk header fix)",
  tasks: [
    {
      title: "Redesign character rendering with proper pixel art proportions",
      description: "Rewrite the character sprite definitions using proper 16x24 pixel art proportions. Replace the current oversized sprite arrays with compact, well-proportioned sprites for all character types. Each sprite should have clear head, body, and leg sections with appropriate pixel ratios. Update the SPRITE_MAP and PALETTE_MAP accordingly.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["All character sprites use 16x24 pixel grid", "SPRITE_MAP and PALETTE_MAP updated", "No duplicate function declarations", "File compiles without TypeScript errors"]
    },
    {
      title: "Add multi-frame idle animation for all characters",
      description: "Add idle animation frame arrays for each character type (KING_IDLE_FRAMES, KNIGHT_IDLE_FRAMES, etc). Each should have 2-4 frames showing subtle breathing or shifting movements. Update drawCharacter to cycle through idle frames based on the frame counter.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Each character type has idle animation frames", "drawCharacter uses frame counter for animation", "Animations cycle smoothly", "No duplicate declarations"]
    },
    {
      title: "Implement character walking animation system",
      description: "Add walking animation frames and a walk cycle system. Create WALK_FRAMES arrays for each character type showing leg movement. Add a walkFrame property to AnimState and update updateMovement to advance the walk cycle. Modify drawCharacter to use walk frames when the character is moving.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Walk animation frames defined for all characters", "Walk cycle advances during movement", "Smooth animation transitions", "No TypeScript errors"]
    },
    {
      title: "Create detailed tilemap-based room floor rendering",
      description: "Enhance the room floor rendering in drawRoom and room-specific functions to use a tilemap approach with varied floor tiles. Add stone tile patterns, cracks, and color variations. Each room type should have distinct floor style.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Floor tiles have varied patterns", "Each room has distinct floor style", "Tilemap approach used", "No duplicate declarations"]
    },
    {
      title: "Improve stone wall rendering with depth and detail",
      description: "Enhance wall rendering functions to draw detailed stone walls with individual bricks, mortar lines, depth shading, and moss/damage details. Add highlights and shadows to create a 3D appearance.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Walls show individual brick patterns", "Depth shading creates 3D effect", "Visual detail improved", "No TypeScript errors"]
    },
    {
      title: "Add detailed furniture sprites for each room",
      description: "Enhance the furniture drawing functions (drawThrone, drawWorkbench, drawScribeDesk, etc.) with more detailed pixel art sprites. Add wood grain textures, metal studs, fabric details, and appropriate shadows.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Furniture sprites more detailed", "Each furniture type visually distinct", "Appropriate textures and shadows", "No duplicate function declarations"]
    },
    {
      title: "Implement proper lighting system with torch glow",
      description: "Add a torch/lantern lighting system to rooms. Create drawTorch() function with animated flame. Add radial glow effect around light sources. Update drawRoomLighting to use point lights from torch positions.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Torch sprites with animated flame", "Radial glow effect around lights", "Lighting integrates with room rendering", "No TypeScript errors"]
    },
    {
      title: "Add character speech and thought bubbles",
      description: "Create a bubble rendering system that shows speech or thought bubbles above characters. Add drawSpeechBubble() and drawThoughtBubble() functions. Bubbles should show brief status text like 'Working...', 'Idle', or task-related messages.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Speech bubble rendering function", "Thought bubble rendering function", "Bubbles display status text", "No duplicate declarations"]
    },
    {
      title: "Create unified castle floor plan layout",
      description: "Add a drawCastleOverview() function that renders a bird's eye architectural floor plan showing all rooms connected by corridors. Add doorway connections between adjacent rooms.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Castle overview function created", "Rooms connected by corridors", "Doorways between rooms", "No TypeScript errors"]
    },
    {
      title: "Add wall decorations and environmental props",
      description: "Create functions to draw wall-mounted decorations: banners, shields, weapon displays, paintings, sconces. Add drawWallDecoration() that accepts decoration type and renders at specified position.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Multiple decoration types supported", "Wall decorations render correctly", "Decorations placed contextually", "No duplicate declarations"]
    },
    {
      title: "Implement proper pixel art color palette system",
      description: "Create a centralized color palette system with named palette entries. Add CASTLE_PALETTE with stone, wood, metal, fabric, and nature color groups. Update existing drawing functions to reference palette colors instead of hardcoded hex values.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Centralized palette object created", "Multiple color groups defined", "Existing functions use palette", "No TypeScript errors"]
    },
    {
      title: "Add animated environmental effects",
      description: "Add particle-based environmental effects: dust motes floating in light beams, fireplace sparks, water drips in the dungeon. Create updateParticles() and drawParticles() functions.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Particle system created", "Multiple effect types", "Particles animate smoothly", "No duplicate declarations"]
    },
    {
      title: "Implement character-furniture interaction system",
      description: "Add visual indicators when characters are near their workstations. Show characters sitting at desks, standing at forges, or reading at lecterns. Add getInteractionPose() that returns character sprite modifications based on proximity to furniture.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Interaction poses for workstations", "Visual feedback near furniture", "Smooth transition between poses", "No TypeScript errors"]
    },
    {
      title: "Add status-based character visual effects",
      description: "Enhance drawStatusEffect to show more detailed visual effects based on agent state. Add glow effects for 'working', ZZZ particles for 'idle', exclamation marks for errors, and spinning gears for 'processing'.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Visual effects for each agent state", "Effects animate properly", "Clear visual distinction between states", "No duplicate declarations"]
    },
    {
      title: "Create character outline and shadow system",
      description: "Add a drawCharacterOutline() function that renders a 1px dark outline around character sprites for better visibility. Add drawCharacterShadow() that draws an elliptical shadow beneath each character.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Character outlines render correctly", "Shadows beneath characters", "Outlines don't affect sprite colors", "No TypeScript errors"]
    },
    {
      title: "Add room transition animations",
      description: "Create a room transition system with fade or slide effects when switching between rooms. Add transitionToRoom() function with easing. Store current transition state and render intermediate frames.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Transition animation between rooms", "Easing function for smooth motion", "Transition state management", "No duplicate declarations"]
    },
    {
      title: "Implement character info tooltip on hover",
      description: "Add a drawTooltip() function that renders an info panel showing character name, role, current status, and current task when the mouse hovers near a character position. Style as a medieval scroll/parchment.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Tooltip renders on hover positions", "Shows name, role, status, task", "Medieval parchment styling", "No TypeScript errors"]
    },
    {
      title: "Add ambient sound indicators (visual)",
      description: "Create visual representations of ambient sounds: musical notes near the bard area, hammer sounds near the forge (impact lines), quill scratching near the scriptorium (small motion lines). Add drawSoundIndicator() function.",
      type: "code",
      assigned_tier: "squire",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Sound indicator function created", "Multiple indicator types", "Indicators animate", "No duplicate declarations"]
    },
    {
      title: "Create minimap overview panel",
      description: "Add a drawMinimap() function that renders a small overview of the entire castle in the corner of the screen. Show room positions as colored rectangles with dots for character positions. Highlight the currently viewed room.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Minimap renders castle overview", "Rooms shown as rectangles", "Character positions as dots", "No TypeScript errors"]
    },
    {
      title: "Add day/night cycle visual theme",
      description: "Implement a day/night cycle that affects room lighting and colors. Add getTimeOfDay() function and applyTimeTheme() that adjusts canvas overlay opacity and color temperature. Night should be darker with more torch reliance.",
      type: "code",
      assigned_tier: "knight",
      context_refs: [{ file: "packages/ui/src/engine/pixel-characters.ts", startLine: 1, endLine: 9999 }],
      acceptance_criteria: ["Day/night cycle function", "Visual theme changes with time", "Torch light more prominent at night", "No duplicate declarations"]
    }
  ]
};

const body = JSON.stringify(decree);
const req = http.request({
  hostname: 'localhost',
  port: 7778,
  path: '/api/decree',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data.substring(0, 500));
  });
});
req.on('error', e => console.log('Error:', e.message));
req.write(body);
req.end();
