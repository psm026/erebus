/* ============================================================
   EREBUS — the world
   One WebGL scene, scroll-driven camera, HTML floats on top.

   How it works (the whole trick, same as the meadow site):
   - An invisible #scroll-space div gives the page real height,
     so the browser's native scrollbar/touch physics drive us.
   - Scroll position becomes a 0→1 "progress" number.
   - Progress moves the camera along a straight path through
     the dark, past one obsidian shard per project.
   - HTML panels fade in when the camera reaches their stop.
   ============================================================ */

import * as THREE from 'three';

/* ---------- 0. tuning — change the feel from here ---------- */
const CONFIG = {
  segment: 34,        // world-units between stops (bigger = longer drift)
  camLerp: 0.06,      // camera smoothing (lower = dreamier, floatier)
  parallax: 1.7,      // how far the camera leans with the mouse
  starCount: 2200,
  dustCount: 500,
  bg: 0x030307,
  violet: 0x8b7bff,
  cyan: 0x7de8ff,
  shardColor: 0x0b0a12,
};

/* ---------- 1. DOM ---------- */
const canvas = document.getElementById('erebus');
const panels = [...document.querySelectorAll('.panel')];
const stops = panels.length; // intro + 5 projects + contact = 7
const pathLength = (stops - 1) * CONFIG.segment;

const hudIndex = document.getElementById('hud-index');
const hudSector = document.getElementById('hud-sector');
const hudTime = document.getElementById('hud-time');
const progressFill = document.getElementById('progress-fill');
const loaderCount = document.getElementById('loader-count');

const SECTORS = [
  'EREBUS // DRIFT',
  'DEPTH 01', 'DEPTH 02', 'DEPTH 03', 'DEPTH 04', 'DEPTH 05',
  'APPROACH // PLANET',
];

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.matchMedia('(max-width: 720px)').matches;

/* ---------- 2. bail out gracefully if WebGL is missing ---------- */
function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

function fallback(err) {
  if (err) console.error('[erebus] falling back to static:', err);
  document.body.classList.add('no-webgl', 'world-ready');
}

/* ---------- 3. shaders (GLSL) ---------- */

// Nebula: cheap fbm noise painted on the inside of a huge sphere
// that follows the camera, so the darkness never "ends".
const NEBULA_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEBULA_FRAG = /* glsl */ `
  uniform float uTime;
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
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float n  = fbm(d * 3.0 + vec3(0.0, 0.0, uTime * 0.02));
    float n2 = fbm(d * 6.0 - vec3(uTime * 0.015));
    vec3 col = vec3(0.012, 0.012, 0.028);                        // base void
    col += vec3(0.10, 0.06, 0.22) * smoothstep(0.55, 0.92, n);   // violet nebula
    col += vec3(0.03, 0.10, 0.13) * smoothstep(0.60, 0.95, n2);  // teal wisps
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Stars: point sprites with per-star twinkle.
const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTw;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTw = 0.65 + 0.35 * sin(uTime * (0.6 + aPhase) + aPhase * 20.0);
    gl_PointSize = aSize * uPixelRatio * (140.0 / max(1.0, -mv.z)) * vTw;
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vTw;
    gl_FragColor = vec4(uColor, a);
  }
`;

// Dust: near-field particles that drift on noise — this is the
// layer that makes the dark feel inhabited when you move.
const DUST_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vA;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.12 + aPhase * 6.2831) * 1.6;
    p.y += cos(uTime * 0.09 + aPhase * 12.566) * 1.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vA = 0.5 + 0.5 * sin(uTime * 0.5 + aPhase * 40.0);
    gl_PointSize = aSize * uPixelRatio * (90.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * (0.22 + 0.3 * vA);
    gl_FragColor = vec4(uColor, a);
  }
