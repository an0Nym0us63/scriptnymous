// Génère les icônes PNG de la PWA (192, 512, 180) sans dépendance : rastérisation maison + encodeur PNG (zlib).
// Usage : node web/scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Formes (coordonnées dans un repère 64×64, comme favicon.svg) ----
const sdRoundRect = (x, y, w, h, r) => {
  const qx = Math.abs(x - w / 2) - w / 2 + r;
  const qy = Math.abs(y - h / 2) - h / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};
const sdSegment = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - t * vx, wy - t * vy);
};
const mix = (a, b, t) => a + (b - a) * t;
const lerpColor = (c1, c2, t) => c1.map((v, i) => Math.round(mix(v, c2[i], t)));
const cover = (d, aa) => Math.max(0, Math.min(1, 0.5 - d / aa)); // antialiasing

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 64;
  const aa = 1.2 / s;
  const bg = [0x0b, 0x0f, 0x19], border = [0x24, 0x30, 0x49], ok = [0x22, 0xc5, 0x5e];
  const g1 = [0x7c, 0x6c, 0xff], g2 = [0x38, 0xbd, 0xf8];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s, y = (py + 0.5) / s;
      let color = [0, 0, 0], alpha = 0;
      const dRect = sdRoundRect(x, y, 64, 64, 16);
      const aRect = cover(dRect, aa);
      if (aRect > 0) {
        color = bg; alpha = aRect;
        const aBorder = cover(Math.abs(dRect + 1) - 1, aa);
        color = lerpColor(color, border, aBorder);
        const grad = lerpColor(g1, g2, Math.max(0, Math.min(1, (x + y - 20) / 50)));
        const dChevron = Math.min(sdSegment(x, y, 18, 20, 32, 32), sdSegment(x, y, 32, 32, 18, 44)) - 3;
        const dBar = sdSegment(x, y, 34, 44, 48, 44) - 3;
        const aStroke = cover(Math.min(dChevron, dBar), aa);
        color = lerpColor(color, grad, aStroke);
        const aDot = cover(Math.hypot(x - 48, y - 18) - 4, aa);
        color = lerpColor(color, ok, aDot);
      }
      const i = (py * size + px) * 4;
      buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return png(size, size, buf);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(path.join(out, name), render(size));
  console.log('écrit', name);
}
