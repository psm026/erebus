/* ============================================================
   EREBUS v2 — the world engine
   Rooms are DATA (world.json). This file only knows how to
   render whatever rooms it is given:
   - each room owns a stretch of the camera path
   - palettes (fog / nebula / dust) crossfade between rooms
   - structures: shard, monolith, ring, orb, swarm, image, egg
   - stops become text panels; eggs are hidden clickables
   Add a room to world.json → commit → the world grows.
   ============================================================ */

import * as THREE from 'three';

/* ---------- tuning ---------- */
const CONFIG = {
  segment: 34,
  camLerp: 0.06,
  paletteLerp: 0.035,
  parallax: 1.7,
  starCount: 2200,
  dustCount: 700,
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
const isMobile = window.matchMedia('(max-width: 720px)').matches;

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
    vec3 col = vec3(0.010, 0.010, 0.024);
    col += uColA * smoothstep(0.55, 0.92, n);
    col += uColB * smoothstep(0.60, 0.95, n2);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const POINTS_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uDrift;
  varying float vTw;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.12 + aPhase * 6.2831) * uDrift;
    p.y += cos(uTime * 0.09 + aPhase * 12.566) * uDrift * 0.75;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vTw = 0.65 + 0.35 * sin(uTime * (0.6 + aPhase) + aPhase * 20.0);
    gl_PointSize = aSize * uPixelRatio * (140.0 / max(1.0, -mv.z)) * vTw;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINTS_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.06, d) * vTw * uAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

