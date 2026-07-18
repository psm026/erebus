/* ============================================================
   EREBUS v4 — the multi-world engine
   - Worlds are data files: world.json (main) + world-<id>.json (sub-worlds)
   - PORTALS: clickable structures that fade you into another world
   - Resilient: a malformed room is skipped and logged, never fatal
   - Winding spline flight, look-around camera, bloom, reflections
   - #w=<id> hash routing: portals are linkable, browser Back works
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// boot beacon: index.html rescues the page if this module never runs
window.__erebusBooted = true;

const PR_CAP = 1.5;
const VERSION = 4;

/* ---------- tuning ---------- */
const CONFIG = {
  segment: 34,
  weaveX: 14,
  weaveY: 4.5,
  camLerp: 0.055,
  paletteLerp: 0.035,
  lookYaw: 0.42,
  lookPitch: 0.22,
  bank: 0.55,
  starCount: 2000,
  dustPerStop: 70,
  bloom: { strength: 0.5, radius: 0.75, threshold: 0.25 },
};

const ROOM_DEFAULTS = {
  sector: 'EREBUS',
  accentA: '#8b7bff', accentB: '#7de8ff',
  fog: '#030307', nebulaA: '#1a1048', nebulaB: '#0a2a33', dust: '#8b7bff',
};

const canvas = document.getElementById('erebus');
const content = document.getElementById('content');
const hudIndex = document.getElementById('hud-index');
const hudSector = document.getElementById('hud-sector');
const hudTime = document.getElementById('hud-time');
const progressFill = document.getElementById('progress-fill');
const loaderCount = document.getElementById('loader-count');
const eggVeil = document.getElementById('egg-veil');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 720px)').matches;

const lerp = (a, b, t) => a + (b - a) * t;
const pad = (n) => String(n).padStart(2, '0');
const rand = (a, b) => a + Math.random() * (b - a);

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function fallback(err) {
  if (err) console.error('[erebus] falling back to static:', err);
  document.body.classList.add('no-webgl', 'world-ready');
  if (content && !content.children.length) {
    content.innerHTML = '<section class="panel intro is-active" style="position:static;opacity:1;transform:none;filter:none;margin:18vh 7vw">' +
      '<p class="eyebrow">EREBUS</p><h1>The dark is resting.</h1>' +
      '<p class="lede">Something didn’t load. Refresh to try again — or say hello: ' +
      '<a href="mailto:psm026@gmail.com">psm026@gmail.com</a></p></section>';
  }
}

/* ---------- shaders ---------- */
const NEBULA_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEBULA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uLift;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float n  = fbm(d * 3.0 + vec3(0.0, 0.0, uTime * 0.02));
    float n2 = fbm(d * 6.5 - vec3(uTime * 0.015));
    vec3 col = vec3(0.008, 0.008, 0.020);
    col += uColA * smoothstep(0.52, 0.95, n);
    col += uColB * smoothstep(0.58, 0.97, n2);
    gl_FragColor = vec4(col * uLift, 1.0);
  }
`;

const POINTS_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uDrift;
  varying float vTw;
  varying float vFogDepth;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.12 + aPhase * 6.2831) * uDrift;
    p.y += cos(uTime * 0.09 + aPhase * 12.566) * uDrift * 0.75;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vTw = 0.72 + 0.28 * sin(uTime * (0.35 + aPhase * 0.6) + aPhase * 20.0);
    vFogDepth = -mv.z;
    gl_PointSize = aSize * uPixelRatio * (140.0 / max(1.0, -mv.z)) * vTw;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINTS_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uFogDensity;
  varying float vTw;
  varying float vFogDepth;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float fogF = exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth * 1.442695);
    float a = smoothstep(0.5, 0.06, d) * vTw * uAlpha * fogF;
    gl_FragColor = vec4(uColor, a);
  }
`;

const RIM_VERT = /* glsl */ `
  varying float vFres;
  varying float vFogDepth;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFres = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 2.5);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const RIM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uFogDensity;
  varying float vFres;
  varying float vFogDepth;
  void main() {
    float fogF = exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth * 1.442695);
    gl_FragColor = vec4(uColor * vFres * uIntensity * fogF, vFres * fogF);
  }
`;

// tapered filament ribbon — a line that thins and expands, not a wire
const FIL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPresence;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    float across = abs(vUv.y - 0.5) * 2.0;
    float edge = pow(max(0.0, 1.0 - across), 1.7);
    float along = pow(max(0.001, sin(3.14159 * vUv.x)), 0.55);
    float fogF = exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth * 1.442695);
    float a = edge * along * uIntensity * uPresence * fogF;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// aurora veil: a curtain of flowing light wrapping the sky
const VEIL_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec3 p = position;
    p += normal * (sin(uv.x * 6.2831 + uTime * 0.28) * 1.4 + sin(uv.x * 15.0 - uTime * 0.2) * 0.6) * uv.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const VEIL_FRAG = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uIntensity;
  uniform float uPresence;
  uniform float uFogDensity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vFogDepth;
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise2(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x),
               mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm2(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise2(p); p *= 2.15; a *= 0.5; }
    return v;
  }
  void main() {
    float n = fbm2(vec2(vUv.x * 5.0 + uTime * 0.05, vUv.y * 1.6 - uTime * 0.03));
    float band = pow(max(0.0, 1.0 - vUv.y), 1.35);                 // bright hem fading upward
    float rays = 0.5 + 0.5 * sin(vUv.x * 44.0 + n * 7.0);          // curtain striations
    vec3 col = mix(uColA, uColB, n);
    float fogF = exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth * 1.442695);
    float a = band * rays * smoothstep(0.25, 0.8, n) * uIntensity * uPresence * fogF;
    gl_FragColor = vec4(col * a, a);
  }
