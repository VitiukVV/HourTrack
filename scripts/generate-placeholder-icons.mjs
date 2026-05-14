#!/usr/bin/env node
/**
 * Generate placeholder solid-color PNG icons so the PWA manifest validates
 * and vite-plugin-pwa builds without warnings. Per S01 Task 12, real icons
 * are produced via `pwa-asset-generator` from `favicon.svg`; this script is
 * the offline fallback used by CI and dev environments without network.
 *
 * Output: apps/web/public/icons/{pwa-192x192,pwa-512x512,pwa-maskable-512x512,apple-touch-icon}.png
 *
 * Uses zero deps -- emits a minimal IDAT chunk via the deflate algorithm
 * built into Node's `zlib`.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'apps', 'web', 'public', 'icons');
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

// Color: #0F172A (slate-900) -- matches theme_color in manifest
const R = 0x0f;
const G = 0x17;
const B = 0x2a;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines: each row prefixed with filter byte 0, then size * 3 bytes RGB
  const rowSize = size * 3 + 1;
  const raw = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const off = y * rowSize + 1 + x * 3;
      raw[off] = R;
      raw[off + 1] = G;
      raw[off + 2] = B;
    }
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'pwa-maskable-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of targets) {
  const out = resolve(iconsDir, name);
  writeFileSync(out, makePng(size));
  console.log(`  + ${name} (${size}x${size})`);
}

console.log('[icons] Placeholder PNG icons generated. Replace with branded artwork via pwa-asset-generator before production.');
