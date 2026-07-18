// Generates build/icon.png (1024x1024) — the pixel Mr. Panda on a rounded blue
// square. Pure Node (zlib) PNG encoder, no image libraries. Run: node scripts/make-icon.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// --- same idle sprite (HEAD + SUIT + LEGS_A) and palette as the app ---
const SPRITE = [
  "..KKKK............KKKK..",
  ".KKKKKK..........KKKKKK.",
  ".KKKKWWWWWWWWWWWWWWKKKK.",
  "..KKWWWWWWWWWWWWWWWWKK..",
  "..WWWWWWWWWWWWWWWWWWWW..",
  "..WWSSSSSSSSSSSSSSSSWW..",
  "..WWSXSSSSSSSSSSSSXSWW..",
  "..WWWSSSSSSSSSSSSSSWWW..",
  "..WWWWWWWWWWWWWWWWWWWW..",
  "..WWWWWWWWWNNWWWWWWWWW..",
  "..WWWWWWWWWWWWWWWWWWWW..",
  "...WWWWWWWWWWWWWWWWWW...",
  "....TTTTTHHHHHHTTTTT....",
  "...TTTTTTTHRRHTTTTTTT...",
  "...TTTTTTTHRRHTTTTTTT...",
  "..TTTTTTTTTRRTTTTTTTTT..",
  "..TTTTTTTTTDRTTTTTTTTT..",
  "..KKKTTTTTTTTTTTTTTKKK..",
  "..KKKTTTTTTTTTTTTTTKKK..",
  "....TTTTTTTTTTTTTTTT....",
  ".....TTTTTT..TTTTTT.....",
  ".....TTTTTT..TTTTTT.....",
  "....KKKKKK....KKKKKK....",
  "....KKKKKK....KKKKKK...."
];
const HEX = { K:'17171C', W:'F2EFE4', N:'17171C', S:'0D1015', X:'9FD8FF',
  T:'26262E', H:'F6F4EC', R:'C0392B', D:'E8C766' };
const PAL = {}; Object.keys(HEX).forEach(k => {
  const h = HEX[k]; PAL[k] = [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
});

const SIZE = 1024;
const buf = Buffer.alloc(SIZE * SIZE * 4, 0);
function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4; buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a == null ? 255 : a;
}

// rounded-square background
const M = 92, R = 200, x0 = M, y0 = M, x1 = SIZE - M, y1 = SIZE - M;
const BG = [30, 111, 230];
function inRound(x, y) {
  if (x >= x0 && x < x1 && y >= y0 + R && y < y1 - R) return true;
  if (x >= x0 + R && x < x1 - R && y >= y0 && y < y1) return true;
  const cs = [[x0+R,y0+R],[x1-R,y0+R],[x0+R,y1-R],[x1-R,y1-R]];
  for (const [cx, cy] of cs) { const dx = x-cx, dy = y-cy; if (dx*dx + dy*dy <= R*R) return true; }
  return false;
}
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (inRound(x, y)) set(x, y, BG[0], BG[1], BG[2], 255);

// pixel panda, centered
const BLOCK = 26, PW = 24 * BLOCK, ox = Math.round((SIZE - PW) / 2), oy = Math.round((SIZE - PW) / 2);
for (let row = 0; row < SPRITE.length; row++) {
  for (let col = 0; col < SPRITE[row].length; col++) {
    const ch = SPRITE[row][col]; if (ch === '.') continue;
    const c = PAL[ch]; if (!c) continue;
    for (let by = 0; by < BLOCK; by++) for (let bx = 0; bx < BLOCK; bx++) set(ox + col*BLOCK + bx, oy + row*BLOCK + by, c[0], c[1], c[2], 255);
  }
}

// --- minimal PNG encoder ---
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) { raw[y * (1 + SIZE * 4)] = 0; buf.copy(raw, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, '(' + png.length + ' bytes)');
