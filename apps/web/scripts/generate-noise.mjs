// Gera src/assets/noise.png: um tile PEQUENO (96x96) de ruído em tons de cinza, determinístico.
// Usado como background repetido na textura de grão (D25). Nada de filtro SVG ao vivo.
// Uso: node scripts/generate-noise.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SIZE = 96;

// PRNG mulberry32 (semente fixa: o arquivo gerado é reproduzível).
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const random = prng(20260427);
const raw = Buffer.alloc((SIZE + 1) * SIZE); // 1 byte de filtro (0) + SIZE pixels por linha
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) raw[y * (SIZE + 1) + 1 + x] = Math.floor(random() * 256);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // 8 bits
header[9] = 0; // tons de cinza
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = resolve(import.meta.dirname, '../src/assets/noise.png');
writeFileSync(target, png);
process.stdout.write(`noise.png: ${png.length} bytes (${SIZE}x${SIZE})\n`);
