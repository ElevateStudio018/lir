/**
 * Procedural PBR surfaces — generated on the client, so there is nothing to
 * download and no third-party licence to track. Every texture tiles seamlessly
 * (the noise lattice wraps at the tile period) and ships a colour map, a normal
 * map derived from the height field and a roughness map.
 */
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise: the lattice repeats every `period` cells. */
function tileNoise(seed) {
  const R = rng(seed);
  const P = new Uint8Array(512);
  const perm = [...Array(256).keys()].sort(() => R() - 0.5);
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const V = new Float32Array(256).map(() => R());
  const h = (x, y) => V[P[(P[x & 255] + y) & 511] & 255];
  return (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = h(x0, y0);
    const b = h(x1, y0);
    const c = h(x0, y1);
    const d = h(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(n, x, y, base, oct, gain = 0.5) {
  let s = 0;
  let amp = 1;
  let norm = 0;
  let p = base;
  for (let i = 0; i < oct; i++) {
    s += amp * n(x * p, y * p, p);
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return s / norm;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Builds colour/normal/roughness textures from a per-texel sampler.
 * sampler(u, v) → [r, g, b, height 0..1, roughness 0..1] with u, v ∈ [0, 1).
 */
function bake(size, sampler, { normalStrength = 2, anisotropy = 4 } = {}) {
  const col = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, h, ro] = sampler(x / size, y / size);
      const i = y * size + x;
      col[i * 4] = clamp(r);
      col[i * 4 + 1] = clamp(g);
      col[i * 4 + 2] = clamp(b);
      col[i * 4 + 3] = 255;
      H[i] = h;
      const rv = clamp(ro * 255);
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = rv;
      rough[i * 4 + 3] = 255;
    }
  }
  const nrm = new Uint8ClampedArray(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nrm[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      nrm[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      nrm[i + 2] = (1 / l) * 0.5 * 255 + 127.5;
      nrm[i + 3] = 255;
    }
  }
  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(col, true), normalMap: tex(nrm, false), roughnessMap: tex(rough, false) };
}

// ---------- Surfaces ----------

/** Cast-in-place concrete: cloudy tone, fine grain, air voids, faint formwork lines. */
export function concrete(size, { tone = [186, 182, 172], pores = 1, seed = 1 } = {}) {
  const n = tileNoise(seed);
  const n2 = tileNoise(seed + 7);
  const R = rng(seed + 3);
  const voids = [];
  const count = Math.round(size * size * 0.0016 * pores);
  for (let i = 0; i < count; i++) voids.push([R(), R(), (0.6 + R() * 1.8) / size]);
  // Spatial hash for pore lookups
  const G = 32;
  const cells = Array.from({ length: G * G }, () => []);
  for (const v of voids) cells[Math.floor(v[1] * G) * G + Math.floor(v[0] * G)].push(v);
  const poreAt = (u, v) => {
    const cx = Math.floor(u * G);
    const cy = Math.floor(v * G);
    let d = 1;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const list = cells[(((cy + j) % G) + G) % G * G + ((((cx + i) % G) + G) % G)];
        for (const [px, py, r] of list) {
          let dx = Math.abs(u - px);
          let dy = Math.abs(v - py);
          dx = Math.min(dx, 1 - dx);
          dy = Math.min(dy, 1 - dy);
          d = Math.min(d, Math.hypot(dx, dy) / r);
        }
      }
    return d < 1 ? 1 - d : 0;
  };
  return bake(size, (u, v) => {
    const cloud = fbm(n, u, v, 3, 4, 0.55);
    const grain = fbm(n2, u, v, 48, 3, 0.5);
    const form = Math.sin(v * Math.PI * 2 * 6) * 0.5 + 0.5; // formwork board rhythm
    const p = poreAt(u, v) * pores;
    const k = 0.86 + (cloud - 0.5) * 0.22 + (grain - 0.5) * 0.12 - Math.pow(form, 12) * 0.03 - p * 0.35;
    const h = cloud * 0.25 + grain * 0.5 - p * 0.9;
    return [tone[0] * k, tone[1] * k, tone[2] * k * 0.99, h, 0.82 + (grain - 0.5) * 0.18 + p * 0.1];
  }, { normalStrength: 3 });
}

/** Vertical timber cladding: boards, grain and knots, weathering toward silver at the edges. */
export function timber(size, seed = 11) {
  const n = tileNoise(seed);
  const n2 = tileNoise(seed + 5);
  const boards = 4;
  return bake(size, (u, v) => {
    const b = Math.floor(u * boards);
    const bu = u * boards - b;
    const shift = (b * 0.37) % 1;
    const grain = fbm(n, u * 1.0 + b * 0.13, v, 2, 3) * 0.5 + Math.sin((bu * 18 + fbm(n2, u, v + shift, 4, 3) * 6) * Math.PI) * 0.25;
    const seam = bu < 0.025 || bu > 0.975 ? 1 : 0;
    const tone = 0.82 + grain * 0.3 - seam * 0.45 + (((b * 7919) % 5) / 5 - 0.5) * 0.12;
    return [168 * tone, 124 * tone, 84 * tone, grain * 0.6 - seam, 0.62 + grain * 0.1 + seam * 0.2];
  }, { normalStrength: 2.2 });
}

/** Lawn: clumped greens, dry patches and fine blade noise. */
export function grass(size, seed = 21) {
  const n = tileNoise(seed);
  const n2 = tileNoise(seed + 2);
  return bake(size, (u, v) => {
    const clump = fbm(n, u, v, 4, 4, 0.55);
    const blade = fbm(n2, u, v, 64, 2, 0.6);
    const dry = Math.max(0, fbm(n, u + 0.31, v + 0.77, 2, 3) - 0.55) * 2.2;
    const k = 0.72 + clump * 0.4 + (blade - 0.5) * 0.35;
    const r = (86 + dry * 60) * k;
    const g = (104 + dry * 30) * k;
    const b = (62 + dry * 10) * k;
    return [r, g, b, blade * 0.6 + clump * 0.4, 0.92];
  }, { normalStrength: 1.4 });
}

/** Asphalt: dark binder with bright aggregate specks and patching. */
export function asphalt(size, seed = 31) {
  const n = tileNoise(seed);
  const n2 = tileNoise(seed + 9);
  return bake(size, (u, v) => {
    const patch = fbm(n, u, v, 2, 3);
    const agg = fbm(n2, u, v, 128, 1);
    const speck = agg > 0.78 ? (agg - 0.78) * 4 : 0;
    const k = 0.9 + (patch - 0.5) * 0.25 + speck * 0.9;
    return [46 * k, 49 * k, 51 * k, agg * 0.8, 0.88 - speck * 0.2];
  }, { normalStrength: 2.5 });
}

/** Granite paving slabs 1200×600, stretcher bond, with sanded joints. */
export function paving(size, seed = 41) {
  const n = tileNoise(seed);
  const n2 = tileNoise(seed + 4);
  const R = rng(seed);
  const tones = Array.from({ length: 64 }, () => 0.9 + R() * 0.16);
  return bake(size, (u, v) => {
    const rows = 8;
    const cols = 4;
    const ry = Math.floor(v * rows);
    const off = ry % 2 ? 0.5 / cols : 0;
    const cx = Math.floor(((u + off) % 1) * cols);
    const fu = (((u + off) % 1) * cols) % 1;
    const fv = (v * rows) % 1;
    const joint = Math.min(fu, 1 - fu, (fv * 0.5) / 1, (1 - fv) * 0.5) < 0.012 ? 1 : 0;
    const grain = fbm(n2, u, v, 64, 2);
    const t = tones[(ry * cols + cx) % 64] * (0.94 + (fbm(n, u, v, 4, 3) - 0.5) * 0.12) + (grain - 0.5) * 0.1;
    const k = joint ? 0.62 : t;
    return [196 * k, 191 * k, 180 * k, joint ? 0 : 0.5 + grain * 0.3, joint ? 0.95 : 0.74];
  }, { normalStrength: 2 });
}

/** Rescales a BoxGeometry's UVs to metres so textures keep real-world scale. */
export function boxUV(geo, w, h, d, tile = 2) {
  const uv = geo.attributes.uv;
  const dims = [
    [d, h], [d, h], // ±x
    [w, d], [w, d], // ±y
    [w, h], [w, h], // ±z
  ];
  for (let f = 0; f < 6; f++) {
    const [a, b] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * a) / tile, (uv.getY(k) * b) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** Scales a plane's 0..1 UVs to metres. */
export function planeUV(geo, w, h, tile = 2) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  uv.needsUpdate = true;
  return geo;
}