`;

/* ---------- helpers ---------- */
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function shardGeometry(radius) {
  const g = new THREE.IcosahedronGeometry(radius, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = strHash(v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3));
    v.multiplyScalar(1 + (h - 0.5) * 0.22); // gem-cut, not rubble
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function rimMaterial(color, intensity, fogDensity = 0.010) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uFogDensity: { value: fogDensity },
    },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function pointsCloud(count, positionFn, color, sizeRange, alpha, drift, fogDensity = 0.010) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = positionFn(i);
    positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
    sizes[i] = rand(sizeRange[0], sizeRange[1]);
    phases[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, PR_CAP) },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      uDrift: { value: drift },
      uFogDensity: { value: fogDensity },
    },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

/* merged tapered ribbons for a whole set of edges — one draw call per network */
function filamentsGeometry(edges, baseWidth) {
  const positions = [], uvs = [], index = [];
  const pt = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  const SEG = 12;
  let vbase = 0;
  for (const [a, b] of edges) {
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5)
      .add(new THREE.Vector3().randomDirection().multiplyScalar(len * rand(0.08, 0.2)));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const up = new THREE.Vector3().randomDirection();
    const w0 = baseWidth * rand(0.55, 1.35);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      curve.getPoint(u, pt);
      curve.getTangent(u, tan);
      side.crossVectors(tan, up).normalize();
      const w = w0 * (0.1 + 0.9 * Math.pow(Math.sin(Math.PI * u), 0.75));
      positions.push(pt.x + side.x * w, pt.y + side.y * w, pt.z + side.z * w,
                     pt.x - side.x * w, pt.y - side.y * w, pt.z - side.z * w);
      uvs.push(u, 1, u, 0);
      if (i < SEG) { const q = vbase + i * 2; index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    vbase += (SEG + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  return geo;
}

function filamentMaterial(color, intensity, fogDensity = 0.0115) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uPresence: { value: 1 },
      uFogDensity: { value: fogDensity },
    },
    vertexShader: FIL_VERT,
    fragmentShader: FIL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function buildPanel(stop, room, globalIndex) {
  const sec = document.createElement('section');
  const variant = stop.variant || 'panel';
  sec.className = 'panel ' + (variant === 'intro' ? 'intro' :
    variant === 'contact' ? 'contact' :
    variant === 'room-title' ? 'room-title' : 'project');
  sec.dataset.stop = String(globalIndex);
  sec.style.setProperty('--accent', room.accentA);

  let html = '';
  if (stop.num) html += `<span class="p-num" aria-hidden="true">${stop.num}</span>`;
  if (stop.eyebrow) html += `<p class="eyebrow">${stop.eyebrow}</p>`;
  const H = variant === 'intro' ? 'h1' : 'h2';
  html += `<${H}>${stop.title || ''}</${H}>`;
  if (stop.tags) html += `<p class="p-tags">${stop.tags}</p>`;
  if (stop.body) html += `<p class="${variant === 'intro' ? 'lede' : 'p-desc'}">${stop.body}</p>`;
  if (stop.link) html += `<a class="p-link${variant === 'contact' ? ' contact-link' : ''}" href="${stop.link.href}">${stop.link.label}</a>`;
  sec.innerHTML = html;
  content.appendChild(sec);
  return sec;
}

/* room sanitizer: broken rooms are skipped, never fatal */
function sanitizeRooms(raw) {
  const rooms = [];
  (Array.isArray(raw) ? raw : []).forEach((r, i) => {
    try {
      if (!r || typeof r !== 'object') throw new Error('not an object');
      const room = Object.assign({}, ROOM_DEFAULTS, r);
      room.id = room.id || 'room-' + i;
      room.stops = (Array.isArray(room.stops) ? room.stops : []).filter((s) => s && typeof s.title === 'string');
      room.structures = Array.isArray(room.structures) ? room.structures : [];
      if (!room.stops.length) throw new Error('no valid stops');
      rooms.push(room);
    } catch (err) {
      console.warn('[erebus] skipping malformed room #' + i + ':', err.message);
    }
  });
  return rooms;
}

/* ============================================================
   ENGINE
   ============================================================ */
async function boot() {
  /* --- persistent core (survives world swaps) --- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : PR_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // portrait screens get a wider window into the dark and a tighter flight path
  const isPortrait = () => window.innerHeight > window.innerWidth * 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(ROOM_DEFAULTS.fog, 0.0115); // deeper dark, slower reveals

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.25;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(isPortrait() ? 68 : 58, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  scene.add(new THREE.AmbientLight(0x24203f, 0.7));
  const key = new THREE.DirectionalLight(0x8ea0ff, 1.0);
  key.position.set(4, 8, 6);
  scene.add(key);
  const lightA = new THREE.PointLight(0xffffff, 90, 70, 2);
  lightA.position.set(-6, 3, -6);
  camera.add(lightA);
  const lightB = new THREE.PointLight(0xffffff, 60, 60, 2);
  lightB.position.set(7, -4, -10);
  camera.add(lightB);

  /* bloom is the soul — phones get it too, at lean resolution */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : PR_CAP));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    isMobile ? new THREE.Vector2(384, 384) : new THREE.Vector2(window.innerWidth, window.innerHeight),
    isMobile ? 0.5 : CONFIG.bloom.strength, CONFIG.bloom.radius, CONFIG.bloom.threshold
  ));
  composer.addPass(new OutputPass());

  const sky = new THREE.Group();
  scene.add(sky);
  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(ROOM_DEFAULTS.nebulaA) },
      uColB: { value: new THREE.Color(ROOM_DEFAULTS.nebulaB) },
      // small screens crush near-black — lift the sky so the dark stays visible
      uLift: { value: isMobile ? 1.4 : 1.0 },
    },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(260, 32, 32), nebulaMat));

  // photographic/AI sky: a second sphere that carries an equirectangular image
  // (rooms opt in with "sky": "./asset-name.webp" — 2:1 equirect, AI-generated or shot)
  const skyPhotoMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide,
  });
  const skyPhoto = new THREE.Mesh(new THREE.SphereGeometry(255, 48, 32), skyPhotoMat);
  skyPhoto.rotation.y = Math.PI; // seam behind the entry gaze
  sky.add(skyPhoto);
  function setSkyPhoto(url, opacity) {
    if (skyPhotoMat.map) { skyPhotoMat.map.dispose(); skyPhotoMat.map = null; }
    skyPhotoMat.opacity = 0;
    if (!url) { skyPhotoMat.needsUpdate = true; return; }
    texLoaderGlobal.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      skyPhotoMat.map = tex;
      skyPhotoMat.opacity = opacity != null ? opacity : 0.85;
      skyPhotoMat.needsUpdate = true;
    });
  }
  const texLoaderGlobal = new THREE.TextureLoader();
  const stars = pointsCloud(
    CONFIG.starCount,
    () => new THREE.Vector3().randomDirection().multiplyScalar(rand(90, 240)),
    0xdfe6ff, [0.6, 1.6], 0.75, 0.0, 0.0
  );
  sky.add(stars);

  const shardMat = new THREE.MeshStandardMaterial({
    color: 0x0b0a12, roughness: 0.12, metalness: 0.92, flatShading: true, envMapIntensity: 0.9,
  });
  const monoMat = new THREE.MeshStandardMaterial({
    color: 0x08070d, roughness: 0.35, metalness: 0.7, envMapIntensity: 0.35,
  });
  const texLoader = new THREE.TextureLoader();

  /* --- world state (rebuilt on every world swap) --- */
  const W = {
    id: null, rooms: [], allStops: [], panels: [],
    curve: null, totalStops: 0, pathLength: 0,
    animated: [], clickables: [], dust: null, planetGroup: null,
    disposables: [], groups: [],
    immersive: false, returnTo: 'main', wakeAt: 0,
  };
  const CAM_BASE_Z = 10;
  const seg = CONFIG.segment;
  let targetProgress = 0, progress = 0, activeStop = -1;
  let swapping = false;

  const worldFile = (id) => (!id || id === 'main') ? 'world.json' : `world-${id}.json`;
  const worldIdFromHash = () => (location.hash.match(/^#w=([\w-]+)/) || [])[1] || 'main';

  function track(obj) { W.disposables.push(obj); return obj; }

  function disposeWorld() {
    for (const g of W.groups) scene.remove(g);
    if (W.dust) scene.remove(W.dust);
    if (W.planetGroup) scene.remove(W.planetGroup);
    for (const d of W.disposables) {
      if (d.geometry) d.geometry.dispose();
      if (d.material) {
        if (d.material.map) d.material.map.dispose();
        d.material.dispose();
      }
    }
    W.rooms = []; W.allStops = []; W.panels = [];
    W.animated = []; W.clickables = []; W.disposables = []; W.groups = [];
    W.dust = null; W.planetGroup = null; W.curve = null;
    content.innerHTML = '';
    activeStop = -1;
  }

  function accent(room, key) { return key === 'B' ? room.accentB : room.accentA; }
  const stopT = (i) => W.totalStops > 1 ? i / (W.totalStops - 1) : 0;

  function besidePath(room, lateralMin, lateralMax, i) {
    const t = stopT(rand(room.firstStop, room.lastStop));
    const p = W.curve.getPointAt(Math.min(1, Math.max(0, t)));
    const side = i % 2 ? 1 : -1;
    p.x += side * rand(lateralMin, lateralMax);
    p.y += rand(-13, 13);
    return p;
  }

  function registerGroup(group, baseY, rotSpeed, bobSpeed) {
    scene.add(group);
    W.groups.push(group);
    // collect every glow layer so presence (fade in/out of existence) can drive it
    const glow = [];
    group.traverse((o) => {
      if (o.geometry || o.material) track(o);
      const m = o.material;
      if (!m) return;
      if (m.uniforms && m.uniforms.uColA && m.uniforms.uPresence) glow.push({ kind: 'veil', mat: m });
      else if (m.uniforms && m.uniforms.uPresence) glow.push({ kind: 'fil', mat: m });
      else if (m.uniforms && m.uniforms.uIntensity) glow.push({ kind: 'rim', mat: m, base: m.uniforms.uIntensity.value });
      else if (m.uniforms && m.uniforms.uAlpha) glow.push({ kind: 'points', mat: m, base: m.uniforms.uAlpha.value });
      else if (m.isMeshBasicMaterial && m.transparent) glow.push({ kind: 'basic', mat: m, base: m.opacity });
    });
    const breathe = group.userData.breathe !== undefined ? group.userData.breathe : true;
    W.animated.push({
      group, baseY, glow, breathe,
      breatheMin: group.userData.breatheMin || 0,
      breatheSpeed: rand(0.16, 0.4),
      breathePhase: Math.random() * Math.PI * 2,
      rotSpeed: rotSpeed != null ? rotSpeed : rand(0.03, 0.09),
      bobSpeed: bobSpeed != null ? bobSpeed : rand(0.15, 0.35),
      bobPhase: Math.random() * Math.PI * 2,
    });
  }

  function place(group, room, i, spec) {
    // anchored/hero pieces stay lit; ambient ones fade in and out of the dark
    group.userData.breathe = spec.breathe !== undefined ? !!spec.breathe : !spec.anchor;
    if (W.immersive) {
      // dive rooms: everything surrounds YOU — spherical shells, layered
      // macro (far silhouettes) / mid / micro (almost touchable)
      if (spec.anchor) {
        // the "weenie": one gravitational focal piece, ahead and slightly up
        group.position.set(rand(-4, 4), rand(1, 5), -rand(24, 30));
      } else {
        const dir = new THREE.Vector3().randomDirection();
        dir.y *= 0.65; // denser near the horizon band, still above/below you
        const shell = [rand(9, 15), rand(16, 28), rand(30, 44)][i % 3];
        group.position.copy(dir.normalize().multiplyScalar(shell));
      }
      group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      registerGroup(group, group.position.y);
      return;
    }
    if (spec.anchor) {
      const stopIdx = room.firstStop + 1 + (i % Math.max(1, room.stops.length - 1));
      const p = W.curve.getPointAt(stopT(Math.min(stopIdx, W.totalStops - 1)));
      if (isPortrait()) {
        // phones: hero pieces live in the upper half, above the text
        group.position.set(p.x + rand(-2.5, 3.5), p.y + rand(3, 5.5), p.z - 13);
      } else {
        // 11+ units off-path: the camera weaves ±sway, never fly THROUGH a hero piece
        group.position.set(p.x + 11 + (i % 3) * 2, p.y + rand(-1.5, 2.5), p.z - 12);
      }
    } else {
      group.position.copy(isPortrait() ? besidePath(room, 6, 15, i) : besidePath(room, 11, 30, i));
    }
    group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    registerGroup(group, group.position.y);
  }

  function buildStructure(spec, room) {
    try {
      const count = spec.count || 1;
      const col = accent(room, spec.rim || 'A');
      const intensity = spec.intensity != null ? spec.intensity : 1.0;
      const scale = Array.isArray(spec.scale) ? spec.scale : [1, 2];

      for (let i = 0; i < count; i++) {
        const s = rand(scale[0], scale[1]);
        const group = new THREE.Group();

        if (spec.kind === 'shard') {
          const geo = shardGeometry(s);
          group.add(new THREE.Mesh(geo, shardMat));
          const rim = new THREE.Mesh(geo, rimMaterial(col, intensity * 0.85));
          rim.scale.setScalar(1.04);
          group.add(rim);

        } else if (spec.kind === 'monolith') {
          const geo = new THREE.BoxGeometry(s * 0.22, s, s * 0.1);
          group.add(new THREE.Mesh(geo, monoMat));
          const rim = new THREE.Mesh(geo, rimMaterial(col, intensity * 0.7));
          rim.scale.setScalar(1.03);
          group.add(rim);

        } else if (spec.kind === 'ring') {
          const geo = new THREE.TorusGeometry(s, s * 0.005, 8, 128);
          group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: spec.opacity != null ? spec.opacity : 0.22,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })));

        } else if (spec.kind === 'orb') {
          const geo = new THREE.SphereGeometry(s * 0.5, 32, 32);
          group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            color: 0x05050a, roughness: 0.25, metalness: 0.4, envMapIntensity: 0.7,
          })));
          const rim = new THREE.Mesh(geo, rimMaterial(col, intensity));
          rim.scale.setScalar(1.14);
          group.add(rim);

        } else if (spec.kind === 'network') {
          // mycelium: nodes joined by TAPERED filaments that thin and expand —
          // organic threads, not wireframe
          const nodeCount = Math.min(spec.nodes || 22, 36);
          const pts = [];
          for (let n = 0; n < nodeCount; n++) {
            pts.push(new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * s));
          }
          const edges = [];
          for (let a = 0; a < pts.length; a++) {
            const near = pts
              .map((p, idx) => ({ idx, dist: p.distanceTo(pts[a]) }))
              .filter((x) => x.idx !== a)
              .sort((x, y) => x.dist - y.dist);
            for (let k = 0; k < 2 && k < near.length; k++) {
              if (near[k].idx > a) edges.push([pts[a], pts[near[k].idx]]);
              else edges.push([pts[near[k].idx], pts[a]]);
            }
          }
          const fil = new THREE.Mesh(
            filamentsGeometry(edges, s * 0.02),
            filamentMaterial(col, intensity)
          );
          group.add(fil);
          let ni = 0;
          group.add(pointsCloud(pts.length, () => pts[ni++], col, [0.8, 1.5], 0.55, 0.1));

        } else if (spec.kind === 'veil') {
          // aurora curtain wrapping the viewer — sky-scale, dive rooms especially
          const geo = new THREE.CylinderGeometry(s, s * 0.96, s * rand(0.34, 0.5), 96, 10, true);
          const mat = new THREE.ShaderMaterial({
            uniforms: {
              uColA: { value: new THREE.Color(accent(room, 'A')) },
              uColB: { value: new THREE.Color(accent(room, 'B')) },
              uIntensity: { value: intensity },
              uPresence: { value: 1 },
              uFogDensity: { value: 0.0115 },
              uTime: { value: 0 },
            },
            vertexShader: VEIL_VERT,
            fragmentShader: VEIL_FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          group.add(new THREE.Mesh(geo, mat));
          group.position.set(0, rand(7, 13) + i * 4, 0);
          group.rotation.y = Math.random() * Math.PI * 2;
          group.userData.breathe = spec.breathe !== undefined ? !!spec.breathe : true;
          group.userData.breatheMin = 0.45; // auroras dim, never die
          registerGroup(group, group.position.y, 0.05, 0.12);
          continue;

        } else if (spec.kind === 'sea') {
          // a dead-still ocean of light below you
          group.add(pointsCloud(
            isMobile ? 380 : 720,
            () => {
              const r = Math.sqrt(Math.random()) * s;
              const a = Math.random() * Math.PI * 2;
              return new THREE.Vector3(Math.cos(a) * r, -rand(6.5, 9.5), Math.sin(a) * r);
            },
            col, [0.4, 1.0], 0.6, 0.25
          ));
          group.userData.breathe = false;
          registerGroup(group, 0, 0.005, 0.05);
          continue;

        } else if (spec.kind === 'swarm') {
          group.add(pointsCloud(
            isMobile ? 140 : 260,
            () => new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * s),
            col, [0.4, 1.0], 0.75, 2.2
          ));

        } else if (spec.kind === 'image' && spec.src) {
          const tex = texLoader.load(spec.src);
          tex.colorSpace = THREE.SRGBColorSpace;
          const geo = new THREE.PlaneGeometry(s, s * (spec.ratio || 0.66));
          group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
          })));

        } else if (spec.kind === 'egg') {
          const geo = new THREE.SphereGeometry(scale[0], 16, 16);
          const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col }));
          const rim = new THREE.Mesh(geo, rimMaterial(col, intensity * 0.8));
          rim.scale.setScalar(2.0);
          group.add(core); group.add(rim);
          core.userData = { type: 'egg', secret: spec.secret };
          W.clickables.push(core);
          if (W.immersive) {
            const dir = new THREE.Vector3().randomDirection();
            group.position.copy(dir.multiplyScalar(rand(12, 20)));
          } else {
            const t = stopT(rand(room.firstStop, room.lastStop));
            const p = W.curve.getPointAt(Math.min(1, Math.max(0, t)));
            // within reach of the look-around: off the path, never out of sight
            group.position.set(p.x + rand(-6, 6), p.y + rand(4.5, 7.5) * (Math.random() > 0.5 ? 1 : -1), p.z - 6);
          }
          group.userData.breathe = true;
          group.userData.breatheMin = 0.7; // eggs dim but stay findable
          registerGroup(group, group.position.y, 0.06, 0.5);
          continue;

        } else if (spec.kind === 'portal') {
          // a gate to another world: ring + burning core, clickable
          const ringGeo = new THREE.TorusGeometry(s, s * 0.02, 12, 128);
          group.add(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })));
          const coreGeo = new THREE.SphereGeometry(s * 0.34, 24, 24);
          const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: col }));
          const rim = new THREE.Mesh(coreGeo, rimMaterial(col, intensity * 1.2));
          rim.scale.setScalar(1.9);
          group.add(core); group.add(rim);
          core.userData = { type: 'portal', to: spec.to || 'main' };
          // the ring is clickable too — bigger target
          group.children[0].userData = core.userData;
          W.clickables.push(core, group.children[0]);
          if (W.immersive) {
            // exit gate floats behind your entry gaze — turn around to leave
            group.position.set(rand(-3, 3), rand(-1, 3), rand(18, 24));
          } else if (spec.anchor !== false) {
            const stopIdx = Math.min(room.firstStop + 1, room.lastStop);
            const p = W.curve.getPointAt(stopT(stopIdx));
            group.position.set(p.x - 9 - (i % 2) * 2, p.y + rand(-1, 2), p.z - 10);
          } else {
            group.position.copy(besidePath(room, 9, 16, i));
          }
          group.userData.breathe = true;
          group.userData.breatheMin = 0.7; // portals pulse, never hide
          registerGroup(group, group.position.y, 0.12, 0.3);
          continue;
        } else {
          continue;
        }

        place(group, room, i, spec);
      }
    } catch (err) {
      console.warn('[erebus] skipping structure in "' + room.id + '":', err.message);
    }
  }

  function buildWorld(data, id) {
    W.id = id;
    W.immersive = data.mode === 'immersive';
    W.returnTo = data.returnTo || 'main';
    W.wakeAt = clock ? clock.getElapsedTime() : 0;
    document.body.classList.toggle('immersive', W.immersive);
    W.rooms = sanitizeRooms(data.rooms);
    if (!W.rooms.length) throw new Error('world "' + id + '" has no valid rooms');

    W.rooms.forEach((room) => {
      room.firstStop = W.allStops.length;
      room.stops.forEach((stop) => W.allStops.push({ stop, room }));
      room.lastStop = W.allStops.length - 1;
      room.zStart = CAM_BASE_Z - (room.firstStop - 0.5) * seg;
      room.zEnd = CAM_BASE_Z - (room.lastStop + 0.5) * seg;
    });
    W.totalStops = W.allStops.length;
    W.pathLength = (W.totalStops - 1) * seg;

    if (!W.immersive) {
      const wx = CONFIG.weaveX * (isPortrait() ? 0.45 : 1); // narrow screens: tighter weave, nothing off-frame
      const pts = [];
      for (let i = 0; i < W.totalStops; i++) {
        pts.push(new THREE.Vector3(
          Math.sin(i * 1.7) * wx,
          Math.cos(i * 1.3) * CONFIG.weaveY,
          CAM_BASE_Z - i * seg
        ));
      }
      // a 1-stop world still needs a line to fly
      if (pts.length === 1) pts.push(pts[0].clone().add(new THREE.Vector3(0, 0, -seg)));
      W.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    } else {
      W.curve = null; // dive rooms have no rail — you stand inside them
    }

    if (W.immersive) {
      // one ephemeral title — appears, then dissolves; the room speaks visually
      W.panels = [buildPanel(W.rooms[0].stops[0], W.rooms[0], 0)];
      W.panels[0].classList.add('is-active', 'ephemeral');
      setTimeout(() => W.panels[0] && W.panels[0].classList.add('gone'), 4200);
      W.dust = pointsCloud(
        420,
        () => new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * 42),
        W.rooms[0].dust, [0.4, 1.0], 0.35, 1.2
      );
    } else {
      W.panels = W.allStops.map((s, i) => buildPanel(s.stop, s.room, i));
      W.dust = pointsCloud(
        Math.max(180, CONFIG.dustPerStop * W.totalStops),
        () => new THREE.Vector3(rand(-52, 52), rand(-24, 24), 30 - Math.random() * (W.pathLength + 110)),
        W.rooms[0].dust, [0.4, 1.0], isMobile ? 0.48 : 0.35, 1.6
      );
    }
    scene.add(W.dust);
    track(W.dust);

    W.rooms.forEach((room) => room.structures.forEach((spec) => buildStructure(spec, room)));

    const planetRoom = W.rooms.find((r) => r.planet);
    if (planetRoom) {
      const endP = W.curve.getPointAt(1);
      W.planetGroup = new THREE.Group();
      const geo = new THREE.SphereGeometry(46, 64, 64);
      W.planetGroup.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x05050c, roughness: 0.9, metalness: 0.1, envMapIntensity: 0.35,
      })));
      const atmo = new THREE.Mesh(geo, rimMaterial(planetRoom.accentA, 1.15));
      atmo.scale.setScalar(1.06);
      W.planetGroup.add(atmo);
      W.planetGroup.position.set(endP.x + 30, endP.y - 36, endP.z - 62);
      scene.add(W.planetGroup);
      W.planetGroup.traverse((o) => { if (o.geometry || o.material) track(o); });
    }

    document.getElementById('scroll-space').style.height = W.immersive ? '100vh' : `${W.totalStops * 120}vh`;
    hudSector.textContent = W.rooms[0].sector || '';

    // photographic/AI sky if the room asks for one
    setSkyPhoto(W.rooms[0].sky || null, W.rooms[0].skyOpacity);

    // palette snap targets to the first room of the new world
    const r0 = W.rooms[0];
    fogTarget.set(r0.fog); nebATarget.set(r0.nebulaA); nebBTarget.set(r0.nebulaB);
    dustTarget.set(r0.dust); lightATarget.set(r0.accentA); lightBTarget.set(r0.accentB);
  }

  async function fetchWorld(id) {
    const opts = ('timeout' in AbortSignal) ? { signal: AbortSignal.timeout(9000) } : {};
    const r = await fetch('./' + worldFile(id) + '?v=' + VERSION, opts);
    if (!r.ok) throw new Error(worldFile(id) + ' HTTP ' + r.status);
    return r.json();
  }

  async function swapWorld(id, pushHash) {
    if (swapping || id === W.id) return;
    swapping = true;
    document.body.classList.add('world-jump');
    try {
      const data = await fetchWorld(id);
      await new Promise((res) => setTimeout(res, 620)); // let the fade land
      disposeWorld();
      buildWorld(data, id);
      resetLook();
      window.scrollTo(0, 0);
      progress = 0; targetProgress = 0;
      onScroll();
      if (!W.immersive) setActiveStop(0);
      if (pushHash) {
        history.pushState({ w: id }, '', id === 'main' ? location.pathname : '#w=' + id);
      }
    } catch (err) {
      console.error('[erebus] world swap failed:', err);
      // stay in the current world; the dark forgives
    } finally {
      document.body.classList.remove('world-jump');
      swapping = false;
    }
  }

  window.addEventListener('popstate', () => {
    swapWorld(worldIdFromHash(), false);
  });

  /* --- palette state --- */
  const fogTarget = new THREE.Color(ROOM_DEFAULTS.fog);
  const nebATarget = new THREE.Color(ROOM_DEFAULTS.nebulaA);
  const nebBTarget = new THREE.Color(ROOM_DEFAULTS.nebulaB);
  const dustTarget = new THREE.Color(ROOM_DEFAULTS.dust);
  const lightATarget = new THREE.Color(ROOM_DEFAULTS.accentA);
  const lightBTarget = new THREE.Color(ROOM_DEFAULTS.accentB);

  function roomAtZ(z) {
    for (const r of W.rooms) if (z <= r.zStart && z >= r.zEnd) return r;
    return W.rooms.length ? (z > W.rooms[0].zEnd ? W.rooms[0] : W.rooms[W.rooms.length - 1]) : null;
  }

  /* --- scroll --- */
  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    targetProgress = max > 0 ? window.scrollY / max : 0;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.altKey || e.ctrlKey) return;
    const idx = Math.round(progress * (W.totalStops - 1));
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') next = Math.min(W.totalStops - 1, idx + 1);
    if (e.key === 'ArrowUp' || e.key === 'PageUp') next = Math.max(0, idx - 1);
    if (next !== null) {
      e.preventDefault();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: (next / (W.totalStops - 1)) * max, behavior: reduced ? 'auto' : 'smooth' });
    }
  });

  /* --- pointer --- */
  let mouseTX = 0, mouseTY = 0, mouseX = 0, mouseY = 0;

  /* dive-room look state: drag turns your head anywhere — a magic window */
  let yaw = 0, pitch = 0, yawVel = 0, pitchVel = 0;
  let dragging = false, lastX = 0, lastY = 0, lastMoveAt = 0;
  let tiltYaw = 0, tiltPitch = 0, tiltArmed = false;
  let targetFov = 58;

  window.addEventListener('pointermove', (e) => {
    if (W.immersive) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const kx = 2.4 / window.innerWidth, ky = 1.7 / window.innerHeight;
      yaw -= dx * kx; pitch -= dy * ky;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      yawVel = -dx * kx; pitchVel = -dy * ky;
      lastMoveAt = performance.now();
      return;
    }
    if (e.pointerType === 'touch') return;
    mouseTX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseTY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });

  window.addEventListener('wheel', (e) => {
    if (!W.immersive) return;
    targetFov = Math.max(38, Math.min(70, targetFov + e.deltaY * 0.02)); // lean in / pull back
  }, { passive: true });

  // magic-window tilt on phones (iOS asks permission on first touch)
  function armTilt() {
    if (tiltArmed) return;
    tiltArmed = true;
    const attach = () => window.addEventListener('deviceorientation', (e) => {
      if (!W.immersive || e.beta == null) return;
      tiltPitch = ((e.beta - 55) / 90) * 0.7;
      tiltYaw = (-e.gamma / 90) * 0.7;
    }, { passive: true });
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') attach(); }).catch(() => {});
      } else {
        attach();
      }
    } catch (err) { /* the dark forgives */ }
  }

  function resetLook() { yaw = 0; pitch = 0; yawVel = 0; pitchVel = 0; tiltYaw = 0; tiltPitch = 0; targetFov = 58; }

  const raycaster = new THREE.Raycaster();
  const clickNDC = new THREE.Vector2();

  /* hover affordance: clickables wake and the cursor tells the truth */
  let hoveredGroup = null;
  let lastHoverCheck = 0;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || swapping || !W.clickables.length) return;
    const now = performance.now();
    if (now - lastHoverCheck < 120) return;
    lastHoverCheck = now;
    clickNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(clickNDC, camera);
    const hits = raycaster.intersectObjects(W.clickables, false);
    const g = hits.length ? hits[0].object.parent : null;
    if (g !== hoveredGroup) {
      hoveredGroup = g;
      document.documentElement.style.cursor = g ? 'pointer' : '';
    }
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    if (W.immersive && !(e.target.closest && e.target.closest('.hud, #hud-exit, #egg-veil'))) {
      dragging = true; lastX = e.clientX; lastY = e.clientY; lastMoveAt = performance.now();
      armTilt();
    }
    if (swapping || !W.clickables.length) return;
    if (document.body.classList.contains('egg-open')) return;
    if (e.target.closest && e.target.closest('.panel, .hud, .hud-bottom, #egg-veil, #hud-exit')) return;
    clickNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(clickNDC, camera);
    const hits = raycaster.intersectObjects(W.clickables, false);
    if (!hits.length) return;
    const data = hits[0].object.userData || {};
    if (data.type === 'egg') {
      const secret = data.secret || {};
      eggVeil.querySelector('.egg-eyebrow').textContent = secret.eyebrow || 'FOUND';
      eggVeil.querySelector('.egg-title').textContent = secret.title || '';
      eggVeil.querySelector('.egg-body').textContent = secret.body || '';
      document.body.classList.add('egg-open');
    } else if (data.type === 'portal') {
      swapWorld(data.to === '__back' ? 'main' : data.to, true);
    }
  });
  eggVeil.querySelector('.egg-close').addEventListener('click', () => {
    document.body.classList.remove('egg-open');
  });

  /* surface: the always-available way back out of a dive */
  const exitBtn = document.getElementById('hud-exit');
  if (exitBtn) exitBtn.addEventListener('click', () => swapWorld(W.returnTo || 'main', true));

  /* --- HUD --- */
  function setActiveStop(idx) {
    if (idx === activeStop) return;
    activeStop = idx;
    W.panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    hudSector.textContent = W.allStops[idx] ? W.allStops[idx].room.sector : '';
    hudIndex.textContent = `${pad(idx)} / ${pad(Math.max(0, W.totalStops - 1))}`;
  }
  function updateClock() {
    const d = new Date();
    hudTime.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  updateClock();
  setInterval(updateClock, 30000);

  /* --- loader --- */
  function runLoader() {
    const t0 = performance.now();
    const DURATION = reduced ? 200 : 1300;
    (function step() {
      const t = Math.min(1, (performance.now() - t0) / DURATION);
      loaderCount.textContent = String(Math.floor(t * 100)).padStart(3, '0');
      if (t < 1) requestAnimationFrame(step);
      else document.body.classList.add('world-ready');
    })();
  }

  /* --- frame loop --- */
  const clock = new THREE.Clock();
  let running = true;
  let firstFrame = true;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    fallback(new Error('WebGL context lost'));
  });

  const camPos = new THREE.Vector3();
  const lookPos = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    if (!W.curve && !W.immersive) return;
    const tAbs = clock.getElapsedTime();
    const t = tAbs * (reduced ? 0.15 : 1);

    if (W.immersive) {
      /* you stand inside the room; your head is the camera */
      if (!dragging) {
        yaw += yawVel; pitch = Math.max(-1.45, Math.min(1.45, pitch + pitchVel));
        yawVel *= 0.94; pitchVel *= 0.94;
        if (!reduced && performance.now() - lastMoveAt > 2200) yaw += 0.00045; // idle drift — never frozen
      }
      camera.position.set(0, 0, 0);
      camera.rotation.set(pitch + tiltPitch, yaw + tiltYaw, 0);
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov = lerp(camera.fov, targetFov, 0.08);
        camera.updateProjectionMatrix();
      }
      camPos.set(0, 0, 0);
    } else {
      // adaptive glide: dreamy up close, quicker over long jumps so no one waits half a minute
      const gap = Math.abs(targetProgress - progress);
      progress = reduced ? targetProgress : lerp(progress, targetProgress, Math.min(0.16, CONFIG.camLerp + gap * 0.35));
      mouseX = lerp(mouseX, mouseTX, 0.045);
      mouseY = lerp(mouseY, mouseTY, 0.045);

      const pT = Math.min(0.9995, Math.max(0, progress));
      W.curve.getPointAt(pT, camPos);
      W.curve.getPointAt(Math.min(1, pT + 0.018), lookPos);
      W.curve.getTangentAt(pT, tangent);

      camera.position.copy(camPos);
      camera.lookAt(lookPos);
      camera.rotateY(-mouseX * CONFIG.lookYaw);
      camera.rotateX(-mouseY * CONFIG.lookPitch);
      camera.rotateZ(-tangent.x * CONFIG.bank);
    }

    sky.position.copy(camera.position);

    const room = W.immersive ? W.rooms[0] : roomAtZ(camPos.z);
    if (room) {
      fogTarget.set(room.fog); nebATarget.set(room.nebulaA); nebBTarget.set(room.nebulaB);
      dustTarget.set(room.dust); lightATarget.set(room.accentA); lightBTarget.set(room.accentB);
    }
    const pl = CONFIG.paletteLerp;
    scene.fog.color.lerp(fogTarget, pl);
    nebulaMat.uniforms.uColA.value.lerp(nebATarget, pl);
    nebulaMat.uniforms.uColB.value.lerp(nebBTarget, pl);
    if (W.dust) W.dust.material.uniforms.uColor.value.lerp(dustTarget, pl);
    lightA.color.lerp(lightATarget, pl);
    lightB.color.lerp(lightBTarget, pl);

    nebulaMat.uniforms.uTime.value = t;
    stars.material.uniforms.uTime.value = t;
    if (W.dust) W.dust.material.uniforms.uTime.value = t;
    for (const s of W.animated) {
      s.group.rotation.y += s.rotSpeed * 0.002;
      s.group.rotation.x += s.rotSpeed * 0.001;
      s.group.position.y = s.baseY + Math.sin(t * s.bobSpeed + s.bobPhase) * 0.35;
      // presence: things surface out of the dark, hold, and sink back —
      // "was that something I saw"
      let presence = 1;
      if (s.breathe && !reduced) {
        const raw = 0.5 + 0.5 * Math.sin(t * s.breatheSpeed + s.breathePhase);
        const shaped = raw * raw * (3 - 2 * raw);
        presence = s.breatheMin + (1 - s.breatheMin) * shaped;
      }
      if (s.group === hoveredGroup) presence = Math.max(presence, 0.95); // hover wakes it fully
      // dive rooms wake slowly: the reveal is the arrival
      const wakeRaw = Math.min(1, Math.max(0, (tAbs - W.wakeAt) / 3.5));
      presence *= wakeRaw * wakeRaw * (3 - 2 * wakeRaw);
      for (const g of s.glow) {
        if (g.kind === 'rim') g.mat.uniforms.uIntensity.value = g.base * (0.06 + 0.94 * presence);
        else if (g.kind === 'fil') g.mat.uniforms.uPresence.value = presence;
        else if (g.kind === 'veil') { g.mat.uniforms.uPresence.value = presence; g.mat.uniforms.uTime.value = t; }
        else if (g.kind === 'points') { g.mat.uniforms.uAlpha.value = g.base * presence; g.mat.uniforms.uTime.value = t; }
        else if (g.kind === 'basic') g.mat.opacity = g.base * presence;
      }
    }
    if (W.planetGroup) W.planetGroup.rotation.y += 0.0003;

    if (!W.immersive) {
      setActiveStop(Math.round(progress * (W.totalStops - 1)));
      progressFill.style.width = `${(progress * 100).toFixed(2)}%`;
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; runLoader(); }
  }

  /* --- resize --- */
  let lastW = window.innerWidth, lastH = window.innerHeight;
  let wasPortrait = isPortrait();
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW && Math.abs(window.innerHeight - lastH) < 140) return;
    lastW = window.innerWidth; lastH = window.innerHeight;
    if (isPortrait() !== wasPortrait) {
      // orientation flip: recompose the world for the new frame
      wasPortrait = isPortrait();
      camera.fov = wasPortrait ? 68 : 58;
      const id = W.id || 'main';
      W.id = null; // force rebuild
      swapWorld(id, false);
    }
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio, PR_CAP);
    renderer.setPixelRatio(pr);
    if (composer) {
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.setPixelRatio(pr);
    }
    stars.material.uniforms.uPixelRatio.value = pr;
    if (W.dust) W.dust.material.uniforms.uPixelRatio.value = pr;
    onScroll();
  });

  /* --- go --- */
  const startId = worldIdFromHash();
  let data;
  try {
    data = await fetchWorld(startId);
  } catch (err) {
    if (startId !== 'main') data = await fetchWorld('main'); // bad hash → main world
    else throw err;
  }
  buildWorld(data, startId);
  resetLook();
  if (W.curve) {
    camera.position.copy(W.curve.getPointAt(0));
    setActiveStop(0);
  }
  onScroll();
  tick();
}

/* ---------- ignition ---------- */
if (!webglOK()) {
  fallback();
} else {
  boot().catch(fallback);
}