const RIM_VERT = /* glsl */ `
  varying float vFres;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFres = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 2.5);
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

/* ---------- geometry helpers ---------- */
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function shardGeometry(radius) {
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

function rimMaterial(color, intensity) {
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

function pointsCloud(count, positionFn, color, sizeRange, alpha, drift) {
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
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      uDrift: { value: drift },
    },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

/* ---------- panel DOM ---------- */
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
  html += `<${H}>${stop.title}</${H}>`;
  if (stop.tags) html += `<p class="p-tags">${stop.tags}</p>`;
  if (stop.body) html += `<p class="${variant === 'intro' ? 'lede' : 'p-desc'}">${stop.body}</p>`;
  if (stop.link) html += `<a class="p-link${variant === 'contact' ? ' contact-link' : ''}" href="${stop.link.href}">${stop.link.label}</a>`;
  sec.innerHTML = html;
  content.appendChild(sec);
  return sec;
}

/* ---------- the world ---------- */
async function init() {
  const world = await fetch('./world.json?v=' + Date.now()).then((r) => r.json());
  const rooms = world.rooms;

  /* --- flatten stops; compute room ranges --- */
  const CAM_BASE_Z = 10;
  const seg = CONFIG.segment;
  const allStops = [];
  rooms.forEach((room) => {
    room.firstStop = allStops.length;
    room.stops.forEach((stop) => allStops.push({ stop, room }));
    room.lastStop = allStops.length - 1;
    room.zStart = CAM_BASE_Z - (room.firstStop - 0.5) * seg;  // nearer edge
    room.zEnd = CAM_BASE_Z - (room.lastStop + 0.5) * seg;     // farther edge
  });
  const totalStops = allStops.length;
  const pathLength = (totalStops - 1) * seg;

  /* --- panels --- */
  const panels = allStops.map((s, i) => buildPanel(s.stop, s.room, i));

  /* --- renderer / scene / camera --- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(rooms[0].fog, 0.011);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 0, CAM_BASE_Z);
  scene.add(camera);

  scene.add(new THREE.AmbientLight(0x24203f, 0.8));
  const key = new THREE.DirectionalLight(0x8ea0ff, 1.2);
  key.position.set(4, 8, 6);
  scene.add(key);
  const lightA = new THREE.PointLight(0xffffff, 90, 70, 2);
  lightA.position.set(-6, 3, -6);
  camera.add(lightA);
  const lightB = new THREE.PointLight(0xffffff, 60, 60, 2);
  lightB.position.set(7, -4, -10);
  camera.add(lightB);

  /* --- sky (follows camera) --- */
  const sky = new THREE.Group();
  scene.add(sky);
  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(rooms[0].nebulaA) },
      uColB: { value: new THREE.Color(rooms[0].nebulaB) },
    },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(260, 32, 32), nebulaMat));
  const stars = pointsCloud(
    CONFIG.starCount,
    () => new THREE.Vector3().randomDirection().multiplyScalar(rand(90, 240)),
    0xdfe6ff, [0.8, 2.4], 1.0, 0.0
  );
  sky.add(stars);

  /* --- dust along the whole path --- */
  const dust = pointsCloud(
    CONFIG.dustCount,
    () => new THREE.Vector3(rand(-36, 36), rand(-20, 20), 30 - Math.random() * (pathLength + 110)),
    rooms[0].dust, [0.5, 1.4], 0.55, 1.6
  );
  scene.add(dust);

  /* --- structures --- */
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x0b0a12, roughness: 0.18, metalness: 0.85, flatShading: true });
  const monoMat = new THREE.MeshStandardMaterial({ color: 0x08070d, roughness: 0.35, metalness: 0.6 });
  const animated = [];
  const eggMeshes = [];
  const texLoader = new THREE.TextureLoader();

  function accent(room, key) { return key === 'B' ? room.accentB : room.accentA; }

  function place(group, room, i, spec) {
    if (spec.anchor) {
      const stopIdx = room.firstStop + 1 + (i % Math.max(1, room.stops.length - 1));
      const z = CAM_BASE_Z - stopIdx * seg - 12;
      group.position.set(8 + (i % 3) * 1.5, rand(-1.5, 2.5), z);
    } else {
      const side = i % 2 ? 1 : -1;
      group.position.set(
        side * rand(10, 28),
        rand(-14, 14),
        rand(room.zEnd - 10, room.zStart)
      );
    }
    group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    animated.push({
      group,
      baseY: group.position.y,
      rotSpeed: rand(0.05, 0.17),
      bobSpeed: rand(0.2, 0.5),
      bobPhase: Math.random() * Math.PI * 2,
    });
  }

  function buildStructure(spec, room) {
    const count = spec.count || 1;
    const col = accent(room, spec.rim || 'A');
    const intensity = spec.intensity != null ? spec.intensity : 1.1;
    for (let i = 0; i < count; i++) {
      const s = rand(spec.scale[0], spec.scale[1]);
      const group = new THREE.Group();

      if (spec.kind === 'shard') {
        const geo = shardGeometry(s);
        group.add(new THREE.Mesh(geo, shardMat));
        const rim = new THREE.Mesh(geo, rimMaterial(col, intensity));
        rim.scale.setScalar(1.045);
        group.add(rim);

      } else if (spec.kind === 'monolith') {
        const geo = new THREE.BoxGeometry(s * 0.22, s, s * 0.1);
        group.add(new THREE.Mesh(geo, monoMat));
        const rim = new THREE.Mesh(geo, rimMaterial(col, intensity * 0.8));
        rim.scale.setScalar(1.03);
        group.add(rim);

      } else if (spec.kind === 'ring') {
        const geo = new THREE.TorusGeometry(s, s * 0.012, 8, 96);
        const mat = new THREE.MeshBasicMaterial({
          color: col, transparent: true, opacity: spec.opacity != null ? spec.opacity : 0.3,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        group.add(new THREE.Mesh(geo, mat));

      } else if (spec.kind === 'orb') {
        const geo = new THREE.SphereGeometry(s * 0.5, 24, 24);
        group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 0.4, metalness: 0.2 })));
        const rim = new THREE.Mesh(geo, rimMaterial(col, intensity));
        rim.scale.setScalar(1.15);
        group.add(rim);

      } else if (spec.kind === 'swarm') {
        group.add(pointsCloud(
          isMobile ? 140 : 260,
          () => new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * s),
          col, [0.4, 1.1], 0.8, 2.2
        ));

      } else if (spec.kind === 'image' && spec.src) {
        const tex = texLoader.load(spec.src);
        tex.colorSpace = THREE.SRGBColorSpace;
        const geo = new THREE.PlaneGeometry(s, s * (spec.ratio || 0.66));
        group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
        })));

      } else if (spec.kind === 'egg') {
        const geo = new THREE.SphereGeometry(spec.scale[0], 16, 16);
        const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col }));
        const rim = new THREE.Mesh(geo, rimMaterial(col, intensity));
        rim.scale.setScalar(2.2);
        group.add(core);
        group.add(rim);
        core.userData.secret = spec.secret;
        eggMeshes.push(core);
        group.position.set(rand(-6, 6), rand(10, 15) * (Math.random() > 0.5 ? 1 : -1), rand(room.zEnd, room.zStart) - 4);
        scene.add(group);
        animated.push({ group, baseY: group.position.y, rotSpeed: 0.1, bobSpeed: 0.6, bobPhase: Math.random() * 6 });
        continue;
      } else {
        continue;
      }

      scene.add(group);
      place(group, room, i, spec);
    }
  }

  rooms.forEach((room) => room.structures.forEach((spec) => buildStructure(spec, room)));

  /* --- planet, in whichever room asks for it --- */
  const planetRoom = rooms.find((r) => r.planet);
  let planetGroup = null;
  if (planetRoom) {
    planetGroup = new THREE.Group();
    const geo = new THREE.SphereGeometry(46, 48, 48);
    planetGroup.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x05050c, roughness: 0.95, metalness: 0.1 })));
    const atmo = new THREE.Mesh(geo, rimMaterial(planetRoom.accentA, 1.3));
    atmo.scale.setScalar(1.06);
    planetGroup.add(atmo);
    planetGroup.position.set(26, -34, planetRoom.zEnd - 55);
    scene.add(planetGroup);
  }

  /* --- scroll / progress --- */
  document.getElementById('scroll-space').style.height = `${totalStops * 120}vh`;
  let targetProgress = 0, progress = 0, activeStop = -1;

  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    targetProgress = max > 0 ? window.scrollY / max : 0;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('keydown', (e) => {
    const idx = Math.round(progress * (totalStops - 1));
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') next = Math.min(totalStops - 1, idx + 1);
    if (e.key === 'ArrowUp' || e.key === 'PageUp') next = Math.max(0, idx - 1);
    if (next !== null) {
      e.preventDefault();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: (next / (totalStops - 1)) * max, behavior: reduced ? 'auto' : 'smooth' });
    }
  });

  /* --- pointer: parallax + egg raycast --- */
  let mouseTX = 0, mouseTY = 0, mouseX = 0, mouseY = 0;
  window.addEventListener('pointermove', (e) => {
    mouseTX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseTY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  const raycaster = new THREE.Raycaster();
  const clickNDC = new THREE.Vector2();
  window.addEventListener('pointerdown', (e) => {
    if (!eggMeshes.length) return;
    clickNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(clickNDC, camera);
    const hits = raycaster.intersectObjects(eggMeshes, false);
    if (hits.length) {
      const secret = hits[0].object.userData.secret || {};
      eggVeil.querySelector('.egg-eyebrow').textContent = secret.eyebrow || 'FOUND';
      eggVeil.querySelector('.egg-title').textContent = secret.title || '';
      eggVeil.querySelector('.egg-body').textContent = secret.body || '';
      document.body.classList.add('egg-open');
    }
  });
  eggVeil.querySelector('.egg-close').addEventListener('click', () => {
    document.body.classList.remove('egg-open');
  });

  /* --- HUD --- */
  function setActiveStop(idx) {
    if (idx === activeStop) return;
    activeStop = idx;
    panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    hudSector.textContent = allStops[idx] ? allStops[idx].room.sector : '';
    hudIndex.textContent = `${pad(idx)} / ${pad(totalStops - 1)}`;
  }
  function updateClock() {
    const d = new Date();
    hudTime.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  updateClock();
  setInterval(updateClock, 30000);

  /* --- palette crossfade state --- */
  const fogTarget = new THREE.Color(rooms[0].fog);
  const nebATarget = new THREE.Color(rooms[0].nebulaA);
  const nebBTarget = new THREE.Color(rooms[0].nebulaB);
  const dustTarget = new THREE.Color(rooms[0].dust);
  const lightATarget = new THREE.Color(rooms[0].accentA);
  const lightBTarget = new THREE.Color(rooms[0].accentB);

  function roomAtZ(z) {
    for (const r of rooms) if (z <= r.zStart && z >= r.zEnd) return r;
    return z > rooms[0].zEnd ? rooms[0] : rooms[rooms.length - 1];
  }

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
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); tick(); }
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    fallback(new Error('WebGL context lost'));
  });

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const t = clock.getElapsedTime() * (reduced ? 0.15 : 1);

    progress = reduced ? targetProgress : lerp(progress, targetProgress, CONFIG.camLerp);
    mouseX = lerp(mouseX, mouseTX, 0.05);
    mouseY = lerp(mouseY, mouseTY, 0.05);

    const z = CAM_BASE_Z - progress * pathLength;
    const swayX = Math.sin(z * 0.09) * 1.8;
    const swayY = Math.cos(z * 0.07) * 1.1;
    camera.position.set(swayX + mouseX * CONFIG.parallax, swayY - mouseY * CONFIG.parallax * 0.6, z);
    camera.lookAt(swayX * 0.5 + mouseX, swayY * 0.5 - mouseY * 0.5, z - 16);
    sky.position.copy(camera.position);

    /* palette crossfade toward the current room */
    const room = roomAtZ(z);
    fogTarget.set(room.fog); nebATarget.set(room.nebulaA); nebBTarget.set(room.nebulaB);
    dustTarget.set(room.dust); lightATarget.set(room.accentA); lightBTarget.set(room.accentB);
    const pl = CONFIG.paletteLerp;
    scene.fog.color.lerp(fogTarget, pl);
    nebulaMat.uniforms.uColA.value.lerp(nebATarget, pl);
    nebulaMat.uniforms.uColB.value.lerp(nebBTarget, pl);
    dust.material.uniforms.uColor.value.lerp(dustTarget, pl);
    lightA.color.lerp(lightATarget, pl);
    lightB.color.lerp(lightBTarget, pl);

    nebulaMat.uniforms.uTime.value = t;
    stars.material.uniforms.uTime.value = t;
    dust.material.uniforms.uTime.value = t;
    for (const s of animated) {
      s.group.rotation.y += s.rotSpeed * 0.004;
      s.group.rotation.x += s.rotSpeed * 0.002;
      s.group.position.y = s.baseY + Math.sin(t * s.bobSpeed + s.bobPhase) * 0.5;
      const first = s.group.children[0];
      if (first && first.isPoints) first.material.uniforms.uTime.value = t;
    }
    if (planetGroup) planetGroup.rotation.y += 0.0003;

    setActiveStop(Math.round(progress * (totalStops - 1)));
    progressFill.style.width = `${(progress * 100).toFixed(2)}%`;

    renderer.render(scene, camera);
    if (firstFrame) { firstFrame = false; runLoader(); }
  }

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
  init().catch(fallback);
}
