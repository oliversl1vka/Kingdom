// Render all character sprites to a BMP file for visual inspection
const fs = require('fs');
const path = require('path');

// Read the source file and extract sprites + palettes
const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'ui', 'src', 'engine', 'pixel-characters.ts'), 'utf8');

// Extract palette function logic inline
function shadeColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + Math.round(255 * percent / 100)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + Math.round(255 * percent / 100)));
  const b = Math.max(0, Math.min(255, (num & 0xFF) + Math.round(255 * percent / 100)));
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

const P = {
  gold: ['#806020', '#b08830', '#d4a840', '#f0c040', '#fff080'],
};

function charPalette(skin, hair, pri, sec, acc, cape) {
  return {
    O: '#1a1018', S: skin, s: shadeColor(skin, -30),
    H: hair, h: shadeColor(hair, -25),
    P: pri, p: shadeColor(pri, -25),
    C: sec, c: shadeColor(sec, -25),
    A: acc, a: shadeColor(acc, -25),
    K: cape || pri, k: shadeColor(cape || pri, -30),
    W: '#ffffff', w: '#c8c8c8',
    E: '#1a1020', B: '#3e2a18', b: '#2e1a0a',
    G: P.gold[3], g: P.gold[2],
    M: '#7f8c8d', m: '#5a6570',
    R: '#e74c3c', L: '#3498db', F: '#2ecc71',
    T: '#f5e6ca', t: '#d4c5a9',
  };
}

const PALETTES = {
  king:       charPalette('#e8c0a0', '#8B6914', '#c0392b', '#f1c40f', '#f39c12', '#8B0000'),
  knight:     charPalette('#e0b088', '#3a2510', '#7f8c8d', '#bdc3c7', '#2980b9'),
  healer:     charPalette('#e8c0a0', '#f5e6ca', '#ecf0f1', '#3498db', '#2ecc71'),
  sentinel:   charPalette('#d4a574', '#1a1a1a', '#2c3e50', '#34495e', '#e74c3c'),
  nobility:   charPalette('#e8c0a0', '#4a3728', '#8e44ad', '#d4a8e0', '#f0c040'),
  squire:     charPalette('#e8c0a0', '#c0763a', '#27ae60', '#8B7355', '#e0d6c2'),
  scribe:     charPalette('#e8c0a0', '#6b4226', '#8B7355', '#d4c5a9', '#2c3e50'),
  judge:      charPalette('#e8c0a0', '#888888', '#1a1a2e', '#e0d6c2', '#c0392b'),
  blacksmith: charPalette('#c89060', '#1a1a1a', '#555555', '#f39c12', '#e74c3c'),
};

// Extract sprite arrays from source
const SPRITES = {};
const names = ['KING_SPRITE','KNIGHT_SPRITE','HEALER_SPRITE','SENTINEL_SPRITE','NOBILITY_SPRITE','SQUIRE_SPRITE','SCRIBE_SPRITE','JUDGE_SPRITE','BLACKSMITH_SPRITE'];
const types = ['king','knight','healer','sentinel','nobility','squire','scribe','judge','blacksmith'];

names.forEach((name, idx) => {
  const m = src.match(new RegExp('const ' + name + ' = \\[([^\\]]+)\\]'));
  if (!m) { console.error(name + ' not found'); return; }
  const lines = m[1].match(/'([^']*)'/g).map(s => s.slice(1, -1));
  SPRITES[types[idx]] = lines;
});

// Render to pixel buffer
const scale = 4; // 4x zoom
const spriteW = 18;
const spriteH = 24;
const cellW = spriteW * scale + 8;
const cellH = spriteH * scale + 20;
const cols = 5;
const rows = Math.ceil(types.length / cols);
const imgW = cols * cellW + 8;
const imgH = rows * cellH + 8;

// RGBA buffer
const buf = Buffer.alloc(imgW * imgH * 4);
// Fill with dark blue background
for (let i = 0; i < imgW * imgH; i++) {
  buf[i * 4] = 25; buf[i * 4 + 1] = 25; buf[i * 4 + 2] = 50; buf[i * 4 + 3] = 255;
}

function hexToRGB(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
}

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= imgW || y < 0 || y >= imgH) return;
  const idx = (y * imgW + x) * 4;
  buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;
}

// Draw each sprite with outline
types.forEach((type, idx) => {
  const sprite = SPRITES[type];
  const palette = PALETTES[type];
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const ox = 8 + col * cellW;
  const oy = 8 + row * cellH;

  if (!sprite) return;

  // Draw black outline first
  const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  for (let r = 0; r < sprite.length; r++) {
    const line = sprite[r];
    for (let c = 0; c < line.length; c++) {
      if (line[c] === ' ') continue;
      for (const [dx, dy] of offsets) {
        const nx = c + dx, ny = r + dy;
        if (ny < 0 || ny >= sprite.length || nx < 0 || nx >= line.length || sprite[ny][nx] === ' ') {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPixel(ox + (c + dx) * scale + sx, oy + (r + dy) * scale + sy, 0, 0, 0);
            }
          }
        }
      }
    }
  }

  // Draw sprite
  for (let r = 0; r < sprite.length; r++) {
    const line = sprite[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ' ') continue;
      const color = palette[ch] || '#ff00ff';
      const [cr, cg, cb] = hexToRGB(color);
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          setPixel(ox + c * scale + sx, oy + r * scale + sy, cr, cg, cb);
        }
      }
    }
  }
});

// Write as PNG (minimal valid PNG)
// Use a simpler format: write raw BMP
function writeBMP(filename, width, height, rgbaData) {
  const rowSize = Math.ceil(width * 3 / 4) * 4; // rows padded to 4 bytes
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const bmp = Buffer.alloc(fileSize);

  // BMP header
  bmp.write('BM', 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(54, 10); // pixel data offset
  // DIB header
  bmp.writeUInt32LE(40, 14); // header size
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(-height, 22); // negative = top-down
  bmp.writeUInt16LE(1, 26); // planes
  bmp.writeUInt16LE(24, 28); // bpp
  bmp.writeUInt32LE(0, 30); // compression
  bmp.writeUInt32LE(pixelDataSize, 34);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = 54 + y * rowSize + x * 3;
      bmp[di] = rgbaData[si + 2]; // B
      bmp[di + 1] = rgbaData[si + 1]; // G
      bmp[di + 2] = rgbaData[si]; // R
    }
  }

  fs.writeFileSync(filename, bmp);
}

const outFile = path.join(__dirname, '..', 'sprite-preview.bmp');
writeBMP(outFile, imgW, imgH, buf);
console.log('Written to', outFile, 'size:', imgW, 'x', imgH);
