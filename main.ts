// news-image-20261120 v6 — "The World Today: 36 Stories"
// Fresh implementation written from V6-SPEC.md only.
// Node 22, standard library only, no network, deterministic:
// fixed layout, no Date.now, no Math.random.
// Renders a 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png.
//
// Technique: 3x supersampled framebuffer (3072x3072) + box-filter
// downsample; vector-stroke glyphs rasterised to coverage masks and
// stamped with bilinear sampling at a 1/3-output-pixel sub-pixel offset.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 3; // supersample factor
const SW = W * SS;

type RGB = [number, number, number];

// ---------- palette ----------
const CREAM: RGB = [247, 241, 222];
const PAPER: RGB = [255, 253, 244];
const INK: RGB = [26, 26, 26];
const RED: RGB = [179, 39, 30];
const RED_DK: RGB = [140, 28, 22];
const NAVY: RGB = [31, 58, 95];
const BORDER: RGB = [216, 205, 178];
const MUTED: RGB = [110, 100, 80];
const SEA: RGB = [220, 232, 228];
const LAND: RGB = [234, 217, 166];
const LAND_EDGE: RGB = [185, 168, 107];
const SKY: RGB = [214, 230, 238];
const CHIP_BG: RGB = [232, 238, 240];

const REGION_COLORS: Record<string, RGB> = {
  ASIA: [122, 79, 163],
  EUROPE: [43, 94, 167],
  "MIDDLE EAST": [199, 127, 10],
  AMERICAS: [192, 57, 43],
  AFRICA: [46, 125, 50],
  GLOBAL: [14, 124, 123],
};

// ---------- framebuffer ----------
const buf = new Uint8Array(SW * SW * 3);
for (let i = 0; i < SW * SW; i++) {
  buf[i * 3] = CREAM[0];
  buf[i * 3 + 1] = CREAM[1];
  buf[i * 3 + 2] = CREAM[2];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// filled axis-aligned rect, coords in output px
function rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const sx0 = Math.max(0, Math.round(x0 * SS));
  const sy0 = Math.max(0, Math.round(y0 * SS));
  const sx1 = Math.min(SW, Math.round(x1 * SS));
  const sy1 = Math.min(SW, Math.round(y1 * SS));
  for (let y = sy0; y < sy1; y++) {
    let o = (y * SW + sx0) * 3;
    for (let x = sx0; x < sx1; x++) {
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
      o += 3;
    }
  }
}

function frame(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
  rect(x0, y0, x1, y0 + t, c);
  rect(x0, y1 - t, x1, y1, c);
  rect(x0, y0, x0 + t, y1, c);
  rect(x1 - t, y0, x1, y1, c);
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  const sx0 = Math.max(0, Math.floor((cx - r) * SS));
  const sy0 = Math.max(0, Math.floor((cy - r) * SS));
  const sx1 = Math.min(SW, Math.ceil((cx + r) * SS));
  const sy1 = Math.min(SW, Math.ceil((cy + r) * SS));
  const rr = r * r;
  for (let y = sy0; y < sy1; y++) {
    const dy = (y + 0.5) / SS - cy;
    for (let x = sx0; x < sx1; x++) {
      const dx = (x + 0.5) / SS - cx;
      if (dx * dx + dy * dy <= rr) {
        const o = (y * SW + x) * 3;
        buf[o] = c[0];
        buf[o + 1] = c[1];
        buf[o + 2] = c[2];
      }
    }
  }
}

function ring(cx: number, cy: number, r: number, w: number, c: RGB): void {
  const sx0 = Math.max(0, Math.floor((cx - r - w) * SS));
  const sy0 = Math.max(0, Math.floor((cy - r - w) * SS));
  const sx1 = Math.min(SW, Math.ceil((cx + r + w) * SS));
  const sy1 = Math.min(SW, Math.ceil((cy + r + w) * SS));
  const ro = (r + w / 2) * (r + w / 2);
  const ri = (r - w / 2) * (r - w / 2);
  for (let y = sy0; y < sy1; y++) {
    const dy = (y + 0.5) / SS - cy;
    for (let x = sx0; x < sx1; x++) {
      const dx = (x + 0.5) / SS - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 <= ro && d2 >= ri) {
        const o = (y * SW + x) * 3;
        buf[o] = c[0];
        buf[o + 1] = c[1];
        buf[o + 2] = c[2];
      }
    }
  }
}

// scanline-filled polygon; pts = flat [x,y,...] in output px
function polygon(pts: number[], c: RGB): void {
  const n = pts.length / 2;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < n; i++) {
    ymin = Math.min(ymin, pts[i * 2 + 1]);
    ymax = Math.max(ymax, pts[i * 2 + 1]);
  }
  const y0 = Math.max(0, Math.floor(ymin * SS));
  const y1 = Math.min(SW, Math.ceil(ymax * SS));
  for (let y = y0; y < y1; y++) {
    const yy = (y + 0.5) / SS;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = pts[i * 2];
      const y1p = pts[i * 2 + 1];
      const x2 = pts[j * 2];
      const y2p = pts[j * 2 + 1];
      if ((y1p <= yy && y2p > yy) || (y2p <= yy && y1p > yy)) {
        xs.push(x1 + ((yy - y1p) / (y2p - y1p)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx0 = Math.max(0, Math.round(xs[k] * SS));
      const sx1 = Math.min(SW, Math.round(xs[k + 1] * SS));
      for (let x = sx0; x < sx1; x++) {
        const o = (y * SW + x) * 3;
        buf[o] = c[0];
        buf[o + 1] = c[1];
        buf[o + 2] = c[2];
      }
    }
  }
}

// thick line as a quad + round caps, output px coords
function line(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  polygon(
    [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny],
    c,
  );
  circle(x1, y1, w / 2, c);
  circle(x2, y2, w / 2, c);
}

function polyline(pts: number[], w: number, c: RGB): void {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    line(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w, c);
  }
}

