// md-table-tools icon generator — writes images/icon.png (128x128 RGBA PNG)
// Usage: node tools/make-icon.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 4; // 4x supersampling for anti-aliasing
const W = 128;
const w = W * S;
const h = W * S;

// ---- pixel painter (normalized 0..128 coords, rendered at 512x512) ----
function colorAt(nx, ny) {
  // tile: rounded rect (4..124, radius 26) VS Code blue
  const inTile = inRoundRect(nx, ny, 4, 4, 124, 124, 26);
  if (!inTile) return null;

  // table grid (white) inside the tile
  const lt = 4; // line thickness
  // outer box
  const x0 = 26, x1 = 102, y0 = 34, y1 = 94;
  const onVLine =
    (Math.abs(nx - x0) < lt / 2 || Math.abs(nx - x1) < lt / 2) && ny >= y0 - lt / 2 && ny <= y1 + lt / 2;
  const onHLine =
    (Math.abs(ny - y0) < lt / 2 || Math.abs(ny - y1) < lt / 2) && nx >= x0 - lt / 2 && nx <= x1 + lt / 2;
  // inner dividers: cols at 51.3 / 76.6, rows at 54 / 74
  const onCol = (Math.abs(nx - 51.3) < lt / 2 || Math.abs(nx - 76.6) < lt / 2) && ny > y0 && ny < y1;
  const onRow = (Math.abs(ny - 54) < lt / 2 || Math.abs(ny - 74) < lt / 2) && nx > x0 && nx < x1;

  if ((onVLine || onHLine || onCol || onRow) && nx >= x0 - lt / 2 && nx <= x1 + lt / 2 && ny >= y0 - lt / 2 && ny <= y1 + lt / 2) {
    return [255, 255, 255, 255];
  }
  // header row tint
  if (nx > x0 && nx < x1 && ny > y0 && ny < 54) return [255, 255, 255, 70];
  return [0, 120, 212, 255]; // #0078D4
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

// ---- render + downsample ----
const out = Buffer.alloc(W * W * 4);
for (let oy = 0; oy < W; oy++) {
  for (let ox = 0; ox < W; ox++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const c = colorAt(ox + (sx + 0.5) / S, oy + (sy + 0.5) / S) || [0, 0, 0, 0];
        r += c[0]; g += c[1]; b += c[2]; a += c[3];
      }
    }
    const n = S * S;
    const di = (oy * W + ox) * 4;
    out[di] = Math.round(r / n);
    out[di + 1] = Math.round(g / n);
    out[di + 2] = Math.round(b / n);
    out[di + 3] = Math.round(a / n);
  }
}

// ---- PNG writer ----
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const raw = Buffer.alloc(W * (W * 4 + 1));
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0;
  out.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const outPath = path.join(__dirname, '..', 'images', 'icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log('wrote ' + outPath);
