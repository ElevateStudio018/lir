/**
 * THE CONSTRUCTION PROCESS — scroll-driven WebGL scene.
 *
 * A procedural Swedish mid-rise (5 floors, 24 × 13.5 m) is assembled entirely
 * from scroll progress: site plan → BIM wireframe → excavation & foundation →
 * frame (columns, steel beams, decks, crane) → facade (spandrels, glass, timber
 * fins) → golden-hour handover → photo-to-blueprint transition.
 *
 * Everything is deterministic in `t`, so scrolling up reverses perfectly.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import * as TX from './textures.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { T, range, sub, lerp, ease, clamp01 } from './timeline.js';

// ---------- Building constants (metres) ----------
const F = 5; // floors
const FH = 3.6; // floor height
const BX = 6; // bays along x
const BZ = 3; // bays along z
const BAY_X = 4;
const BAY_Z = 4.5;
const W = BX * BAY_X; // 24
const D = BZ * BAY_Z; // 13.5
const X0 = -W / 2;
const Z0 = -D / 2;
const TOP = F * FH + 0.3;
const CRANE_POS = new THREE.Vector3(-21, 0, -15);
const CRANE_H = 34;

// Deterministic RNG so the scene is identical on every visit.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function setInst(mesh, i, x, y, z, sx, sy, sz, ry = 0, rx = 0) {
  if (sx <= 0.0001 || sy <= 0.0001 || sz <= 0.0001) {
    mesh.setMatrixAt(i, HIDE);
    return;
  }
  _e.set(rx, ry, 0);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(i, _m);
}

/** Thin box oriented between two points — used for lattice (crane) members. */
function strut(a, b, t) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, t, len);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0.0001));
  m.setPosition(mid);
  g.applyMatrix4(m);
  return g;
}

