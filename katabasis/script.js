/* ============================================================
   KATABASIS — v3 engine · PSM
   A wordless descent. Four pillars:
   1. Cinematic materials  — true glass (transmission, iridescence)
   2. Volumetric atmosphere — light blades + drifting fog banks
   3. Reactive matter       — the world answers cursor + touch
   4. Filmic post           — bloom, grain, chromatic aberration
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ---------------- config ---------------- */

const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth <= 720;
const isPortrait = () => innerHeight > innerWidth * 1.05;
const PR_CAP = isMobile ? 1.25 : 1.6;

const CHAMBERS = [
  { // I — the violet gate
    nebA: '#0b0620', nebB: '#1b0f3a',
    accA: '#8f6bff', accB: '#37e6d4',
    glass: '#120a24', atten: '#5b3bd6',
  },
  { // II — the ember hollow
    nebA: '#160604', nebB: '#2a0d05',
    accA: '#ff7a3c', accB: '#ffd166',
    glass: '#1c0a05', atten: '#c4501e',
  },
  { // III — the pale deep
    nebA: '#020a0c', nebB: '#07222a',
    accA: '#9ffcf0', accB: '#5b8cff',
    glass: '#03141a', atten: '#1e8c96',
  },
];

const SPACING = 46;                 // vertical distance between chambers
const MAX_DEPTH = CHAMBERS.length - 1;

const CFG = {
  bloomStrength: isMobile ? 0.55 : 0.85,
  bloomRadius: 0.85,
  bloomThreshold: 0.16,
  particles: isMobile ? 900 : 1800,
  beltCount: isMobile ? 60 : 96,
  blades: isMobile ? 4 : 7,
  fogSlabs: isMobile ? 4 : 7,
  lift: isMobile ? 1.35 : 1.0,
};

/* ---------------- glsl helpers ---------------- */