// point-in-polygon (ray cast), output px coords
function pointInPoly(x: number, y: number, pts: number[]): boolean {
  const n = pts.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2];
    const yi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const yj = pts[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------- PNG encoding ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(
      raw,
      y * (1 + w * 3) + 1,
    );
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- vector glyph set ----------
// Grid: x 0..8, y 0..12. Cap top row 1, baseline row 9, x-height rows 4..9,
// descenders to row 11. Each glyph = list of strokes; each stroke is a
// flat polyline [x,y,...]. Designed fresh for this entry.
type Stroke = number[];
const GLYPHS: Record<string, Stroke[]> = {
  A: [[0.8, 9, 4, 1, 7.2, 9], [2.4, 6.2, 5.6, 6.2]],
  B: [
    [1, 1, 1, 9],
    [1, 1, 4.8, 1, 6.4, 2.4, 6.4, 3.6, 4.8, 4.8, 1, 4.8],
    [1, 4.8, 5, 4.8, 6.6, 6.2, 6.6, 7.6, 5, 9, 1, 9],
  ],
  C: [[6.8, 2.6, 5.4, 1, 2.6, 1, 1, 2.6, 1, 7.4, 2.6, 9, 5.4, 9, 6.8, 7.4]],
  D: [[1, 1, 1, 9, 4.6, 9, 6.9, 7, 6.9, 3, 4.6, 1, 1, 1]],
  E: [[6.6, 1, 1, 1, 1, 9, 6.6, 9], [1, 5, 5, 5]],
  F: [[6.6, 1, 1, 1, 1, 9], [1, 5, 5, 5]],
  G: [[6.8, 2.6, 5.4, 1, 2.6, 1, 1, 2.6, 1, 7.4, 2.6, 9, 5.4, 9, 6.8, 7.4, 6.8, 5.2, 4, 5.2]],
  H: [[1, 1, 1, 9], [7, 1, 7, 9], [1, 5, 7, 5]],
  I: [[4, 1, 4, 9], [2, 1, 6, 1], [2, 9, 6, 9]],
  J: [[2.4, 1, 6.6, 1], [5.6, 1, 5.6, 7, 4, 9, 2.4, 9, 1, 7.4]],
  K: [[1, 1, 1, 9], [6.8, 1, 1.8, 5], [2.8, 4.2, 6.8, 9]],
  L: [[1, 1, 1, 9, 6.8, 9]],
  M: [[1, 9, 1, 1, 4, 6.6, 7, 1, 7, 9]],
  N: [[1, 9, 1, 1, 7, 9, 7, 1]],
  O: [[4, 1, 6.3, 2.2, 7, 5, 6.3, 7.8, 4, 9, 1.7, 7.8, 1, 5, 1.7, 2.2, 4, 1]],
  P: [[1, 9, 1, 1, 5, 1, 6.8, 2.6, 6.8, 4, 5, 5, 1, 5]],
  Q: [
    [4, 1, 6.3, 2.2, 7, 5, 6.3, 7.8, 4, 9, 1.7, 7.8, 1, 5, 1.7, 2.2, 4, 1],
    [5, 7, 7.4, 9.6],
  ],
  R: [[1, 9, 1, 1, 5, 1, 6.8, 2.6, 6.8, 4, 5, 5, 1, 5], [3.6, 5, 7, 9]],
  S: [[6.8, 2.8, 5.4, 1, 2.6, 1, 1.2, 2.8, 1.8, 4.6, 6.2, 5.4, 6.8, 7.2, 5.4, 9, 2.6, 9, 1.2, 7.2]],
  T: [[1, 1, 7, 1], [4, 1, 4, 9]],
  U: [[1, 1, 1, 7, 2.6, 9, 5.4, 9, 7, 7, 7, 1]],
  V: [[1, 1, 4, 9, 7, 1]],
  W: [[1, 1, 2.2, 9, 4, 4.6, 5.8, 9, 7, 1]],
  X: [[1, 1, 7, 9], [7, 1, 1, 9]],
  Y: [[1, 1, 4, 5.6, 7, 1], [4, 5.6, 4, 9]],
  Z: [[1, 1, 7, 1, 1, 9, 7, 9]],
  a: [
    [6.8, 4.8, 6.8, 9],
    [1.2, 6.2, 2.4, 4.8, 5.4, 4.8, 6.8, 6, 6.8, 7.4, 5.4, 9, 2.4, 9, 1.2, 7.6, 1.2, 6.2],
  ],
  b: [[1, 1, 1, 9], [1, 6.6, 2.6, 4.8, 5.4, 4.8, 6.8, 6.2, 6.8, 7.4, 5.4, 9, 1, 9]],
  c: [[6.8, 5.6, 5.4, 4.8, 2.6, 4.8, 1.2, 6.2, 1.2, 7.6, 2.6, 9, 5.4, 9, 6.8, 7.8]],
  d: [
    [6.8, 1, 6.8, 9],
    [6.8, 6.6, 5.4, 4.8, 2.6, 4.8, 1.2, 6.2, 1.2, 7.4, 2.6, 9, 5.4, 9, 6.8, 7.6],
  ],
  e: [
    [6.6, 6.8, 5.4, 4.8, 2.6, 4.8, 1.2, 6.2, 1.2, 7.6, 2.6, 9, 5.4, 9, 6.8, 7.8],
    [1.2, 6.8, 6.6, 6.8],
  ],
  f: [[5.2, 2.8, 4, 1.2, 2.6, 1.2], [4, 1.2, 4, 9], [2.2, 5.4, 5.8, 5.4]],
  g: [
    [1.2, 6.2, 2.4, 4.8, 5.4, 4.8, 6.8, 6, 6.8, 7.4, 5.4, 9, 2.4, 9, 1.2, 7.6, 1.2, 6.2],
    [6.8, 4.8, 6.8, 9.4, 5.4, 11, 2.6, 11, 1.2, 9.8],
  ],
  h: [[1, 1, 1, 9], [1, 6.4, 2.6, 4.8, 5.4, 4.8, 6.8, 6.2, 6.8, 9]],
  i: [[2.25, 4.8, 2.25, 9], [2.25, 2.1, 2.25, 2.9]],
  j: [[2.25, 4.8, 2.25, 9.4, 1.5, 11, 0.2, 11], [2.25, 2.1, 2.25, 2.9]],
  k: [[1, 1, 1, 9], [6.8, 4.8, 2, 7], [3, 6, 6.8, 9]],
  l: [[2.25, 1, 2.25, 9]],
  m: [
    [1, 9, 1, 5.4, 2.2, 4.8, 3.4, 4.8, 4, 5.6, 4, 9],
    [4, 5.4, 5.2, 4.8, 6.4, 4.8, 7, 5.6, 7, 9],
  ],
  n: [[1, 9, 1, 4.8, 2.6, 4.8, 5.4, 4.8, 6.8, 6.2, 6.8, 9]],
  o: [[4, 4.8, 6, 5.6, 6.8, 6.8, 6, 8.2, 4, 9, 2, 8.2, 1.2, 6.8, 2, 5.6, 4, 4.8]],
  p: [[1, 4.8, 1, 11], [1, 6.8, 2.6, 4.8, 5.4, 4.8, 6.8, 6.2, 6.8, 7.4, 5.4, 9, 1, 9]],
  q: [[7, 4.8, 7, 11], [7, 6.8, 5.4, 4.8, 2.6, 4.8, 1.2, 6.2, 1.2, 7.4, 2.6, 9, 5.4, 9, 7, 7.4]],
  r: [[1, 9, 1, 4.8], [1, 5.6, 2.4, 4.8, 4.6, 4.8, 5.6, 5.6]],
  s: [[6.6, 5.8, 5.4, 4.8, 2.8, 4.8, 1.4, 5.8, 2.2, 7, 5.8, 7.2, 6.6, 8, 5.4, 9, 2.8, 9, 1.4, 8]],
  t: [[4, 1.8, 4, 9.6, 5, 10.6], [2, 5.4, 6, 5.4]],
  u: [[1, 4.8, 1, 7.4, 2.6, 9, 5.4, 9, 6.8, 7.4, 6.8, 4.8]],
  v: [[1, 4.8, 4, 9, 7, 4.8]],
  w: [[1, 4.8, 2.2, 9, 4, 6, 5.8, 9, 7, 4.8]],
  x: [[1, 4.8, 7, 9], [7, 4.8, 1, 9]],
  y: [[1, 4.8, 4, 9, 7, 4.8], [4, 9, 3, 11, 1.4, 11]],
  z: [[1, 4.8, 7, 4.8, 1, 9, 7, 9]],
};

// ---------- glyphs, continued: digits + punctuation ----------
Object.assign(GLYPHS, {
  "0": [[4, 1, 6.3, 2.2, 7, 5, 6.3, 7.8, 4, 9, 1.7, 7.8, 1, 5, 1.7, 2.2, 4, 1]],
  "1": [[2.6, 2.6, 4, 1, 4, 9], [2, 9, 6, 9]],
  "2": [[1.6, 2.6, 3, 1, 5.4, 1, 6.8, 2.6, 6.8, 4, 2, 9, 7, 9]],
  "3": [[1.6, 2.4, 3, 1, 5.4, 1, 6.8, 2.6, 6.8, 4, 5, 5, 6.8, 6, 6.8, 7.6, 5.4, 9, 3, 9, 1.6, 7.6]],
  "4": [[5, 1, 5, 9], [1, 6.8, 7, 6.8], [5, 1, 1.2, 6.8]],
  "5": [[6.8, 1, 1.2, 1, 1.2, 5, 4.6, 5, 6.6, 6.4, 6.6, 7.6, 5, 9, 2.6, 9, 1.2, 7.6]],
  "6": [[6.8, 2.6, 5.4, 1, 2.6, 1, 1.2, 2.8, 1.2, 7.4, 2.6, 9, 5.4, 9, 6.8, 7.6, 6.8, 6, 5.4, 4.8, 2.6, 4.8, 1.2, 6]],
  "7": [[1, 1, 7, 1, 3.4, 9]],
  "8": [
    [4, 1, 6, 2, 6.8, 3.4, 5.4, 5, 2.6, 5, 1.2, 3.4, 2, 2, 4, 1],
    [2.6, 5, 5.4, 5, 6.8, 6.4, 6.8, 7.6, 5.4, 9, 2.6, 9, 1.2, 7.6, 1.2, 6.4, 2.6, 5],
  ],
  "9": [[1.2, 7.4, 2.6, 9, 5.4, 9, 6.8, 7.2, 6.8, 2.8, 5.4, 1, 2.6, 1, 1.2, 2.8, 1.2, 4.4, 2.6, 5.4, 5.4, 5.4, 6.8, 4.2]],
  ".": [[1.3, 8.5, 1.3, 9.3]],
  ",": [[1.3, 8.5, 1.3, 9.3], [1.3, 9.3, 0.5, 11]],
  ";": [[2.25, 3.4, 2.25, 4.2], [2.25, 8.5, 2.25, 9.3], [2.25, 9.3, 1.4, 11]],
  ":": [[2.25, 3.4, 2.25, 4.2], [2.25, 8.5, 2.25, 9.3]],
  "!": [[2.25, 1.2, 2.25, 7], [2.25, 8.5, 2.25, 9.3]],
  "?": [[2, 3, 3, 1.4, 5.4, 1.4, 6.6, 3, 6, 4.8, 4, 5.8, 4, 7], [4, 8.5, 4, 9.3]],
  "'": [[2.8, 1.2, 2, 3.2]],
  "~": [[1, 2.6, 2.5, 1.4, 4, 2.6, 5.5, 3.8, 7, 2.6]],
  "-": [[1.5, 5.4, 6.5, 5.4]],
  "–": [[1, 5.4, 7, 5.4]],
  "(": [[5.6, 1, 3.6, 3, 3.6, 7, 5.6, 9]],
  ")": [[2.4, 1, 4.4, 3, 4.4, 7, 2.4, 9]],
  "%": [
    [1.4, 1.2, 6.6, 8.8],
    [2, 1.2, 3.2, 1.2, 3.8, 2.2, 3.2, 3.2, 2, 3.2, 1.4, 2.2, 2, 1.2],
    [6, 6.8, 6.6, 7.8, 6, 8.8, 4.8, 8.8, 4.4, 7.8, 5, 6.8, 6, 6.8],
  ],
  $: [[4, 0.8, 4, 9.4], [6.8, 2.8, 5.4, 1.2, 2.6, 1.2, 1.2, 2.8, 2, 4.4, 6, 5.6, 6.8, 7, 5.4, 8.8, 2.6, 8.8, 1.2, 7.2]],
  "&": [
    [6.4, 2.2, 5.4, 1.2, 3, 1.2, 1.6, 2.6, 1.6, 4.4, 3.6, 6, 6.8, 9],
    [3.6, 6, 2, 7.4, 2, 8.4, 4, 9.2, 6, 8.6],
  ],
  "/": [[6.6, 1, 1.4, 9]],
  "+": [[4, 2, 4, 8], [1.5, 5, 6.5, 5]],
  "@": [
    [4, 1.2, 6.2, 2.4, 6.8, 5, 6, 7.8, 4, 9, 1.8, 7.8, 1.2, 5, 1.8, 2.4, 4, 1.2],
    [6.8, 5, 6.8, 7.6, 5.4, 8.6, 3.6, 8.6, 2.8, 7.6, 2.8, 6.4, 4, 5.6, 5.4, 5.6],
  ],
  "#": [[2.8, 1, 2.2, 9], [5.2, 1, 4.6, 9], [1, 3.6, 7, 3.6], [1, 6.4, 7, 6.4]],
  "|": [[2.25, 1, 2.25, 9]],
  " ": [],
});

// ---------- text engine ----------
// Coverage masks: each glyph rasterised once per weight into a 32x48
// float mask (4 samples per grid unit); stamps sample it bilinearly.
const MU = 4;
const MW = 8 * MU;
const MH = 12 * MU;
const maskCache = new Map<string, Float32Array>();

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
  t = clamp(t, 0, 1);
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function getMask(ch: string, bold: boolean): Float32Array {
  const key = ch + (bold ? "|b" : "|r");
  const hit = maskCache.get(key);
  if (hit) return hit;
  const halfW = bold ? 0.98 : 0.68;
  const mask = new Float32Array(MW * MH);
  const strokes = GLYPHS[ch] || [];
  for (let my = 0; my < MH; my++) {
    const py = (my + 0.5) / MU;
    for (let mx = 0; mx < MW; mx++) {
      const px = (mx + 0.5) / MU;
      let d = Infinity;
      for (const st of strokes) {
        for (let i = 0; i + 3 < st.length; i += 2) {
          d = Math.min(d, distToSeg(px, py, st[i], st[i + 1], st[i + 2], st[i + 3]));
        }
      }
      mask[my * MW + mx] = d === Infinity ? 0 : clamp(halfW + 0.55 - d, 0, 1);
    }
  }
  maskCache.set(key, mask);
  return mask;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

// advance in grid units; comma/period before a digit is 4.5u (kerning fix);
// narrow glyphs and space are narrower; digits stay tabular at 8u.
function adv(ch: string, next: string): number {
  if (ch === " ") return 4;
  if ((ch === "," || ch === ".") && isDigit(next)) return 4.5;
  if ("ijl!.:;'|".includes(ch)) return 4.5;
  if ("ftrI".includes(ch)) return 6;
  return 8;
}

function measure(text: string, s: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += adv(text[i], text[i + 1] || "") * s;
  }
  return w;
}

function stampGlyph(
  mask: Float32Array,
  gxSS: number,
  gySS: number,
  s: number,
  c: RGB,
): void {
  const gw = Math.ceil(8 * s * SS);
  const gh = Math.ceil(12 * s * SS);
  const x0 = Math.max(0, gxSS);
  const y0 = Math.max(0, gySS);
  const x1 = Math.min(SW, gxSS + gw);
  const y1 = Math.min(SW, gySS + gh);
  for (let y = y0; y < y1; y++) {
    const v = ((y - gySS + 0.5) / (s * SS)) * MU - 0.5;
    const my0 = Math.floor(v);
    const fy = clamp(v - my0, 0, 1);
    const myA = clamp(my0, 0, MH - 1);
    const myB = clamp(my0 + 1, 0, MH - 1);
    for (let x = x0; x < x1; x++) {
      const u = ((x - gxSS + 0.5) / (s * SS)) * MU - 0.5;
      const mx0 = Math.floor(u);
      const fx = clamp(u - mx0, 0, 1);
      const mxA = clamp(mx0, 0, MW - 1);
      const mxB = clamp(mx0 + 1, 0, MW - 1);
      const a00 = mask[myA * MW + mxA];
      const a10 = mask[myA * MW + mxB];
      const a01 = mask[myB * MW + mxA];
      const a11 = mask[myB * MW + mxB];
      const a = (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;
      if (a <= 0.01) continue;
      const o = (y * SW + x) * 3;
      buf[o] = buf[o] * (1 - a) + c[0] * a;
      buf[o + 1] = buf[o + 1] * (1 - a) + c[1] * a;
      buf[o + 2] = buf[o + 2] * (1 - a) + c[2] * a;
    }
  }
}

// Draw text; (x, yTop) is the top of the 12-row glyph cell in output px.
// The +1 supersample offset keeps glyph edges off output-pixel
// boundaries so the 3x box downsample anti-aliases them.
function drawText(
  x: number,
  yTop: number,
  text: string,
  s: number,
  c: RGB,
  bold = false,
): void {
  let gx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      gx += 4 * s;
      continue;
    }
    const mask = getMask(ch, bold);
    stampGlyph(mask, Math.round(gx * SS) + 1, Math.round(yTop * SS) + 1, s, c);
    gx += adv(ch, text[i + 1] || "") * s;
  }
}