`;

// Fresnel rim: the ghost-light edge on shards and the planet's
// atmosphere. Rendered as a slightly larger back-face shell.
const RIM_VERT = /* glsl */ `
  varying float vFres;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 viewDir = normalize(-mv.xyz);
    vFres = pow(1.0 - abs(dot(n, viewDir)), 2.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const RIM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vFres;
  void main() {
    gl_FragColor = vec4(uColor * vFres * uIntensity, vFres);
  }
`;

/* ---------- 4. small helpers ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
const pad = (n) => String(n).padStart(2, '0');

// Deterministic hash so shared icosahedron vertices get identical
// displacement — jagged crystal, zero cracks.
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function makeShardGeometry(radius) {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = strHash(v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3));
    v.multiplyScalar(1 + (h - 0.5) * 0.55);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function makePoints(count, spread, vert, frag, color, sizeRange) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = spread(i);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    sizes[i] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    phases[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

function makeRimMaterial(color, intensity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
    },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/* ---------- 5. build the world ---------- */
function init() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CONFIG.bg, 0.011); // shards dissolve into black with distance

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600);
  const CAM_BASE_Z = 10;
  camera.position.set(0, 0, CAM_BASE_Z);
  scene.add(camera);

  /* --- lights: dim key + two colored lights riding with the camera --- */
  scene.add(new THREE.AmbientLight(0x24203f, 0.8));
  const key = new THREE.DirectionalLight(0x8ea0ff, 1.2);
  key.position.set(4, 8, 6);
  scene.add(key);
  const violetLight = new THREE.PointLight(CONFIG.violet, 90, 70, 2);
  violetLight.position.set(-6, 3, -6);
  camera.add(violetLight);
  const cyanLight = new THREE.PointLight(CONFIG.cyan, 60, 60, 2);
  cyanLight.position.set(7, -4, -10);
  camera.add(cyanLight);

  /* --- sky: nebula + far stars, glued to the camera --- */
  const sky = new THREE.Group();
  scene.add(sky);

  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(260, 32, 32), nebulaMat));

  const stars = makePoints(
    CONFIG.starCount,
    () => {
      const dir = new THREE.Vector3().randomDirection();
      return dir.multiplyScalar(90 + Math.random() * 150);
    },
    STAR_VERT, STAR_FRAG, 0xdfe6ff, [0.8, 2.4]
  );
  sky.add(stars);

  /* --- dust: world-space, spread along the whole flight path --- */
  const dust = makePoints(
    CONFIG.dustCount,
    () => new THREE.Vector3(
      (Math.random() - 0.5) * 72,
      (Math.random() - 0.5) * 40,
      30 - Math.random() * (pathLength + 110)
    ),
    DUST_VERT, DUST_FRAG, CONFIG.violet, [0.5, 1.4]
  );
  scene.add(dust);

  /* --- obsidian shards --- */
  const shardMat = new THREE.MeshStandardMaterial({
    color: CONFIG.shardColor,
    roughness: 0.18,
    metalness: 0.85,
    flatShading: true,
  });

  const shards = [];
  function addShard(x, y, z, radius, rimColor, rimIntensity) {
    const group = new THREE.Group();
    const geo = makeShardGeometry(radius);
    group.add(new THREE.Mesh(geo, shardMat));
    const rim = new THREE.Mesh(geo, makeRimMaterial(rimColor, rimIntensity));
    rim.scale.setScalar(1.045);
    group.add(rim);
    group.position.set(x, y, z);
    group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    scene.add(group);
    shards.push({
      group,
      baseY: y,
      rotSpeed: 0.05 + Math.random() * 0.12,
      bobSpeed: 0.2 + Math.random() * 0.3,
      bobPhase: Math.random() * Math.PI * 2,
    });
    return group;
  }

  // One hero shard per project stop, floating right of the text panel.
  for (let i = 1; i <= 5; i++) {
    const rimColor = i % 2 ? CONFIG.violet : CONFIG.cyan;
    addShard(
      8 + (i % 3),                       // x — right side of frame
      (i % 2 ? 1.5 : -1) + (i % 3) * 0.8, // y — slight variance
      CAM_BASE_Z - i * CONFIG.segment - 12,
      2.6 + (i % 2) * 0.5,
      rimColor,
      1.1
    );
  }

  // Ambient debris — smaller, farther, dimmer.
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    addShard(
      side * (13 + Math.random() * 18),
      (Math.random() - 0.5) * 26,
      20 - Math.random() * (pathLength + 60),
      0.6 + Math.random() * 1.5,
      CONFIG.violet,
      0.45
    );
  }

  /* --- the dark planet at journey's end --- */
  const planetGroup = new THREE.Group();
  const planetGeo = new THREE.SphereGeometry(46, 48, 48);
  planetGroup.add(new THREE.Mesh(
    planetGeo,
    new THREE.MeshStandardMaterial({ color: 0x05050c, roughness: 0.95, metalness: 0.1 })
  ));
  const atmo = new THREE.Mesh(planetGeo, makeRimMaterial(0x6f9fff, 1.3));
  atmo.scale.setScalar(1.06);
  planetGroup.add(atmo);
  planetGroup.position.set(26, -34, CAM_BASE_Z - pathLength - 58);
  scene.add(planetGroup);

  /* ---------- 6. scroll → progress → camera ---------- */
  document.getElementById('scroll-space').style.height = `${stops * 120}vh`;

  let targetProgress = 0;
  let progress = 0;
  let activeStop = -1;

  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    targetProgress = max > 0 ? window.scrollY / max : 0;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // Arrow keys hop stop-to-stop.
  window.addEventListener('keydown', (e) => {
    const idx = Math.round(progress * (stops - 1));
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') next = Math.min(stops - 1, idx + 1);
    if (e.key === 'ArrowUp' || e.key === 'PageUp') next = Math.max(0, idx - 1);
    if (next !== null) {
      e.preventDefault();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: (next / (stops - 1)) * max, behavior: reduced ? 'auto' : 'smooth' });
    }
  });

  /* --- mouse parallax --- */
  let mouseTX = 0, mouseTY = 0, mouseX = 0, mouseY = 0;
  window.addEventListener('pointermove', (e) => {
    mouseTX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseTY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  /* --- HUD --- */
  function setActiveStop(idx) {
    if (idx === activeStop) return;
    activeStop = idx;
    panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    hudSector.textContent = SECTORS[idx] || SECTORS[0];
    hudIndex.textContent = `${pad(Math.min(Math.max(idx, 0), 5))} / 05`;
  }

  function updateClock() {
    const d = new Date();
    hudTime.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  updateClock();
  setInterval(updateClock, 30000);

  /* ---------- 7. loader ---------- */
  let worldReady = false;
  function runLoader() {
    const t0 = performance.now();
    const DURATION = reduced ? 200 : 1300;
    (function step() {
      const t = Math.min(1, (performance.now() - t0) / DURATION);
      loaderCount.textContent = String(Math.floor(t * 100)).padStart(3, '0');
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        document.body.classList.add('world-ready');
        worldReady = true;
      }
    })();
  }

  /* ---------- 8. the frame loop ---------- */
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); tick(); }
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    fallback(new Error('WebGL context lost'));
  });

  let firstFrame = true;

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);

    const t = clock.getElapsedTime() * (reduced ? 0.15 : 1);

    // camera glide
    progress = reduced ? targetProgress : lerp(progress, targetProgress, CONFIG.camLerp);
    mouseX = lerp(mouseX, mouseTX, 0.05);
    mouseY = lerp(mouseY, mouseTY, 0.05);

    const z = CAM_BASE_Z - progress * pathLength;
    const swayX = Math.sin(z * 0.09) * 1.8;
    const swayY = Math.cos(z * 0.07) * 1.1;
    camera.position.set(
      swayX + mouseX * CONFIG.parallax,
      swayY - mouseY * CONFIG.parallax * 0.6,
      z
    );
    camera.lookAt(swayX * 0.5 + mouseX, swayY * 0.5 - mouseY * 0.5, z - 16);

    // sky follows so the dark is endless
    sky.position.copy(camera.position);

    // animate matter
    nebulaMat.uniforms.uTime.value = t;
    stars.material.uniforms.uTime.value = t;
    dust.material.uniforms.uTime.value = t;
    for (const s of shards) {
      s.group.rotation.y += s.rotSpeed * 0.004;
      s.group.rotation.x += s.rotSpeed * 0.002;
      s.group.position.y = s.baseY + Math.sin(t * s.bobSpeed + s.bobPhase) * 0.5;
    }
    planetGroup.rotation.y += 0.0003;

    // HUD
    setActiveStop(Math.round(progress * (stops - 1)));
    progressFill.style.width = `${(progress * 100).toFixed(2)}%`;

    renderer.render(scene, camera);

    if (firstFrame) {
      firstFrame = false;
      runLoader();
    }
  }

  /* --- resize --- */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2);
    renderer.setPixelRatio(pr);
    stars.material.uniforms.uPixelRatio.value = pr;
    dust.material.uniforms.uPixelRatio.value = pr;
    onScroll();
  });

  onScroll();
  setActiveStop(0);
  tick();
}

/* ---------- go ---------- */
if (!webglOK()) {
  fallback();
} else {
  try {
    init();
  } catch (err) {
    fallback(err);
  }
}
