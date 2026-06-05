/**
 * generate-pwa-icons.mjs
 *
 * Creates PWA icon PNG files using only Node.js built-ins (no canvas / sharp).
 * Produces solid brand-colored squares — valid, installable PWA icons.
 *
 * Usage:  node scripts/generate-pwa-icons.mjs
 * Output: public/icons/{icon-192,icon-512,icon-maskable,apple-touch-icon}.png
 */

import { deflateSync }            from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath }           from "url";
import { dirname, join }           from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = join(__dirname, "..", "public", "icons");

// ─── CRC-32 (required by PNG spec) ───────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── PNG chunk writer ─────────────────────────────────────────────────────────

function pngChunk(type, data) {
  const typeB  = Buffer.from(type, "ascii");
  const dataB  = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const lenBuf = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(dataB.length);
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeB, dataB])));
  return Buffer.concat([lenBuf, typeB, dataB, crcBuf]);
}

// ─── Solid-color PNG builder ──────────────────────────────────────────────────

function buildPNG(size, r, g, b) {
  // IHDR: width(4), height(4), bitDepth(1), colorType(2=RGB), compress(1), filter(1), interlace(1)
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8; // 8 bits per channel
  ihdr[9]  = 2; // RGB (no alpha)
  ihdr[10] = 0; // deflate/inflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Raw scanlines: [filter=0] [R G B] × width  ×  height rows
  const stride = 1 + size * 3;
  const raw    = Buffer.allocUnsafe(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const o   = y * stride + 1 + x * 3;
      raw[o]     = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }

  return Buffer.concat([
    // PNG signature
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Generate ─────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

// Brand red: #ef4444 — matches brand.500 in tailwind.config.ts
const [R, G, B] = [0xef, 0x44, 0x44];

const icons = [
  { name: "icon-192.png",         size: 192 },
  { name: "icon-512.png",         size: 512 },
  { name: "icon-maskable.png",    size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of icons) {
  const dest = join(OUT_DIR, name);
  writeFileSync(dest, buildPNG(size, R, G, B));
  console.log(`  ✓  ${dest}`);
}

console.log("\nPWA icons generated successfully.");