function drawTextCentered(x0: number, x1: number, yTop: number, text: string, s: number, c: RGB, bold = false): void {
  const w = measure(text, s);
  drawText(x0 + (x1 - x0 - w) / 2, yTop, text, s, c, bold);
}

function drawTextRight(x1: number, yTop: number, text: string, s: number, c: RGB, bold = false): void {
  drawText(x1 - measure(text, s), yTop, text, s, c, bold);
}

// shrink scale until text fits maxW (never below sMin)
function fitScale(text: string, maxW: number, s0: number, sMin: number): number {
  let s = s0;
  while (s > sMin && measure(text, s) > maxW) s -= 0.05;
  return Math.max(s, sMin);
}

function wrapText(text: string, maxW: number, s: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (measure(trial, s) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// number badge: red disc with white number
function badge(cx: number, cy: number, n: number, r = 8): void {
  circle(cx, cy, r, RED);
  ring(cx, cy, r, 1.2, PAPER);
  const t = String(n);
  drawTextCentered(cx - r, cx + r, cy - r + 2.4, t, r > 7 ? 1.15 : 0.95, PAPER, true);
}

// ---------- story data (verified facts only) ----------
interface Story {
  n: number;
  kicker: string;
  headline: string;
  body: string;
  scene: string;
  stat?: string;
}

const LEAD: Story[] = [
  {
    n: 1,
    kicker: "US-IRAN - REUTERS",
    headline: "TRUMP PUTS IRAN WAR CALL OFF TO 2027",
    body: "Trump says no rush on Iran; will see what happens after Jan 1. Decision in 2027.",
    scene: "capitol",
    stat: "NO RUSH - AFTER JAN 1 - 2027",
  },
  {
    n: 2,
    kicker: "SHENZHEN DECLARATION - CFR",
    headline: "TRUMP, XI, PUTIN: 4-POINT DECLARATION",
    body: "First summit agrees 4-point pact: UN reform, oil supply, immunities, nuclear-risk talks.",
    scene: "flags",
    stat: "4 POINTS - 80 MIN - NO UKRAINE MENTION",
  },
];

const MEDIUM: Story[] = [
  { n: 3, kicker: "WALL STREET - WSJ", headline: "DOW SLIDES 1,101", body: "Dow -2.2% below 50,000; 4th day down.", scene: "chart" },
  { n: 4, kicker: "COP31 ANTALYA - THE HINDU", headline: "COP31: NO DEAL YET", body: "COP draft cut 144 to 80; no deal yet.", scene: "cop" },
  { n: 5, kicker: "BAY OF BENGAL - THE HINDU", headline: "AKVAN HITS ODISHA", body: "300,000 moved; 423 rescue teams out.", scene: "cyclone" },
  { n: 6, kicker: "DEEP SPACE - BBC", headline: "VOYAGER 1: 1 LIGHT-DAY", body: "First object 1 light-day out; 25.9bn km.", scene: "voyager" },
  { n: 7, kicker: "UKRAINE WAR - BBC", headline: "EUROPE OPEN TO TALKS", body: "Leaders ready for talks with Russia.", scene: "handshake" },
  { n: 8, kicker: "AI MARKETS - BBX", headline: "ANTHROPIC $1.27T", body: "Market value at close after record IPO.", scene: "chip" },
  { n: 9, kicker: "JAPAN SPACE - SPACE", headline: "HAYABUSA2 ENGINE FAULT", body: "Engine fault ends asteroid landing.", scene: "asteroid" },
  { n: 10, kicker: "GAMES - MEZHA", headline: "GTA VI SALES PASS $1.8B", body: "Passes The Odyssey's $1.80B global run.", scene: "gta" },
  { n: 11, kicker: "US - BBC", headline: "TRUMP PARDONS PETE ROSE", body: "Posthumous pardon for baseball legend.", scene: "baseball" },
  { n: 12, kicker: "INDIA ECONOMY - FICCI", headline: "MODI: WHERE ARE HIRES?", body: "'We cut tax, but where are the hires?'", scene: "podium" },
  { n: 13, kicker: "CRICKET - REUTERS", headline: "PHILLIPS 118", body: "NZ pass 250 on Day 2; 216-run stand.", scene: "cricket" },
];

interface OneLiner {
  n: number;
  kw: string;
  text: string;
  region: string;
}

const ONELINERS: OneLiner[] = [
  { n: 14, kw: "YUNUS HOME FIRE", text: "fire at Yunus home; arson feared", region: "ASIA" },
  { n: 15, kw: "HONG KONG OPEN", text: "Rakshitha stuns Olympic champion", region: "ASIA" },
  { n: 16, kw: "RAHUL GANDHI", text: "rejects poll boycott strategy", region: "ASIA" },
  { n: 17, kw: "US SUMMONSES", text: "court orders summonses to Doval, Goel", region: "ASIA" },
  { n: 18, kw: "PAKISTAN TO DELHI", text: "minister leads SCO delegation", region: "ASIA" },
  { n: 19, kw: "CALIFORNIA", text: "targets Nvidia in China AI-chip probe", region: "AMERICAS" },
  { n: 20, kw: "CANADA AI CENTRES", text: "embraces AI data centres", region: "AMERICAS" },
  { n: 21, kw: "TAIZ UNDER SIEGE", text: "voices inside besieged city speak", region: "MIDDLE EAST" },
  { n: 22, kw: "MEASLES COMEBACK", text: "vaccine fears fuel US return", region: "AMERICAS" },
  { n: 23, kw: "FIONA THE HIPPO", text: "dies after swallowing a hat", region: "AMERICAS" },
  { n: 24, kw: "CUMIN SODAS", text: "fizzy sodas challenge cola giants", region: "ASIA" },
  { n: 25, kw: "WORLD CHILDREN'S DAY", text: "marked around the world", region: "GLOBAL" },
  { n: 26, kw: "JOBURG DEAL", text: "ANC nears deal; talks continue Friday", region: "AFRICA" },
  { n: 27, kw: "EU-UK SUMMIT", text: "second post-Brexit summit opens", region: "EUROPE" },
  { n: 28, kw: "NATO ASSEMBLY", text: "72nd session opens in Berlin", region: "EUROPE" },
  { n: 29, kw: "BIRD-FLU VACCINE", text: "first H5N1 vaccine for chickens", region: "ASIA" },
  { n: 30, kw: "YOUTH STRIKE", text: "students walk out across Europe", region: "EUROPE" },
  { n: 31, kw: "ASIAN ROUT", text: "shares head for worst week since 2020", region: "ASIA" },
  { n: 32, kw: "FRIDGE HACK SHIELD", text: "UK fridges secured from hackers", region: "EUROPE" },
  { n: 33, kw: "META CLIMATE U-TURN", text: "rethinks 2030 net-zero goals", region: "GLOBAL" },
  { n: 34, kw: "BUKELE THIRD TERM", text: "bid for third term expected", region: "AMERICAS" },
  { n: 35, kw: "SENEGAL BOAT", text: "four bodies after boat capsizes", region: "AFRICA" },
  { n: 36, kw: "WILD WIN", text: "Minnesota Wild beat Flames 4-1", region: "AMERICAS" },
];

const NUMBERS: [string, string][] = [
  ["-1,101", "DOW POINTS"],
  ["-2.0%", "S&P 500"],
  ["-2.3%", "NASDAQ"],
  ["300,000", "EVACUATED"],
  ["423", "RESCUE TEAMS"],
  ["1 LIGHT-DAY", "VOYAGER 1"],
  ["80 MINUTES", "SUMMIT"],
  ["118", "PHILLIPS"],
];

const TABS: [string, number][] = [
  ["ASIA", 12],
  ["EUROPE", 6],
  ["MIDDLE EAST", 2],
  ["AMERICAS", 9],
  ["AFRICA", 2],
  ["GLOBAL", 5],
];

const TIMELINE: [string, string][][] = [
  [
    ["~00:02 UTC", "BBC: FRIDGE SHIELD"],
    ["~00:23 UTC", "REUTERS: PHILLIPS CENTURY"],
    ["02:00-03:00 UTC", "AKVAN LANDFALL"],
  ],
  [
    ["09:30 UTC", "EU-UK SUMMIT OPENS"],
    ["12:00 UTC", "YOUTH STRIKE LONDON"],
    ["21:00 UTC", "COP31 TEXT DUE"],
  ],
];

const DATE_CHECK_LINES = [
  "NOT TODAY: ICJ Myanmar ruling 19 Nov. Fiji disaster 18 Nov. KAFD strike 19 Nov.",
  "Hormuz mine claims unconfirmed. US-Venezuela deal 19 Nov. Summit met 19 Nov.",
  "Voyager 1 milestone 18 Nov, announced 19 Nov. Hayabusa2 retargeting announced 17 Nov.",
];

// ---------- per-story scenes ----------
// Each draws inside (x, y, w, h). detail=true for the large lead panels
// (may include small text); false for the small medium-grid chips.
const STARS: [number, number][] = [
  [0.12, 0.14], [0.3, 0.08], [0.52, 0.2], [0.7, 0.1], [0.88, 0.18],
  [0.2, 0.32], [0.45, 0.38], [0.8, 0.36], [0.08, 0.55], [0.62, 0.55],
  [0.9, 0.6], [0.35, 0.68], [0.55, 0.8], [0.15, 0.85], [0.78, 0.86],
];

function scene(kind: string, x: number, y: number, w: number, h: number, detail: boolean): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (kind === "capitol") {
    rect(x, y, x + w, y + h, SKY);
    rect(x, y + h * 0.78, x + w, y + h, [120, 160, 110]);
    // dome
    circle(cx - w * 0.18, y + h * 0.52, w * 0.16, PAPER);
    ring(cx - w * 0.18, y + h * 0.52, w * 0.16, 1.2, MUTED);
    rect(x + w * 0.1, y + h * 0.52, x + w * 0.54, y + h * 0.66, PAPER);
    rect(x + w * 0.16, y + h * 0.66, x + w * 0.2, y + h * 0.78, MUTED);
    rect(x + w * 0.3, y + h * 0.66, x + w * 0.34, y + h * 0.78, MUTED);
    rect(x + w * 0.44, y + h * 0.66, x + w * 0.48, y + h * 0.78, MUTED);
    line(cx - w * 0.18, y + h * 0.36, cx - w * 0.18, y + h * 0.22, 2, INK);
    // calendar page
    const calX = x + w * 0.62;
    const calY = y + h * 0.16;
    const calW = w * 0.32;
    const calH = h * 0.4;
    rect(calX, calY, calX + calW, calY + calH, PAPER);
    frame(calX, calY, calX + calW, calY + calH, INK, 1);
    rect(calX, calY, calX + calW, calY + calH * 0.26, RED);
    if (detail) drawTextCentered(calX, calX + calW, calY + calH * 0.36, "2027", Math.min(2, calW / 34), INK, true);
  } else if (kind === "flags") {
    rect(x, y, x + w, y + h, SKY);
    // skyline behind
    rect(x + w * 0.05, y + h * 0.55, x + w * 0.22, y + h * 0.82, [150, 160, 175]);
    rect(x + w * 0.28, y + h * 0.45, x + w * 0.45, y + h * 0.82, [130, 142, 158]);
    rect(x + w * 0.78, y + h * 0.5, x + w * 0.95, y + h * 0.82, [150, 160, 175]);
    // table
    rect(x + w * 0.08, y + h * 0.82, x + w * 0.92, y + h * 0.9, [120, 84, 50]);
    // document on the table
    const docX = x + w * 0.32;
    const docY = y + h * 0.6;
    rect(docX, docY, docX + w * 0.36, docY + h * 0.22, PAPER);
    frame(docX, docY, docX + w * 0.36, docY + h * 0.22, INK, 1);
    if (detail) drawTextCentered(docX, docX + w * 0.36, docY + h * 0.07, "4 POINTS", Math.min(1.15, (w * 0.36) / 72), RED, true);
    // three flag poles
    const poles = [0.16, 0.5, 0.84];
    const flagCols: RGB[][] = [
      [[179, 39, 30], [255, 255, 255], [31, 58, 95]],
      [[200, 30, 30], [200, 30, 30], [200, 30, 30]],
      [[255, 255, 255], [31, 58, 95], [179, 39, 30]],
    ];
    for (let i = 0; i < 3; i++) {
      const px = x + w * poles[i];
      line(px, y + h * 0.12, px, y + h * 0.82, 2, INK);
      const fx = px + 1;
      const fy = y + h * 0.12;
      const fw = w * 0.26;
      const fh = h * 0.14;
      if (i === 0) {
        for (let sIdx = 0; sIdx < 4; sIdx++) {
          rect(fx, fy + (fh / 4) * sIdx, fx + fw, fy + (fh / 4) * (sIdx + 1), sIdx % 2 ? PAPER : RED);
        }
        rect(fx, fy, fx + fw * 0.45, fy + fh * 0.55, NAVY);
      } else if (i === 1) {
        rect(fx, fy, fx + fw, fy + fh, [200, 30, 30]);
        circle(fx + fw * 0.24, fy + fh * 0.3, Math.min(fw, fh) * 0.12, [255, 210, 60]);
        circle(fx + fw * 0.62, fy + fh * 0.28, Math.min(fw, fh) * 0.07, [255, 210, 60]);
        circle(fx + fw * 0.78, fy + fh * 0.5, Math.min(fw, fh) * 0.07, [255, 210, 60]);
      } else {
        rect(fx, fy, fx + fw, fy + fh / 3, PAPER);
        rect(fx, fy + fh / 3, fx + fw, fy + (2 * fh) / 3, NAVY);
        rect(fx, fy + (2 * fh) / 3, fx + fw, fy + fh, RED);
      }
      frame(fx, fy, fx + fw, fy + fh, INK, 0.7);
    }
    void flagCols;
  } else if (kind === "chart") {
    rect(x, y, x + w, y + h, PAPER);
    line(x + w * 0.08, y + h * 0.12, x + w * 0.08, y + h * 0.88, 1, MUTED);
    line(x + w * 0.08, y + h * 0.88, x + w * 0.94, y + h * 0.88, 1, MUTED);
    polyline(
      [x + w * 0.1, y + h * 0.2, x + w * 0.3, y + h * 0.3, x + w * 0.5, y + h * 0.28, x + w * 0.68, y + h * 0.55, x + w * 0.9, y + h * 0.82],
      2.4,
      RED,
    );
    circle(x + w * 0.9, y + h * 0.82, 2.6, RED);
    if (detail) {
      drawText(x + w * 0.1, y + h * 0.04, "$", 1.7, INK, true);
      drawTextRight(x + w * 0.94, y + h * 0.6, "-2.2%", 1.5, RED, true);
    } else {
      drawText(x + w * 0.08, y + h * 0.02, "$", 1.3, INK, true);
    }
  } else if (kind === "cop") {
    rect(x, y, x + w, y + h, SKY);
    circle(cx - w * 0.14, cy - h * 0.08, Math.min(w, h) * 0.3, [70, 130, 180]);
    polygon(
      [cx - w * 0.3, cy - h * 0.2, cx - w * 0.12, cy - h * 0.28, cx - w * 0.05, cy - h * 0.08, cx - w * 0.28, cy - h * 0.02],
      [90, 170, 110],
    );
    polygon(
      [cx - w * 0.05, cy + h * 0.05, cx + w * 0.08, cy + h * 0.02, cx + w * 0.14, cy + h * 0.22, cx - w * 0.02, cy + h * 0.2],
      [90, 170, 110],
    );
    // thermometer
    const tx = x + w * 0.78;
    rect(tx - 2, y + h * 0.18, tx + 2, y + h * 0.68, PAPER);
    frame(tx - 2, y + h * 0.18, tx + 2, y + h * 0.68, INK, 0.8);
    rect(tx - 1.4, y + h * 0.42, tx + 1.4, y + h * 0.68, RED);
    circle(tx, y + h * 0.72, 4.5, RED);
    // shrinking bar
    rect(x + w * 0.08, y + h * 0.82, x + w * 0.5, y + h * 0.9, [150, 160, 175]);
    rect(x + w * 0.08, y + h * 0.92, x + w * 0.3, y + h * 0.98, RED);
    if (detail) drawText(x + w * 0.56, y + h * 0.82, "144 TO 80", 1.05, INK, true);
  } else if (kind === "cyclone") {
    rect(x, y, x + w, y + h, SKY);
    // spiral rings
    for (let i = 0; i < 4; i++) {
      ring(cx - w * 0.05, cy - h * 0.12, 5 + i * 6, 2.2, [40, 90, 160]);
    }
    circle(cx - w * 0.05, cy - h * 0.12, 3, [40, 90, 160]);
    // coast
    polygon([x, y + h * 0.72, x + w * 0.4, y + h * 0.66, x + w, y + h * 0.78, x + w, y + h, x, y + h], LAND);
    // rain
    for (let i = 0; i < 5; i++) {
      const rx = x + w * (0.08 + i * 0.18);
      line(rx, y + h * 0.5, rx - 3, y + h * 0.62, 1.2, [60, 110, 180]);
    }
    // evacuation bus
    rect(x + w * 0.55, y + h * 0.68, x + w * 0.92, y + h * 0.84, [230, 180, 40]);
    rect(x + w * 0.6, y + h * 0.71, x + w * 0.68, y + h * 0.77, SKY);
    rect(x + w * 0.72, y + h * 0.71, x + w * 0.8, y + h * 0.77, SKY);
    circle(x + w * 0.63, y + h * 0.86, 2.4, INK);
    circle(x + w * 0.84, y + h * 0.86, 2.4, INK);
  } else if (kind === "voyager") {
    rect(x, y, x + w, y + h, NAVY);
    for (const [fx, fy] of STARS) {
      circle(x + w * fx, y + h * fy, 1.1, PAPER);
    }
    ring(cx, cy, Math.min(w, h) * 0.42, 1.4, [140, 200, 230]);
    // probe body + dish
    rect(cx - 4, cy - 3, cx + 6, cy + 5, [210, 170, 60]);
    polygon([cx + 6, cy - 8, cx + 16, cy - 2, cx + 6, cy + 4], PAPER);
    line(cx - 4, cy - 3, cx - 12, cy - 12, 1.6, PAPER);
    circle(cx - 12, cy - 12, 1.8, RED);
    if (detail) drawTextCentered(x, x + w, y + h * 0.82, "1 LIGHT-DAY", 1.15, PAPER, true);
  } else if (kind === "handshake") {
    rect(x, y, x + w, y + h, SKY);
    // mini Europe outline
    polygon(
      [x + w * 0.12, y + h * 0.2, x + w * 0.4, y + h * 0.14, x + w * 0.6, y + h * 0.22, x + w * 0.55, y + h * 0.42, x + w * 0.32, y + h * 0.48, x + w * 0.14, y + h * 0.4],
      LAND,
    );
    // dove
    circle(cx + w * 0.08, cy + h * 0.22, Math.min(w, h) * 0.14, PAPER);
    polygon([cx - w * 0.2, cy + h * 0.1, cx + w * 0.05, cy + h * 0.3, cx - w * 0.28, cy + h * 0.34], PAPER);
    polygon([cx + w * 0.05, cy + h * 0.14, cx + w * 0.3, cy - h * 0.05, cx + w * 0.12, cy + h * 0.2], PAPER);
    circle(cx + w * 0.2, cy + h * 0.16, Math.min(w, h) * 0.06, PAPER);
    polygon([cx + w * 0.26, cy + h * 0.16, cx + w * 0.36, cy + h * 0.19, cx + w * 0.26, cy + h * 0.21], [230, 170, 40]);
    // olive branch
    line(x + w * 0.62, y + h * 0.72, x + w * 0.9, y + h * 0.62, 1.4, [60, 130, 70]);
    circle(x + w * 0.72, y + h * 0.66, 2, [60, 130, 70]);
    circle(x + w * 0.82, y + h * 0.63, 2, [60, 130, 70]);
  } else if (kind === "chip") {
    rect(x, y, x + w, y + h, [235, 240, 245]);
    // circuit traces
    line(x + w * 0.08, y + h * 0.2, x + w * 0.3, y + h * 0.2, 1.4, [90, 120, 150]);
    line(x + w * 0.08, y + h * 0.8, x + w * 0.3, y + h * 0.8, 1.4, [90, 120, 150]);
    line(x + w * 0.7, y + h * 0.2, x + w * 0.92, y + h * 0.2, 1.4, [90, 120, 150]);
    line(x + w * 0.7, y + h * 0.8, x + w * 0.92, y + h * 0.8, 1.4, [90, 120, 150]);
    // chip body
    const chX = cx - w * 0.2;
    const chY = cy - h * 0.2;
    rect(chX, chY, chX + w * 0.4, chY + h * 0.4, NAVY);
    frame(chX, chY, chX + w * 0.4, chY + h * 0.4, [210, 170, 60], 1.4);
    for (let i = 0; i < 3; i++) {
      rect(chX - 5, chY + 4 + i * 7, chX, chY + 6 + i * 7, [210, 170, 60]);
      rect(chX + w * 0.4, chY + 4 + i * 7, chX + w * 0.4 + 5, chY + 6 + i * 7, [210, 170, 60]);
    }
    // banner
    const bY = y + h * 0.78;
    rect(x + w * 0.06, bY, x + w * 0.94, bY + h * 0.16, RED);
    if (detail) drawTextCentered(x + w * 0.06, x + w * 0.94, bY + h * 0.02, "$1.27T AT CLOSE", 1.05, PAPER, true);
    // bell
    circle(cx + w * 0.3, y + h * 0.1, 3.4, [210, 170, 60]);
  } else if (kind === "asteroid") {
    rect(x, y, x + w, y + h, NAVY);
    for (const [fx, fy] of STARS) {
      circle(x + w * fx, y + h * fy, 1, PAPER);
    }
    polygon(
      [cx - w * 0.28, cy - h * 0.05, cx - w * 0.12, cy - h * 0.22, cx + w * 0.12, cy - h * 0.2, cx + w * 0.26, cy, cx + w * 0.08, cy + h * 0.2, cx - w * 0.2, cy + h * 0.16],
      [150, 150, 150],
    );
    circle(cx - w * 0.05, cy - h * 0.08, 2.4, [110, 110, 110]);
    circle(cx + w * 0.12, cy + h * 0.06, 1.8, [110, 110, 110]);
    // probe with broken engine
    rect(cx + w * 0.28, cy - h * 0.3, cx + w * 0.42, cy - h * 0.18, PAPER);
    line(cx + w * 0.28, cy - h * 0.24, cx + w * 0.2, cy - h * 0.24, 1.4, PAPER);
    line(cx + w * 0.42, cy - h * 0.24, cx + w * 0.5, cy - h * 0.24, 1.4, PAPER);
    line(cx + w * 0.46, cy - h * 0.2, cx + w * 0.52, cy - h * 0.12, 2, RED);
    line(cx + w * 0.52, cy - h * 0.2, cx + w * 0.46, cy - h * 0.12, 2, RED);
  } else if (kind === "gta") {
    rect(x, y, x + w, y + h * 0.45, [240, 140, 80]);
    rect(x, y + h * 0.45, x + w, y + h * 0.7, [90, 60, 110]);
    rect(x, y + h * 0.7, x + w, y + h, [30, 30, 50]);
    circle(cx + w * 0.3, y + h * 0.2, Math.min(w, h) * 0.12, [255, 220, 130]);
    // skyline
    rect(x + w * 0.05, y + h * 0.45, x + w * 0.2, y + h * 0.72, [25, 25, 40]);
    rect(x + w * 0.26, y + h * 0.35, x + w * 0.42, y + h * 0.72, [25, 25, 40]);
    rect(x + w * 0.48, y + h * 0.5, x + w * 0.62, y + h * 0.72, [25, 25, 40]);
    rect(x + w * 0.68, y + h * 0.38, x + w * 0.86, y + h * 0.72, [25, 25, 40]);
    for (let i = 0; i < 4; i++) {
      circle(x + w * (0.12 + i * 0.2), y + h * 0.55, 1.2, [255, 220, 130]);
    }
    // controller
    const cY = y + h * 0.74;
    rect(x + w * 0.22, cY, x + w * 0.78, cY + h * 0.18, [40, 40, 55]);
    circle(x + w * 0.32, cY + h * 0.09, 2.6, PAPER);
    circle(x + w * 0.68, cY + h * 0.09, 2.6, RED);
    if (detail) drawTextCentered(x, x + w, y + h * 0.02, "$1.8B", 1.5, PAPER, true);
  } else if (kind === "baseball") {
    rect(x, y, x + w, y + h, [200, 230, 170]);
    // diamond
    polygon([cx, cy - h * 0.28, cx + w * 0.34, cy + h * 0.05, cx, cy + h * 0.34, cx - w * 0.34, cy + h * 0.05], [240, 220, 180]);
    polygon([cx, cy - h * 0.28, cx + w * 0.34, cy + h * 0.05, cx, cy + h * 0.34, cx - w * 0.34, cy + h * 0.05], [190, 150, 110]);
    // bat
    line(cx - w * 0.3, cy - h * 0.3, cx + w * 0.1, cy + h * 0.1, 3, [150, 110, 70]);
    circle(cx + w * 0.28, cy - h * 0.05, 2.6, PAPER);
    // ribbon
    const rY = y + h * 0.8;
    polygon([x + w * 0.08, rY, x + w * 0.92, rY, x + w * 0.86, rY + h * 0.14, x + w * 0.14, rY + h * 0.14], RED);
    if (detail) drawTextCentered(x + w * 0.08, x + w * 0.92, rY + h * 0.015, "POSTHUMOUS", 0.95, PAPER, true);
  } else if (kind === "podium") {
    rect(x, y, x + w, y + h, SKY);
    // factory
    rect(x + w * 0.06, y + h * 0.5, x + w * 0.34, y + h * 0.78, [140, 140, 140]);
    rect(x + w * 0.1, y + h * 0.34, x + w * 0.15, y + h * 0.5, [120, 120, 120]);
    rect(x + w * 0.2, y + h * 0.3, x + w * 0.25, y + h * 0.5, [120, 120, 120]);
    circle(x + w * 0.12, y + h * 0.28, 2.6, [200, 200, 200]);
    circle(x + w * 0.22, y + h * 0.24, 2.6, [200, 200, 200]);
    // podium
    polygon([cx - w * 0.22, y + h * 0.78, cx + w * 0.22, y + h * 0.78, cx + w * 0.16, y + h * 0.5, cx - w * 0.16, y + h * 0.5], [120, 84, 50]);
    line(cx, y + h * 0.3, cx, y + h * 0.5, 1.6, INK);
    circle(cx, y + h * 0.28, 2.4, INK);
    // tax-cut arrow up
    line(x + w * 0.78, y + h * 0.62, x + w * 0.78, y + h * 0.3, 2.4, [46, 125, 50]);
    polygon([x + w * 0.7, y + h * 0.36, x + w * 0.86, y + h * 0.36, x + w * 0.78, y + h * 0.22], [46, 125, 50]);
  } else if (kind === "cricket") {
    rect(x, y, x + w, y + h, [190, 220, 150]);
    // pitch
    rect(cx - w * 0.12, y + h * 0.08, cx + w * 0.12, y + h * 0.92, [230, 210, 160]);
    // stumps
    for (let i = -1; i <= 1; i++) {
      line(cx + i * 4, y + h * 0.14, cx + i * 4, y + h * 0.3, 1.6, [220, 180, 60]);
    }
    // bat
    line(cx - w * 0.3, cy + h * 0.1, cx + w * 0.05, cy - h * 0.25, 3.4, [150, 110, 70]);
    circle(cx + w * 0.22, cy + h * 0.28, 2.6, RED);
    // scoreboard
    const sX = x + w * 0.58;
    const sY = y + h * 0.08;
    rect(sX, sY, sX + w * 0.36, sY + h * 0.3, NAVY);
    if (detail) drawTextCentered(sX, sX + w * 0.36, sY + h * 0.04, "118", 1.6, PAPER, true);
    else drawTextCentered(sX, sX + w * 0.36, sY + h * 0.04, "118", 1.1, PAPER, true);
  }
}

// ---------- layout ----------
// Bands (output px): masthead 0-82, tabs 82-104, timeline 104-142,
// lead 142-298, numbers 298-346, medium grid 346-560, map 560-646,
// also-on 646-948, date check 948-986, footer 986-1024.
const MX = 24;
const RX = 1000;

function hairline(y: number): void {
  rect(MX, y, RX, y + 1, BORDER);
}

function masthead(): void {
  rect(MX, 0, RX, 2, RED);
  drawText(MX, 8, "FRIDAY - ONE DAY, ONE PICTURE", 1.05, RED, true);
  drawTextRight(RX, 8, "36 STORIES - ONE DAY", 1.05, RED, true);
  drawTextCentered(MX, RX, 17, "20 NOVEMBER 2026", 4.4, INK, true);
  drawTextCentered(MX, RX, 67, "THE WORLD TODAY - 36 STORIES - ONE DAY", 1.2, NAVY, true);
  rect(MX, 80, RX, 82, NAVY);
}

function tabs(): void {
  const gap = 6;
  const tw = (RX - MX - (TABS.length - 1) * gap) / TABS.length;
  TABS.forEach(([name, count], i) => {
    const x0 = MX + i * (tw + gap);
    const x1 = x0 + tw;
    rect(x0, 84, x1, 102, PAPER);
    frame(x0, 84, x1, 102, BORDER, 1);
    const col = REGION_COLORS[name];
    circle(x0 + 14, 93, 4, col);
    const label = name + " " + String(count);
    const w = measure(label, 1.3);
    drawText(x0 + (tw - w) / 2 + 6, 87, name, 1.3, INK, true);
    drawText(x0 + (tw - w) / 2 + 6 + measure(name, 1.3) + measure(" ", 1.3), 87, String(count), 1.3, RED, true);
  });
}

function timeline(): void {
  rect(MX, 104, MX + 108, 142, RED);
  drawTextCentered(MX, MX + 108, 110, "THE DAY", 1.25, PAPER, true);
  drawTextCentered(MX, MX + 108, 125, "IN UTC", 1.25, PAPER, true);
  const colW = (RX - (MX + 116)) / 3;
  TIMELINE.forEach((row, ri) => {
    row.forEach(([time, text], ci) => {
      const x = MX + 116 + ci * colW;
      const yTop = 109 + ri * 17;
      drawText(x, yTop, time, 0.95, RED, true);
      drawText(x + measure(time, 0.95) + measure(" ", 0.95), yTop, text, 0.95, INK, true);
    });
  });
}

function leadCard(x: number, y: number, w: number, h: number, st: Story): void {
  rect(x, y, x + w, y + h, PAPER);
  frame(x, y, x + w, y + h, BORDER, 1);
  const panelW = 150;
  const px = x + w - panelW;
  rect(px, y, x + w, y + h, CHIP_BG);
  rect(px, y, px + 1, y + h, BORDER);
  scene(st.scene, px + 6, y + 6, panelW - 12, h - 12, true);
  const tw = w - panelW - 22;
  badge(x + 14, y + 14, st.n, 11);
  drawText(x + 32, y + 8, st.kicker, 1.05, RED, true);
  const headLines = wrapText(st.headline, tw, 1.95);
  headLines.forEach((ln, i) => drawText(x + 10, y + 28 + i * 24, ln, 1.95, INK, true));
  const bodyY = y + 28 + headLines.length * 24 + 4;
  const bodyLines = wrapText(st.body, tw, 1.18);
  bodyLines.forEach((ln, i) => drawText(x + 10, bodyY + i * 14.5, ln, 1.18, INK, false));
  if (st.stat) {
    const ss = fitScale(st.stat, tw, 1.0, 0.85);
    drawText(x + 10, y + h - 15, st.stat, ss, RED, true);
  }
}

function mediumCard(x: number, y: number, w: number, h: number, st: Story): void {
  rect(x, y, x + w, y + h, PAPER);
  frame(x, y, x + w, y + h, BORDER, 1);
  const chipW = w > 300 ? 62 : 50;
  const cx0 = x + w - chipW;
  rect(cx0, y, x + w, y + h, CHIP_BG);
  rect(cx0, y, cx0 + 1, y + h, BORDER);
  scene(st.scene, cx0 + 3, y + 3, chipW - 6, h - 6, false);
  const tw = w - chipW - 16;
  badge(x + 11, y + 11, st.n, 7.5);
  const ks = fitScale(st.kicker, tw - 12, 0.82, 0.68);
  drawText(x + 22, y + 5, st.kicker, ks, RED, true);
  const headLines = wrapText(st.headline, tw, 1.3).slice(0, 2);
  headLines.forEach((ln, i) => drawText(x + 10, y + 16 + i * 15, ln, 1.3, INK, true));
  const bodyLines = wrapText(st.body, tw, 1.0).slice(0, 2);
  bodyLines.forEach((ln, i) => drawText(x + 10, y + 47 + i * 11.5, ln, 1.0, INK, false));
}

function numbersStrip(): void {
  const gap = 6;
  const bw = (RX - MX - 7 * gap) / 8;
  NUMBERS.forEach(([val, label], i) => {
    const x0 = MX + i * (bw + gap);
    const x1 = x0 + bw;
    rect(x0, 298, x1, 346, PAPER);
    frame(x0, 298, x1, 346, BORDER, 1);
    const vs = fitScale(val, bw - 12, 1.75, 1.15);
    drawTextCentered(x0, x1, 305, val, vs, RED, true);
    drawTextCentered(x0, x1, 330, label, 0.92, MUTED, true);
  });
}

function mediumGrid(): void {
  const gap = 8;
  const rowH = 70;
  const colW = (RX - MX - 3 * gap) / 4;
  const rows: Story[][] = [
    MEDIUM.slice(0, 4),
    MEDIUM.slice(4, 8),
    MEDIUM.slice(8, 11),
  ];
  rows.forEach((row, ri) => {
    const y = 346 + ri * (rowH + 2);
    if (row.length === 4) {
      row.forEach((st, ci) => mediumCard(MX + ci * (colW + gap), y, colW, rowH, st));
    } else {
      const w3 = (RX - MX - 2 * gap) / 3;
      row.forEach((st, ci) => mediumCard(MX + ci * (w3 + gap), y, w3, rowH, st));
    }
  });
}

// ---------- world map ----------
// Schematic continents (output px, band y 560-646). Sea is the cream
// background with a pale wash; land is filled tan.
const CONTINENTS: number[][] = [
  // North America
  [70, 570, 150, 562, 230, 564, 265, 576, 250, 589, 215, 596, 190, 609, 150, 604, 110, 602, 70, 592, 55, 579],
  // Greenland
  [285, 560, 315, 560, 320, 570, 295, 572],
  // South America
  [225, 610, 265, 608, 285, 616, 275, 636, 250, 644, 230, 636, 218, 620],
  // Europe
  [470, 564, 520, 560, 545, 568, 535, 580, 505, 584, 480, 580, 465, 572],
  // Africa
  [475, 602, 530, 598, 560, 604, 555, 624, 530, 644, 495, 644, 478, 619, 468, 606],
  // Asia
  [550, 566, 640, 560, 760, 562, 850, 570, 880, 584, 840, 600, 780, 604, 720, 616, 660, 610, 600, 604, 560, 592, 545, 576],
  // Australia
  [845, 622, 905, 618, 925, 626, 915, 640, 860, 642, 842, 632],
  // New Zealand
  [938, 630, 950, 628, 953, 638, 942, 642],
];

interface MapLabel {
  name: string;
  pinX: number;
  pinY: number;
  num: number | null;
  box: [number, number, number, number]; // x, y, w, h
  leaderFrom: [number, number];
}

const MAP_LABELS: MapLabel[] = [
  { name: "WASHINGTON", pinX: 235, pinY: 586, num: 1, box: [292, 578, 98, 14], leaderFrom: [292, 585] },
  { name: "LONDON", pinX: 488, pinY: 570, num: 7, box: [400, 562, 58, 14], leaderFrom: [458, 569] },
  { name: "ANTALYA", pinX: 545, pinY: 580, num: 4, box: [490, 586, 64, 12], leaderFrom: [522, 586] },
  { name: "RIYADH", pinX: 578, pinY: 594, num: null, box: [612, 630, 58, 14], leaderFrom: [612, 637] },
  { name: "ODISHA", pinX: 700, pinY: 604, num: 5, box: [688, 630, 58, 14], leaderFrom: [717, 630] },
  { name: "SHENZHEN", pinX: 795, pinY: 596, num: 2, box: [760, 632, 74, 12], leaderFrom: [797, 632] },
  { name: "TOKYO", pinX: 862, pinY: 582, num: 9, box: [908, 562, 50, 14], leaderFrom: [908, 569] },
  { name: "WELLINGTON", pinX: 947, pinY: 636, num: 13, box: [905, 600, 90, 14], leaderFrom: [945, 614] },
];

function mapBand(): void {
  rect(MX, 560, RX, 646, SEA);
  frame(MX, 560, RX, 646, BORDER, 1);
  for (const poly of CONTINENTS) {
    polygon(poly, LAND);
    // outline the landmass
    for (let i = 0; i + 3 < poly.length; i += 2) {
      line(poly[i], poly[i + 1], poly[i + 2], poly[i + 3], 1, LAND_EDGE);
    }
    const n = poly.length / 2;
    line(poly[(n - 1) * 2], poly[(n - 1) * 2 + 1], poly[0], poly[1], 1, LAND_EDGE);
  }
  drawText(MX + 6, 630, "WHERE IT HAPPENED", 1.0, RED, true);
  // labels first (in open sea, white backing), then leader lines, then pins
  for (const lb of MAP_LABELS) {
    const [bx, by, bw, bh] = lb.box;
    rect(bx, by, bx + bw, by + bh, PAPER);
    frame(bx, by, bx + bw, by + bh, RED, 0.8);
    drawTextCentered(bx, bx + bw, by + 1.5, lb.name, 1.0, INK, true);
  }
  for (const lb of MAP_LABELS) {
    line(lb.leaderFrom[0], lb.leaderFrom[1], lb.pinX, lb.pinY, 1.2, RED);
  }
  for (const lb of MAP_LABELS) {
    if (lb.num !== null) {
      circle(lb.pinX, lb.pinY, 7, RED);
      ring(lb.pinX, lb.pinY, 7, 1.2, PAPER);
      drawTextCentered(lb.pinX - 7, lb.pinX + 7, lb.pinY - 4.5, String(lb.num), 0.85, PAPER, true);
    } else {
      circle(lb.pinX, lb.pinY, 5, RED);
      ring(lb.pinX, lb.pinY, 5, 1.2, PAPER);
    }
  }
  // runtime verification: every label box corner + centre must be sea
  for (const lb of MAP_LABELS) {
    const [bx, by, bw, bh] = lb.box;
    const pts: [number, number][] = [
      [bx + 1, by + 1],
      [bx + bw - 1, by + 1],
      [bx + 1, by + bh - 1],
      [bx + bw - 1, by + bh - 1],
      [bx + bw / 2, by + bh / 2],
    ];
    for (const [px, py] of pts) {
      for (const poly of CONTINENTS) {
        if (pointInPoly(px, py, poly)) {
          console.error(`MAP LABEL ON LAND: ${lb.name} at (${px}, ${py})`);
        }
      }
    }
  }
  // label-label overlap check
  for (let i = 0; i < MAP_LABELS.length; i++) {
    for (let j = i + 1; j < MAP_LABELS.length; j++) {
      const a = MAP_LABELS[i].box;
      const b = MAP_LABELS[j].box;
      if (a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) {
        console.error(`MAP LABELS OVERLAP: ${MAP_LABELS[i].name} / ${MAP_LABELS[j].name}`);
      }
    }
  }
}

function alsoOn(): void {
  rect(MX, 646, RX, 948, PAPER);
  frame(MX, 646, RX, 948, BORDER, 1);
  drawText(MX, 650, "ALSO ON FRIDAY 20 NOVEMBER", 1.6, RED, true);
  drawTextRight(RX, 654, "23 MORE STORIES", 1.0, MUTED, true);
  rect(MX, 668, RX, 669, BORDER);
  const rowH = 23;
  const colW = 484;
  ONELINERS.forEach((it, i) => {
    const col = i < 12 ? 0 : 1;
    const row = i % 12;
    const x = MX + col * (colW + 8);
    const yTop = 672 + row * rowH + 4;
    const full = String(it.n) + " " + it.kw + ": " + it.text;
    const s = fitScale(full, colW - 40, 1.05, 0.92);
    drawText(x, yTop, String(it.n), s, RED, true);
    circle(x + 30, yTop + 5, 3.5, REGION_COLORS[it.region]);
    let gx = x + 40;
    drawText(gx, yTop, it.kw + ":", s, INK, true);
    gx += measure(it.kw + ":", s) + measure(" ", s);
    drawText(gx, yTop, it.text, s, INK, false);
  });
}

function dateCheck(): void {
  rect(MX, 950, MX + 92, 984, RED);
  drawTextCentered(MX, MX + 92, 954, "DATE", 1.2, PAPER, true);
  drawTextCentered(MX, MX + 92, 968, "CHECK", 1.2, PAPER, true);
  DATE_CHECK_LINES.forEach((ln, i) => {
    const s = fitScale(ln, RX - 128 - MX, 0.95, 0.85);
    drawText(128, 951 + i * 12, ln, s, INK, false);
  });
}

function footer(): void {
  rect(MX, 986, RX, 987, BORDER);
  drawTextCentered(MX, RX, 990, "SOURCES: REUTERS AP BBC WSJ THE HINDU IMD NASA", 1.0, INK, false);
  drawTextCentered(MX, RX, 1002, "ALL STORIES VERIFIED AGAINST NAMED SOURCES", 1.0, MUTED, false);
  drawTextCentered(MX, RX, 1013, "20 NOVEMBER 2026", 1.0, RED, true);
}

// ---------- main ----------
function main(): void {
  masthead();
  tabs();
  timeline();
  hairline(142);
  const leadW = (RX - MX - 8) / 2;
  leadCard(MX, 142, leadW, 156, LEAD[0]);
  leadCard(MX + leadW + 8, 142, leadW, 156, LEAD[1]);
  hairline(298);
  numbersStrip();
  hairline(346);
  mediumGrid();
  hairline(560);
  mapBand();
  hairline(646);
  alsoOn();
  hairline(948);
  dateCheck();
  footer();

  finish("entry.png");
}

function finish(name: string): void {
  // 3x box downsample to 1024x1024
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * SW + x * SS + dx) * 3;
          r += buf[o];
          g += buf[o + 1];
          b += buf[o + 2];
        }
      }
      const o = (y * W + x) * 3;
      out[o] = Math.round(r / 9);
      out[o + 1] = Math.round(g / 9);
      out[o + 2] = Math.round(b / 9);
    }
  }

  // measurements for the build report
  let filled = 0;
  let hardEdges = 0;
  let pairs = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      if (
        Math.abs(out[o] - CREAM[0]) > 14 ||
        Math.abs(out[o + 1] - CREAM[1]) > 14 ||
        Math.abs(out[o + 2] - CREAM[2]) > 14
      ) {
        filled++;
      }
      if (x + 1 < W) {
        const o2 = o + 3;
        const l1 = 0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2];
        const l2 = 0.299 * out[o2] + 0.587 * out[o2 + 1] + 0.114 * out[o2 + 2];
        if (Math.abs(l1 - l2) > 150) hardEdges++;
        pairs++;
      }
    }
  }
  console.error(`filled fraction: ${(100 * (filled / (W * H))).toFixed(1)}%`);
  console.error(`hard horizontal edges: ${(100 * (hardEdges / pairs)).toFixed(2)}%`);

  const png = encodePNG(out, W, H);
  const dir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  fs.writeFileSync(target, png);
  console.error(`wrote ${target}: ${png.length} bytes`);
}

// Font test sheet (FONT_TEST=1): pangram + full charset, per V6-SPEC font rules.
function pangramSheet(): void {
  drawText(40, 60, "The quick brown fox jumps over the lazy dog 0123456789", 2.2, INK, false);
  drawText(40, 140, "DOW -1,101", 2.2, RED, true);
  drawText(40, 220, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 1.8, INK, true);
  drawText(40, 280, "abcdefghijklmnopqrstuvwxyz", 1.8, INK, false);
  drawText(40, 340, "0123456789 .,;:!?'-()%$&/+@#", 1.8, INK, false);
  drawText(40, 400, "S&P 500 -2.0% $1.27T (COP31) 144 TO 80", 1.8, INK, false);
}

if (process.env.FONT_TEST) {
  pangramSheet();
  finish("font-test.png");
} else {
  main();
}
