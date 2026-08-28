/* Renders the pixel-art Poké Ball from public/sprites.js to PNG icons (no dependencies).
   Usage: node scripts/make-favicon.js */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('../public/sprites.js');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function render(size) {
  const px = P.POKEBALL, n = px.length; // 16x16, last row empty -> centre it
  const scale = Math.floor(size / n);
  const off = Math.floor((size - scale * n) / 2);
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const ch = px[r][c]; if (ch === '.') continue;
    const col = P.PALETTE[ch]; if (!col) continue;
    const [R, G, B] = hex(col);
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = ((off + r * scale + y) * size + (off + c * scale + x)) * 4;
      buf[i] = R; buf[i + 1] = G; buf[i + 2] = B; buf[i + 3] = 255;
    }
  }
  return png(size, size, buf);
}
const out = path.join(__dirname, '..', 'public', 'assets');
for (const size of [32, 192]) { fs.writeFileSync(path.join(out, `pokeball-${size}.png`), render(size)); console.log(`wrote assets/pokeball-${size}.png`); }