export function createProcessScene(canvas, { mobile = false, reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  const maxDpr = mobile ? 1.5 : 1.75;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const TM_EXPOSURE = 1.05;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x0b1113, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 900);

  // Environment for PBR reflections (generated once, tiny).
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Two light rigs: a neutral studio fill while the site is being built, and a real
  // golden-hour HDRI for the handover. Swapped as the sun comes up.
  const envNeutral = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  let envSunset = null;
  scene.environment = envNeutral;
  scene.environmentRotation.y = -2.1; // align the HDRI's low sun with the scene's sun
  // Real-world light: Poly Haven "Venice Sunset" (CC0), a low golden-hour sun over a city.
  new HDRLoader().load(
    `${import.meta.env.BASE_URL}env/venice_sunset_1k.hdr`,
    (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      envSunset = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pmrem.dispose();
      lastApplied = -1;
    },
    undefined,
    () => pmrem.dispose(),
  );

  // Post-processing (desktop): ground-truth AO for contact shadows, gentle bloom for lit windows.
  let composer = null;
  let gtao = null;
  let bloom = null;
  let postOK = true;
  if (!mobile) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, 512, 512);
    gtao.updateGtaoMaterial({ radius: 2.4, distanceExponent: 1.6, thickness: 2.5, scale: 1.1, samples: 12, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    composer.addPass(gtao);
    bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.1, 0.55, 0.88);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  const fog = new THREE.Fog(0x0b1113, 90, 320);
  scene.fog = fog;

  // ---------- Lights ----------
  const hemi = new THREE.HemisphereLight(0x9fb6c8, 0x1a1a18, 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xbfd2e6, 0.6);
  sun.position.set(40, 60, 30);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // ---------- Materials ----------
  const TS = mobile ? 256 : 512;
  const TXC = TX.concrete(TS, { tone: [190, 186, 176], seed: 1 });
  const TXP = TX.concrete(TS, { tone: [220, 215, 205], pores: 0.35, seed: 5 });
  const TXS = TX.concrete(TS / 2, { tone: [96, 84, 70], pores: 2.5, seed: 9 });
  const TXW = TX.timber(TS);
  const TXG = TX.grass(TS);
  const TXA = TX.asphalt(TS);
  const TXV = TX.paving(TS);
  const pbr = (t, ns = 1) => ({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, normalScale: new THREE.Vector2(ns, ns) });

  const solids = [];
  const std = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    m.polygonOffset = true;
    m.polygonOffsetFactor = 1;
    m.polygonOffsetUnits = 1;
    solids.push(m);
    return m;
  };
  const M = {
    ground: std({ color: 0x151c1f, roughness: 1, ...pbr(TXG, 0.8) }),
    soil: std({ color: 0xffffff, roughness: 1, side: THREE.BackSide, ...pbr(TXS, 1.2) }),
    lid: std({ color: 0x151c1f, roughness: 1, transparent: true, ...pbr(TXG, 0.8) }),
    concrete: std({ color: 0xe8e5de, roughness: 1, ...pbr(TXC, 0.9) }),
    slab: std({ color: 0xdcd8cf, roughness: 1, ...pbr(TXC, 0.7) }),
    steel: std({ color: 0x3e464b, roughness: 0.42, metalness: 0.75 }),
    panel: std({ color: 0xffffff, roughness: 1, ...pbr(TXP, 0.6) }),
    wood: std({ color: 0xffffff, roughness: 1, ...pbr(TXW, 0.8) }),
    glass: std({ color: 0x1f2c33, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.25 }),
    glassLit: std({ color: 0x26323a, roughness: 0.06, metalness: 0.6, envMapIntensity: 1.0, emissive: 0xffc27a, emissiveIntensity: 0 }),
    frame: std({ color: 0x2a2e30, roughness: 0.42, metalness: 0.65 }),
    sill: std({ color: 0xb9b8b2, roughness: 0.35, metalness: 0.7 }),
    railGlass: std({ color: 0xa9bec8, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }),
    crane: std({ color: 0xc39c45, roughness: 0.5, metalness: 0.35 }),
    craneDark: std({ color: 0x2a2f33, roughness: 0.6, metalness: 0.4 }),
    plaza: std({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0, ...pbr(TXV, 0.8) }),
    asphalt: std({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0, ...pbr(TXA, 1) }),
    marking: std({ color: 0xe8e4da, roughness: 0.8, transparent: true, opacity: 0 }),
    trunk: std({ color: 0x5b4c3e, roughness: 0.9 }),
    crown: std({ color: 0xffffff, roughness: 0.85 }),
    people: std({ color: 0xffffff, roughness: 0.8 }),
    lamp: std({ color: 0x23282b, roughness: 0.6, metalness: 0.5 }),
    lampHead: std({ color: 0x333333, emissive: 0xffcf96, emissiveIntensity: 0 }),
    solar: std({ color: 0x1c2733, roughness: 0.2, metalness: 0.8 }),
  };

  const root = new THREE.Group();
  scene.add(root);
  const edgeSources = []; // meshes whose final edges feed the blueprint drawing

  // ---------- Sky dome ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uDay: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.6, 0.18, -0.78).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDay;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 nightTop = vec3(0.035, 0.055, 0.065);
        vec3 nightHor = vec3(0.06, 0.085, 0.1);
        vec3 dayTop = vec3(0.28, 0.4, 0.52);
        vec3 dayHor = vec3(0.93, 0.74, 0.52);
        vec3 night = mix(nightHor, nightTop, smoothstep(0.0, 0.5, h));
        float sunAmt = pow(max(dot(normalize(vDir), uSunDir), 0.0), 6.0);
        vec3 day = mix(dayHor, dayTop, smoothstep(-0.02, 0.55, h));
        day += vec3(1.0, 0.72, 0.42) * sunAmt * 0.55;
        day += vec3(1.0, 0.85, 0.6) * pow(max(dot(normalize(vDir), uSunDir), 0.0), 220.0) * 2.0;
        vec3 col = mix(night, day, uDay);
        col *= mix(1.0, 0.72, smoothstep(0.0, -0.2, vDir.y));
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat);
  scene.add(sky);

  // ---------- Ground with excavation opening ----------
  const PIT_W = 28;
  const PIT_D = 18;
  const PIT_H = 3;
  const gShape = new THREE.Shape();
  gShape.moveTo(-300, -300).lineTo(300, -300).lineTo(300, 300).lineTo(-300, 300).lineTo(-300, -300);
  const hole = new THREE.Path();
  hole.moveTo(-PIT_W / 2, -PIT_D / 2).lineTo(-PIT_W / 2, PIT_D / 2).lineTo(PIT_W / 2, PIT_D / 2).lineTo(PIT_W / 2, -PIT_D / 2).lineTo(-PIT_W / 2, -PIT_D / 2);
  gShape.holes.push(hole);
  const groundGeo = new THREE.ShapeGeometry(gShape);
  {
    const uv = groundGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5, uv.getY(i) / 5);
  }
  const ground = new THREE.Mesh(groundGeo, M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  const pit = new THREE.Mesh(TX.boxUV(new THREE.BoxGeometry(PIT_W, PIT_H, PIT_D), PIT_W, PIT_H, PIT_D, 3), M.soil);
  pit.position.y = -PIT_H / 2 - 0.001;
  pit.receiveShadow = true;
  root.add(pit);

  const lid = new THREE.Mesh(TX.planeUV(new THREE.PlaneGeometry(PIT_W, PIT_D), PIT_W, PIT_D, 5), M.lid);
  lid.rotation.x = -Math.PI / 2;
  lid.position.y = 0.002;
  lid.receiveShadow = true;
  root.add(lid);

  // Blueprint grid projected on the ground
  const gridMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0x8fbad6) }, uReveal: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uReveal;
      uniform vec3 uColor;
      varying vec2 vXZ;
      float gridLine(vec2 p, float s) {
        vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = length(vXZ);
        float minor = gridLine(vXZ, 1.5) * 0.28;
        float major = gridLine(vXZ, 7.5) * 0.75;
        float g = max(minor, major);
        float fade = 1.0 - smoothstep(24.0, 95.0, d);
        float reveal = smoothstep(uReveal * 120.0, uReveal * 120.0 - 18.0, d);
        gl_FragColor = vec4(uColor, g * fade * reveal * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.02;
  grid.renderOrder = 2;
  root.add(grid);

  // ---------- Site plan linework (drawn progressively) ----------
  const planPts = [];
  const seg = (a, b) => planPts.push(a[0], 0.04, a[1], b[0], 0.04, b[1]);
  const poly = (pts, closed = true) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) seg(pts[i], pts[(i + 1) % pts.length]);
  };
  // Plot boundary
  poly([[-38, -30], [34, -34], [42, 18], [8, 30], [-40, 26]]);
  // Topographic contours
  for (let k = 0; k < 4; k++) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const x = -70 + i * 3.5;
      pts.push([x, -46 - k * 7 + Math.sin(x * 0.06 + k) * 4 + Math.cos(x * 0.021) * 3]);
    }
    poly(pts, false);
  }
  // Structural grid axes
  for (let i = 0; i <= BX; i++) seg([X0 + i * BAY_X, Z0 - 6], [X0 + i * BAY_X, -Z0 + 6]);
  for (let j = 0; j <= BZ; j++) seg([X0 - 6, Z0 + j * BAY_Z], [-X0 + 6, Z0 + j * BAY_Z]);
  // Footprint (double line = wall)
  poly([[X0, Z0], [-X0, Z0], [-X0, -Z0], [X0, -Z0]]);
  poly([[X0 - 0.4, Z0 - 0.4], [-X0 + 0.4, Z0 - 0.4], [-X0 + 0.4, -Z0 + 0.4], [X0 - 0.4, -Z0 + 0.4]]);
  // Dimension lines + ticks
  const dimZ = -Z0 + 9;
  seg([X0, dimZ], [-X0, dimZ]);
  for (let i = 0; i <= BX; i++) seg([X0 + i * BAY_X - 0.5, dimZ + 0.5], [X0 + i * BAY_X + 0.5, dimZ - 0.5]);
  const dimX = X0 - 9;
  seg([dimX, Z0], [dimX, -Z0]);
  for (let j = 0; j <= BZ; j++) seg([dimX - 0.5, Z0 + j * BAY_Z + 0.5], [dimX + 0.5, Z0 + j * BAY_Z - 0.5]);
  // Road edges + entry
  poly([[-90, 19], [90, 19]], false);
  poly([[-90, 27], [90, 27]], false);
  poly([[-4, 19], [-4, -Z0 + 0.4]], false);
  poly([[4, 19], [4, -Z0 + 0.4]], false);
  // Axis bubbles
  const circle = (cx, cz, r) => {
    const pts = [];
    for (let i = 0; i < 20; i++) pts.push([cx + Math.cos((i / 20) * Math.PI * 2) * r, cz + Math.sin((i / 20) * Math.PI * 2) * r]);
    poly(pts);
  };
  for (let i = 0; i <= BX; i++) circle(X0 + i * BAY_X, Z0 - 7.2, 1.1);
  for (let j = 0; j <= BZ; j++) circle(X0 - 7.2, Z0 + j * BAY_Z, 1.1);
  // North arrow
  poly([[30, -22], [32, -16], [34, -22], [32, -20.5]]);

  const planGeo = new THREE.BufferGeometry();
  planGeo.setAttribute('position', new THREE.Float32BufferAttribute(planPts, 3));
  const planVerts = planPts.length / 3;
  const planMat = new THREE.LineBasicMaterial({ color: 0xb5d4e8, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const planLines = new THREE.LineSegments(planGeo, planMat);
  planLines.renderOrder = 3;
  planLines.frustumCulled = false;
  root.add(planLines);

  // ---------- BIM wireframe volume ----------
  const wireGroup = new THREE.Group();
  const wirePts = [];
  const box = new THREE.BoxGeometry(W, FH, D);
  const boxEdges = new THREE.EdgesGeometry(box);
  const be = boxEdges.attributes.position.array;
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < be.length; i += 3) wirePts.push(be[i], be[i + 1] + FH / 2 + f * FH, be[i + 2]);
  }
  for (let i = 0; i <= BX; i++) {
    for (let j = 0; j <= BZ; j++) {
      wirePts.push(X0 + i * BAY_X, 0, Z0 + j * BAY_Z, X0 + i * BAY_X, F * FH, Z0 + j * BAY_Z);
    }
  }
  for (let f = 1; f <= F; f++) {
    for (let i = 1; i < BX; i++) wirePts.push(X0 + i * BAY_X, f * FH, Z0, X0 + i * BAY_X, f * FH, -Z0);
  }
  // Vertical dimension with floor ticks
  const vx = -X0 + 4;
  const vz = -Z0 + 4;
  wirePts.push(vx, 0, vz, vx, F * FH, vz);
  for (let f = 0; f <= F; f++) wirePts.push(vx - 0.6, f * FH, vz, vx + 0.6, f * FH, vz);
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  const wireMat = new THREE.LineBasicMaterial({ color: 0xb5d4e8, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const wire = new THREE.LineSegments(wireGeo, wireMat);
  wire.renderOrder = 3;
  wireGroup.add(wire);
  // Section plane sweeping upward — a subtle BIM reference
  const scanMat = new THREE.MeshBasicMaterial({ color: 0x8fbad6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(W + 3, D + 3), scanMat);
  scan.rotation.x = -Math.PI / 2;
  scan.renderOrder = 4;
  wireGroup.add(scan);
  const scanEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W + 3, D + 3)), wireMat);
  scanEdge.rotation.x = -Math.PI / 2;
  wireGroup.add(scanEdge);
  root.add(wireGroup);

  // ---------- Foundation ----------
  const colPos = [];
  for (let i = 0; i <= BX; i++) for (let j = 0; j <= BZ; j++) colPos.push([X0 + i * BAY_X, Z0 + j * BAY_Z]);
  const NC = colPos.length;

  const footings = new THREE.InstancedMesh(TX.boxUV(new THREE.BoxGeometry(1.8, 2.6, 1.8), 1.8, 2.6, 1.8), M.concrete, NC);
  footings.castShadow = footings.receiveShadow = true;
  root.add(footings);

  const slab0 = new THREE.Mesh(TX.boxUV(new THREE.BoxGeometry(W + 1, 0.5, D + 1), W + 1, 0.5, D + 1, 3), M.slab);
  slab0.castShadow = slab0.receiveShadow = true;
  slab0.userData.edges = true;
  root.add(slab0);
  edgeSources.push(slab0);

  // Dust
  const DUST = mobile ? 160 : 380;
  const dustGeo = new THREE.BufferGeometry();
  const dustBase = new Float32Array(DUST * 3);
  const dustPos = new Float32Array(DUST * 3);
  {
    const r = rng(7);
    for (let i = 0; i < DUST; i++) {
      dustBase[i * 3] = (r() - 0.5) * 40;
      dustBase[i * 3 + 1] = r() * 8;
      dustBase[i * 3 + 2] = (r() - 0.5) * 30;
    }
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    size: 0.35,
    map: dotTexture(),
    color: 0xd9c9ae,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  root.add(dust);

  // ---------- Structure ----------
  const COLS = NC * F;
  const COL_H = FH - 0.32;
  const columns = new THREE.InstancedMesh(TX.boxUV(new THREE.BoxGeometry(0.42, COL_H, 0.42), 0.42, COL_H, 0.42), M.concrete, COLS);
  columns.castShadow = columns.receiveShadow = true;
  root.add(columns);

  // Beams (unit length along X; rotated for Z beams)
  const beamSpecs = [];
  for (let f = 1; f <= F; f++) {
    for (let j = 0; j <= BZ; j++)
      for (let i = 0; i < BX; i++) beamSpecs.push({ f, dir: 'x', x: X0 + (i + 0.5) * BAY_X, z: Z0 + j * BAY_Z, len: BAY_X - 0.42, k: i + j * BX });
    for (let i = 0; i <= BX; i++)
      for (let j = 0; j < BZ; j++) beamSpecs.push({ f, dir: 'z', x: X0 + i * BAY_X, z: Z0 + (j + 0.5) * BAY_Z, len: BAY_Z - 0.42, k: j + i * BZ });
  }
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.46, 0.3), M.steel, beamSpecs.length);
  beams.castShadow = true;
  root.add(beams);

  const slabs = [];
  for (let f = 1; f <= F; f++) {
    const s = new THREE.Mesh(TX.boxUV(new THREE.BoxGeometry(W + 0.8, 0.32, D + 0.8), W + 0.8, 0.32, D + 0.8, 3), M.slab);
    s.geometry.translate((W + 0.8) / 2, 0, 0); // pivot on the west edge — decks are laid across
    s.castShadow = s.receiveShadow = true;
    s.userData.edges = true;
    root.add(s);
    slabs.push(s);
    edgeSources.push(s);
  }

  const coreH = F * FH + 1.6;
  const core = new THREE.Mesh(TX.boxUV(new THREE.BoxGeometry(3.6, coreH, 4.2), 3.6, coreH, 4.2), M.concrete);
  core.geometry.translate(0, coreH / 2, 0);
  core.position.set(X0 + 4.5 * BAY_X, 0, 0);
  core.castShadow = core.receiveShadow = true;
  core.userData.edges = true;
  root.add(core);
  edgeSources.push(core);

  // ---------- Tower crane ----------
  const crane = new THREE.Group();
  crane.position.copy(CRANE_POS);
  {
    const parts = [];
    const w = 1.7;
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const corners = [v(-w / 2, 0, -w / 2), v(w / 2, 0, -w / 2), v(w / 2, 0, w / 2), v(-w / 2, 0, w / 2)];
    for (const c of corners) parts.push(strut(c, v(c.x, CRANE_H, c.z), 0.16));
    const step = 2.2;
    for (let y = 0; y < CRANE_H - step; y += step) {
      for (let k = 0; k < 4; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 4];
        parts.push(strut(v(a.x, y, a.z), v(b.x, y + step, b.z), 0.07));
        parts.push(strut(v(a.x, y + step, a.z), v(b.x, y + step, b.z), 0.07));
      }
    }
    const mast = new THREE.Mesh(mergeGeometries(parts), M.crane);
    mast.castShadow = true;
    crane.add(mast);

    const slew = new THREE.Group();
    slew.position.y = CRANE_H;
    const jp = [];
    const L = 42;
    const CL = 12;
    const jh = 1.6;
    // jib: two bottom chords + top chord, diagonals
    jp.push(strut(v(-CL, 0, -0.7), v(L, 0, -0.7), 0.14));
    jp.push(strut(v(-CL, 0, 0.7), v(L, 0, 0.7), 0.14));
    jp.push(strut(v(-CL, jh, 0), v(L, jh * 0.4, 0), 0.14));
    for (let x = -CL; x < L; x += 2.4) {
      const yTop = x < 0 ? jh : lerp(jh, jh * 0.4, x / L);
      jp.push(strut(v(x, 0, -0.7), v(x + 1.2, yTop, 0), 0.06));
      jp.push(strut(v(x, 0, 0.7), v(x + 1.2, yTop, 0), 0.06));
      jp.push(strut(v(x + 1.2, yTop, 0), v(x + 2.4, 0, -0.7), 0.06));
      jp.push(strut(v(x + 1.2, yTop, 0), v(x + 2.4, 0, 0.7), 0.06));
    }
    // tower head + pendants
    jp.push(strut(v(0, 0, 0), v(0, 7, 0), 0.3));
    jp.push(strut(v(0, 7, 0), v(L * 0.62, jh * 0.6, 0), 0.05));
    jp.push(strut(v(0, 7, 0), v(-CL + 0.5, jh, 0), 0.05));
    const jib = new THREE.Mesh(mergeGeometries(jp), M.crane);
    jib.castShadow = true;
    slew.add(jib);
    const cw = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 2.2), M.craneDark);
    cw.position.set(-CL + 2, -0.6, 0);
    cw.castShadow = true;
    slew.add(cw);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1.8), M.craneDark);
    cab.position.set(1.6, -1.2, 1.5);
    slew.add(cab);

    const trolley = new THREE.Group();
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), M.craneDark);
    cable.geometry.translate(0, -0.5, 0);
    trolley.add(cable);
    const hook = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), M.crane);
    hook.add(block);
    const load = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.44, 0.3), M.steel);
    load.position.y = -1.6;
    load.castShadow = true;
    hook.add(load);
    trolley.add(hook);
    slew.add(trolley);
    crane.userData = { slew, trolley, cable, hook, load };
    crane.add(slew);
  }
  root.add(crane);

  // ---------- Facade ----------
  const bays = []; // {x,z,f,ry,w,side,ord}
  let ord = 0;
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < BX; i++) bays.push({ f, x: X0 + (i + 0.5) * BAY_X, z: -Z0 + 0.32, ry: 0, w: BAY_X, n: [0, 1], ord: ord++ });
    for (let j = 0; j < BZ; j++) bays.push({ f, x: -X0 + 0.32, z: -Z0 - (j + 0.5) * BAY_Z, ry: Math.PI / 2, w: BAY_Z, n: [1, 0], ord: ord++ });
    for (let i = 0; i < BX; i++) bays.push({ f, x: -X0 - (i + 0.5) * BAY_X, z: Z0 - 0.32, ry: Math.PI, w: BAY_X, n: [0, -1], ord: ord++ });
    for (let j = 0; j < BZ; j++) bays.push({ f, x: X0 - 0.32, z: Z0 + (j + 0.5) * BAY_Z, ry: -Math.PI / 2, w: BAY_Z, n: [-1, 0], ord: ord++ });
  }
  const NB = bays.length;
  const spandrelBays = bays.filter((b) => b.f > 0);
  const spandrels = new THREE.InstancedMesh(TX.boxUV(new THREE.BoxGeometry(1, 1, 0.26), 4, 1.1, 0.26, 2.2), M.panel, spandrelBays.length);
  spandrels.castShadow = spandrels.receiveShadow = true;
  root.add(spandrels);

  const litR = rng(11);
  const glassDarkBays = [];
  const glassLitBays = [];
  for (const b of bays) (litR() < 0.62 ? glassLitBays : glassDarkBays).push(b);
  const glassDark = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.08), M.glass, glassDarkBays.length);
  const glassLit = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.08), M.glassLit, glassLitBays.length);
  root.add(glassDark, glassLit);

  // Timber fins on bay lines — full height, Nordic vertical rhythm
  const fins = [];
  const BALC_BAYS = [1, 4]; // street-facing balconies (bay index along x)
  const balcX = BALC_BAYS.map((i) => X0 + (i + 0.5) * BAY_X);
  for (let i = 0; i <= BX * 2; i++) {
    const fx = X0 + i * (BAY_X / 2);
    if (!balcX.some((bx) => Math.abs(bx - fx) < 0.01)) fins.push({ x: fx, z: -Z0 + 0.62, ry: 0 });
    fins.push({ x: X0 + i * (BAY_X / 2), z: Z0 - 0.62, ry: 0 });
  }
  for (let j = 0; j <= BZ * 2; j++) {
    fins.push({ x: -X0 + 0.62, z: Z0 + j * (BAY_Z / 2), ry: Math.PI / 2 });
    fins.push({ x: X0 - 0.62, z: Z0 + j * (BAY_Z / 2), ry: Math.PI / 2 });
  }
  const FIN_H = F * FH + 0.1;
  const finMesh = new THREE.InstancedMesh(TX.boxUV(new THREE.BoxGeometry(0.14, FIN_H, 0.56), 0.14, FIN_H, 0.56, 1.4), M.wood, fins.length);
  finMesh.castShadow = true;
  root.add(finMesh);

  // Window frames (head, sill, jambs, centre mullion) — constant section, per bay
  const FRAME_PARTS = 5;
  const frames = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.frame, NB * FRAME_PARTS);
  frames.castShadow = true;
  root.add(frames);
  // Pressed-metal sills under upper-floor windows
  const sills = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 0.26), M.sill, spandrelBays.length);
  sills.castShadow = true;
  root.add(sills);
  // Balconies: slab, glass balustrade (front + sides), steel handrail
  const balconies = [];
  for (let f = 1; f < F; f++) for (const bx of balcX) balconies.push({ f, x: bx });
  const NBAL = balconies.length;
  const BAL_W = 3.5;
  const BAL_D = 1.6;
  const balSlab = new THREE.InstancedMesh(TX.boxUV(new THREE.BoxGeometry(BAL_W, 0.2, BAL_D), BAL_W, 0.2, BAL_D, 2.2), M.panel, NBAL);
  const balGlass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.railGlass, NBAL * 3);
  const balRail = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.frame, NBAL * 3);
  balSlab.castShadow = balSlab.receiveShadow = true;
  balGlass.renderOrder = 5;
  root.add(balSlab, balGlass, balRail);
  // Entrance canopy — timber soffit over the main door
  const canopy = new THREE.Mesh(TX.boxUV(new THREE.BoxGeometry(8, 0.4, 3), 8, 0.4, 3, 1.4), M.wood);
  canopy.castShadow = true;
  canopy.userData.edges = true;
  root.add(canopy);
  edgeSources.push(canopy);

  // Roof: parapet + plant + solar
  const roof = new THREE.Group();
  const parapetGeo = mergeGeometries([
    TX.boxUV(new THREE.BoxGeometry(W + 1.4, 0.9, 0.3), W + 1.4, 0.9, 0.3, 2.2).translate(0, 0, D / 2 + 0.55),
    TX.boxUV(new THREE.BoxGeometry(W + 1.4, 0.9, 0.3), W + 1.4, 0.9, 0.3, 2.2).translate(0, 0, -D / 2 - 0.55),
    TX.boxUV(new THREE.BoxGeometry(0.3, 0.9, D + 1.4), 0.3, 0.9, D + 1.4, 2.2).translate(W / 2 + 0.55, 0, 0),
    TX.boxUV(new THREE.BoxGeometry(0.3, 0.9, D + 1.4), 0.3, 0.9, D + 1.4, 2.2).translate(-W / 2 - 0.55, 0, 0),
  ]);
  const parapet = new THREE.Mesh(parapetGeo, M.panel);
  parapet.position.y = TOP + 0.45;
  parapet.castShadow = true;
  parapet.userData.edges = true;
  roof.add(parapet);
  edgeSources.push(parapet);
  const plant = new THREE.Mesh(TX.boxUV(new THREE.BoxGeometry(5, 1.8, 3.2), 5, 1.8, 3.2, 2.2), M.panel);
  plant.position.set(6, TOP + 0.9, 0);
  plant.castShadow = true;
  plant.userData.edges = true;
  roof.add(plant);
  edgeSources.push(plant);
  const solarN = 18;
  const solar = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.06, 1.4), M.solar, solarN);
  for (let i = 0; i < solarN; i++) {
    const cx = X0 + 3 + (i % 6) * 2.9;
    const cz = -4 + Math.floor(i / 6) * 2.6;
    setInst(solar, i, cx, TOP + 0.5, cz, 1, 1, 1, 0, -0.35);
  }
  solar.castShadow = true;
  roof.add(solar);
  root.add(roof);

  // ---------- Landscape ----------
  const plaza = new THREE.Mesh(TX.planeUV(new THREE.PlaneGeometry(44, 30), 44, 30, 4.8), M.plaza);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.03, 2);
  plaza.receiveShadow = true;
  root.add(plaza);

  const road = new THREE.Mesh(TX.planeUV(new THREE.PlaneGeometry(260, 8), 260, 8, 4), M.asphalt);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.04, 23);
  road.receiveShadow = true;
  root.add(road);
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.02, 0.18), M.marking, 30);
  for (let i = 0; i < 30; i++) setInst(dashes, i, -120 + i * 8.2, 0.06, 23, 1, 1, 1);
  root.add(dashes);

  const R = rng(3);
  const trees = [];
  const TREE_N = mobile ? 26 : 54;
  let guard = 0;
  while (trees.length < TREE_N && guard++ < 2000) {
    const x = (R() - 0.5) * 110;
    const z = -44 + R() * 62;
    if (Math.abs(x) < 23 && z > -17 && z < 17.5) continue; // plaza & building
    if (z > 17.5 && z < 29) continue; // road
    if (Math.hypot(x - CRANE_POS.x, z - CRANE_POS.z) < 4) continue;
    const s = 0.75 + R() * 0.7;
    trees.push({ x, z, s, h: 5 + R() * 4, birch: R() < 0.35, d: Math.hypot(x, z) });
  }
  // Street trees along the entrance
  for (let i = 0; i < 6; i++) trees.push({ x: -21 + i * 8.4, z: 15.5, s: 0.8, h: 6, birch: i % 2 === 0, d: 20 + i });
  trees.sort((a, b) => a.d - b.d);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 1, 6).translate(0, 0.5, 0), M.trunk, trees.length);
  const crownGeo = (() => {
    const blobs = [
      [0, 0, 0, 1],
      [0.45, 0.35, 0.2, 0.7],
      [-0.4, 0.25, -0.25, 0.72],
      [0.05, 0.62, -0.1, 0.6],
    ].map(([x, y, z, r], bi) => {
      const g = mergeVertices(new THREE.IcosahedronGeometry(r, 3).deleteAttribute('normal').deleteAttribute('uv'));
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = 1 + 0.14 * Math.sin(v.x * 5.1 + bi) * Math.cos(v.y * 4.3 - bi) + 0.08 * Math.sin(v.z * 7.7);
        v.multiplyScalar(n).add(new THREE.Vector3(x, y, z));
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      return g;
    });
    const merged = mergeGeometries(blobs);
    merged.computeVertexNormals();
    merged.scale(0.82, 0.82, 0.82);
    return merged;
  })();
  const crowns = new THREE.InstancedMesh(crownGeo, M.crown, trees.length);
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  const cA = new THREE.Color(0x3c4733);
  const cB = new THREE.Color(0x55603f);
  const cBirch = new THREE.Color(0x6e7148);
  trees.forEach((tr, i) => {
    const c = tr.birch ? cBirch.clone() : cA.clone().lerp(cB, R());
    crowns.setColorAt(i, c);
  });
  root.add(trunks, crowns);

  const lamps = [];
  for (let i = 0; i < 12; i++) lamps.push({ x: -55 + i * 10, z: 18.4 });
  const lampPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 5).translate(0, 2.5, 0), M.lamp, lamps.length);
  const lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.16, 0.3), M.lampHead, lamps.length);
  root.add(lampPoles, lampHeads);

  const PEOPLE = mobile ? 16 : 34;
  const people = [];
  const peopleMesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 1.15, 3, 6), M.people, PEOPLE);
  peopleMesh.castShadow = true;
  const pr = rng(21);
  const tones = [0x24292c, 0x3d3833, 0x4f5457, 0x5e4a3b, 0x1f2a36, 0x6d685f];
  for (let i = 0; i < PEOPLE; i++) {
    const onRoadside = pr() < 0.35;
    people.push({
      x: (pr() - 0.5) * 40,
      z: onRoadside ? 17 + pr() * 1.2 : 8 + pr() * 7,
      v: (pr() < 0.5 ? -1 : 1) * (0.5 + pr() * 0.8) * (pr() < 0.25 ? 0 : 1),
      s: 0.9 + pr() * 0.15,
      d: pr(),
    });
    peopleMesh.setColorAt(i, new THREE.Color(tones[i % tones.length]));
  }
  root.add(peopleMesh);

  // ---------- Blueprint pass: paper overlay + detected edges ----------
  const paperMat = new THREE.ShaderMaterial({
    toneMapped: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xf4f3ef) },
      uBlue: { value: new THREE.Color(0x10283b) },
      uInk: { value: new THREE.Color(0x161b1d) },
      uAccent: { value: new THREE.Color(0xc8663a) },
      uGridAmt: { value: 0 },
      uWipe: { value: 0 },
      uInkAmt: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor; uniform vec3 uBlue; uniform vec3 uInk; uniform vec3 uAccent;
      uniform float uGridAmt; uniform float uWipe; uniform float uInkAmt; uniform vec2 uRes;
      void main(){
        vec2 p = gl_FragCoord.xy;
        float s = uRes.y / 28.0;
        vec2 g = abs(fract(p / s - 0.5) - 0.5) * s;
        float minor = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y));
        vec2 g2 = abs(fract(p / (s * 5.0) - 0.5) - 0.5) * s * 5.0;
        float major = 1.0 - smoothstep(0.0, 1.2, min(g2.x, g2.y));
        vec2 uv = gl_FragCoord.xy / uRes;
        float vig = smoothstep(1.2, 0.3, length(uv - 0.5));
        // Bottom-up wipe: paper → blueprint, with a thin copper developing edge
        float front = uWipe * 1.2 - 0.1;
        float y = uv.y + sin(uv.x * 7.0) * 0.008;
        float blue = smoothstep(front + 0.004, front - 0.004, y);
        float edge = (1.0 - smoothstep(0.0, 0.004, abs(y - front))) * step(0.001, uWipe) * step(uWipe, 0.999);
        vec3 paperCol = mix(uColor, vec3(0.043, 0.067, 0.075), (minor * 0.05 + major * 0.1) * uGridAmt);
        vec3 blueCol = mix(uBlue, vec3(0.61, 0.78, 0.9), (minor * 0.07 + major * 0.16) * uGridAmt);
        vec3 col = mix(paperCol, blueCol, blue);
        col = mix(col, uAccent, edge);
        col = mix(col, uInk, uInkAmt);
        col *= mix(0.92, 1.0, vig);
        gl_FragColor = vec4(col, uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), paperMat);
  paper.frustumCulled = false;
  paper.renderOrder = 998;
  scene.add(paper);

  const edgeMat = new THREE.ShaderMaterial({
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0x1d2427) },
      uLight: { value: new THREE.Color(0xdcebf6) },
      uWipe: { value: 0 },
      uSweep: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uAccent: { value: new THREE.Color(0xc8663a) },
    },
    vertexShader: /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor; uniform vec3 uLight; uniform float uWipe; uniform float uSweep; uniform vec2 uRes; uniform vec3 uAccent;
      void main(){
        float x = gl_FragCoord.x / uRes.x;
        vec2 uv = gl_FragCoord.xy / uRes;
        float wf = uWipe * 1.2 - 0.1;
        float lightK = smoothstep(wf + 0.004, wf - 0.004, uv.y + sin(uv.x * 7.0) * 0.008);
        float front = uSweep * 1.3 - 0.15;
        float on = smoothstep(front + 0.02, front - 0.02, x);
        float glow = smoothstep(0.12, 0.0, abs(x - front)) * (1.0 - step(1.0, uSweep));
        vec3 col = mix(mix(uColor, uLight, lightK), uAccent, glow);
        gl_FragColor = vec4(col, max(on, glow) * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  let edgeLines = null;

  // ---------- Camera path ----------
  const K = [
    { t: 0.0, p: [52, 46, 60], l: [0, 0, 0] },
    { t: 0.1, p: [30, 50, 36], l: [0, 0, 1] },
    { t: 0.2, p: [-6, 28, 48], l: [0, 5, 0] },
    { t: 0.3, p: [-26, 7.5, 30], l: [0, -0.5, 0] },
    { t: 0.4, p: [-34, 11, 24], l: [0, 3, 0] },
    { t: 0.5, p: [-26, 19, 38], l: [0, 7, 0] },
    { t: 0.6, p: [12, 17, 54], l: [0, 8.5, 0] },
    { t: 0.7, p: [38, 10, 36], l: [0, 8, 0] },
    { t: 0.8, p: [50, 17, 60], l: [0, 7, 0] },
    { t: 0.865, p: [48, 16.5, 58], l: [0, 7, 0] },
    { t: 0.93, p: [47, 16, 57], l: [0, 7, 0] },
    { t: 1.0, p: [7, 8.5, 12], l: [-2, 7.6, -2] },
  ];
  const camCurve = new THREE.CatmullRomCurve3(K.map((k) => new THREE.Vector3(...k.p)), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(K.map((k) => new THREE.Vector3(...k.l)), false, 'centripetal');
  const camU = (t) => {
    for (let i = 0; i < K.length - 1; i++) {
      if (t <= K[i + 1].t) {
        const k = (t - K[i].t) / (K[i + 1].t - K[i].t);
        return (i + ease.smooth(clamp01(k)) * 0.5 + clamp01(k) * 0.5) / (K.length - 1);
      }
    }
    return 1;
  };

  // ---------- 3D anchored labels ----------
  const labelDefs = [
    { p: [0, 0, -Z0 + 9], text: '24 000', win: [0.06, 0.28] },
    { p: [X0 - 9, 0, 0], text: '13 500', win: [0.07, 0.28] },
    { p: [34, 0, -30], text: 'Tomt <b>12 400 m²</b>', win: [0.05, 0.24] },
    { p: [X0, 0, Z0], text: '±0.00 <b>RH2000 +14.2</b>', win: [0.08, 0.26] },
    { p: [-X0 + 4, F * FH, -Z0 + 4], text: '+18.00 <b>Vån 5</b>', win: [0.16, 0.27] },
    { p: [0, F * FH * 0.5, -Z0], text: 'BIM <b>LOD 300</b>', win: [0.17, 0.26] },
    { p: [PIT_W / 2, -PIT_H, PIT_D / 2], text: 'Schakt <b>−3.00</b>', win: [0.28, 0.4] },
    { p: [0, 0.3, D / 2 + 0.5], text: 'Platta <b>500 mm</b>', win: [0.33, 0.41] },
    { p: [X0, FH * 2, -Z0], text: 'Pelare <b>400×400</b>', win: [0.45, 0.58] },
    { p: [-X0, FH * 3, 0], text: 'HSQ-balk <b>S355</b>', win: [0.49, 0.58] },
    { p: [-X0 + 0.5, FH * 3.2, -Z0 + 0.6], text: 'Fasad <b>Trä / glas</b>', win: [0.62, 0.72] },
    { p: [X0 + 3, TOP + 0.8, -4], text: 'Solceller <b>86 kWp</b>', win: [0.66, 0.72] },
  ];
  let labelEls = [];
  const labelVec = new THREE.Vector3();

  // ---------- State ----------
  let width = 1;
  let height = 1;
  let tTarget = 0;
  let tNow = 0;
  let lastApplied = -1;
  let clock = 0;
  let freeze = 0;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const cPos = new THREE.Vector3();
  const cTgt = new THREE.Vector3();
  const colNight = new THREE.Color(0x0b1113);
  const colDay = new THREE.Color(0xd8b48a);
  const tmpC = new THREE.Color();
  const groundNight = new THREE.Color(0x2a3236);
  const groundDay = new THREE.Color(0xd9d6c6);
  const sunNight = new THREE.Color(0x9fb8d0);
  const sunDay = new THREE.Color(0xffc98e);

  // ---------- Apply timeline ----------
  function apply(t) {
    const pIdea = range(t, T.idea);
    const pPlan = range(t, T.plan);
    const pGround = range(t, T.ground);
    const pFrame = range(t, T.frame);
    const pFacade = range(t, T.facade);
    const pResult = range(t, T.result);
    const pBp = range(t, T.blueprint);
    const pIntro = range(t, [0, 0.06]);

    // Grid + plan
    gridMat.uniforms.uReveal.value = ease.out(clamp01(pIntro * 0.6 + pIdea * 0.8));
    gridMat.uniforms.uOpacity.value = (1 - sub(pGround, 0.5, 1)) * 0.9;
    planGeo.setDrawRange(0, Math.floor(ease.inOut(sub(pIdea, 0.02, 0.92)) * planVerts / 2) * 2);
    const bpLines = sub(pBp, 0.45, 0.6) * (1 - sub(pBp, 0.85, 0.98));
    planMat.opacity = Math.max(sub(pIdea, 0, 0.1) * (1 - sub(pFrame, 0.1, 0.6) * 0.85) * (1 - pResult), bpLines * 0.8);
    planMat.color.set(pBp > 0.4 ? 0xd6e8f5 : 0xb5d4e8);

    // Wireframe rises out of the ground
    const wUp = ease.inOut(sub(pPlan, 0.05, 0.75));
    wireGroup.scale.set(1, Math.max(0.001, wUp), 1);
    wireMat.opacity = sub(pPlan, 0, 0.15) * (1 - sub(pGround, 0.1, 0.5) * 0.45) * (1 - sub(pFrame, 0.1, 0.8) * 0.8) * (1 - sub(pFacade, 0.2, 0.7)) * 0.95;
    scan.position.y = lerp(0.05, F * FH - 0.05, sub(pPlan, 0.4, 0.95)) / Math.max(0.001, wUp);
    scanMat.opacity = sub(pPlan, 0.35, 0.5) * (1 - sub(pPlan, 0.92, 1)) * 0.12;
    scan.visible = scanEdge.visible = scanMat.opacity > 0.001;
    scanEdge.position.y = scan.position.y;

    // Excavation
    M.lid.opacity = 1 - sub(pGround, 0.02, 0.18) * (1 - sub(pGround, 0.86, 1));
    M.lid.transparent = M.lid.opacity < 0.999;
    lid.visible = M.lid.opacity > 0.001;
    pit.visible = pGround > 0.01;

    for (let i = 0; i < NC; i++) {
      const k = ease.outBack(sub(pGround, 0.2 + (i / NC) * 0.25, 0.38 + (i / NC) * 0.25));
      setInst(footings, i, colPos[i][0], lerp(-6, -1.5, k), colPos[i][1], 1, pGround > 0.2 ? 1 : 0, 1);
    }
    footings.instanceMatrix.needsUpdate = true;

    const sk = ease.out(sub(pGround, 0.55, 0.86));
    slab0.position.y = lerp(-3.2, 0.05, sk);
    slab0.visible = pGround > 0.55;

    // Dust (animated with the clock, amount by scroll)
    dustMat.opacity = Math.sin(Math.PI * sub(pGround, 0.15, 1)) * 0.55 + Math.sin(Math.PI * sub(pFrame, 0, 0.5)) * 0.15;

    // Crane: erected during ground stage, dismantled during handover
    const craneUp = ease.inOut(sub(pGround, 0.1, 0.6)) * (1 - ease.inOut(sub(pResult, 0.05, 0.45)));
    crane.visible = craneUp > 0.005;
    crane.scale.set(1, Math.max(0.001, craneUp), 1);
    const { slew, trolley, cable, hook, load } = crane.userData;
    // Jib aims at the working area — derived from scroll, not time.
    const workFloor = Math.min(F - 1, Math.floor(pFrame * F));
    const aim = -0.55 + pFrame * 1.3 + Math.sin(pFrame * F * Math.PI) * 0.22 + pFacade * 0.9;
    slew.rotation.y = aim;
    const reach = 22 + Math.sin(pFrame * F * Math.PI * 2) * 6 + pFacade * 4;
    trolley.position.x = reach;
    const hookY = -lerp(CRANE_H - (workFloor + 1) * FH - 2.5, 6, sub(pFacade, 0.3, 1)) + Math.sin(pFrame * 30) * 0.8;
    cable.scale.y = -hookY;
    hook.position.y = hookY - 0.4;
    load.visible = pFrame > 0.02 && pFrame < 0.98;
    load.rotation.y = -aim * 0.6;

    // Frame
    for (let f = 0; f < F; f++) {
      const a = f / F;
      const q = sub(pFrame, a * 0.92, a * 0.92 + 0.3);
      for (let c = 0; c < NC; c++) {
        const cq = ease.inOut(sub(q, (c / NC) * 0.25, (c / NC) * 0.25 + 0.2));
        const sy = COL_H * cq;
        setInst(columns, f * NC + c, colPos[c][0], f * FH + 0.3 + sy / 2, colPos[c][1], 1, cq, 1);
      }
    }
    columns.instanceMatrix.needsUpdate = true;

    beamSpecs.forEach((b, i) => {
      const a = (b.f - 1) / F;
      const q = sub(pFrame, a * 0.92 + 0.08, a * 0.92 + 0.34);
      const kk = ease.out(sub(q, (b.k / 24) * 0.5, (b.k / 24) * 0.5 + 0.5));
      const y = b.f * FH - 0.1;
      const side = b.k % 2 ? 1 : -1;
      const off = (1 - kk) * 26;
      const lift = (1 - kk) * 7;
      if (b.dir === 'x') setInst(beams, i, b.x + side * off, y + lift, b.z, kk > 0 ? b.len : 0, 1, 1);
      else setInst(beams, i, b.x, y + lift, b.z + side * off, kk > 0 ? b.len : 0, 1, 1, Math.PI / 2);
    });
    beams.instanceMatrix.needsUpdate = true;

    slabs.forEach((s, i) => {
      const a = i / F;
      const q = ease.inOut(sub(pFrame, a * 0.92 + 0.2, a * 0.92 + 0.36));
      s.visible = q > 0.001;
      s.scale.x = Math.max(0.001, q);
      s.position.set(X0 - 0.4, (i + 1) * FH + 0.14, 0);
    });

    const coreK = ease.inOut(sub(pFrame, 0, 0.95));
    core.visible = pFrame > 0.001;
    core.scale.y = Math.max(0.001, coreK);
    core.position.y = 0.3;

    // Facade
    spandrelBays.forEach((b, i) => {
      const k = ease.out(sub(pFacade, (b.ord / NB) * 0.55, (b.ord / NB) * 0.55 + 0.14));
      const out = (1 - k) * 3.2;
      const y = b.f * FH + 0.3 + 0.55;
      setInst(spandrels, i, b.x + b.n[0] * out, y - (1 - k) * 1.5, b.z + b.n[1] * out, k > 0 ? b.w - 0.08 : 0, 1.1, 1, b.ry);
    });
    spandrels.instanceMatrix.needsUpdate = true;

    const placeGlass = (mesh, list) => {
      list.forEach((b, i) => {
        const k = ease.inOut(sub(pFacade, 0.2 + (b.ord / NB) * 0.55, 0.2 + (b.ord / NB) * 0.55 + 0.14));
        const gh = b.f === 0 ? FH - 0.55 : FH - 1.55;
        const base = b.f * FH + 0.3 + (b.f === 0 ? 0.05 : 1.1);
        const y = base + gh / 2 + (1 - k) * 2.2;
        setInst(mesh, i, b.x - b.n[0] * 0.08, y, b.z - b.n[1] * 0.08, b.w - 0.3, k > 0.002 ? gh * k : 0, 1, b.ry);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    placeGlass(glassDark, glassDarkBays);
    placeGlass(glassLit, glassLitBays);

    fins.forEach((fn, i) => {
      const k = ease.out(sub(pFacade, 0.45 + (i / fins.length) * 0.35, 0.6 + (i / fins.length) * 0.35));
      const h = FIN_H * k;
      setInst(finMesh, i, fn.x, 0.3 + h / 2, fn.z, 1, k, 1, fn.ry);
    });
    finMesh.instanceMatrix.needsUpdate = true;

    // Frames follow the glass; sills follow the spandrels
    bays.forEach((b, i) => {
      const k = ease.inOut(sub(pFacade, 0.24 + (b.ord / NB) * 0.55, 0.24 + (b.ord / NB) * 0.55 + 0.14));
      const gh = b.f === 0 ? FH - 0.55 : FH - 1.55;
      const base = b.f * FH + 0.3 + (b.f === 0 ? 0.05 : 1.1);
      const w = b.w - 0.3;
      const cy = base + gh / 2 + (1 - k) * 2.2;
      const ox = -b.n[0] * 0.03;
      const oz = -b.n[1] * 0.03;
      const along = (d) => [b.x + (b.n[1] !== 0 ? d : 0) + ox, b.z + (b.n[0] !== 0 ? -d * Math.sign(b.n[0]) : 0) + oz];
      const on = k > 0.002;
      const t = 0.075;
      const j = i * FRAME_PARTS;
      let [x, z] = along(0);
      setInst(frames, j, x, cy + gh / 2, z, on ? w + t : 0, t, 0.12, b.ry);
      setInst(frames, j + 1, x, cy - gh / 2, z, on ? w + t : 0, t, 0.12, b.ry);
      [x, z] = along(w / 2);
      setInst(frames, j + 2, x, cy, z, on ? t : 0, gh, 0.12, b.ry);
      [x, z] = along(-w / 2);
      setInst(frames, j + 3, x, cy, z, on ? t : 0, gh, 0.12, b.ry);
      [x, z] = along(0);
      setInst(frames, j + 4, x, cy, z, on ? 0.05 : 0, gh, 0.1, b.ry);
    });
    frames.instanceMatrix.needsUpdate = true;

    spandrelBays.forEach((b, i) => {
      const k = ease.out(sub(pFacade, 0.3 + (b.ord / NB) * 0.55, 0.3 + (b.ord / NB) * 0.55 + 0.14));
      const y = b.f * FH + 0.3 + 1.1 - 0.02;
      setInst(sills, i, b.x + b.n[0] * 0.12, y, b.z + b.n[1] * 0.12, k > 0.002 ? b.w - 0.25 : 0, 1, 1, b.ry);
    });
    sills.instanceMatrix.needsUpdate = true;

    balconies.forEach((bl, i) => {
      const k = ease.out(sub(pFacade, 0.5 + (i / NBAL) * 0.3, 0.64 + (i / NBAL) * 0.3));
      const on = k > 0.002;
      const zf = -Z0 + 0.3;
      const d = BAL_D * k;
      const y = bl.f * FH + 0.2;
      setInst(balSlab, i, bl.x, y, zf + d / 2, on ? 1 : 0, 1, on ? k : 0);
      const gy = y + 0.1 + 0.55;
      const gk = sub(k, 0.6, 1);
      const g = i * 3;
      const gOn = gk > 0.002;
      setInst(balGlass, g, bl.x, gy, zf + d - 0.05, gOn ? BAL_W - 0.1 : 0, 1.0 * gk, 0.025);
      setInst(balGlass, g + 1, bl.x - BAL_W / 2 + 0.05, gy, zf + d / 2, gOn ? 0.025 : 0, 1.0 * gk, d - 0.1);
      setInst(balGlass, g + 2, bl.x + BAL_W / 2 - 0.05, gy, zf + d / 2, gOn ? 0.025 : 0, 1.0 * gk, d - 0.1);
      const ry2 = y + 0.1 + 1.08 * gk;
      setInst(balRail, g, bl.x, ry2, zf + d - 0.05, gOn ? BAL_W : 0, 0.05, 0.06);
      setInst(balRail, g + 1, bl.x - BAL_W / 2 + 0.05, ry2, zf + d / 2, gOn ? 0.06 : 0, 0.05, d);
      setInst(balRail, g + 2, bl.x + BAL_W / 2 - 0.05, ry2, zf + d / 2, gOn ? 0.06 : 0, 0.05, d);
    });
    balSlab.instanceMatrix.needsUpdate = balGlass.instanceMatrix.needsUpdate = balRail.instanceMatrix.needsUpdate = true;

    const ck = ease.out(sub(pFacade, 0.82, 1));
    canopy.visible = ck > 0.002;
    canopy.scale.set(1, 1, Math.max(0.001, ck));
    canopy.position.set(0, 3.55, -Z0 + 0.3 + 1.5 * ck);

    const roofK = ease.out(sub(pFacade, 0.78, 1));
    roof.visible = roofK > 0.001;
    roof.position.y = (1 - roofK) * 4;
    roof.scale.setScalar(Math.max(0.001, 0.9 + roofK * 0.1));

    // Raw → finished material shift
    M.concrete.color.set(0xe0ddd5).lerp(tmpC.set(0xf6f3ec), pFacade);

    // Result — landscape, light, life
    const day = ease.inOut(sub(pResult, 0.0, 0.8));
    skyMat.uniforms.uDay.value = day;
    tmpC.copy(colNight).lerp(colDay, day);
    fog.color.copy(tmpC);
    fog.near = lerp(90, 120, day);
    fog.far = lerp(320, 420, day);
    M.ground.color.copy(groundNight).lerp(groundDay, day);
    M.lid.color.copy(M.ground.color);
    M.plaza.opacity = ease.out(sub(pResult, 0.15, 0.55));
    M.plaza.transparent = M.plaza.opacity < 0.999;
    plaza.visible = M.plaza.opacity > 0.001;
    M.asphalt.opacity = ease.out(sub(pResult, 0.1, 0.5));
    M.asphalt.transparent = M.asphalt.opacity < 0.999;
    M.marking.opacity = M.asphalt.opacity;
    road.visible = dashes.visible = M.asphalt.opacity > 0.001;

    // Night stages: cool, neutral fill; the warm HDRI takes over as the sun comes up.
    const warm = envSunset && day > 0.3;
    scene.environment = warm ? envSunset : envNeutral;
    scene.environmentIntensity = warm ? lerp(0.55, 1.0, sub(day, 0.3, 1)) : lerp(0.75, 0.6, day / 0.3);
    hemi.intensity = lerp(0.45, 0.3, day);
    hemi.color.set(0x9fb6c8).lerp(tmpC.set(0xcfd8e0), day);
    hemi.groundColor.set(0x1a1a18).lerp(tmpC.set(0x5d5140), day);
    sun.intensity = lerp(0.9, 3.4, day);
    sun.color.copy(sunNight).lerp(sunDay, day);
    sun.position.set(lerp(40, 70, day), lerp(60, 20, day), lerp(30, -40, day));
    renderer.toneMappingExposure = lerp(1.05, TM_EXPOSURE, day);
    if (bloom) bloom.strength = lerp(0.08, 0.32, day);
    if (gtao) gtao.blendIntensity = 1 - sub(pBp, 0.02, 0.15);
    postOK = pBp < 0.18; // blueprint pass needs exact, untonemapped colours

    M.glassLit.emissiveIntensity = ease.inOut(sub(pResult, 0.35, 0.9)) * 0.85;
    M.lampHead.emissiveIntensity = ease.inOut(sub(pResult, 0.4, 0.9)) * 3;

    trees.forEach((tr, i) => {
      const k = ease.outBack(sub(pResult, 0.1 + (i / trees.length) * 0.5, 0.3 + (i / trees.length) * 0.5));
      setInst(trunks, i, tr.x, 0, tr.z, tr.s * k, tr.h * 0.45 * k, tr.s * k);
      setInst(crowns, i, tr.x, tr.h * 0.62 * k, tr.z, 1.7 * tr.s * k * (tr.birch ? 0.8 : 1), tr.h * 0.42 * k, 1.7 * tr.s * k * (tr.birch ? 0.8 : 1));
    });
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;

    lamps.forEach((l, i) => {
      const k = ease.out(sub(pResult, 0.2 + i * 0.02, 0.4 + i * 0.02));
      setInst(lampPoles, i, l.x, 0, l.z, 1, k, 1);
      setInst(lampHeads, i, l.x + 0.35, 5 * k, l.z, k, 1, 1);
    });
    lampPoles.instanceMatrix.needsUpdate = lampHeads.instanceMatrix.needsUpdate = true;

    peopleMesh.visible = pResult > 0.5;

    // Blueprint transition
    const toPaper = ease.inOut(sub(pBp, 0.22, 0.5));
    const toBlue = ease.inOut(sub(pBp, 0.5, 0.72));
    const toInk = ease.inOut(sub(pBp, 0.82, 1));
    paperMat.uniforms.uOpacity.value = toPaper;
    paper.visible = toPaper > 0.001;
    paperMat.uniforms.uWipe.value = toBlue;
    paperMat.uniforms.uInkAmt.value = toInk;
    paperMat.uniforms.uGridAmt.value = sub(pBp, 0.38, 0.55) * (1 - toInk);
    edgeMat.uniforms.uWipe.value = toBlue;
    edgeMat.uniforms.uSweep.value = ease.inOut(sub(pBp, 0.1, 0.42));
    edgeMat.uniforms.uOpacity.value = sub(pBp, 0.08, 0.14) * (1 - ease.inOut(sub(pBp, 0.8, 0.96)));
    if (edgeLines) edgeLines.visible = edgeMat.uniforms.uOpacity.value > 0.001;
    freeze = sub(pBp, 0, 0.12);

    // Camera
    const u = camU(t);
    camCurve.getPoint(u, cPos);
    tgtCurve.getPoint(u, cTgt);
    camera.fov = lerp(34, 62, ease.in(sub(pBp, 0.7, 1)));
    camera.updateProjectionMatrix();
  }

  function buildEdges() {
    // Evaluate the finished state and trace every hard edge for the drawing.
    apply(0.8);
    root.updateMatrixWorld(true);
    const out = [];
    const pushEdges = (geo, matrix, threshold = 20) => {
      const eg = new THREE.EdgesGeometry(geo, threshold);
      eg.applyMatrix4(matrix);
      const a = eg.attributes.position.array;
      for (let i = 0; i < a.length; i++) out.push(a[i]);
      eg.dispose();
    };
    for (const m of edgeSources) pushEdges(m.geometry, m.matrixWorld);
    const inst = [columns, spandrels, glassDark, glassLit, finMesh, trunks, solar, lampPoles, balSlab, balRail, sills];
    const im = new THREE.Matrix4();
    for (const mesh of inst) {
      const base = new THREE.EdgesGeometry(mesh.geometry, mesh === crowns ? 28 : 20);
      const a = base.attributes.position.array;
      const v = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, im);
        if (im.elements[0] === 0 && im.elements[5] === 0) continue;
        im.premultiply(mesh.parent.matrixWorld);
        for (let j = 0; j < a.length; j += 3) {
          v.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(im);
          out.push(v.x, v.y, v.z);
        }
      }
      base.dispose();
    }
    // Trees as architectural symbols: crossed elevations + plan ring
    trees.forEach((tr) => {
      const cx = tr.x;
      const cz = tr.z;
      const cy = tr.h * 0.62;
      const rx = 1.7 * tr.s * (tr.birch ? 0.8 : 1) * 1.2;
      const ry = tr.h * 0.42 * 1.2;
      const N = 18;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        out.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cz, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, cz);
        out.push(cx, cy + Math.sin(a0) * ry, cz + Math.cos(a0) * rx, cx, cy + Math.sin(a1) * ry, cz + Math.cos(a1) * rx);
        out.push(cx + Math.cos(a0) * rx, cy, cz + Math.sin(a0) * rx, cx + Math.cos(a1) * rx, cy, cz + Math.sin(a1) * rx);
      }
    });
    // Road + plaza outline
    const extra = [
      [-130, 19, 130, 19], [-130, 27, 130, 27],
      [-22, -13, 22, -13], [22, -13, 22, 17], [22, 17, -22, 17], [-22, 17, -22, -13],
    ];
    for (const [ax, az, bx, bz] of extra) out.push(ax, 0.05, az, bx, 0.05, bz);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    edgeLines = new THREE.LineSegments(g, edgeMat);
    edgeLines.frustumCulled = false;
    edgeLines.renderOrder = 999;
    edgeLines.visible = false;
    scene.add(edgeLines);
    lastApplied = -1;
  }

  function animateAmbient(dt) {
    const live = 1 - freeze;
    clock += dt * live;
    // Dust drift
    if (dustMat.opacity > 0.01) {
      for (let i = 0; i < DUST; i++) {
        const b = i * 3;
        dustPos[b] = dustBase[b] + Math.sin(clock * 0.3 + i) * 0.8;
        dustPos[b + 1] = (dustBase[b + 1] + clock * (0.25 + (i % 7) * 0.04)) % 8;
        dustPos[b + 2] = dustBase[b + 2] + Math.cos(clock * 0.25 + i * 1.3) * 0.8;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dust.visible = true;
    } else dust.visible = false;
    // People walking on the plaza
    if (peopleMesh.visible) {
      const pk = ease.out(sub(range(tNow, T.result), 0.5, 0.9));
      people.forEach((p, i) => {
        let x = p.x + p.v * clock * 0.6;
        x = ((((x + 26) % 52) + 52) % 52) - 26;
        const bob = Math.abs(Math.sin(clock * 5 * Math.abs(p.v) + p.d * 6)) * 0.04 * Math.min(1, Math.abs(p.v));
        const s = p.s * pk;
        setInst(peopleMesh, i, x, 0.8 * s + bob, p.z, s, s, s);
      });
      peopleMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    }
    camera.aspect = width / height;
    // Narrow screens: pull back so the building stays framed.
    camera.zoom = camera.aspect < 0.8 ? 0.6 : camera.aspect < 1.2 ? 0.8 : 1;
    // Portrait: lift the model into the upper part of the frame, clear of the stage text.
    if (camera.aspect < 0.8) camera.setViewOffset(width, height, 0, height * 0.14, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const px = renderer.getDrawingBufferSize(new THREE.Vector2());
    paperMat.uniforms.uRes.value.copy(px);
    edgeMat.uniforms.uRes.value.copy(px);
    lastApplied = -1;
  }

  function setLabels(container) {
    container.innerHTML = '';
    labelEls = labelDefs.map((d) => {
      const el = document.createElement('div');
      el.className = 'plabel';
      el.innerHTML = d.text;
      container.appendChild(el);
      return el;
    });
  }

  function updateLabels() {
    labelDefs.forEach((d, i) => {
      const el = labelEls[i];
      if (!el) return;
      const [a, b] = d.win;
      const vis = Math.min(sub(tNow, a, a + 0.015), 1 - sub(tNow, b - 0.015, b));
      if (vis <= 0.001) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        return;
      }
      labelVec.set(d.p[0], d.p[1], d.p[2]).project(camera);
      if (labelVec.z > 1) {
        el.style.opacity = '0';
        return;
      }
      const x = (labelVec.x * 0.5 + 0.5) * width;
      const y = (-labelVec.y * 0.5 + 0.5) * height;
      const inText = x < width * 0.4 && y > height * 0.56;
      const inChrome = x > width * 0.76 && (y < height * 0.3 || y > height * 0.62);
      el.style.opacity = String(inText || inChrome ? vis * 0.12 : vis);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
  }

  // ---------- Loop ----------
  let running = false;
  let raf = 0;
  let last = performance.now();
  let slowFrames = 0;
  let fastFrames = 0;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Heavy, controlled follow — progress glides toward the scroll position.
    const k = reduced ? 1 : 1 - Math.pow(0.0009, dt);
    tNow += (tTarget - tNow) * k;
    if (Math.abs(tTarget - tNow) < 0.00002) tNow = tTarget;

    if (Math.abs(tNow - lastApplied) > 0.00001) {
      apply(tNow);
      lastApplied = tNow;
    }
    animateAmbient(dt);

    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
    const drift = (1 - freeze) * (reduced ? 0 : 1);
    camera.position.set(cPos.x + mouse.sx * 1.4 * drift, cPos.y + mouse.sy * 0.8 * drift, cPos.z);
    camera.lookAt(cTgt);
    sun.target.position.set(0, 0, 0);

    updateLabels();
    if (composer && postOK) composer.render(dt);
    else renderer.render(scene, camera);

    // Adaptive resolution — keep the scene smooth on weaker GPUs.
    if (dt > 0.024) slowFrames++;
    else if (dt < 0.014) fastFrames++;
    if (slowFrames > 40 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      resize();
      slowFrames = fastFrames = 0;
    } else if (fastFrames > 240 && dpr < Math.min(window.devicePixelRatio || 1, maxDpr)) {
      dpr = Math.min(maxDpr, dpr + 0.25);
      renderer.setPixelRatio(dpr);
      resize();
      slowFrames = fastFrames = 0;
    }
  }

  resize();
  buildEdges();
  apply(0);

  return {
    setProgress(t) {
      tTarget = clamp01(t);
    },
    jump(t) {
      tTarget = tNow = clamp01(t);
    },
    setPointer(x, y) {
      mouse.x = x;
      mouse.y = y;
    },
    setLabels,
    resize,
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get progress() {
      return tNow;
    },
    dispose() {
      this.stop();
      renderer.dispose();
    },
  };
}