const GLSL_NOISE = /* glsl */`
  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

/* ---------------- boot ---------------- */

function boot() {
  const canvas = document.getElementById('kata');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, PR_CAP));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(CHAMBERS[0].nebA), 0.012);

  const camera = new THREE.PerspectiveCamera(isPortrait() ? 70 : 58, innerWidth / innerHeight, 0.1, 700);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, 4, 17);
  scene.add(camera);

  // environment for physical materials
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.2).texture;

  // lights ride with the camera, tinted per chamber
  const keyLight = new THREE.PointLight(0xffffff, 40, 90, 1.9);
  keyLight.position.set(6, 3, 4);
  camera.add(keyLight);
  const fillLight = new THREE.PointLight(0xffffff, 22, 70, 2.0);
  fillLight.position.set(-7, -4, 2);
  camera.add(fillLight);

  /* ---------------- state ---------------- */

  const S = {
    t: 0,
    depth: 0,            // smoothed 0..MAX_DEPTH
    targetDepth: 0,
    pointer: new THREE.Vector2(0, 0),     // NDC
    pointerWorld: new THREE.Vector3(0, 0, 0),
    pulseAt: -99,        // time of last click shockwave
    pulseFrom: new THREE.Vector3(),
    heroes: [],
    belts: [],
    blades: [],
    slabs: [],
    cores: [],
    started: performance.now() / 1000,
  };

  const colA = new THREE.Color(), colB = new THREE.Color();
  const nebA = new THREE.Color(), nebB = new THREE.Color();
  const fogCol = new THREE.Color();

  /* ---------------- sky: breathing nebula ---------------- */

  const nebulaMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(CHAMBERS[0].nebA) },
      uColB: { value: new THREE.Color(CHAMBERS[0].nebB) },
      uLift: { value: CFG.lift },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime, uLift;
      uniform vec3 uColA, uColB;
      ${GLSL_NOISE}
      void main() {
        vec2 p = vec2(atan(vDir.x, vDir.z) * 1.2, vDir.y * 2.2);
        float n1 = fbm(p * 1.6 + uTime * 0.008);
        float n2 = fbm(p * 3.4 - uTime * 0.005 + 7.31);
        vec3 col = mix(uColA, uColB, smoothstep(0.25, 0.8, n1));
        col += uColB * pow(n2, 3.0) * 0.55;
        col *= 0.85 + 0.15 * sin(uTime * 0.05 + n1 * 6.2831);
        gl_FragColor = vec4(col * uLift, 1.0);
      }
    `,
  });
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(300, 40, 40), nebulaMat);
  scene.add(nebula);

  /* stars */
  {
    const n = isMobile ? 700 : 1400;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(260 + Math.random() * 30);
      pos.set([v.x, v.y, v.z], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aSeed;
        varying float vTw;
        uniform float uTime;
        void main() {
          vTw = 0.5 + 0.5 * sin(uTime * (0.4 + aSeed) + aSeed * 40.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.0 + aSeed * 2.2) * (200.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vTw;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * (0.25 + 0.75 * vTw);
          gl_FragColor = vec4(vec3(0.85, 0.87, 1.0) * a, a);
        }
      `,
    });
    const stars = new THREE.Points(g, m);
    scene.add(stars);
    S.starsMat = m;
  }

  /* ---------------- chambers ---------------- */

  CHAMBERS.forEach((ch, i) => {
    const y = -i * SPACING;
    const group = new THREE.Group();
    group.position.set(0, y, 0);
    scene.add(group);

    const A = new THREE.Color(ch.accA), B = new THREE.Color(ch.accB);

    /* -- pillar 1: the glass hero -- */
    const heroGeo = new THREE.IcosahedronGeometry(3.1, 1);
    let heroMat;
    if (!isMobile) {
      heroMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(ch.glass),
        transmission: 1.0,
        thickness: 3.2,
        ior: 1.45,
        roughness: 0.07,
        metalness: 0.0,
        attenuationColor: new THREE.Color(ch.atten),
        attenuationDistance: 5.5,
        iridescence: 1.0,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [120, 480],
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.5,
        specularIntensity: 1.0,
      });
    } else {
      // transmission is brutal on phone GPUs — iridescent obsidian instead
      heroMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(ch.glass),
        roughness: 0.14,
        metalness: 0.55,
        iridescence: 1.0,
        iridescenceIOR: 1.3,
        clearcoat: 1.0,
        clearcoatRoughness: 0.2,
        envMapIntensity: 1.7,
      });
    }
    const hero = new THREE.Mesh(heroGeo, heroMat);
    group.add(hero);
    S.heroes.push(hero);

    // molten core inside the glass
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.15, 2),
      new THREE.MeshBasicMaterial({ color: A, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    );
    group.add(core);
    S.cores.push(core);

    const heroLight = new THREE.PointLight(A, 60, 40, 1.8);
    group.add(heroLight);

    /* -- pillar 3: the reactive belt -- */
    const beltMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0b14,
      roughness: 0.22,
      metalness: 0.85,
      iridescence: 0.9,
      iridescenceIOR: 1.35,
      envMapIntensity: 1.4,
      emissive: A,
      emissiveIntensity: 0.06,
    });
    const belt = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.34, 0), beltMat, CFG.beltCount);
    const beltData = [];
    for (let k = 0; k < CFG.beltCount; k++) {
      beltData.push({
        r: 6.2 + Math.random() * 3.4,
        a: Math.random() * Math.PI * 2,
        v: (0.04 + Math.random() * 0.08) * (Math.random() < 0.5 ? 1 : -1),
        tilt: (Math.random() - 0.5) * 2.4,
        s: 0.5 + Math.random() * 1.3,
        spin: Math.random() * Math.PI * 2,
        push: new THREE.Vector3(),
      });
    }
    group.add(belt);
    S.belts.push({ mesh: belt, data: beltData, mat: beltMat, group });

    /* -- pillar 2a: volumetric light blades -- */
    for (let k = 0; k < CFG.blades; k++) {
      const bladeMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uCol: { value: (k % 2 ? B : A).clone() },
          uSeed: { value: Math.random() * 10 },
          uPulse: { value: 0 },
        },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */`
          varying vec2 vUv;
          uniform float uTime, uSeed, uPulse;
          uniform vec3 uCol;
          ${GLSL_NOISE}
          void main() {
            float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
            float len = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.4, vUv.y);
            float n = 0.35 + 0.65 * vnoise(vec2(vUv.y * 5.0 - uTime * 0.1, uSeed));
            float breathe = 0.55 + 0.45 * sin(uTime * 0.22 + uSeed * 6.0);
            float a = edge * edge * len * n * breathe * (0.34 + uPulse);
            gl_FragColor = vec4(uCol * a, a);
          }
        `,
      });
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + Math.random() * 1.4, 24 + Math.random() * 10), bladeMat);
      const ang = (k / CFG.blades) * Math.PI * 2 + Math.random() * 0.7;
      const rad = 4.6 + Math.random() * 2.4;
      blade.position.set(Math.cos(ang) * rad, 2 + Math.random() * 4, Math.sin(ang) * rad);
      blade.rotation.y = -ang + Math.PI / 2;
      blade.rotation.z = (Math.random() - 0.5) * 0.35;
      group.add(blade);
      S.blades.push({ mesh: blade, mat: bladeMat, baseAng: ang, rad, group });
    }

    /* -- pillar 2b: drifting fog banks -- */
    for (let k = 0; k < CFG.fogSlabs; k++) {
      const slabMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uCol: { value: new THREE.Color(ch.nebB).lerp(A, 0.35) },
          uSeed: { value: Math.random() * 20 },
          uAlpha: { value: 0.05 + Math.random() * 0.06 },
        },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */`
          varying vec2 vUv;
          uniform float uTime, uSeed, uAlpha;
          uniform vec3 uCol;
          ${GLSL_NOISE}
          void main() {
            float n = fbm(vUv * vec2(3.0, 1.6) + vec2(uTime * 0.014, uSeed));
            float fade = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x)
                       * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
            float a = smoothstep(0.42, 0.85, n) * fade * uAlpha;
            gl_FragColor = vec4(uCol, a);
          }
        `,
      });
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(90 + Math.random() * 50, 34 + Math.random() * 18), slabMat);
      slab.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 26, -14 - Math.random() * 26);
      group.add(slab);
      S.slabs.push({ mesh: slab, mat: slabMat });
    }
  });

  /* ---------------- pillar 3: reactive dust ocean ---------------- */

  const dust = (() => {
    const n = CFG.particles;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    const span = SPACING * CHAMBERS.length + 40;
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 70, 20 - Math.random() * span, (Math.random() - 0.5) * 60], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCol: { value: new THREE.Color(CHAMBERS[0].accA) },
        uPointer: { value: new THREE.Vector3(999, 999, 999) },
        uPulseAt: { value: -99 },
        uPulseFrom: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */`
        attribute float aSeed;
        varying float vGlow;
        uniform float uTime, uPulseAt;
        uniform vec3 uPointer, uPulseFrom;
        void main() {
          vec3 p = position;
          // slow curl-ish drift
          p.x += sin(uTime * 0.11 + aSeed * 40.0 + p.y * 0.05) * 1.6;
          p.y += sin(uTime * 0.07 + aSeed * 31.0) * 1.1;
          p.z += cos(uTime * 0.09 + aSeed * 23.0 + p.x * 0.04) * 1.6;
          // cursor repulsion — the dark moves out of your way
          vec3 away = p - uPointer;
          float d = length(away);
          p += normalize(away + 0.0001) * (2.6 / (1.0 + d * d * 0.25)) * step(d, 9.0);
          // click shockwave — a ring of held breath
          float age = uTime - uPulseAt;
          float ring = abs(length(p - uPulseFrom) - age * 22.0);
          vGlow = (1.0 - smoothstep(0.0, 3.0, ring)) * exp(-age * 0.9) * step(0.0, age);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.4 + aSeed * 2.4 + vGlow * 3.0) * (160.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vGlow;
        uniform vec3 uCol;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.08, d) * (0.34 + vGlow * 1.6);
          gl_FragColor = vec4(mix(uCol, vec3(1.0), vGlow * 0.7) * a, a);
        }
      `,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    return m;
  })();

  /* ---------------- pillar 4: filmic pass ---------------- */

  const FilmicShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uCA: { value: isMobile ? 0.0022 : 0.0032 },
      uGrain: { value: 0.055 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uTime, uCA, uGrain;
      uniform vec2 uRes;
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      void main() {
        vec2 c = vUv - 0.5;
        float r2 = dot(c, c);
        // chromatic aberration, stronger at edges
        vec2 off = c * uCA * (0.5 + r2 * 3.0);
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
        // fine animated grain, heavier in shadow
        float g = hash21(vUv * uRes + fract(uTime) * 61.7) - 0.5;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col += g * uGrain * (1.0 - lum * 0.8);
        // gentle lens darkening
        col *= 1.0 - r2 * 0.55;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(devicePixelRatio, PR_CAP));
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    isMobile ? new THREE.Vector2(384, 384) : new THREE.Vector2(innerWidth, innerHeight),
    CFG.bloomStrength, CFG.bloomRadius, CFG.bloomThreshold
  ));
  composer.addPass(new OutputPass());
  const filmic = new ShaderPass(FilmicShader);
  composer.addPass(filmic);

  /* ---------------- input ---------------- */

  const raycaster = new THREE.Raycaster();
  const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function updatePointer(x, y) {
    S.pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(S.pointer, camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(pointerPlane, hit)) S.pointerWorld.copy(hit);
  }

  addEventListener('pointermove', (e) => updatePointer(e.clientX, e.clientY), { passive: true });

  addEventListener('pointerdown', (e) => {
    updatePointer(e.clientX, e.clientY);
    S.pulseAt = S.t;
    S.pulseFrom.copy(S.pointerWorld);
    document.getElementById('hint').classList.add('gone');
  }, { passive: true });

  // descent: wheel
  addEventListener('wheel', (e) => {
    S.targetDepth = THREE.MathUtils.clamp(S.targetDepth + e.deltaY * 0.00055, 0, MAX_DEPTH);
    document.getElementById('hint').classList.add('gone');
  }, { passive: true });

  // descent: touch drag
  let touchY = null;
  addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (touchY === null) return;
    const dy = touchY - e.touches[0].clientY;
    touchY = e.touches[0].clientY;
    S.targetDepth = THREE.MathUtils.clamp(S.targetDepth + dy * 0.0032, 0, MAX_DEPTH);
    document.getElementById('hint').classList.add('gone');
  }, { passive: true });
  addEventListener('touchend', () => { touchY = null; }, { passive: true });

  /* resize + orientation */
  let lastW = innerWidth, lastH = innerHeight;
  addEventListener('resize', () => {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 140) return;
    lastW = innerWidth; lastH = innerHeight;
    camera.fov = isPortrait() ? 70 : 58;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    filmic.uniforms.uRes.value.set(innerWidth, innerHeight);
  });

  /* ---------------- frame loop ---------------- */

  const depthEl = document.getElementById('depth');
  const dummy = new THREE.Object3D();
  const tmpV = new THREE.Vector3();

  function tick() {
    requestAnimationFrame(tick);
    S.t = performance.now() / 1000 - S.started;
    const t = S.t;

    // ease the descent + tiny constant sink (the abyss pulls)
    S.targetDepth = Math.min(MAX_DEPTH, S.targetDepth + 0.00008);
    S.depth += (S.targetDepth - S.depth) * 0.045;

    const di = Math.min(CHAMBERS.length - 2, Math.floor(S.depth));
    const df = S.depth - di;
    const chA = CHAMBERS[di], chB = CHAMBERS[Math.min(di + 1, CHAMBERS.length - 1)];

    // palette crossfade
    colA.set(chA.accA).lerp(colB.set(chB.accA), df);
    const accB2 = new THREE.Color(chA.accB).lerp(new THREE.Color(chB.accB), df);
    nebA.set(chA.nebA).lerp(new THREE.Color(chB.nebA), df);
    nebB.set(chA.nebB).lerp(new THREE.Color(chB.nebB), df);
    nebulaMat.uniforms.uColA.value.copy(nebA);
    nebulaMat.uniforms.uColB.value.copy(nebB);
    scene.fog.color.copy(fogCol.copy(nebA).lerp(nebB, 0.4));
    keyLight.color.copy(colA);
    fillLight.color.copy(accB2);
    dust.uniforms.uCol.value.copy(colA);

    // camera rides the descent; pointer gives parallax lean
    const camY = -S.depth * SPACING + 4;
    camera.position.y += (camY - camera.position.y) * 0.06;
    camera.position.x += (S.pointer.x * 2.2 - camera.position.x) * 0.04;
    camera.position.z = 17;
    camera.lookAt(tmpV.set(S.pointer.x * 3.5, camera.position.y - 3 - S.pointer.y * -2.5, 0));
    nebula.position.copy(camera.position);

    // pointer plane follows camera depth so raycast lands in the active chamber
    pointerPlane.constant = 0;

    // shared uniforms
    nebulaMat.uniforms.uTime.value = t;
    S.starsMat.uniforms.uTime.value = t;
    dust.uniforms.uTime.value = t;
    dust.uniforms.uPointer.value.copy(S.pointerWorld);
    dust.uniforms.uPulseAt.value = S.pulseAt;
    dust.uniforms.uPulseFrom.value.copy(S.pulseFrom);
    filmic.uniforms.uTime.value = t;

    const pulseAge = t - S.pulseAt;
    const pulseGlow = Math.exp(-pulseAge * 1.4) * (pulseAge > 0 ? 1 : 0);

    // heroes breathe + tilt away from the cursor
    S.heroes.forEach((hero, i) => {
      hero.rotation.y = t * 0.06 + i;
      hero.rotation.x = Math.sin(t * 0.045 + i * 2.0) * 0.22;
      const s = 1 + Math.sin(t * 0.3 + i) * 0.012;
      hero.scale.setScalar(s);
      // lean: cursor pushes the crystal off its axis, it eases back
      hero.rotation.z += ((S.pointer.x * -0.14) - hero.rotation.z) * 0.03;
    });
    S.cores.forEach((core, i) => {
      const b = 0.86 + Math.sin(t * 0.7 + i * 1.7) * 0.14 + pulseGlow * 0.5;
      core.scale.setScalar(b);
      core.material.opacity = 0.55 + 0.35 * Math.sin(t * 0.5 + i) + pulseGlow * 0.4;
    });

    // belts: orbit + cursor repulsion (matter avoids your hand)
    S.belts.forEach(({ mesh, data, mat, group }) => {
      const gy = group.position.y;
      for (let k = 0; k < data.length; k++) {
        const d = data[k];
        d.a += d.v * 0.016;
        const bx = Math.cos(d.a) * d.r;
        const bz = Math.sin(d.a) * d.r;
        const by = Math.sin(d.a * 2 + d.tilt) * 1.6;
        // world-space distance to pointer
        tmpV.set(bx, by + gy, bz).sub(S.pointerWorld);
        const dist = tmpV.length();
        if (dist < 6) {
          tmpV.normalize().multiplyScalar((6 - dist) * 0.55);
          d.push.lerp(tmpV, 0.12);
        } else {
          d.push.lerp(tmpV.set(0, 0, 0), 0.05);
        }
        dummy.position.set(bx + d.push.x, by + d.push.y, bz + d.push.z);
        dummy.rotation.set(d.spin + t * d.v * 8, d.a, d.tilt);
        dummy.scale.setScalar(d.s * 0.9);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mat.emissiveIntensity = 0.06 + pulseGlow * 0.9;
      mat.emissive.copy(colA);
    });

    // blades: slow orbit, pulse flare
    S.blades.forEach(({ mesh, mat, baseAng, rad, group }, k) => {
      const a = baseAng + t * 0.015 * (k % 2 ? 1 : -1);
      mesh.position.x = Math.cos(a) * rad;
      mesh.position.z = Math.sin(a) * rad;
      mesh.rotation.y = -a + Math.PI / 2;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uPulse.value = pulseGlow * 0.6;
    });

    S.slabs.forEach(({ mat }) => { mat.uniforms.uTime.value = t; });

    // depth readout: metres of nothing
    depthEl.textContent = String(Math.round(S.depth * 333)).padStart(3, '0');

    composer.render();
  }

  tick();
  window.__kataBooted = true;

  /* entry choreography */
  setTimeout(() => document.getElementById('veil').classList.add('gone'), 2900);
  setTimeout(() => {
    const h = document.getElementById('hint');
    if (h) h.classList.remove('gone');
  }, 4200);
}

try { boot(); } catch (err) {
  console.error('[KATABASIS] boot failed:', err);
  document.body.classList.add('no-webgl');
}
