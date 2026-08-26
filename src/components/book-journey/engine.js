/* eslint-disable */
// @ts-nocheck
/**
 * BOOK JOURNEY — ENGINE
 *
 * PORTED, NOT REWRITTEN. This is the implementation from
 *   frontend/Book journey scroll experience/Malnad Stories Hero.dc.html
 * (the `class Component extends DCLogic` body, lines 204–2791), moved here essentially verbatim.
 * The terrain, mountains, characters, mist, clouds, leaves, snow, trail, book, cover artwork,
 * travel scenes, camera choreography, lighting, shadows, procedural textures, spring timing and
 * six-scene progression are all the ORIGINAL code and must stay that way.
 *
 * Only the runtime wrapper changed:
 *   1. `extends DCLogic` → a standalone class the React component drives; refs/props injected.
 *   2. `renderVals()` (the artifact's binding contract) removed; the stage markup carries
 *      `data-mount` / `data-trail` hooks that componentDidMount resolves.
 *   3. Three.js comes from the bundled npm package instead of a runtime CDN import.
 *   4. Input is bound to the section element, and the document-level scroll lock is gone —
 *      see canConsume(). This is the only behavioural change.
 *   5. releaseGL() now disposes geometries/materials/textures as well as the context.
 *
 * eslint/ts are disabled for this file deliberately: it is ported third-party-shaped code and
 * should stay diffable against the artifact, not be reformatted to house style.
 */
import * as THREE from 'three';

const TOTAL = 1460;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class BookJourneyEngine {
  /**
   * Ported from the artifact's `class Component extends DCLogic`. The artifact runtime supplied
   * the refs and the props; the React wrapper passes them in instead. Every terrain, character,
   * atmosphere, book, lighting and choreography method below is the ORIGINAL implementation.
   */
  constructor({ pinRef, stageRef, props, fonts }) {
    this.pinRef = pinRef;
    this.stageRef = stageRef;
    // The artifact bound these with ref="{{ … }}"; the stage markup now carries data hooks.
    this.mountRef = { current: null };
    this.trailRef = { current: null };
    this.props = props;
    // Resolved next/font family names for the procedural canvas textures. Same faces the
    // artifact used; only the name is generated, so it has to be injected rather than literal.
    this.fonts = fonts;
  }

  // bare rock peaks flanking the steep middle of the climb, past the last of the forest:
  // [x, z, radius, height, noise seed]. kept well clear of the trail centreline so they read as
  // the walls of the valley the path threads rather than obstacles on it.
  ROCKS = [[-88, -36, 62, 92, 3.1], [86, -74, 58, 100, 7.4], [-72, -114, 47, 80, 11.7]];

  componentDidMount() {
    this.mountRef.current = this.stageRef.current.querySelector('[data-mount]');
    this.trailRef.current = this.stageRef.current.querySelector('[data-trail]');
    this.mobile = window.innerWidth < 820;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.panels = Array.from(this.stageRef.current.querySelectorAll('[data-panel]'));
    this.ctaEl = this.stageRef.current.querySelector('[data-cta]');
    this.markers = Array.from(this.trailRef.current.querySelectorAll('[data-marker]'));
    this.sceneIdx = 0; this.fromIdx = 0; this.toIdx = 0;
    this.fromU = 0; this.toU = 0; this.tw = 1; this.twV = 0; this.damp = 1;
    this.bandX = 0; this.bandV = 0; this.pending = 0; this.dirNow = 1;
    this.isAnimating = false; this.ctaT = 0; this.opCache = []; this.lastGesture = 0;
    this.panels.forEach(p => { p.style.willChange = 'opacity, transform'; });
    this.cards = this.panels.map(p => p.firstElementChild);
    this.applyProps();
    // NO lock() on mount. The artifact froze the document here; inside the landing page the
    // journey is an ordinary section and the page must stay scrollable at all times.
    this.bindInput();
    window.addEventListener('resize', this.onResize = () => this.resize(), { passive: true });
    this.initThree();
    this.updateDom();
    this.updateTrail();
  }

  componentDidUpdate() { this.applyProps(); }

  componentWillUnmount() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.pump);
    document.removeEventListener('visibilitychange', this.onVis);
    if (this.inputEl) {
      this.inputEl.removeEventListener('wheel', this.onWheel);
      this.inputEl.removeEventListener('keydown', this.onKey);
      this.inputEl.removeEventListener('touchstart', this.onTouchStart);
      this.inputEl.removeEventListener('touchmove', this.onTouchMove);
      this.inputEl = null;
    }
    window.removeEventListener('resize', this.onResize);
    // The window pointermove/pointerup/pointercancel and the capture-phase wheel/keydown that
    // used to be removed here belonged to bindBookDrag, which no longer exists.
    this.dead = true;
    this.releaseGL();
  }

  releaseGL() {
    // Walk the graph and free GPU memory before dropping the context. The artifact could rely on
    // a full page teardown; a client-side route change cannot.
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          for (const k of Object.keys(m)) {
            const v = m[k];
            if (v && v.isTexture) { try { v.dispose(); } catch (e) {} }
          }
          try { m.dispose(); } catch (e) {}
        }
      });
      if (this.scene.background && this.scene.background.isTexture) {
        try { this.scene.background.dispose(); } catch (e) {}
      }
      this.scene = null;
    }
    const r = this.renderer;
    this.renderer = null;
    if (!r) return;
    try { r.forceContextLoss(); } catch (e) {}
    try { r.dispose(); } catch (e) {}
    if (r.domElement) r.domElement.remove();
  }

  applyProps() {
    // spring response (seconds to reach target), not a fixed duration
    this.resp = (this.reduced ? 0.36 : 1.2) / (this.props.transitionSpeed ?? 1);
    this.dur = this.resp;
    this.trailRef.current.style.display = (this.props.showTrail ?? true) ? 'flex' : 'none';
    if (this.scene) this.scene.fog.density = 0.0034 * (this.props.mistDensity ?? 1);
    this.baseFog = 0.0034 * (this.props.mistDensity ?? 1);
    this.leafScale = (this.props.leafDensity ?? 1);
  }

  /* ---------- terrain math ---------- */
  hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
  vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi), b = this.hash(xi + 1, yi), c = this.hash(xi, yi + 1), d = this.hash(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  fbm(x, y, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * (this.vnoise(x * f, y * f) * 2 - 1); f *= 2.03; a *= 0.5; } return s; }
  ridge(x, y, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(this.vnoise(x * f, y * f) * 2 - 1); s += a * n * n; f *= 2.07; a *= 0.52; } return s; }

  pathAt(x, z) {
    const W = this.WXZ; let best = 1e9, bx = 0, bz = 0;
    for (let i = 0; i < W.length - 1; i++) {
      const ax = W[i][0], az = W[i][1], dx = W[i + 1][0] - ax, dz = W[i + 1][1] - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bx = px; bz = pz; }
    }
    return { d: best, x: bx, z: bz };
  }

  distToPath(x, z) { return this.pathAt(x, z).d; }

  // a peak with radial buttresses: ridged noise sampled round the axis, so spurs stand out and
  // gullies cut between them down the fall line. a plain radial falloff gives a smooth cone, and
  // a smooth cone is the one shape real mountains never have.
  spire(x, z, cx, cz, r, k, sd, sharp, freq) {
    const dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz) / r;
    if (d >= 1) return 0;
    const a = Math.atan2(dz, dx);
    const rg = this.ridge(Math.cos(a) * freq + sd, Math.sin(a) * freq + sd, 3);
    // buttresses fade out at the apex, which would otherwise pinch into a spike
    const m = 1 + (rg - 0.45) * 0.85 * ss(0.03, 0.28, d);
    return Math.pow(1 - d, sharp) * k * clamp(m, 0.35, 1.7);
  }

  // raw range: rises steadily inland, then throws up the summit cone
  baseHeight(x, z) {
    const s = 0.0062;
    let h = Math.pow(this.ridge(x * s, z * s, 7), 1.18) * 64 - 10;
    h += this.fbm(x * s * 3.4, z * s * 3.4, 4) * 7;
    h += this.fbm(x * 0.09, z * 0.09, 3) * 2.3;
    h += this.fbm(x * 0.34, z * 0.34, 2) * 0.9;
    h += Math.pow(clamp((122 - z) / 276, 0, 1), 1.35) * 38;
    const d = Math.hypot(x - this.SUM[0], z - this.SUM[1]);
    const cone = Math.pow(clamp(1 - d / 154, 0, 1), 1.4);
    h += cone * 134 + cone * (this.ridge(x * 0.019, z * 0.019, 4) - 0.42) * 38 + cone * this.fbm(x * 0.07, z * 0.07, 3) * 7;
    // the summit pyramid proper: a sharp spire standing out of the broad massif, then flutings —
    // the fine snow ribs that run the full height of a Himalayan face
    h += this.spire(x, z, this.SUM[0], this.SUM[1], 66, 52, 1.7, 1.95, 3.4);
    const dn = d / 154;
    if (dn < 1) {
      const ca = Math.atan2(z - this.SUM[1], x - this.SUM[0]);
      const flute = this.ridge(Math.cos(ca) * 11 + 4.2, Math.sin(ca) * 11 + 4.2, 2);
      h += Math.pow(cone, 1.4) * (flute - 0.44) * 15 * ss(0.04, 0.26, dn);
    }
    for (let i = 0; i < this.ROCKS.length; i++) {
      const p = this.ROCKS[i];
      h += this.spire(x, z, p[0], p[1], p[2], p[3], p[4], 1.9, 2.7);
    }
    // the wall standing behind the summit — what the last scene looks out over
    h += this.spire(x, z, -96, -198, 78, 118, 3.3, 1.75, 2.2)
      + this.spire(x, z, 84, -214, 70, 102, 8.1, 1.8, 2.4)
      + this.spire(x, z, 12, -236, 62, 88, 5.5, 1.9, 2.6);
    return h;
  }

  // the trail is a graded bench cut along the centreline, so it climbs with the mountain
  height(x, z) {
    const p = this.pathAt(x, z);
    const b = this.baseHeight(x, z);
    const g = (1 - ss(3.5, 16, p.d)) * (1 - ss(50, 88, b));
    return b * (1 - g) + (this.baseHeight(p.x, p.z) - 1.1) * g;
  }

  // exactly where the drawn mesh is: the terrain is a triangulated plane, so read the height off
  // the same triangle the renderer draws. anything analytic (height() alone, or a bilinear guess)
  // drifts up to half a metre from the rendered face and leaves figures floating or buried.
  surfaceY(x, z) {
    const sx = this.mobile ? 130 : 250, sz = this.mobile ? 150 : 290;
    const gx = 460 / sx, gz = 420 / sz;
    const fx = clamp((x + 230) / gx, 0, sx - 1e-4), fz = clamp((z + 245) / gz, 0, sz - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    // cell corners, named as PlaneGeometry orders them: tris (A,B,D) and (B,C,D), split on B–D.
    // read straight out of the grid the terrain was built from when it exists — recomputing the
    // noise here would cost tens of noise evaluations on every footfall.
    const G = this.hGrid;
    let A, B, C, D;
    if (G) {
      const W = sx + 1;
      A = G[ix + W * iz]; B = G[ix + W * (iz + 1)];
      C = G[ix + 1 + W * (iz + 1)]; D = G[ix + 1 + W * iz];
    } else {
      const x0 = ix * gx - 230, z0 = iz * gz - 245;
      A = this.height(x0, z0); B = this.height(x0, z0 + gz);
      C = this.height(x0 + gx, z0 + gz); D = this.height(x0 + gx, z0);
    }
    if (tx + tz <= 1) return A + (D - A) * tx + (B - A) * tz;
    return C + (B - C) * (1 - tx) + (D - C) * (1 - tz);
  }

  groundY(x, z) { return this.surfaceY(x, z) + 0.03; }

  // what a boot stands on: the top of the tread bed, a thin raised strip laid over the drawn
  // surface. the ribbon is built from this same call at high density, so the two cannot drift and
  // the terrain cannot saw through the strip between stations.
  treadY(x, z) { return this.surfaceY(x, z) + 0.24; }

  initThree() {
    // The artifact fetched three r160 from a CDN at runtime. The app's CSP (script-src 'self')
    // blocks that, the promise rejected before the renderer was built, and the empty mount showed
    // the stage's dark backdrop — the reported "black area". Same version, now bundled.
    if (this.dead) return;
    this.THREE = THREE;
    const mount = this.mountRef.current;
    if (!mount) return;

    this.SUM = [-6, -158];
    this.WXZ = [[6, 122], [-26, 72], [22, 24], [-20, -20], [16, -62], [-6, -158]];

    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.FogExp2(0xC3D8E6, 0.0034 * (this.props.mistDensity ?? 1));
    scene.background = this.skyTexture(THREE);

    const camera = new THREE.PerspectiveCamera(46, mount.clientWidth / mount.clientHeight, 0.5, 900);
    this.camera = camera;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, powerPreference: 'high-performance' });
    } catch (err) {
      mount.style.background = 'linear-gradient(#B9CEC4 0%, #DCE8E2 26%, #6E8F80 52%, #145A41 74%, #06281F 100%)';
      return;
    }
    if (this.dead) { try { renderer.forceContextLoss(); renderer.dispose(); } catch (e) {} return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1 : 1.25));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(this.raf); });
    renderer.domElement.addEventListener('webglcontextrestored', () => { this.camInit = false; this.tick(); });
    mount.style.background = 'linear-gradient(#B9CEC4 0%, #DCE8E2 26%, #6E8F80 52%, #145A41 74%, #06281F 100%)';
    mount.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.THREE = THREE;

    const key = new THREE.DirectionalLight(0xFFF6E6, 2.7);
    key.position.set(-90, 78, 60);
    key.castShadow = true;
    key.shadow.mapSize.set(this.mobile ? 512 : 1024, this.mobile ? 512 : 1024);
    key.shadow.camera.left = -7; key.shadow.camera.right = 7;
    key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
    key.shadow.camera.near = 1; key.shadow.camera.far = 220;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.05;
    key.shadow.radius = 3;
    this.key = key;
    this.keyOffset = new THREE.Vector3(-90, 78, 60).normalize().multiplyScalar(110);
    scene.add(key, key.target);
    scene.add(new THREE.HemisphereLight(0xCDE6F6, 0x142A18, 1.02));
    scene.add(new THREE.AmbientLight(0x2E5636, 0.28));
    this.bookLight = new THREE.PointLight(0xFFFFFF, 260, 55, 2);
    scene.add(this.bookLight);

    this.buildTerrain(THREE, scene);
    this.buildFarRange(THREE, scene);
    this.buildSummit(THREE, scene);
    this.buildMist(THREE, scene);
    this.buildClouds(THREE, scene);
    this.buildBook(THREE, scene);
    this.buildLeaves(THREE, scene);
    this.buildSnow(THREE, scene);

    // journey curve through the six waypoints
    const pts = this.WXZ.map(([x, z], i) => {
      const lift = i === 0 ? 4.2 : i === 5 ? 3.1 : 11;
      return new THREE.Vector3(x, this.height(x, z) + lift, z);
    });
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    this.buildTrailRibbon(THREE, scene);
    this.buildTrailLife(THREE, scene);
    this.buildClimbers(THREE, scene);
    // the finale looks straight up the peak: camera stands off the south side, aimed at the body
    // of the cone so it fills the middle of the frame, with the album held out to the left
    this.finaleLook = this.summitTop.clone().add(new THREE.Vector3(0, -15, 0));
    this.finaleCam = this.summitTop.clone().add(new THREE.Vector3(4, 10, 86));
    const fFwd = this.finaleLook.clone().sub(this.finaleCam).normalize();
    const fR = new THREE.Vector3().crossVectors(fFwd, new THREE.Vector3(0, 1, 0)).normalize();
    const fU = new THREE.Vector3().crossVectors(fR, fFwd).normalize();
    this.finaleBook = this.finaleCam.clone()
      .addScaledVector(fFwd, 13).addScaledVector(fR, -3.7).addScaledVector(fU, -0.5);


    this.dirty = true;
    this.clock = new THREE.Clock();
    this.tick();
  }

  skyTexture(THREE) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#12447A'); g.addColorStop(0.34, '#5B9BCE'); g.addColorStop(0.66, '#B4D3E9'); g.addColorStop(1, '#EAF3F8');
    const ctx = c.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  }

  buildTerrain(THREE, scene) {
    const segX = this.mobile ? 130 : 250, segZ = this.mobile ? 150 : 290;
    const w = 460, d = 420;
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const zOff = -35; // centre so terrain spans z ≈ +175 … -245
    // keep the corner heights: everything that stands on the terrain reads them back instead of
    // re-evaluating the noise, which is what makes per-frame surface queries affordable
    const hg = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i) + zOff;
      pos.setZ(i, z);
      const y = this.height(x, z);
      pos.setY(i, y);
      hg[i] = y;
    }
    this.hGrid = hg;
    geo.computeVertexNormals();
    // Western Ghats cover as satellite sees it: mostly very dark green, broken by patches of
      // lighter canopy, and green far higher up the slope than an alpine palette would go
    const cDeep = new THREE.Color(0x03120A), cForest = new THREE.Color(0x08250E), cCanopy = new THREE.Color(0x0E3614),
      cStand = new THREE.Color(0x164C1A), cMeadow = new THREE.Color(0x2A6322), cGrass = new THREE.Color(0x4C7833),
      cEarth = new THREE.Color(0x6F5A43), cRock = new THREE.Color(0x484740), cMist = new THREE.Color(0xC3D8E6),
      cScree = new THREE.Color(0x7C7E7B), cSnow = new THREE.Color(0xF8FCFF),
      cSnowShade = new THREE.Color(0x7BA0C9), cCanopyDark = new THREE.Color(0x030C06),
      cRockPale = new THREE.Color(0x938E80), cRockDark = new THREE.Color(0x24241F), cSilt = new THREE.Color(0x45632E),
      cSun = new THREE.Color(0xFFEBC8), cSky = new THREE.Color(0x9FC4E0), cLit = new THREE.Color(0x63913C);
    const LX = -0.677, LY = 0.586, LZ = 0.451;
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    const W1 = segX + 1;
    const hGrid = (c, r) => pos.getY(Math.min(segZ, Math.max(0, r)) * W1 + Math.min(segX, Math.max(0, c)));
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i), h = pos.getY(i);
      const gc = i % W1, gr = (i / W1) | 0;
      // discrete curvature over the same grid: gullies read concave, spurs convex. this is what
      // separates an eroded range from a lumpy one in satellite imagery
      const cv = clamp((h - (hGrid(gc - 1, gr) + hGrid(gc + 1, gr) + hGrid(gc, gr - 1) + hGrid(gc, gr + 1)) * 0.25) * 0.75, -1, 1);
      const slope = 1 - nrm.getY(i);
      // the fall line — downslope direction straight off the normal. every rock rib, gully and
      // snow streak below is sampled in this frame: noise squeezed hard across the slope and
      // stretched down it. this is the one thing that separates eroded terrain from noise draped
      // over a hill, because water, debris and snow all travel one way and leave parallel grain.
      const nx = nrm.getX(i), nz = nrm.getZ(i);
      const gl = Math.hypot(nx, nz) || 1e-5;
      const dx = nx / gl, dz = nz / gl, ax = -dz, az = dx;
      const along = px * dx + pz * dz, across = px * ax + pz * az;
      const fw = ss(0.05, 0.28, slope);   // flat ground has no fall line worth speaking of
      const flow = (this.fbm(across * 0.30, along * 0.048, 4) * 0.62 + this.fbm(across * 0.92, along * 0.13, 3) * 0.38) * fw;
      // sharp crests with gullies cut between them: ridged noise in the same stretched frame
      const rib = (1 - Math.abs(this.vnoise(across * 0.40, along * 0.065) * 2 - 1)) * fw;
      const gully = clamp(0.55 - rib - cv * 0.9, 0, 1);   // where water collects and snow lies
      const mott = this.fbm(px * 0.075, pz * 0.075, 3);
      // the flanking massifs are bare to their feet — buttressed grey rock with snow caught in
      // the gullies, no timber and no meadow anywhere on them
      let bare = 0;
      for (let k = 0; k < this.ROCKS.length; k++) {
        const p = this.ROCKS[k];
        bare = Math.max(bare, clamp(1 - Math.hypot(px - p[0], pz - p[1]) / (p[2] * 0.95), 0, 1));
      }
      bare = ss(0.08, 0.46, bare + mott * 0.06);
      // proximity to the summit massif. everything inside it is Himalayan: the snowline drops
      // hundreds of metres, and snow holds on faces far steeper than it would lower down
      const himal = Math.pow(clamp(1 - Math.hypot(px - this.SUM[0], pz - this.SUM[1]) / 190, 0, 1), 0.8);
      // cover is a mosaic of stands, not a smooth ramp: hard-edged patches of dark and lighter
      // green interleaving is what makes satellite forest read as forest
      const stand = this.fbm(px * 0.018, pz * 0.018, 4) - 0.5;
      const clump = this.fbm(px * 0.066, pz * 0.066, 3) - 0.5;
      const t = clamp((h + 22) / 174, 0, 1) + mott * 0.04;
      tmp.copy(cDeep)
        .lerp(cForest, ss(0, 0.12, t + stand * 0.1))
        .lerp(cCanopy, ss(0.08, 0.29, t + clump * 0.13))
        .lerp(cStand, ss(0.2, 0.45, t + stand * 0.17))
        .lerp(cMeadow, ss(0.62, 0.86, t))
        .lerp(cGrass, ss(0.88, 1.0, t));
      // treeline: a hard, ragged edge that climbs the gullies and gives up on the exposed ribs,
      // never the soft ramp a plain elevation blend produces
      const wood = (1 - ss(0.60, 0.79, t + flow * 0.15 + cv * 0.10 + rib * 0.09)) * (1 - bare) * (1 - ss(0.2, 0.62, himal));
      // crown grain: a fine dapple of near-black shadow and sunlit leaf over the stand colour
      const dap = this.fbm(px * 0.46, pz * 0.46, 2) * 0.55 + this.fbm(px * 0.155, pz * 0.155, 2) * 0.45;
      tmp.lerp(cCanopyDark, clamp(dap * 1.25 - 0.05, 0, 1) * wood * 0.62);
      tmp.lerp(cLit, clamp(0.36 - dap, 0, 1) * wood * 0.26);
      tmp.multiplyScalar(1 - wood * 0.14);   // timber is dark before the light ever reaches it
      // drainage: gullies hold the wet dark timber, spurs dry out pale
      if (cv < 0) tmp.lerp(cCanopyDark, Math.min(0.5, -cv * 0.6) * wood);
      else tmp.lerp(cSilt, Math.min(0.26, cv * 0.28) * ss(0.24, 0.6, t));
      // bare earth scars only on the open upper slopes; forest holds the lower ground
      const scar = ss(0.44, 0.72, this.fbm(px * 0.026, pz * 0.026, 3) * 0.5 + 0.5) * ss(0.6, 0.9, t);
      if (scar > 0) tmp.lerp(cEarth, scar * 0.5);
      // bedding planes: noise banded by elevation follows the contours the way strata do
      const strat = this.fbm(px * 0.013, h * 0.115, 3);
      if (slope > 0.3 || bare > 0) {
        // steep ground low down is still timbered; rock only takes over as the cover thins
        const rk = Math.max(bare * 0.9, clamp((slope - 0.3) / 0.34, 0, 1) * (0.2 + 0.8 * ss(0.42, 0.78, t + flow * 0.12)));
        tmp.lerp(cRock, rk * 0.82);
        // ribs weather pale and dusty, the gullies between them stay wet and near-black. banding
        // the pale by strata keeps the contrast reading as bedded rock rather than as stripes
        tmp.lerp(cRockPale, rk * clamp(strat * 0.8 + 0.34 + rib * 0.7, 0, 1) * 0.5);
        tmp.lerp(cRockDark, rk * gully * 0.6);
      }
      const alp = ss(96, 132, h + mott * 12);
      if (alp > 0) tmp.lerp(cScree, alp * 0.92);
      const lit = clamp(nrm.getX(i) * LX + nrm.getY(i) * LY + nrm.getZ(i) * LZ, 0, 1);
      // self-shadowing across the grain: crests catch the light, the gullies beside them drop
      // away. at this mesh density the geometry cannot carry it, so it goes in the colour
      tmp.multiplyScalar(clamp(1 + (rib - 0.42) * 0.34 - gully * 0.2, 0.62, 1.34));
      // wind-packed snow capping the cone: bright crests, blue in the lee, rock ribs through it
      const wind = this.fbm(px * 0.05, pz * 0.13, 3);
      // it lies deeper in the shade and in the hollows, and blows clean off the ridge lines
      const sn = ss(128, 168, h + mott * 10 + wind * 12 + (0.5 - lit) * 16 - cv * 16 - (rib - 0.4) * 30 + himal * 52 + bare * 8)
        * clamp(1 - slope * (0.92 - himal * 0.46), 0, 1);
      if (sn > 0) {
        tmp.lerp(cSnow, sn * (0.86 + 0.14 * ss(-0.25, 0.45, wind)));
        tmp.lerp(cSnowShade, sn * clamp(0.66 - lit * 0.8, 0, 1));
        if (slope > 0.46) tmp.lerp(cRock, clamp((slope - 0.46) / 0.36, 0, 1) * 0.55 * sn);
        // rock bands driven through the snow where the bedding outcrops — the dark strata that
        // stripe a Himalayan face and stop it reading as a plain white cone
        const band = ss(0.52, 0.78, strat * 0.5 + 0.5) * ss(0.24, 0.5, slope) * himal;
        if (band > 0) tmp.lerp(cRockDark, band * sn * 0.62);
      }
      // snow survives well below the snowline where it is packed into shaded couloirs — the
      // white streaks running down an otherwise bare face
      const couloir = ss(0.34, 0.72, gully) * ss(104, 152, h + wind * 14 + himal * 44 + bare * 16) * clamp(1 - lit * 0.85, 0, 1) * clamp(1 - slope * 0.7, 0, 1);
      if (couloir > 0) { tmp.lerp(cSnow, couloir * 0.72); tmp.lerp(cSnowShade, couloir * 0.4); }
      // satellite-style aspect shading: sun-facing slopes run warm and bright, shaded faces
      // stay open and take their colour from the sky rather than going black
      const shade = 0.34 + 0.8 * Math.pow(lit, 0.82);
      // snow carries a far wider shading range than rock does — a lit face against one in shadow
      // is close to two to one. flattening that is what makes a snow peak read as a paper cutout
      // instead of a mountain, and it is the flutings that the range makes legible.
      tmp.multiplyScalar(shade * (1 - sn) + (0.6 + 0.64 * Math.pow(lit, 0.85)) * sn);
      tmp.lerp(cSun, lit * 0.09 * (1 - sn) * (1 - wood * 0.55));   // canopy stays green in the sun, it doesn't go warm
      tmp.lerp(cSky, (1 - lit) * 0.08);
      // valley floors sit in their own shadow, spurs catch the sky
      tmp.multiplyScalar(clamp(1 + cv * 0.16, 0.84, 1.14));
      if (h < -30) tmp.lerp(cMist, clamp((-30 - h) / 45, 0, 1) * 0.4);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const det = this.detailTex(THREE);
    const bump = det.clone();
    bump.needsUpdate = true;
    bump.repeat.set(300, 270);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, map: det, bumpMap: bump, bumpScale: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // fine canopy grain: vertex colours alone go flat when the camera is a few metres off the ground
  detailTex(THREE) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, 256, 256);
    const blob = (cx, cy, r, a, col) => {
      x.fillStyle = col; x.globalAlpha = a;
      for (let ox = -256; ox <= 256; ox += 256) for (let oy = -256; oy <= 256; oy += 256) {
        x.beginPath(); x.arc(cx + ox, cy + oy, r, 0, 7); x.fill();
      }
    };
    for (let i = 0; i < 24; i++) blob(this.hash(i, 3) * 256, this.hash(3, i) * 256, 18 + this.hash(i, 11) * 26, 0.07, '#16331A');
    for (let i = 0; i < 700; i++) blob(this.hash(i, 23) * 256, this.hash(23, i) * 256, 1.5 + this.hash(i, 17) * 2.8, 0.12 + this.hash(i, 29) * 0.12, '#0A1A0D');
    for (let i = 0; i < 300; i++) blob(this.hash(i, 47) * 256, this.hash(47, i) * 256, 1.2 + this.hash(i, 53) * 1.9, 0.11, '#88A85E');
    for (let i = 0; i < 120; i++) blob(this.hash(i, 91) * 256, this.hash(91, i) * 256, 1 + this.hash(i, 97) * 1.4, 0.08, '#FFFFFF');
    // rain-cut streaks running downhill — the grain real slopes have at close range
    x.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const sx = this.hash(i, 31) * 256, sy = this.hash(31, i) * 256;
      x.globalAlpha = 0.05 + this.hash(i, 43) * 0.05;
      x.strokeStyle = this.hash(i, 59) > 0.55 ? '#F2EDE1' : '#2B3227';
      x.lineWidth = 0.8 + this.hash(i, 67) * 1.6;
      for (let oy = -256; oy <= 256; oy += 256) {
        x.beginPath();
        x.moveTo(sx, sy + oy);
        x.quadraticCurveTo(sx + (this.hash(i, 37) - 0.5) * 18, sy + oy + 22, sx + (this.hash(37, i) - 0.5) * 34, sy + oy + 34 + this.hash(i, 71) * 40);
        x.stroke();
      }
    }
    x.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(96, 88);
    if (this.renderer) t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  buildFarRange(THREE, scene) {
    const geo = new THREE.PlaneGeometry(1200, 320, this.mobile ? 90 : 180, this.mobile ? 40 : 80);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i) - 460;
      pos.setZ(i, z);
      // seated far enough back that the relief runs edge to edge. the old offset left the near
      // rows at zero amplitude — a dead-level shelf, and that hard-edged slab was what hung in
      // frame over the valley looking like a solid green structure
      pos.setY(i, -72 + this.ridge(x * 0.0035, z * 0.0035, 5) * 130);
    }
    geo.computeVertexNormals();
    // the far wall reads as distance: haze-blue at the foot, snow only on what stands highest
    const fc = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x3B5C73), cHigh = new THREE.Color(0x9CBBD0), cCap = new THREE.Color(0xEAF4FB), fcol = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i);
      fcol.copy(cLow).lerp(cHigh, ss(-64, 22, h)).lerp(cCap, ss(20, 54, h) * 0.72);
      fc[i * 3] = fcol.r; fc[i * 3 + 1] = fcol.g; fc[i * 3 + 2] = fcol.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    scene.add(new THREE.Mesh(geo, mat));
  }

  // summit marker: post, board and flag planted on the highest ground
  buildSummit(THREE, scene) {
    const [sx, sz] = this.SUM;
    const sy = this.height(sx, sz);
    this.summitTop = new THREE.Vector3(sx, sy, sz);

    const wood = new THREE.MeshStandardMaterial({ color: 0x4A2C1D, roughness: 0.92 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.2, 7), wood);
    post.position.set(sx + 1.4, sy + 2.6, sz + 1.2);
    post.castShadow = true;
    scene.add(post);

    const c = document.createElement('canvas'); c.width = 512; c.height = 200;
    const ctx = c.getContext('2d');
    const paint = () => {
      ctx.fillStyle = '#EFE7D6'; ctx.fillRect(0, 0, 512, 200);
      ctx.strokeStyle = '#4A2C1D'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 488, 176);
      ctx.fillStyle = '#0B3D2E'; ctx.textAlign = 'center';
      try { ctx.letterSpacing = '10px'; } catch (e) {}
      ctx.font = `400 34px ${this.fonts.jost}, sans-serif`;
      ctx.fillText('SUMMIT', 261, 66);
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      ctx.font = `400 76px ${this.fonts.cinzel}, serif`;
      ctx.fillText('8,000 FT', 256, 142);
      ctx.fillStyle = 'rgba(11,61,46,0.5)';
      ctx.fillRect(150, 162, 212, 3);
      if (this.signTex) this.signTex.needsUpdate = true;
    };
    paint();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paint).catch(() => {});
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.signTex = tex;
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.8, 0.16),
      [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), wood]);
    board.position.set(sx + 1.4, sy + 4.5, sz + 1.28);
    board.rotation.y = -0.4;
    board.castShadow = true;
    scene.add(board);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x2A2018, roughness: 0.9 }));
    pole.position.set(sx - 2.6, sy + 2.2, sz - 0.6);
    scene.add(pole);
    // prayer-flag line strung across the cairn, as at a real base camp
    const anchorA = new THREE.Vector3(sx - 2.6, sy + 4.2, sz - 0.6);
    const anchorB = new THREE.Vector3(sx + 1.4, sy + 5.2, sz + 1.2);
    const FLAG = [0x2E6FA8, 0xF2F5F2, 0xC6473A, 0x3E8B4E, 0xE8B04B];
    this.prayer = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const u = (i + 0.5) / 16;
      const p = anchorA.clone().lerp(anchorB, u);
      p.y -= Math.sin(u * Math.PI) * 1.5;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.46),
        new THREE.MeshStandardMaterial({ color: FLAG[i % 5], roughness: 0.9, side: THREE.DoubleSide }));
      q.position.copy(p).add(new THREE.Vector3(0, -0.25, 0));
      q.rotation.y = 0.5;
      q.userData.p = u * 7;
      this.prayer.add(q);
    }
    scene.add(this.prayer);
  }

  // a roped party working straight up the front of the snow face, and the flag on top
  buildClimbers(THREE, scene) {
    const [sx, sz] = this.SUM, top = this.summitTop;
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const u = i / 7;
      const r = 64 * Math.pow(1 - u, 1.12);          // the near face, straight towards camera
      const x = sx + 2 + Math.sin(u * 4.2) * 8 * (1 - u);
      const z = sz + r;
      pts.push(new THREE.Vector3(x, this.groundY(x, z) + 0.06, z));
    }
    pts[7].set(top.x, top.y + 0.1, top.z);
    this.route = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);

    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xE8B04B, roughness: 0.95 });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(this.route, 140, 0.05, 5, false), ropeMat));
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xB8BCC0, roughness: 0.3, metalness: 0.72 });
    [0.18, 0.34, 0.5, 0.64, 0.78, 0.9].forEach((u) => {
      const p = this.route.getPoint(u), tg = this.route.getTangent(u).normalize();
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.028, 0.95, 6), steelMat);
      screw.position.copy(p).add(new THREE.Vector3(0, -0.2, 0));
      screw.rotation.set(-0.95, Math.atan2(tg.x, tg.z), 0);
      screw.castShadow = true;
      scene.add(screw);
    });

    this.climbers = [];
    const roped = this.mobile ? 3 : 5;
    for (let i = 0; i < roped; i++) {
      const m = this.makeTrekker(THREE, (i * 0.21 + 0.08) % 1, true, i % 3 === 1 ? 1 : 0);
      m.userData.u = 0.14 + i * 0.13;
      m.userData.u0 = m.userData.u;
      m.userData.u1 = m.userData.u;
      m.userData.step = 0.013 + this.hash(i, 5) * 0.004;   // one haul per cycle, then a rest
      m.userData.rate = 0.2 + this.hash(i, 15) * 0.05;     // cycles per second
      m.userData.ph = i * 0.6;
      m.userData.k = -1;
      m.userData.dir = 1;
      m.userData.side = -0.26 - this.hash(i, 9) * 0.14;   // everyone stands left of the fixed line
      scene.add(m);
      this.climbers.push(m);
    }

    // the summit: the tricolour planted, two climbers who got it there
    const staffH = 3.5;
    const bx = top.x - 0.6, bz = top.z + 1.4, by = this.groundY(bx, bz);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.046, staffH, 7),
      new THREE.MeshStandardMaterial({ color: 0xC9CDD2, roughness: 0.38, metalness: 0.6 }));
    staff.position.set(bx, by + staffH / 2, bz);
    staff.rotation.z = 0.09;
    staff.castShadow = true;
    scene.add(staff);
    const c = document.createElement('canvas'); c.width = 180; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#FF9933'; g.fillRect(0, 0, 180, 40);
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 40, 180, 40);
    g.fillStyle = '#138808'; g.fillRect(0, 80, 180, 40);
    g.strokeStyle = '#000080'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(90, 60, 15, 0, 7); g.stroke();
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      g.beginPath(); g.moveTo(90, 60); g.lineTo(90 + Math.cos(a) * 15, 60 + Math.sin(a) * 15); g.stroke();
    }
    g.fillStyle = '#000080'; g.beginPath(); g.arc(90, 60, 3.2, 0, 7); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tri = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.4, 12, 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, side: THREE.DoubleSide }));
    tri.position.set(bx + 1.12, by + staffH - 0.92, bz);
    this.tricolour = tri;
    this.triBase = Float32Array.from(tri.geometry.attributes.position.array);
    scene.add(tri);

    const hero = this.makeTrekker(THREE, 0.32, true);
    const hx = bx - 1.0, hz = bz + 0.35;
    hero.position.set(hx, this.groundY(hx, hz), hz);
    hero.rotation.y = 0.42;                       // turned out to the valley they just climbed
    hero.userData.arms[0].rotation.set(-2.55, 0, 0.16);   // gripping the staff overhead
    hero.userData.elbows[0].rotation.x = -0.12;
    hero.userData.arms[1].rotation.set(-0.5, 0, -0.34);
    hero.userData.elbows[1].rotation.x = -0.55;
    hero.userData.legs[0].rotation.x = 0.18;
    hero.userData.legs[1].rotation.x = -0.14;
    hero.userData.knees[0].rotation.x = 0.1;
    scene.add(hero);
    this.summitHero = hero;

    const mate = this.makeTrekker(THREE, 0.68, true, 1);
    const mx = bx + 0.85, mz = bz + 0.15;
    mate.position.set(mx, this.groundY(mx, mz), mz);
    mate.rotation.y = 0.16;
    mate.userData.arms[0].rotation.set(-2.2, 0, -0.22);   // ice axe punched at the sky
    mate.userData.elbows[0].rotation.x = -0.2;
    mate.userData.arms[1].rotation.set(-1.35, 0, -0.5);
    mate.userData.elbows[1].rotation.x = -0.7;
    mate.userData.legs[0].rotation.x = -0.16;
    mate.userData.legs[1].rotation.x = 0.2;
    mate.userData.knees[1].rotation.x = 0.12;
    scene.add(mate);
    this.summitMate = mate;
  }

  // walker: two-segment limbs on real joints, pack, hat and a trekking pole.
  // kind 0 = man, 1 = woman, 2 = child — same rig, different proportions
  makeTrekker(THREE, hue, alpine, kind) {
    const K = kind || 0;
    const JACKET = [0xC6473A, 0xE8B04B, 0x2E6E8E, 0xEDE7DA, 0x8A5A3B, 0x4E7C59];
    const SKIN = [0xD8A87E, 0xC08D63, 0xA9714B, 0xE0B891];
    const g = new THREE.Group();
    const jc = JACKET[Math.floor(hue * JACKET.length) % JACKET.length];
    const jacket = new THREE.MeshStandardMaterial({ color: jc, roughness: 0.82 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2A3540, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[Math.floor(hue * 11) % SKIN.length], roughness: 0.85 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x241A14, roughness: 0.96 });
    const pack = new THREE.MeshStandardMaterial({ color: 0x3E5A3F, roughness: 0.92 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x1E1A16, roughness: 0.95 });

    // anatomical limb: a lathed profile with a rounded joint head, muscle belly and taper
    const bone = (mat, rT, rM, rB, len) => {
      const P = [], p = (r, y) => P.push(new THREE.Vector2(Math.max(0.004, r), y));
      p(0.004, -len - rB * 0.9); p(rB * 0.58, -len - rB * 0.66); p(rB, -len);
      p(rB * 1.12, -len * 0.82); p(rM, -len * 0.42); p(rT, rT * 0.08);
      p(rT * 0.62, rT * 0.7); p(0.004, rT * 0.92);
      return new THREE.Mesh(new THREE.LatheGeometry(P, 12), mat);
    };
    const joint = (matU, matL, U, L, up, lo) => {
      const root = new THREE.Group();
      root.add(bone(matU, U[0], U[1], U[2], up));
      const mid = new THREE.Group();
      mid.position.y = -up;
      mid.add(bone(matL, L[0], L[1], L[2], lo));
      root.add(mid);
      return { root, mid };
    };

    const hipY = 0.92, shY = 1.53;
    const LEG_U = [0.118, 0.102, 0.076], LEG_L = [0.086, 0.09, 0.05];   // thigh tapers to the knee, calf bulges then narrows to the ankle
    const legLJ = joint(pants, pants, LEG_U, LEG_L, 0.47, 0.45), legRJ = joint(pants, pants, LEG_U, LEG_L, 0.47, 0.45);
    const legL = legLJ.root, legR = legRJ.root;
    legL.position.set(-0.115, hipY, 0); legR.position.set(0.115, hipY, 0);
    // boot: rounded sole, heel and ankle cuff — a shoe, not a block
    const shoe = () => {
      const s = new THREE.Group();
      const sole = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.19, 4, 10), boot);
      sole.rotation.x = Math.PI / 2 - 0.09; sole.scale.set(1.25, 1, 0.6);
      sole.position.set(0, -0.425, 0.07);
      const heel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), boot);
      heel.scale.set(1.05, 1, 0.95); heel.position.set(0, -0.385, -0.035);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.066, 0.075, 10), boot);
      cuff.position.set(0, -0.33, 0);
      s.add(sole, heel, cuff);
      return s;
    };
    const ankles = [];
    [legLJ, legRJ].forEach((l) => {
      const ank = new THREE.Group();
      ank.position.y = -0.4;          // a real ankle, so the foot can roll heel-to-toe
      const s = shoe();
      s.position.y = 0.4;
      ank.add(s);
      l.mid.add(ank);
      ankles.push(ank);
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 4, 9), jacket);
    torso.position.y = 1.24;
    torso.scale.set(1.12, 1, 0.78);
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.1, 3, 8), pants);
    hips.position.y = 0.98; hips.scale.set(1.15, 1, 0.82);

    const ARM_U = [0.078, 0.068, 0.054], ARM_L = [0.058, 0.058, 0.04];   // deltoid to elbow, forearm to a narrow wrist
    const armLJ = joint(jacket, jacket, ARM_U, ARM_L, 0.32, 0.3), armRJ = joint(jacket, jacket, ARM_U, ARM_L, 0.32, 0.3);
    const armL = armLJ.root, armR = armRJ.root;
    armL.position.set(-0.285, shY - 0.04, 0); armR.position.set(0.285, shY - 0.04, 0);
    armL.rotation.z = -0.07; armR.rotation.z = 0.07;   // arms rest against the body, not flared
    // gloved hands on real wrists: padded palm, fingers curled, thumb wrapped, cuff over the sleeve
    const glove = new THREE.MeshStandardMaterial({ color: 0x232D36, roughness: 0.96 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x151C23, roughness: 0.98 });
    const hands = [];
    [armLJ, armRJ].forEach((a) => {
      const wj = new THREE.Group();
      wj.position.y = -0.3;
      const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, 0.05, 4, 8), glove);
      palm.position.y = -0.052; palm.scale.set(0.94, 1, 0.74);
      const fing = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.032, 3, 7), glove);
      fing.position.set(0, -0.108, 0.016); fing.scale.set(0.9, 1, 0.7); fing.rotation.x = 0.62;
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.038, 3, 6), glove);
      thumb.position.set(0.012, -0.062, 0.044); thumb.rotation.set(-0.9, 0, -0.3);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.07, 9), cuffMat);
      cuff.position.y = 0.012;
      wj.add(palm, fing, thumb, cuff);
      a.mid.add(wj);
      hands.push(wj);
    });
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.42, 4, 8), jacket);
    shoulders.position.y = shY - 0.02; shoulders.rotation.z = Math.PI / 2;
    // trekking pole gripped at the top inside the fist, telescoping shaft running down past the
    // hand to a basket and tip at the ground — held, not carried alongside
    const pole = new THREE.Group();
    pole.position.set(0.006, -0.055, 0.028);
    pole.rotation.set(0.26, 0, 0.07);
    const alu = new THREE.MeshStandardMaterial({ color: 0x9AA0A6, roughness: 0.42, metalness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1B1E22, roughness: 0.95 });
    const shaftU = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.015, 0.38, 6), alu);
    shaftU.position.y = -0.235;
    const shaftL = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0125, 0.38, 6), alu);
    shaftL.position.y = -0.575;
    const gripM = new THREE.Mesh(new THREE.CapsuleGeometry(0.023, 0.082, 4, 8), rubber);
    gripM.position.y = -0.028;
    const strapM = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.006, 5, 12),
      new THREE.MeshStandardMaterial({ color: 0x2C3E2E, roughness: 0.95 }));
    strapM.position.set(0, 0.008, 0.026); strapM.rotation.set(1.15, 0, 0);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.024, 0.015, 9), rubber);
    basket.position.y = -0.735;
    const tipM = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.05, 5), alu);
    tipM.position.y = -0.785; tipM.rotation.x = Math.PI;
    pole.add(shaftU, shaftL, gripM, strapM, basket, tipM);
    // the pole hangs off the body, not the arm chain: the walk loop parks its grip at whatever
    // world point the fist reaches and then solves the shaft down onto the ground under the tip
    pole.position.set(0.3, 1.05, 0.14);
    g.add(pole);

    const headGrp = new THREE.Group();
    headGrp.position.y = 1.56;      // head on its own pivot, so it can stay level over the stride
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 6), skin);
    neck.position.y = 0.04;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), skin);
    head.position.y = 0.17; head.scale.set(0.92, 1.06, 0.94);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.132, 10, 8), hair);
    back.position.set(0, 0.19, -0.03); back.scale.set(0.98, 0.86, 1);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.155, 0.1, 12), jacket);
    hat.position.y = 0.27;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.018, 14), jacket);
    brim.position.y = 0.232;
    headGrp.add(neck, head, back, hat, brim);

    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.3, 4, 8), pack);
    bag.position.set(0, 1.29, -0.2); bag.scale.set(1.15, 1, 0.7);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 7), pack);
    lid.position.set(0, 1.47, -0.2); lid.scale.set(1.12, 0.55, 0.72);
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x2C3E2E, roughness: 0.95 });
    const straps = new THREE.Group();
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.42, 0.05), strapMat);
      st.position.set(s * 0.13, 1.35, 0.15); st.rotation.x = -0.12;
      straps.add(st);
    }
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 6, 14), strapMat);
    belt.position.y = 1.06; belt.rotation.x = Math.PI / 2; belt.scale.set(1.05, 0.78, 1);
    straps.add(belt);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8), boot);
    roll.position.set(0, 1.57, -0.24); roll.rotation.z = Math.PI / 2;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.152, 0.045, 12), pants);
    band.position.y = 0.24;
    headGrp.add(band);

    if (alpine) {
      // ice axe in the hand, harness with a rope tail, crampons under the boots
      const steel = new THREE.MeshStandardMaterial({ color: 0xC4C8CC, roughness: 0.3, metalness: 0.75 });
      // axe gripped just under the head in the gloved fist, shaft down past the hip
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.68, 5), steel);
      shaft.position.set(0, -0.3, 0.02);
      const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.042, 0.05), steel);
      pickHead.position.set(0.1, 0.052, 0.02); pickHead.rotation.z = -0.55;
      const adze = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), steel);
      adze.position.set(-0.085, 0.058, 0.02);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 5), steel);
      spike.position.set(0, -0.68, 0.02); spike.rotation.x = Math.PI;
      hands[0].add(shaft, pickHead, adze, spike);
      pole.visible = false;
      const webbing = new THREE.MeshStandardMaterial({ color: 0xC6473A, roughness: 0.9 });
      const harness = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.036, 6, 14), webbing);
      harness.position.y = 0.96; harness.rotation.x = Math.PI / 2; harness.scale.set(1, 0.82, 1);
      const belay = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 5, 10), steel);
      belay.position.set(0, 0.99, 0.2);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 5),
        new THREE.MeshStandardMaterial({ color: 0xE8B04B, roughness: 0.95 }));
      tail.position.set(0.03, 1.2, 0.44); tail.rotation.set(-0.8, 0, 0.12);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.163, 12, 8, 0, 6.3, 0, 1.3),
        new THREE.MeshStandardMaterial({ color: 0xE8B04B, roughness: 0.45 }));
      helm.position.y = 0.195;
      const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.052, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x1A1D22, roughness: 0.25, metalness: 0.45 }));
      goggle.position.set(0, 0.188, 0.115);
      hat.visible = false; brim.visible = false; band.visible = false;
      [legLJ, legRJ].forEach((l, li) => {
        const cr = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.315), steel);
        cr.position.set(0, -0.095, 0.045);
        ankles[li].add(cr);
        for (let s = -1; s <= 1; s += 2) {
          const pt = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 4), steel);
          pt.position.set(s * 0.055, -0.135, 0.15); pt.rotation.x = Math.PI;
          ankles[li].add(pt);
        }
      });
      g.add(harness, belay, tail);
      headGrp.add(helm, goggle);
    }
    if (K === 1) {
      shoulders.scale.y = 0.84;
      hips.scale.set(1.32, 1, 0.86);
      torso.scale.set(1.03, 1, 0.75);
      const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 7), hair);
      pony.position.set(0, 0.06, -0.17); pony.rotation.x = 0.55;
      headGrp.add(pony);
    }
    if (K === 2) {
      bag.scale.multiplyScalar(0.7); lid.scale.multiplyScalar(0.7);
      roll.visible = false; pole.visible = false;
      head.scale.set(1.06, 1.14, 1.06);   // a child's head is large for the body
      shoulders.scale.y = 0.8;
    }
    g.scale.setScalar(K === 2 ? 0.66 : K === 1 ? 0.93 : 1);
    g.add(hips, legL, legR, torso, shoulders, armL, armR, headGrp, bag, lid, straps, roll);
    g.rotation.order = 'YXZ';
    g.userData.legs = [legL, legR];
    g.userData.knees = [legLJ.mid, legRJ.mid];
    g.userData.feet = ankles;
    g.userData.head = headGrp;
    g.userData.arms = [armL, armR];
    g.userData.elbows = [armLJ.mid, armRJ.mid];
    g.userData.torso = torso;
    g.userData.hands = hands;
    g.userData.pole = pole;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // two-bone leg IK. given where the hip is and where the boot has to land, solve the hip and
  // knee to reach it and level the ankle onto what it is standing on. this is what keeps feet
  // on the surface instead of through it on sloping ground.
  solveLeg(d, i, hipY, tgtY, fz, sc, ankle, pitch) {
    const A = 0.47, B = 0.4;
    const dy = (tgtY - hipY) / sc;
    const L = clamp(Math.hypot(dy, fz), 0.24, 0.868);
    const phi = Math.atan2(-fz, -dy);
    const al = Math.acos(clamp((A * A + L * L - B * B) / (2 * A * L), -1, 1));
    const kn = Math.PI - Math.acos(clamp((A * A + B * B - L * L) / (2 * A * B), -1, 1));
    // rotations are relative to the body, so a pitched body has its pitch taken back out here
    d.legs[i].rotation.x = phi - al - (pitch || 0);
    d.knees[i].rotation.x = kn;
    if (d.feet) d.feet[i].rotation.x = -(phi - al + kn) + (ankle || 0);
  }

  // stand a static figure on the real surface: hips as high as the lower boot allows, both legs solved
  plantFeet(m) {
    const sc = m.scale.x || 1, yc = Math.cos(m.rotation.y), ys = Math.sin(m.rotation.y);
    const F = [{ i: 0, fz: 0.12 }, { i: 1, fz: -0.13 }];
    let hip = Infinity;
    F.forEach((f) => {
      const lx = (f.i ? 0.115 : -0.115) * sc, lz = f.fz * sc;
      f.g = this.groundY(m.position.x + lx * yc + lz * ys, m.position.z - lx * ys + lz * yc);
      hip = Math.min(hip, f.g + 0.075 * sc + Math.sqrt(Math.max(0.04, 0.7534 - f.fz * f.fz)) * sc);
    });
    m.position.y = hip - 0.92 * sc;
    F.forEach((f) => this.solveLeg(m.userData, f.i, hip, f.g + 0.075 * sc, f.fz, sc, 0));
  }

  // trekkers, edge stones and cairns dressing the path
  buildTrailLife(THREE, scene) {
    const curve = this.flatCurve;
    const at = (t, off) => {
      const p = curve.getPoint(t), tg = curve.getTangent(t).normalize();
      const x = p.x - tg.z * off, z = p.z + tg.x * off;
      return { x, z, y: this.groundY(x, z), yaw: Math.atan2(tg.x, tg.z) };
    };
    this.trekkers = [];
    this.pathLen = curve.getLength();
    this.walkAt = (t, off) => {
      const p = curve.getPoint(t), tg = curve.getTangent(t).normalize();
      const x = p.x - tg.z * off, z = p.z + tg.x * off;
      // the graded bench, but never under the drawn mesh where the cut meets the shoulder
      return { x, z, y: this.treadY(x, z), yaw: Math.atan2(tg.x, tg.z) };
    };
    let tSnow = 0.9;
    for (let i = 30; i <= 100; i++) { const q = curve.getPoint(i / 100); if (this.height(q.x, q.z) > 90) { tSnow = i / 100; break; } }
    this.tSnow = clamp(tSnow - 0.02, 0.4, 0.93);
    // parties strung out along the trail, walking up to the snowline and back down the same tread
    const parties = this.mobile ? 4 : 6;
    let n = 0;
    for (let p = 0; p < parties; p++) {
      const lead = 0.05 + p * (0.88 / parties) + this.hash(p, 41) * 0.02;
      const spd = 0.0011 + this.hash(p, 13) * 0.0006;   // an unhurried walking pace, not a jog
      const size = this.hash(41, p) > 0.55 ? 3 : 2;
      for (let k = 0; k < size; k++) {
        const t = clamp(lead - k * (0.011 + this.hash(k, p) * 0.006), 0.012, 0.965);
        const off = (k % 2 ? 1 : -1) * (0.35 + this.hash(k + 2, p) * 0.7);
        const s = this.walkAt(t, off);
        // a family to a party: one walks ahead, the others keep pace behind
        const kind = k === 0 ? (p % 2) : k === 1 ? 1 - (p % 2) : 2;
        const m = this.makeTrekker(THREE, this.hash(n, 7), false, kind);
        m.position.set(s.x, s.y, s.z);
        m.rotation.y = s.yaw;
        m.userData.phase = this.hash(7, n) * 6.28;
        m.userData.t = t;
        m.userData.off = off;
        m.userData.sc = kind === 2 ? 0.66 : kind === 1 ? 0.93 : 1;
        m.userData.gait = this.hash(n, 21) * 6.28;
        m.userData.spd = spd * (0.94 + this.hash(n, 29) * 0.12);
        m.userData.dir = 1;
        m.userData.hold = 0;
        m.userData.top = this.tSnow - this.hash(p, 17) * 0.03;   // turns back where the tread runs out
        scene.add(m);
        this.trekkers.push(m);
        n++;
      }
    }

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6E6656, roughness: 1, flatShading: true });
    const stone = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.4, 0), stoneMat, 200);
    const d = new THREE.Object3D();
    for (let i = 0; i < 200; i++) {
      const t = 0.02 + (i / 200) * 0.82;
      const side = i % 2 ? 1 : -1;
      const s = at(t + this.hash(i, 3) * 0.004, side * (2.7 + this.hash(3, i) * 1.1));
      d.position.set(s.x, s.y + 0.06, s.z);
      d.rotation.set(this.hash(i, 9) * 3, this.hash(9, i) * 3, this.hash(i, 5) * 3);
      d.scale.setScalar(0.35 + this.hash(5, i) * 0.75);
      d.updateMatrix();
      stone.setMatrixAt(i, d.matrix);
    }
    stone.castShadow = true; stone.receiveShadow = true;
    scene.add(stone);

    [0.19, 0.34, 0.5, 0.66, 0.84].forEach((t, i) => {
      const s = at(t, i % 2 ? 3.6 : -3.6);
      const cairn = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const r = 0.5 - k * 0.09;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stoneMat);
        m.position.y = 0.25 + k * 0.42;
        m.rotation.y = k * 1.1;
        m.castShadow = true;
        cairn.add(m);
      }
      cairn.position.set(s.x, s.y, s.z);
      scene.add(cairn);
    });
  }

  buildMist(THREE, scene) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(220,232,226,0.85)'); g.addColorStop(1, 'rgba(220,232,226,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    this.mistMat = mat;
    this.mistGroup = new THREE.Group();
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((Math.random() - 0.5) * 420, -58 + Math.random() * 26, -120 - Math.random() * 240);
      m.userData.drift = 0.5 + Math.random();
      this.mistGroup.add(m);
    }
    scene.add(this.mistGroup);
  }

  // a thin cloud deck lying between the last camp and the summit — the climb passes up through it
  buildClouds(THREE, scene) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 34; i++) {
      const cx = 60 + this.hash(i, 61) * 392, cy = 96 + this.hash(61, i) * 84;
      const r = 34 + this.hash(i, 71) * 76;
      const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.5, 'rgba(246,251,254,0.2)');
      g.addColorStop(1, 'rgba(242,249,254,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * (0.34 + this.hash(i, 77) * 0.2), 0, 0, 7); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: false });
    this.cloudMat = mat;
    this.clouds = new THREE.Group();
    this.clouds.visible = false;
    const top = this.summitTop ? this.summitTop.y : 175;
    for (let i = 0; i < 26; i++) {
      // half hang off the peak itself, so the last scene looks out over a cloud layer;
      // half sit in the climb corridor, so the rise to it passes straight up through them
      const deck = i % 2 === 0;
      const s = deck ? 110 + this.hash(i, 81) * 130 : 55 + this.hash(i, 81) * 55;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(s, s * (deck ? 0.4 : 0.55)), mat);
      if (deck) q.position.set(this.SUM[0] + (this.hash(i, 91) - 0.5) * 220,
        top - 40 + this.hash(91, i) * 30, this.SUM[1] + 18 - this.hash(97, i) * 160);
      else q.position.set(this.SUM[0] + (this.hash(i, 91) - 0.5) * 120,
        top - 76 + this.hash(91, i) * 46, this.SUM[1] + 103 - this.hash(97, i) * 60);
      q.userData.d = 0.4 + this.hash(97, i);
      this.clouds.add(q);
    }
    scene.add(this.clouds);
  }

  buildBook(THREE, scene) {
    const W = 3.0, H = 4.0, T = 0.11;
    this.bookW = W;
    this.redraws = [];
    const anis = this.renderer.capabilities.getMaxAnisotropy();
    const mkTex = (o) => {
      const t = new THREE.CanvasTexture(o.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anis;
      this.redraws.push(() => { o.draw(); t.needsUpdate = true; });
      return t;
    };

    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    this.book = root; this.bookInner = inner;

    const sky = new THREE.MeshStandardMaterial({ color: 0x6FB7DE, roughness: 0.5, metalness: 0.06 });
    const skyDeep = new THREE.MeshStandardMaterial({ color: 0x4B93C2, roughness: 0.55, metalness: 0.06 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xFBFAF5, roughness: 0.92 });

    const spreads = [['everest', 0], ['everest', 1], ['friends', 0], ['friends', 1], ['scuba', 0], ['scuba', 1], ['lagoon', 0], ['lagoon', 1]];
    const art = spreads.map(([th, sd]) => new THREE.MeshStandardMaterial({ map: mkTex(this.pageArt(th, sd)), roughness: 0.88 }));
    const coverMat = new THREE.MeshStandardMaterial({ map: mkTex(this.coverArt()), roughness: 0.48, metalness: 0.05 });

    const leftLeaf = new THREE.Group();
    const lg = new THREE.BoxGeometry(W, H, T); lg.translate(-W / 2, 0, -0.22);
    leftLeaf.add(new THREE.Mesh(lg, [sky, skyDeep, sky, sky, art[6], coverMat]));
    const rightLeaf = new THREE.Group();
    const rg = new THREE.BoxGeometry(W, H, T); rg.translate(W / 2, 0, -0.22);
    rightLeaf.add(new THREE.Mesh(rg, [skyDeep, sky, sky, sky, art[1], sky]));

    // leaves hinge on the spine; every page sits on the LEFT and turns to the right
    const pw = W * 0.965, ph = H * 0.94;
    this.pageW = pw;
    this.pages = [];
    for (let p = 0; p < 3; p++) {
      const grp = new THREE.Group();
      const zb = 0.11 - p * 0.035;
      const mk = (mat, back) => {
        const g = new THREE.PlaneGeometry(pw, ph, 18, 1);
        if (back) g.rotateY(Math.PI);
        g.translate(-pw / 2, 0, zb + (back ? -0.008 : 0.008));
        g.userData.base = Float32Array.from(g.attributes.position.array);
        const m = new THREE.Mesh(g, mat);
        m.castShadow = false;
        grp.add(m);
        return g;
      };
      grp.userData.geos = [mk(art[2 * p], false), mk(art[2 * p + 3], true)];
      inner.add(grp);
      this.pages.push(grp);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.17, H * 1.008, 0.3), skyDeep);
    spine.position.z = -0.34;
    inner.add(spine, leftLeaf, rightLeaf);
    this.leftLeaf = leftLeaf; this.rightLeaf = rightLeaf;
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.pages.forEach(g => g.traverse(o => { if (o.isMesh) o.castShadow = false; }));
    scene.add(root);

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.redraws.forEach(f => f())).catch(() => {});
  }

  coverArt() {
    const c = document.createElement('canvas'); c.width = 640; c.height = 860;
    const ctx = c.getContext('2d');
    const img = new Image();
    const draw = () => {
      const g = ctx.createLinearGradient(0, 0, 640, 860);
      g.addColorStop(0, '#A9DDF3'); g.addColorStop(0.5, '#6FB7DE'); g.addColorStop(1, '#4B93C2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 860);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
      ctx.strokeRect(40, 46, 560, 768);
      if (img.complete && img.naturalWidth) {
        const s = Math.min(430 / img.naturalWidth, 460 / img.naturalHeight);
        ctx.drawImage(img, 320 - img.naturalWidth * s / 2, 330 - img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0B3D2E';
      ctx.font = `400 70px ${this.fonts.scriptorama}, cursive`;
      ctx.fillText('Malnad Stories', 320, 678);
      try { ctx.letterSpacing = '5px'; } catch (e) {}
      ctx.font = `400 16px ${this.fonts.jost}, sans-serif`;
      ctx.fillStyle = 'rgba(11,61,46,0.62)';
      ctx.fillText('SUMMIT TRAIL EDITION', 322, 724);
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      ctx.fillStyle = 'rgba(11,61,46,0.3)';
      ctx.fillRect(240, 750, 160, 2);
    };
    img.onload = () => { (this.redraws || []).forEach(f => f()); };
    // THE M. The artifact loaded this from a RELATIVE `uploads/…` path that only existed beside
    // the .dc.html file; in the app it resolved to /uploads/… and 404'd, so `img.complete &&
    // img.naturalWidth` was never true and the cover rendered with the title but no mark. The
    // same artwork is already served at /logo.png (public/logo.png — the site's own wordmark,
    // used by the header, footer and auth shell), so the asset is reused rather than duplicated.
    // Same-origin, so drawing it does not taint the canvas the texture is read from.
    img.src = '/logo.png';
    draw();
    return { canvas: c, draw };
  }

  /* ---------- album spreads: one travel story per spread ---------- */
  pageArt(theme, side) {
    const c = document.createElement('canvas'); c.width = 620; c.height = 840;
    const ctx = c.getContext('2d');
    const b = { x: 50, y: 58, w: 520, h: 520 };
    const META = {
      everest: [['Summit Push', 'EVEREST · KHUMBU'], ['The Last Ridge', '8,848 M · 05:41']],
      friends: [['The Whole Crew', 'RIDGE CAMP · DAY 04'], ['Fire and Stories', 'CAMP TWO · NIGHT']],
      scuba: [['Down to the Reef', 'NETRANI ISLAND'], ['Blue Hour', '18 M · 42 MIN']],
      lagoon: [['The Last Lake', 'MALNAD BASIN'], ['Still Water', 'EVENING PADDLE']]
    };
    const name = META[theme][side][0], cap = META[theme][side][1];
    const draw = () => {
      const pg = ctx.createLinearGradient(0, 0, 620, 840);
      pg.addColorStop(0, '#FDFCF7'); pg.addColorStop(1, '#F0ECE1');
      ctx.fillStyle = pg; ctx.fillRect(0, 0, 620, 840);

      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      if (theme === 'everest') this.artEverest(ctx, b, side);
      else if (theme === 'friends') this.artFriends(ctx, b, side);
      else if (theme === 'scuba') this.artScuba(ctx, b, side);
      else this.artLagoon(ctx, b, side);
      const vg = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, b.h * 0.26, b.x + b.w / 2, b.y + b.h / 2, b.h * 0.8);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,26,40,0.3)');
      ctx.fillStyle = vg; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();

      ctx.strokeStyle = 'rgba(6,40,31,0.18)'; ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#0B3D2E';
      ctx.font = `400 44px ${this.fonts.scriptorama}, cursive`;
      ctx.fillText(name, b.x + 2, b.y + b.h + 84);
      try { ctx.letterSpacing = '4px'; } catch (e) {}
      ctx.font = `400 17px ${this.fonts.jost}, sans-serif`;
      ctx.fillStyle = 'rgba(11,61,46,0.5)';
      ctx.fillText(cap, b.x + 3, b.y + b.h + 122);
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      ctx.fillStyle = 'rgba(11,61,46,0.16)';
      ctx.fillRect(b.x, b.y + b.h + 150, b.w, 1);

      ctx.fillStyle = 'rgba(11,61,46,0.03)';
      for (let n = 0; n < 300; n++) ctx.fillRect((this.hash(n, side + 3) * 620) | 0, (this.hash(side + 7, n) * 840) | 0, 2, 2);
    };
    draw();
    return { canvas: c, draw };
  }

  ridgeLayer(ctx, b, o) {
    const base = b.y + b.h * o.base, amp = b.h * o.amp;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x, base);
    for (let x = 0; x <= b.w; x += 5) {
      const n = this.ridge(x / b.w * o.freq + o.seed, o.seed * 1.7, 3);
      ctx.lineTo(b.x + x, base - n * amp * 1.8);
    }
    ctx.lineTo(b.x + b.w, b.y + b.h); ctx.closePath();
    ctx.fillStyle = o.fill; ctx.fill();
    if (o.snow) {
      ctx.save(); ctx.clip();
      const g = ctx.createLinearGradient(0, base - amp * 1.8, 0, base + b.h * 0.08);
      g.addColorStop(0, 'rgba(255,255,255,0.96)'); g.addColorStop(0.55, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(b.x, base - amp * 1.8, b.w, amp * 2.2);
      ctx.restore();
    }
    if (o.haze) { ctx.fillStyle = o.haze; ctx.fillRect(b.x, base + b.h * 0.008, b.w, b.h * 0.055); }
  }

  // stick-light silhouette; poses: stand / up / jump / sit / climb
  figure(ctx, x, y, h, pose, col) {
    const u = h / 8;
    const sit = pose === 'sit';
    const hip = y - (sit ? 2.1 : 3.4) * u, sh = y - (sit ? 4.2 : 5.7) * u, hd = y - (sit ? 5.3 : 6.9) * u;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = u * 0.92;
    ctx.beginPath();
    if (sit) { ctx.moveTo(x + u * 1.9, y); ctx.lineTo(x + u * 0.7, y - u * 0.9); ctx.lineTo(x, hip); }
    else if (pose === 'jump') { ctx.moveTo(x - u * 1.3, y - u * 0.5); ctx.lineTo(x - u * 0.2, hip); ctx.moveTo(x + u * 1.2, y - u * 0.9); ctx.lineTo(x + u * 0.2, hip); }
    else if (pose === 'climb') { ctx.moveTo(x - u * 0.9, y); ctx.lineTo(x - u * 0.2, hip); ctx.moveTo(x + u * 0.8, y - u * 0.5); ctx.lineTo(x + u * 0.2, hip); }
    else { ctx.moveTo(x - u * 0.6, y); ctx.lineTo(x - u * 0.15, hip); ctx.moveTo(x + u * 0.62, y); ctx.lineTo(x + u * 0.15, hip); }
    ctx.stroke();
    ctx.lineWidth = u * 1.55;
    ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x, sh); ctx.stroke();
    ctx.lineWidth = u * 0.62;
    ctx.beginPath();
    if (pose === 'up' || pose === 'jump') { ctx.moveTo(x - u * 0.3, sh); ctx.lineTo(x - u * 1.7, hd - u * 1.5); ctx.moveTo(x + u * 0.3, sh); ctx.lineTo(x + u * 1.7, hd - u * 1.5); }
    else if (pose === 'climb') { ctx.moveTo(x - u * 0.3, sh); ctx.lineTo(x - u * 1.5, sh - u * 1.4); ctx.moveTo(x + u * 0.3, sh); ctx.lineTo(x + u * 1.1, sh + u * 1.1); }
    else if (sit) { ctx.moveTo(x - u * 0.3, sh); ctx.lineTo(x - u * 1.2, hip + u * 0.2); ctx.moveTo(x + u * 0.3, sh); ctx.lineTo(x + u * 1.3, hip); }
    else { ctx.moveTo(x - u * 0.3, sh); ctx.lineTo(x - u * 1.1, hip + u * 0.5); ctx.moveTo(x + u * 0.3, sh); ctx.lineTo(x + u * 1.1, hip + u * 0.6); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, hd, u * 0.8, 0, 7); ctx.fill();
    if (!sit) { // pack
      ctx.beginPath(); ctx.ellipse(x - u * 0.95, sh + u * 0.7, u * 0.7, u * 1.15, 0.12, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  diver(ctx, x, y, s, rot, col) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = col; ctx.strokeStyle = col;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 1.5, s * 0.52, 0, 0, 7); ctx.fill();          // torso
    ctx.beginPath(); ctx.ellipse(-s * 1.25, -s * 0.5, s * 0.62, s * 0.34, 0.5, 0, 7); ctx.fill(); // tank
    ctx.beginPath(); ctx.arc(s * 1.62, s * 0.08, s * 0.42, 0, 7); ctx.fill();            // head
    ctx.lineWidth = s * 0.3;
    ctx.beginPath(); ctx.moveTo(-s * 1.4, s * 0.1); ctx.lineTo(-s * 2.5, s * 0.5); ctx.moveTo(-s * 1.4, -s * 0.05); ctx.lineTo(-s * 2.5, -s * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-s * 2.75, s * 0.62, s * 0.5, s * 0.2, 0.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-s * 2.75, -s * 0.68, s * 0.5, s * 0.2, -0.5, 0, 7); ctx.fill();
    ctx.lineWidth = s * 0.26;
    ctx.beginPath(); ctx.moveTo(s * 0.9, s * 0.3); ctx.lineTo(s * 1.9, s * 0.95); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(s * 1.78, s * 0.02, s * 0.17, 0, 7); ctx.fill();
    ctx.restore();
  }

  artEverest(ctx, b, side) {
    const sky = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    sky.addColorStop(0, side ? '#0F2E52' : '#1A4879');
    sky.addColorStop(0.42, '#5C8CB4');
    sky.addColorStop(0.7, '#C6D8E5');
    sky.addColorStop(1, '#FCE2C0');
    ctx.fillStyle = sky; ctx.fillRect(b.x, b.y, b.w, b.h);
    const sx = b.x + b.w * (side ? 0.24 : 0.74), sy = b.y + b.h * 0.3;
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, b.h * 0.42);
    glow.addColorStop(0, 'rgba(255,244,214,0.95)'); glow.addColorStop(0.3, 'rgba(255,226,178,0.4)'); glow.addColorStop(1, 'rgba(255,226,178,0)');
    ctx.fillStyle = glow; ctx.fillRect(b.x, b.y, b.w, b.h);

    this.ridgeLayer(ctx, b, { base: 0.52, amp: 0.3, freq: 2.1, seed: 3.1 + side * 4, fill: '#83A2C0', snow: 1, haze: 'rgba(233,242,248,0.5)' });
    this.ridgeLayer(ctx, b, { base: 0.63, amp: 0.26, freq: 3.4, seed: 7.6 + side * 4, fill: '#4E7099', snow: 1, haze: 'rgba(214,230,240,0.4)' });
    this.ridgeLayer(ctx, b, { base: 0.74, amp: 0.2, freq: 4.8, seed: 11.2 + side * 4, fill: '#26405F', snow: 1 });

    ctx.save(); // cloud sea
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 16; i++) {
      const cx = b.x + this.hash(i, side + 1) * b.w, cy = b.y + b.h * (0.66 + this.hash(side + 2, i) * 0.14);
      const r = b.h * (0.05 + this.hash(i, 9) * 0.09);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    }
    ctx.restore();

    const y0 = b.y + b.h * (side ? 0.58 : 0.8), y1 = b.y + b.h * (side ? 1.0 : 0.74);
    const ar = (s) => y0 + (y1 - y0) * ss(0, 1, s) + Math.sin(s * 9 + side) * b.h * 0.012;
    ctx.beginPath(); ctx.moveTo(b.x, ar(0));
    for (let s = 0; s <= 1.0001; s += 0.02) ctx.lineTo(b.x + b.w * s, ar(s));
    ctx.lineTo(b.x + b.w, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.closePath();
    const sg = ctx.createLinearGradient(0, y0 - 20, 0, b.y + b.h);
    sg.addColorStop(0, '#FFFFFF'); sg.addColorStop(0.5, '#E4EFF7'); sg.addColorStop(1, '#A9C3D8');
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x, ar(0));
    for (let s = 0; s <= 1.0001; s += 0.02) ctx.lineTo(b.x + b.w * s, ar(s));
    ctx.stroke();

    const dark = 'rgba(20,38,58,0.92)';
    if (side) {
      const fx = b.x + b.w * 0.36, fy = ar(0.36);
      ctx.strokeStyle = 'rgba(20,38,58,0.8)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(fx + 46, fy - 6); ctx.lineTo(fx + 46, fy - 96); ctx.stroke();
      ctx.fillStyle = '#C6473A';
      ctx.beginPath(); ctx.moveTo(fx + 48, fy - 96); ctx.lineTo(fx + 104, fy - 80); ctx.lineTo(fx + 48, fy - 62); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(20,38,58,0.18)';
      ctx.beginPath(); ctx.ellipse(fx + 16, fy + 4, 44, 7, 0, 0, 7); ctx.fill();
      this.figure(ctx, fx, fy, 96, 'up', dark);
    } else {
      const a = 0.3, c2 = 0.55;
      ctx.strokeStyle = 'rgba(20,38,58,0.55)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(b.x + b.w * a, ar(a) - 26); ctx.quadraticCurveTo(b.x + b.w * 0.43, ar(0.43) - 12, b.x + b.w * c2, ar(c2) - 24); ctx.stroke();
      [[a, 62], [c2, 58]].forEach(([s, h]) => {
        const x = b.x + b.w * s, y = ar(s);
        ctx.fillStyle = 'rgba(20,38,58,0.16)';
        ctx.beginPath(); ctx.ellipse(x + 10, y + 3, h * 0.42, 5, 0, 0, 7); ctx.fill();
        this.figure(ctx, x, y, h, 'climb', dark);
      });
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.55, b.y + b.h * 0.36);
    ctx.quadraticCurveTo(b.x + b.w * 0.78, b.y + b.h * 0.3, b.x + b.w * 1.02, b.y + b.h * 0.33);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  artFriends(ctx, b, side) {
    if (!side) {
      const sky = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      sky.addColorStop(0, '#5C3F79'); sky.addColorStop(0.35, '#D9705E'); sky.addColorStop(0.68, '#F5A868'); sky.addColorStop(1, '#FFDCA0');
      ctx.fillStyle = sky; ctx.fillRect(b.x, b.y, b.w, b.h);
      const sx = b.x + b.w * 0.62, sy = b.y + b.h * 0.52;
      const g = ctx.createRadialGradient(sx, sy, 6, sx, sy, b.h * 0.5);
      g.addColorStop(0, 'rgba(255,246,214,0.98)'); g.addColorStop(0.22, 'rgba(255,214,150,0.55)'); g.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = g; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,250,228,0.95)';
      ctx.beginPath(); ctx.arc(sx, sy, b.h * 0.075, 0, 7); ctx.fill();
      this.ridgeLayer(ctx, b, { base: 0.6, amp: 0.16, freq: 2.4, seed: 21.3, fill: 'rgba(120,74,84,0.85)', haze: 'rgba(255,206,150,0.35)' });
      this.ridgeLayer(ctx, b, { base: 0.72, amp: 0.12, freq: 3.7, seed: 26.9, fill: 'rgba(74,44,58,0.9)' });

      const y0 = b.y + b.h * 0.86, y1 = b.y + b.h * 0.78;
      const ar = (s) => y0 + (y1 - y0) * ss(0, 1, s) - Math.sin(s * 5.5) * b.h * 0.02;
      ctx.beginPath(); ctx.moveTo(b.x, ar(0));
      for (let s = 0; s <= 1.0001; s += 0.02) ctx.lineTo(b.x + b.w * s, ar(s));
      ctx.lineTo(b.x + b.w, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.closePath();
      const gg = ctx.createLinearGradient(0, y1 - 10, 0, b.y + b.h);
      gg.addColorStop(0, '#4B3A2E'); gg.addColorStop(1, '#231A16');
      ctx.fillStyle = gg; ctx.fill();

      const crew = [[0.24, 74, 'up'], [0.39, 80, 'jump'], [0.55, 72, 'stand'], [0.69, 78, 'up']];
      crew.forEach(([s, h, pose]) => {
        const x = b.x + b.w * s, y = ar(s);
        ctx.save();
        ctx.strokeStyle = 'rgba(20,12,10,0.45)'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x - 26, y + h * 0.5); ctx.stroke();
        ctx.restore();
        this.figure(ctx, x, y, h, pose, '#1A1210');
      });
      ctx.strokeStyle = 'rgba(26,18,16,0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 40; i++) {
        const x = b.x + this.hash(i, 31) * b.w, y = b.y + b.h - this.hash(31, i) * b.h * 0.05;
        ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.quadraticCurveTo(x + 5, y - 16, x + 12, y - 30); ctx.stroke();
      }
    } else {
      const sky = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      sky.addColorStop(0, '#0B1A38'); sky.addColorStop(0.55, '#1D3557'); sky.addColorStop(1, '#38506B');
      ctx.fillStyle = sky; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 90; i++) {
        const r = this.hash(i, 44) * 1.7 + 0.4;
        ctx.globalAlpha = 0.35 + this.hash(44, i) * 0.65;
        ctx.beginPath(); ctx.arc(b.x + this.hash(i, 12) * b.w, b.y + this.hash(12, i) * b.h * 0.62, r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.ridgeLayer(ctx, b, { base: 0.62, amp: 0.2, freq: 2.8, seed: 33.4, fill: '#111F33' });
      const fire = { x: b.x + b.w * 0.52, y: b.y + b.h * 0.84 };
      const fg = ctx.createRadialGradient(fire.x, fire.y, 4, fire.x, fire.y, b.h * 0.42);
      fg.addColorStop(0, 'rgba(255,214,140,0.95)'); fg.addColorStop(0.25, 'rgba(240,150,70,0.42)'); fg.addColorStop(1, 'rgba(240,150,70,0)');
      ctx.fillStyle = fg; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#0E1A26'; ctx.fillRect(b.x, b.y + b.h * 0.88, b.w, b.h * 0.12);
      ctx.fillStyle = '#122236';
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.06, b.y + b.h * 0.9); ctx.lineTo(b.x + b.w * 0.2, b.y + b.h * 0.62);
      ctx.lineTo(b.x + b.w * 0.34, b.y + b.h * 0.9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0E1A26'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fire.x - 22, fire.y + 6); ctx.lineTo(fire.x + 20, fire.y - 8);
      ctx.moveTo(fire.x + 22, fire.y + 6); ctx.lineTo(fire.x - 18, fire.y - 8); ctx.stroke();
      ctx.fillStyle = '#FFC46B';
      ctx.beginPath();
      ctx.moveTo(fire.x, fire.y - 42); ctx.quadraticCurveTo(fire.x + 16, fire.y - 12, fire.x + 8, fire.y);
      ctx.lineTo(fire.x - 8, fire.y); ctx.quadraticCurveTo(fire.x - 16, fire.y - 14, fire.x, fire.y - 42); ctx.fill();
      ctx.fillStyle = '#FFF0C0';
      ctx.beginPath(); ctx.ellipse(fire.x, fire.y - 12, 6, 13, 0, 0, 7); ctx.fill();
      [[0.3, 66], [0.72, 64], [0.84, 58]].forEach(([s, h]) => this.figure(ctx, b.x + b.w * s, b.y + b.h * 0.9, h, 'sit', '#0B1522'));
      ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgba(255,196,107,0.5)';
      for (let i = 0; i < 22; i++) {
        const p = this.hash(i, 55);
        ctx.beginPath(); ctx.arc(fire.x + (p - 0.5) * 90, fire.y - 40 - this.hash(55, i) * 150, 1.6 + p * 2, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  artScuba(ctx, b, side) {
    const w = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    w.addColorStop(0, '#A8E6E4'); w.addColorStop(0.22, '#3E9FBE'); w.addColorStop(0.62, '#15628C'); w.addColorStop(1, '#062F4C');
    ctx.fillStyle = w; ctx.fillRect(b.x, b.y, b.w, b.h);

    ctx.save(); // surface
    ctx.fillStyle = 'rgba(226,250,252,0.9)';
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    for (let x = 0; x <= b.w; x += 8) ctx.lineTo(b.x + x, b.y + b.h * 0.055 + Math.sin(x * 0.06 + side) * b.h * 0.014);
    ctx.lineTo(b.x + b.w, b.y); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'screen'; // light shafts
    for (let i = 0; i < 7; i++) {
      const x = b.x + (0.06 + i * 0.15 + this.hash(i, side + 5) * 0.05) * b.w;
      const g = ctx.createLinearGradient(x, b.y, x + b.w * 0.16, b.y + b.h);
      g.addColorStop(0, 'rgba(216,248,255,0.4)'); g.addColorStop(1, 'rgba(216,248,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x + 26, b.y); ctx.lineTo(x + b.w * 0.2, b.y + b.h); ctx.lineTo(x + b.w * 0.12, b.y + b.h); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const reefY = b.y + b.h * (side ? 0.9 : 0.82);
    ctx.fillStyle = '#04263D';
    ctx.beginPath(); ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x, reefY);
    for (let x = 0; x <= b.w; x += 10) ctx.lineTo(b.x + x, reefY - this.ridge(x / b.w * 5 + side * 3, 2.2, 3) * b.h * 0.09);
    ctx.lineTo(b.x + b.w, b.y + b.h); ctx.closePath(); ctx.fill();
    ['#0A4A63', '#0D6172', '#12798A'].forEach((col, li) => {
      ctx.fillStyle = col;
      for (let i = 0; i < 7; i++) {
        const x = b.x + this.hash(i + li * 3, 61) * b.w, base = reefY + li * 6;
        const h = b.h * (0.03 + this.hash(61, i + li) * 0.07);
        ctx.beginPath();
        ctx.moveTo(x - 14, base);
        ctx.bezierCurveTo(x - 10, base - h, x + 8, base - h * 1.2, x + 4, base - h * 1.5);
        ctx.bezierCurveTo(x + 16, base - h * 1.1, x + 18, base - h * 0.4, x + 16, base);
        ctx.closePath(); ctx.fill();
      }
    });

    const fish = (x, y, s, col, flip) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -1 : 1, 1);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * 0.9, 0); ctx.lineTo(-s * 1.7, -s * 0.5); ctx.lineTo(-s * 1.7, s * 0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    for (let i = 0; i < 26; i++) {
      const x = b.x + this.hash(i, 71 + side) * b.w, y = b.y + b.h * (0.28 + this.hash(71, i) * 0.42);
      fish(x, y, 5 + this.hash(i, 8) * 5, 'rgba(255,228,168,0.85)', this.hash(i, 3) > 0.5);
    }
    fish(b.x + b.w * 0.2, b.y + b.h * 0.36, 17, 'rgba(255,206,120,0.95)', false);

    const dark = 'rgba(5,26,42,0.94)';
    if (side) {
      this.diver(ctx, b.x + b.w * 0.42, b.y + b.h * 0.44, 26, 0.42, dark);
      this.diver(ctx, b.x + b.w * 0.7, b.y + b.h * 0.62, 18, 0.3, 'rgba(5,26,42,0.7)');
    } else {
      this.diver(ctx, b.x + b.w * 0.5, b.y + b.h * 0.5, 32, -0.16, dark);
    }
    ctx.fillStyle = 'rgba(232,252,255,0.75)';
    for (let i = 0; i < 30; i++) {
      const t = i / 30;
      const x = b.x + b.w * (side ? 0.36 : 0.44) + Math.sin(t * 7 + side) * 22 + t * 26;
      const y = b.y + b.h * (side ? 0.4 : 0.46) - t * b.h * 0.42;
      ctx.globalAlpha = 0.28 + (1 - t) * 0.45;
      ctx.beginPath(); ctx.arc(x, y, 2 + t * 6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  artLagoon(ctx, b, side) {
    if (!side) { // aerial
      const w = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      w.addColorStop(0, '#1E6F7E'); w.addColorStop(0.5, '#2E93A0'); w.addColorStop(1, '#57BDBE');
      ctx.fillStyle = w; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
      for (let i = 0; i < 26; i++) {
        const y = b.y + this.hash(i, 81) * b.h;
        ctx.beginPath();
        ctx.moveTo(b.x, y);
        for (let x = 0; x <= b.w; x += 14) ctx.lineTo(b.x + x, y + Math.sin(x * 0.05 + i) * 4);
        ctx.stroke();
      }
      ctx.fillStyle = '#0E4C4F';
      ctx.beginPath();
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w * 0.42, b.y);
      ctx.bezierCurveTo(b.x + b.w * 0.3, b.y + b.h * 0.2, b.x + b.w * 0.16, b.y + b.h * 0.26, b.x, b.y + b.h * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#D9CFA8';
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.42, b.y); ctx.lineTo(b.x + b.w * 0.48, b.y);
      ctx.bezierCurveTo(b.x + b.w * 0.34, b.y + b.h * 0.22, b.x + b.w * 0.2, b.y + b.h * 0.3, b.x, b.y + b.h * 0.48);
      ctx.lineTo(b.x, b.y + b.h * 0.42);
      ctx.bezierCurveTo(b.x + b.w * 0.16, b.y + b.h * 0.26, b.x + b.w * 0.3, b.y + b.h * 0.2, b.x + b.w * 0.42, b.y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(6,40,31,0.5)';
      for (let i = 0; i < 26; i++) {
        const t = this.hash(i, 91);
        const x = b.x + b.w * (0.02 + t * 0.36), y = b.y + b.h * (0.02 + this.hash(91, i) * 0.3);
        ctx.beginPath(); ctx.arc(x, y, 7 + this.hash(i, 5) * 12, 0, 7); ctx.fill();
      }
      const kx = b.x + b.w * 0.66, ky = b.y + b.h * 0.6;
      ctx.save();
      ctx.translate(kx, ky); ctx.rotate(-0.5);
      ctx.fillStyle = 'rgba(4,40,50,0.28)';
      ctx.beginPath(); ctx.ellipse(10, 16, 62, 15, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#F0E7CE';
      ctx.beginPath(); ctx.ellipse(0, 0, 58, 13, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#C0563F';
      ctx.beginPath(); ctx.ellipse(0, 0, 50, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#14324A';
      ctx.beginPath(); ctx.arc(-8, 0, 8, 0, 7); ctx.fill();
      ctx.strokeStyle = '#14324A'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-30, -22); ctx.lineTo(14, 22); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
      for (let i = 1; i < 5; i++) {
        ctx.globalAlpha = 0.5 - i * 0.09;
        ctx.beginPath(); ctx.arc(kx + 26, ky + 18, i * 22, 0.7, 2.6); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else { // shoreline evening
      const sky = ctx.createLinearGradient(0, b.y, 0, b.y + b.h * 0.56);
      sky.addColorStop(0, '#2C4C6E'); sky.addColorStop(0.55, '#89A9B8'); sky.addColorStop(1, '#F2D2A8');
      ctx.fillStyle = sky; ctx.fillRect(b.x, b.y, b.w, b.h * 0.56);
      const sx = b.x + b.w * 0.34, sy = b.y + b.h * 0.47;
      const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, b.h * 0.34);
      g.addColorStop(0, 'rgba(255,244,206,0.95)'); g.addColorStop(1, 'rgba(255,226,170,0)');
      ctx.fillStyle = g; ctx.fillRect(b.x, b.y, b.w, b.h * 0.6);
      this.ridgeLayer(ctx, { x: b.x, y: b.y, w: b.w, h: b.h * 0.56 }, { base: 0.72, amp: 0.34, freq: 2.6, seed: 41.7, fill: '#2E4A52', snow: 0, haze: 'rgba(242,210,168,0.4)' });
      const wl = b.y + b.h * 0.56;
      const wg = ctx.createLinearGradient(0, wl, 0, b.y + b.h);
      wg.addColorStop(0, '#3A6B74'); wg.addColorStop(1, '#12363F');
      ctx.fillStyle = wg; ctx.fillRect(b.x, wl, b.w, b.h * 0.44);
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, wl, b.w, b.h * 0.44); ctx.clip();
      ctx.globalAlpha = 0.5;
      ctx.translate(0, wl * 2); ctx.scale(1, -1);
      this.ridgeLayer(ctx, { x: b.x, y: b.y, w: b.w, h: b.h * 0.56 }, { base: 0.72, amp: 0.34, freq: 2.6, seed: 41.7, fill: '#22434B' });
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,236,196,0.55)'; ctx.lineWidth = 3;
      for (let i = 0; i < 16; i++) {
        const y = wl + 8 + i * (b.h * 0.44 / 16);
        const half = 30 + i * 7;
        ctx.globalAlpha = 0.55 - i * 0.025;
        ctx.beginPath(); ctx.moveTo(sx - half, y); ctx.lineTo(sx + half, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#101E24';
      ctx.fillRect(b.x + b.w * 0.58, wl + b.h * 0.1, b.w * 0.42, 12);
      for (let i = 0; i < 5; i++) ctx.fillRect(b.x + b.w * (0.62 + i * 0.08), wl + b.h * 0.1 + 10, 8, b.h * 0.16);
      this.figure(ctx, b.x + b.w * 0.72, wl + b.h * 0.1, 62, 'stand', '#101E24');
      this.figure(ctx, b.x + b.w * 0.83, wl + b.h * 0.1, 58, 'sit', '#101E24');
    }
  }

  // ground trail winding between the ridges
  buildTrailRibbon(THREE, scene) {
    const P = this.WXZ;
    const ext = [[P[0][0] + (P[0][0] - P[1][0]) * 0.8, P[0][1] + (P[0][1] - P[1][1]) * 0.8]]
      .concat(P, [[P[5][0] + (P[5][0] - P[4][0]) * 1.4, P[5][1] + (P[5][1] - P[4][1]) * 1.4]]);
    const flat = new THREE.CatmullRomCurve3(ext.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.4);
    this.flatCurve = flat;
    const N = 900, COL = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1], verts = [], uvs = [], idx = [], cols = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = flat.getPoint(t), tg = flat.getTangent(t).normalize();
      const rx = -tg.z, rz = tg.x;
      const w = 2.5 + Math.sin(t * 19) * 0.55;
      // the tread fades out where the ground turns to snow — no dirt strip across the face
      const a = 1 - ss(94, 122, this.height(p.x, p.z));
      for (const s of COL) {
        const x = p.x + rx * w * s, z = p.z + rz * w * s;
        verts.push(x, this.treadY(x, z), z);
        uvs.push((s + 1) / 2, t * 46);
        cols.push(1, 1, 1, a);
      }
      if (i < N) {
        const b = i * COL.length;
        for (let c = 0; c < COL.length - 1; c++) {
          const q = b + c, r = q + COL.length;
          idx.push(q, q + 1, r, q + 1, r + 1, r);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(150,138,112,0)'); g.addColorStop(0.16, 'rgba(163,150,122,0.75)');
    g.addColorStop(0.4, 'rgba(214,201,174,0.95)'); g.addColorStop(0.6, 'rgba(220,208,182,0.95)');
    g.addColorStop(0.84, 'rgba(163,150,122,0.75)'); g.addColorStop(1, 'rgba(150,138,112,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(112,96,72,0.2)';
    for (let i = 0; i < 60; i++) ctx.fillRect(6 + this.hash(i, 4) * 52, this.hash(4, i) * 64, 2 + this.hash(i, 8) * 3, 2);
    ctx.fillStyle = 'rgba(88,74,54,0.14)';
    for (let i = 0; i < 22; i++) ctx.fillRect(22 + (i % 2) * 16, i * 3 + 1, 6, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, vertexColors: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    });
    scene.add(new THREE.Mesh(geo, mat));
  }

  buildLeaves(THREE, scene) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(32, 4); ctx.bezierCurveTo(58, 22, 56, 48, 32, 60); ctx.bezierCurveTo(8, 48, 6, 22, 32, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(32, 8); ctx.lineTo(32, 56); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const count = this.mobile ? 320 : 900;
    this.leafCount = count;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaMap: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.85, emissive: 0x0B3D2E, emissiveIntensity: 0.6 });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.5), mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const palette = [new THREE.Color(0x145A41), new THREE.Color(0x0B3D2E), new THREE.Color(0x4A2C1D), new THREE.Color(0xDCE8E2)];
    this.leaves = [];
    for (let i = 0; i < count; i++) {
      this.leaves.push({
        x: (Math.random() - 0.5) * 86, y: Math.random() * 36 - 15, z: (Math.random() - 0.5) * 86,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
        spin: 0.5 + Math.random() * 1.6, fall: 0.9 + Math.random() * 1.7, phase: Math.random() * 10, sc: 0.45 + Math.random() * 0.55
      });
      mesh.setColorAt(i, palette[(Math.random() * palette.length) | 0].clone().multiplyScalar(0.85 + Math.random() * 0.4));
    }
    mesh.instanceColor.needsUpdate = true;
    this.leafMesh = mesh;
    this.dummy = new THREE.Object3D();
    scene.add(mesh);
  }

  // above the snowline the fall changes over: flakes instead of leaves
  buildSnow(THREE, scene) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.72)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const count = this.mobile ? 240 : 620;
    this.snowCount = count;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xF4F9FF, transparent: true, depthWrite: false, opacity: 0.92 }), count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;   // instance matrices move every frame; the cached sphere lies
    mesh.visible = false;
    this.snow = [];
    for (let i = 0; i < count; i++) this.snow.push({
      x: (Math.random() - 0.5) * 56, y: Math.random() * 40 - 14, z: (Math.random() - 0.5) * 56,
      fall: 0.45 + Math.random() * 0.75, phase: Math.random() * 10, sc: 0.5 + Math.random() * 1.2, sw: 0.4 + Math.random()
    });
    this.snowMesh = mesh;
    scene.add(mesh);
  }

  /* ---------- scene rig: one gesture = one scene ---------- */
  /**
   * THE ONE BEHAVIOURAL CHANGE. The artifact owned the whole page: it set
   * documentElement/body overflow:hidden on mount, scrolled to the top, and listened on window,
   * so the document could not move until the journey was finished. Inside the landing page that
   * is wrong — the journey is a section, not a page.
   *
   * The lock is replaced by a predicate. A wheel/touch gesture is consumed ONLY when the journey
   * can still act on it in that direction; at either boundary nothing is prevented and the
   * browser scrolls the page natively. Because the listeners are bound to the section element,
   * "the pointer is inside the journey" is answered by event targeting rather than hit-testing.
   *
   * Consequences: no scroll trap is expressible, nothing has to be restored on unmount, and a
   * crash mid-journey cannot leave the site unscrollable.
   */
  canConsume(dir) {
    if (this.reduced) return false;               // reduced motion: never hold the page
    // FAIL OPEN. If the renderer was never built (no WebGL, blocklisted GPU, context limit) the
    // scene cannot move, so consuming a gesture would preventDefault forever and hold the page
    // hostage inside a box the reader cannot scroll out of. No engine ⇒ no claim on the wheel.
    if (!this.renderer) return false;
    // The boundary rule, and the whole of it: another scene in the requested direction means the
    // journey acts on the gesture; no scene left in that direction means the page gets it back.
    // It reads ONLY the scene index — never window.scrollY — so reversing out of scene 3 works
    // exactly the same whether the page is at the top or half way down.
    return dir > 0 ? this.sceneIdx < 5 : this.sceneIdx > 0;
  }

  bindInput() {
    this.onWheel = (e) => {
      // BOUNDARY RELEASE: at the first scene scrolling up, or the last scrolling down, nothing
      // is prevented — the page scrolls and the user leaves the section the way they came.
      if (!this.canConsume(e.deltaY > 0 ? 1 : -1)) return;
      const ad = Math.abs(e.deltaY);
      // Sub-threshold noise is not a gesture, so it must not cost the page its scroll either.
      // preventDefault now happens ONLY on the paths that actually act on the wheel, or that
      // deliberately hold the page still while a scene is in flight — never merely because the
      // pointer happens to be inside .bj-frame.
      if (ad < 4) return;
      const now = performance.now();
      const gap = now - (this.lastWheelT || 0);
      this.lastWheelT = now;
      // a scene only advances on a fresh flick: the wheel has to fall quiet first, so a
      // trackpad's inertia tail can never carry you past a stop
      if (gap > 150) this.wheelArmed = true;
      // A scene is mid-flight (or just landed): hold the page still so the transition the reader
      // asked for is not fought by the document scrolling out from under it.
      if (this.isAnimating || now - (this.settledAt || 0) < 260) { this.wheelArmed = false; e.preventDefault(); return; }
      // The inertia tail of the flick that just advanced a scene. Swallow it — releasing here
      // would shove the page down the moment a scene landed.
      if (!this.wheelArmed) { e.preventDefault(); return; }
      this.wheelArmed = false;
      e.preventDefault();
      this.gesture(e.deltaY > 0 ? 1 : -1, Math.min(ad / 300, 1.1));
    };
    this.onKey = (e) => {
      const fwd = ['ArrowDown', 'PageDown', ' ', 'Spacebar'].includes(e.key);
      const back = ['ArrowUp', 'PageUp'].includes(e.key);
      if (!fwd && !back) return;
      if (!this.canConsume(fwd ? 1 : -1)) return;   // boundary → let the page scroll
      e.preventDefault();
      this.gesture(fwd ? 1 : -1, 0.3);
    };
    this.onTouchStart = (e) => { this.touchY = e.touches[0].clientY; this.touchT = performance.now(); this.touchUsed = false; };
    this.onTouchMove = (e) => {
      if (this.touchY == null || !e.touches[0]) return;
      // ONCE CLAIMED, STAY CLAIMED FOR THE REST OF THE SWIPE.
      // `touchUsed` used to return HERE, before preventDefault. So of a seven-touchmove swipe only
      // the two before the 38px threshold were ever prevented, and the remaining finger travel was
      // handed straight to the browser: one swipe advanced a scene AND scrolled the page a few
      // hundred pixels, which then dragged the section out from under the reader (measured: scene
      // 0 → 1 plus scrollY 0 → 284 from a single swipe). Keep preventing until the finger lifts;
      // the flag still does its real job of stopping a second gesture firing from one swipe.
      if (this.touchUsed) { e.preventDefault(); return; }
      const dy = this.touchY - e.touches[0].clientY;
      if (!this.canConsume(dy > 0 ? 1 : -1)) return; // boundary → normal touch scrolling
      // Touch is NOT symmetrical with the wheel here, deliberately. Once the browser has begun a
      // native touch scroll it stops honouring preventDefault on later touchmoves, so waiting for
      // the 38px threshold before claiming the gesture would lose the swipe entirely. canConsume
      // above is the boundary gate that matters: at scene 0 up / scene 5 down we never reach this
      // line and the page scrolls natively.
      e.preventDefault();
      if (Math.abs(dy) < 38) return;
      this.touchUsed = true;
      // release velocity in px/s, normalised for the spring
      const v = Math.abs(dy) / Math.max(0.04, (performance.now() - this.touchT) / 1000);
      this.gesture(dy > 0 ? 1 : -1, Math.min(v / 900, 1.6));
    };
    // Bound to the SECTION, never to window. A wheel event targets the element under the
    // pointer, so this is exactly "the cursor is inside the Book Journey" with no hit-testing —
    // and scrolling anywhere else on the page is untouched by this component.
    const el = this.pinRef.current;
    this.inputEl = el;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('touchstart', this.onTouchStart, { passive: true });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    document.addEventListener('visibilitychange', this.onVis = () => {
      if (document.hidden) return;
      this.clock.getDelta();
      this.lastFrame = performance.now();
      if (this.isAnimating && performance.now() - this.tStart >= this.resp * 3400) this.finishTween();
    });
    // safety pump: keeps the tween resolving even if rAF is throttled
    this.pump = setInterval(() => {
      if (this.renderer && (this.isAnimating || this.ctaT < 1) && performance.now() - (this.lastFrame || 0) > 240) this.frame();
    }, 200);
  }

  /**
   * THE ALBUM IS A FIXED VISUAL ANCHOR.
   *
   * It used to be the reader's to place: `bookAdj` held a per-scene {x, y, scale} that pointer
   * drag, shift-drag, wheel, +/-/0 and a double-click all wrote to, persisted in localStorage.
   * All of that is gone — the album is now presentation, not a control — so there is no
   * `bookAdj`, no `bookAdjFor`, no `saveBookAdj`, no drag state and no hint overlay.
   *
   * EVERY scene is now a "held" scene. That is the smallest change that makes the album visually
   * fixed, because apparent size is camera DISTANCE, not scale: scenes 1/3/4 already anchored the
   * album a constant `HOLD_D` in front of the lens, while 0/2/5 left it out on the curve where
   * the camera's own choreography (`slot().d`, 10.5 → 34 world units, plus fitAlbum's corrective
   * pass) made it swell and shrink as the reader scrolled. Anchoring all six to the same distance
   * and the same scale makes the size constant BY CONSTRUCTION — no clamping, no correction.
   *
   * The environment keeps every bit of its storytelling: the camera still flies the curve, the
   * terrain, mist, clouds, leaves, snow, trekkers and climbers are untouched, and the panels
   * still cross-fade. Only the album stops moving relative to the frame.
   */
  heldScene() { return true; }

  /**
   * Screen placement for the album at scene `i`, measured against the CANVAS — not the window.
   *
   * The artifact ran full-bleed, so `window.innerWidth/innerHeight` and the canvas were the same
   * box and mixing them was invisible. Embedded in the landing page they are not: the canvas is
   * `min(94vw, 1600px)` x `min(82svh, 880px)` inside `.bj-frame`. Measuring the gutters and the
   * world-units-per-pixel `k` against the window put the album at the wrong size and the wrong
   * place. Everything below is canvas-relative and therefore self-consistent with `camera.aspect`,
   * which `resize()` already derives from the same element.
   */
  readSlot(i, d) {
    const cv = this.renderer && this.renderer.domElement;
    const box = cv && cv.getBoundingClientRect();
    const vw = (box && box.width) || window.innerWidth || 1;
    const vh = (box && box.height) || window.innerHeight || 1;
    const now = performance.now();
    this._read = this._read || null;
    let c = this._read;
    if (!c || c.vw !== vw || c.vh !== vh || now - c.t > 500) {
      // Measure ALL SIX stops in one pass. The scale has to be shared across scenes (see below),
      // so a per-scene cache cannot answer the question — it would only ever know its own gutter.
      const strips = [];
      for (let n = 0; n <= 5; n++) {
        const el = this.cards && this.cards[n];
        const r = el && el.getBoundingClientRect();
        const L = r && r.width ? r.left - (box ? box.left : 0) : vw * 0.5;
        const R = r && r.width ? (box ? box.right : vw) - r.right : vw * 0.5;
        // A gutter narrower than a third of the box is not a gutter. On a phone every card is
        // full width, so there is no "empty half of frame" to sit in — and centring the album
        // there parks it right behind the copy. Fall back to the same question on the OTHER axis:
        // take the taller of the bands above and below the card, which is where the free space
        // actually is once the cards go full width.
        const wide = Math.max(L, R) >= vw * 0.34;
        if (wide) {
          strips[n] = { left: R > L ? vw - R : 0, width: Math.max(L, R), top: 0, height: vh, hf: 0.62 };
        } else {
          const T = r && r.height ? r.top - (box ? box.top : 0) : vh * 0.5;
          const B = r && r.height ? (box ? box.bottom : vh) - r.bottom : vh * 0.5;
          strips[n] = { left: 0, width: vw, top: B > T ? vh - B : 0, height: Math.max(T, B), hf: 0.9 };
        }
      }
      c = this._read = { vw, vh, t: now, strips };
    }
    const k = (2 * Math.tan(this.camera.fov * Math.PI / 360) * Math.max(1, d)) / vh;  // world units per px
    // 1.45 pads for the rotated, pitched footprint swinging outside the flat spread
    const halfW0 = (this.bookW * 1.45) / k, halfH0 = (2.15 * 1.45) / k;   // px, at scale 1
    // ONE SCALE FOR THE WHOLE JOURNEY. This used to be solved per scene, so the album grew and
    // shrank between stops as each card left a different gutter — visible size change driven by
    // nothing but scrolling. Taking the tightest of the six means it fits every stop and never
    // changes between them. It still tracks the viewport, so it stays responsive.
    let s = 1;
    for (let n = 0; n <= 5; n++) {
      const t = c.strips[n];
      s = Math.min(s, (Math.max(90, t.width - 26) * 0.9) / (2 * halfW0), (t.height * t.hf) / (2 * halfH0));
    }
    // floor 0.42: a narrow phone box has no gutter at all, and an album clipped by the frame edge
    // is worse than a small one. On desktop the height term keeps this at ~1 anyway.
    s = clamp(s, 0.42, 1);
    const t = c.strips[i];
    const strip = Math.max(90, t.width - 26);
    return {
      k, s, vw, vh,
      centre: t.left + strip / 2 + 13,        // horizontal placement
      middle: t.top + t.height / 2,           // vertical placement (vh/2 whenever a gutter exists)
      halfW: halfW0 * s, halfH: halfH0 * s,
    };
  }

  /** Constant world distance from the lens to the album, in every scene. Apparent size is this. */
  HOLD_D = 13;

  bookBaseOff(i) {
    return { x: 0, y: 0, s: this.readSlot(i, this.HOLD_D).s };
  }

  /**
   * bindBookDrag() IS GONE, DELIBERATELY.
   *
   * It bound pointerdown/dblclick on the canvas, a CAPTURE-phase wheel + keydown on the section,
   * and pointermove/pointerup/pointercancel on WINDOW. The hover branch of that pointermove ran
   * on every mouse move anywhere on the page: getBoundingClientRect on the canvas,
   * camera.updateMatrixWorld(), book.updateMatrixWorld(true) and a recursive
   * Raycaster.intersectObject(this.book, true) through the covers, spine and three page groups,
   * plus a projected-footprint fallback — roughly sixteen times a second, for the whole life of
   * the page, purely to decide a cursor shape and to support dragging the album.
   *
   * The album is a fixed visual anchor now, so every one of those inputs has nothing left to
   * write to and the raycast has nothing left to answer. The listeners, the raycaster, the
   * localStorage placement store and the hint overlay were all removed together.
   *
   * Nothing else in the engine used pointer events, so no pointer functionality was lost: scene
   * gestures are wheel/touch/key on .bj-frame (bindInput) and the panel CTAs are ordinary
   * anchors handled natively by the browser.
   */

  // one gesture = one scene, but the flight stays grabbable: a reverse gesture
  // re-targets from the live value with velocity carried; a same-way gesture queues one step
  gesture(dir, vel) {
    const now = performance.now();
    const v = vel === undefined ? 0.3 : vel;
    // watchdog: never let a stalled frame loop brick the rig
    if (this.isAnimating && now - (this.lastFrame || 0) > 400) this.finishTween();
    if (this.isAnimating) return;                      // one gesture = one scene; nothing queues
    if (now - (this.settledAt || 0) < 220) return;     // a beat of rest at every stop
    if (now - this.lastGesture < 240) return;
    this.lastGesture = now;
    const next = this.sceneIdx + dir;
    if (next < 0) { this.bandV += -13; return; }
    if (next > 5) { this.release(); return; }
    this.fromIdx = this.sceneIdx;
    this.toIdx = next;
    this.fromU = this.fromIdx / 5;
    this.toU = next / 5;
    this.tw = 0;
    this.twV = v;
    this.dirNow = dir;
    this.damp = 1;   // critically damped: the album settles without a bounce
    this.tStart = now;
    this.isAnimating = true;
    if (this.fromIdx === 5) this.ctaT = 0;
    this.updateTrail();
  }

  finishTween() {
    this.tw = 1;
    this.twV = 0;
    this.isAnimating = false;
    this.sceneIdx = this.toIdx;
    this.fromIdx = this.toIdx;
    this.fromU = this.toU;
    this.ctaT = 0;
    this.settledAt = performance.now();
    this.updateDom();
    this.updateTrail();
  }

  release() {
    // The artifact unlocked the document and drove a smooth scroll to the next section. Now the
    // journey simply stops consuming past the last scene (see canConsume), so the same wheel
    // gesture that finished it carries the page onward. Nothing to do here.
  }

  // measure the free gutter beside this stop's card and frame the album inside it,
  // so a card the user widens can never crowd the spread
  slot(stop) {
    const key = stop + ':' + window.innerWidth + 'x' + window.innerHeight;
    this._slots = this._slots || {};
    // each stop keeps its own settled framing, so returning to a scene lands exactly where it was
    if (this._slots[key]) return (this._slot = this._slots[key]);
    const side = [0, -1, 1, -1, 1, 0][stop];
    const vw = window.innerWidth || 1;
    let nx = 0, d = 20;
    if (side) {
      const r = this.cards[stop] ? this.cards[stop].getBoundingClientRect() : null;
      let a = 0, b = vw;
      if (r && r.width) { if (side < 0) b = r.left - 18; else a = r.right + 18; }
      const w = Math.max(140, b - a);
      nx = clamp(((a + w / 2) / vw) * 2 - 1, -0.9, 0.9);
      const tanH = Math.tan(this.camera.fov * Math.PI / 360);
      // never shrink the spread below legibility, even when the card leaves a thin gutter
      const tw = Math.max(240, w * 0.9);
      d = clamp(9.6 / (2 * tanH * this.camera.aspect * Math.min(0.74, tw / vw)), 10.5, 34);
      this._slot = this._slots[key] = { nx, d, a: 6, b: vw - 6, tw, settle: 90 };
      return this._slot;
    }
    this._slot = this._slots[key] = { nx, d, a: 6, b: vw - 6, tw: vw * 0.4, settle: 0 };
    return this._slot;
  }

  // one corrective pass: measure what the album actually projects to and pull the
  // camera back / re-aim until the spread sits inside its gutter and the viewport
  fitAlbum() {
    const sl = this._slot;
    if (!sl || sl.settle <= 0 || !this.book) return;
    sl.settle--;
    const THREE = this.THREE, vw = window.innerWidth || 1;
    const bb = this._bb || (this._bb = new THREE.Box3());
    const v = this._v3 || (this._v3 = new THREE.Vector3());
    bb.setFromObject(this.book);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.project(this.camera);
      const px = (v.x * 0.5 + 0.5) * vw;
      if (px < lo) lo = px;
      if (px > hi) hi = px;
    }
    const w = hi - lo;
    if (!(w > 1)) return;
    const k = w / sl.tw;
    if (k > 1.015) sl.d = Math.min(34, sl.d * Math.min(k, 1.35));
    else if (k < 0.9 && sl.d > 10.8) sl.d = Math.max(10.5, sl.d * Math.max(k, 0.85));
    if (lo < sl.a) sl.nx = clamp(sl.nx + ((sl.a - lo) / vw) * 2 * 0.7, -0.95, 0.95);
    else if (hi > sl.b) sl.nx = clamp(sl.nx - ((hi - sl.b) / vw) * 2 * 0.7, -0.95, 0.95);
  }

  updateDom() {
    const anim = this.isAnimating;
    const p = this.tw;
    for (let i = 0; i < this.panels.length; i++) {
      let o;
      if (!anim) o = i === this.sceneIdx ? 1 : 0;
      else if (i === this.fromIdx) o = 1 - clamp(p / 0.38, 0, 1);
      else if (i === this.toIdx) o = clamp((p - 0.56) / 0.44, 0, 1);
      else o = 0;
      if (Math.abs((this.opCache[i] === undefined ? -1 : this.opCache[i]) - o) < 0.004) continue;
      this.opCache[i] = o;
      const el = this.panels[i];
      el.style.opacity = o.toFixed(3);
      // materialise: the surface scales and sharpens in, and leaves the way it came
      el.style.transform = 'translateY(' + ((1 - o) * 20).toFixed(1) + 'px) scale(' + (0.985 + 0.015 * o).toFixed(4) + ')';
      el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
      const card = el.firstElementChild;
      if (card) card.style.filter = o > 0.995 ? '' : 'blur(' + ((1 - o) * 3).toFixed(2) + 'px)';
    }
    if (this.ctaEl) {
      const c = clamp(this.ctaT / 0.9, 0, 1);
      if (Math.abs((this.ctaCache === undefined ? -1 : this.ctaCache) - c) > 0.004) {
        this.ctaCache = c;
        this.ctaEl.style.opacity = c.toFixed(3);
        this.ctaEl.style.transform = 'translateY(' + ((1 - c) * 14).toFixed(1) + 'px)';
      }
    }
  }

  updateTrail() {
    const active = (this.isAnimating ? this.toIdx : this.sceneIdx) - 1;
    this.markers.forEach((m, i) => {
      const on = i === active;
      m.style.opacity = on ? '1' : (i < active ? '.55' : '.32');
      const dot = m.querySelector('[data-dot]');
      dot.style.background = on ? '#DCE8E2' : 'transparent';
      dot.style.transform = on ? 'rotate(45deg) scale(1.45)' : 'rotate(45deg) scale(1)';
      dot.style.transition = 'transform .3s ease, background .3s ease';
    });
  }

  resize() {
    if (!this.renderer) return;
    const m = this.mountRef.current;
    this.camera.aspect = m.clientWidth / m.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(m.clientWidth, m.clientHeight);
  }

  tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    try { this.frame(); } catch (err) { window.__frameErr = String(err && err.stack || err); }
  };

  frame = () => {
    if (!this.renderer) return;
    this.lastFrame = performance.now();
    const THREE = this.THREE;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this.isAnimating) {
      const w = 6.2831853 / this.resp, z = this.damp;
      const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
      for (let i = 0; i < n; i++) {
        this.twV += (-2 * z * w * this.twV - w * w * (this.tw - 1)) * h;
        this.tw += this.twV * h;
      }
      if (Math.abs(1 - this.tw) < 0.0015 && Math.abs(this.twV) < 0.02) this.finishTween();
    }
    if (this.bandV || this.bandX) {   // soft boundary: resist, don't hard-stop
      const bw = 17.45;
      this.bandV += (-2 * bw * this.bandV - bw * bw * this.bandX) * dt;
      this.bandX += this.bandV * dt;
      if (Math.abs(this.bandX) < 0.001 && Math.abs(this.bandV) < 0.01) { this.bandX = 0; this.bandV = 0; }
    }
    if (this.sceneIdx === 5 && !this.isAnimating) this.ctaT += dt;
    this.updateDom();

    const tw = clamp(this.tw, 0, 1);
    const e = tw; // the spring is the easing — it starts from the live value, so it can be grabbed
    const u = this.fromU + (this.toU - this.fromU) * e;
    const dwell = 1 - Math.sin(Math.PI * tw);
    const stop = tw < 0.5 ? this.fromIdx : this.toIdx;
    const pos = this.curve.getPoint(u);
    const tan = this.curve.getTangent(u).normalize();
    const tan2 = this.curve.getTangent(Math.min(u + 0.012, 1)).normalize();
    const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
    const fin = this.toIdx === 5 ? e : this.fromIdx === 5 ? 1 - e : 0;
    if (this.bandX) pos.addScaledVector(tan, this.bandX * 0.55);
    if (fin > 0) pos.lerp(this.finaleBook, fin);
    // the album rides over the hillside, never through it: the curve alone dips into rising ground
    // between the trailhead and the first stop, so hold it clear of the surface it passes over
    let clr = -1e9;
    for (const [ox, oz] of [[0, 0], [1.7, 0], [-1.7, 0], [0, 1.7], [0, -1.7]]) {
      const g = this.surfaceY(pos.x + ox, pos.z + oz);
      if (g > clr) clr = g;
    }
    clr += 2.75;   // half the spread, plus air beneath it
    // released towards the summit: there the album hangs in front of the lens, so the ground
    // under the straight line to it stops having a vote
    if (pos.y < clr) pos.y += (clr - pos.y) * (1 - fin);
    if (this.baseFog) this.scene.fog.density = this.baseFog * (1 - 0.72 * fin);
    if (this.mistMat) this.mistMat.opacity = 0.5 * (1 - 0.62 * fin);
    // clouds come in under the last climb: you rise through them on the way to the summit
    if (this.clouds) {
      const cl = fin > 0 ? Math.max(Math.sin(Math.PI * fin), fin * 0.32) : 0;
      this.clouds.visible = cl > 0.01;
      this.cloudMat.opacity = 0.95 * cl;
    }

    // camera
    const F = [
      { back: 10.4, up: 1.9, side: -4.6 }, { back: 19, up: 4.5, side: 8 }, { back: 19, up: 4.5, side: -8 },
      { back: 21, up: 5, side: 10 }, { back: 19, up: 4.5, side: -8 }, { back: 16, up: 5.2, side: 3.2 }
    ][stop];
    const sl = this.slot(stop);
    const off = new THREE.Vector3().addScaledVector(tan, -F.back).addScaledVector(right, F.side);
    off.y += F.up;
    if (stop !== 0 && stop !== 5) off.setLength(sl.d);
    const dwellPos = pos.clone().add(off);
    const transitPos = pos.clone().addScaledVector(tan, -15).addScaledVector(right, Math.sin(u * 9) * 4).add(new THREE.Vector3(0, 6, 0));
    const cam = transitPos.lerp(dwellPos, dwell);
    if (fin > 0) cam.lerp(this.finaleCam, fin);
    const ground = this.height(cam.x, cam.z) + 2.6;
    if (cam.y < ground) cam.y = ground;
    if (!this.camInit) { this.camera.position.copy(cam); this.camInit = true; }
    this.camera.position.lerp(cam, 1 - Math.pow(1e-12, dt));
    // frame the album at an exact screen position, whatever the camera had to do
    const fwd = pos.clone().sub(this.camera.position);
    const dist = Math.max(1, fwd.length());
    fwd.normalize();
    const rCam = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const uCam = new THREE.Vector3().crossVectors(rCam, fwd).normalize();
    const tanH = Math.tan(this.camera.fov * Math.PI / 360);
    const NX = (stop === 0 ? 0.3 : stop === 5 ? 0 : sl.nx) * dwell;
    const NY = (stop === 5 ? 0 : 0.06) * dwell;
    const look = pos.clone()
      .addScaledVector(tan, 3 * (1 - dwell))
      .addScaledVector(rCam, -NX * tanH * this.camera.aspect * dist)
      .addScaledVector(uCam, -NY * tanH * dist);
    // at the summit the aim leaves the album and settles on the peak itself
    if (fin > 0) look.lerp(this.finaleLook, fin);
    if (!this.lookAt) this.lookAt = look.clone();
    this.lookAt.lerp(look, 1 - Math.pow(1e-10, dt));
    this.camera.lookAt(this.lookAt);
    this.bookLight.position.copy(this.camera.position).addScaledVector(right, 2.5).add(new THREE.Vector3(0, 3.5, 0));

    // book — closed at the trailhead, open from scene 1 on, one page turned per scene
    const b = this.book;
    b.position.copy(pos);
    // The trailhead and the summit used to swell the album by 18% (`1 + 0.18 * max(scene0, fin)`).
    // That is a size change driven purely by scrolling, so it is gone: one scale, every scene.
    const big = 1;
    // 4 → 5 was a straight lerp to a fixed point and that line ran clean through the cone, so
    // the album surfaced inside the snow face. anchor it to the live camera instead: held a set
    // distance in front of the lens it cannot come out behind the mountain, and the approach is
    // one smooth pull rather than a dive through rock.
    if (fin > 0) {
      const fw2 = this.lookAt.clone().sub(this.camera.position).normalize();
      const rr2 = new THREE.Vector3().crossVectors(fw2, new THREE.Vector3(0, 1, 0)).normalize();
      const uu2 = new THREE.Vector3().crossVectors(rr2, fw2).normalize();
      // clear of the headline that sits across the lower middle of the finale frame
      const anchor = this.camera.position.clone()
        .addScaledVector(fw2, 13).addScaledVector(rr2, -4.4).addScaledVector(uu2, 1.3);
      b.position.lerp(anchor, ss(0, 1, fin));
    }
    // EVERY scene now holds the album up: pinned HOLD_D in front of the lens, square to the
    // screen, sitting in the free half of frame beside that scene's card. heldScene() is true for
    // all six, so s3 is a constant 1 — kept as a value rather than inlined because the blend below
    // still reads it, and because it is what makes the album immune to the camera's own flight.
    const hF = this.heldScene(this.fromIdx) ? 1 : 0, hT = this.heldScene(this.toIdx) ? 1 : 0;
    const s3 = hF + (hT - hF) * ss(0, 1, e);
    // No reader placement any more — the album is not draggable, so there is no per-scene {x,y,s}
    // to compose in. The only offset left is the design's own, and the only scale is the shared
    // fit, which is identical for every scene by construction (see readSlot).
    const bF = this.bookBaseOff(this.fromIdx), bT = this.bookBaseOff(this.toIdx);
    const adjX = 0, adjY = 0;
    const adjS = bF.s + (bT.s - bF.s) * e;
    const fw = this.lookAt.clone().sub(this.camera.position).normalize();
    const rr = new THREE.Vector3().crossVectors(fw, new THREE.Vector3(0, 1, 0)).normalize();
    const uu = new THREE.Vector3().crossVectors(rr, fw).normalize();
    // held scenes override the curve position entirely: the album is pinned a fixed distance in
    // front of the lens, so its apparent size cannot be changed by where the camera flew.
    if (s3 > 0) {
      const D = this.HOLD_D;
      const slF = this.readSlot(this.fromIdx, D);
      const slT = this.readSlot(this.toIdx, D);
      const sl = e < 0.5 ? slF : slT, kk = sl.k, M = 24;
      const centre = slF.centre + (slT.centre - slF.centre) * e;
      const middle = slF.middle + (slT.middle - slF.middle) * e;
      const cx = clamp(centre + adjX / kk, M + sl.halfW, sl.vw - M - sl.halfW);
      const cy = clamp(middle - adjY / kk, M + sl.halfH, sl.vh - M - sl.halfH);
      const anchor = this.camera.position.clone().addScaledVector(fw, D)
        .addScaledVector(rr, (cx - sl.vw / 2) * kk).addScaledVector(uu, (sl.vh / 2 - cy) * kk);
      b.position.lerp(anchor, s3);
    }
    const bScale = big * adjS;
    b.scale.setScalar(bScale);
    this.bookBasis = { d: Math.max(1, this.camera.position.distanceTo(b.position)) };
    const air = 1 - dwell;

    const oF = this.fromIdx === 0 || this.fromIdx === 5 ? 0 : 1, oT = this.toIdx === 0 || this.toIdx === 5 ? 0 : 1;
    // opening and shutting get their own beat instead of riding the flight linearly: the covers
    // stay closed while the album lifts off 0 → 1 and swing open on the approach, and on 4 → 5 the
    // book shuts early so it arrives at the summit already closed
    const oe = oT > oF ? ss(0.18, 0.88, e) : oF > oT ? ss(0.05, 0.6, e) : e;
    const open = oF + (oT - oF) * oe;
    const close = clamp(1 - open, 0, 1);
    this.bookInner.position.x = -(this.bookW / 2) * close;
    this.bookInner.rotation.x = 0.2 * open;
    this.leftLeaf.rotation.y = -Math.PI * close + 0.14 * open;
    this.rightLeaf.rotation.y = -0.14 * open;

    const tcF = Math.max(0, this.fromIdx - 1), tcT = Math.max(0, this.toIdx - 1);
    const lo = Math.min(tcF, tcT), hi = Math.max(tcF, tcT);
    const pt = ss(0.06, 0.94, e);
    for (let p = 0; p < this.pages.length; p++) {
      const v = p < lo ? 1 : p >= hi ? 0 : (tcT > tcF ? pt : 1 - pt);
      const g = this.pages[p];
      const vv = Math.max(v, close);
      g.rotation.y = -Math.PI * vv + open * 0.13 * (1 - 2 * v);
      const bend = Math.sin(v * Math.PI);
      g.position.z = bend * 0.05;
      if (bend > 0.002 || g.userData.bent) {
        g.userData.bent = bend > 0.002;
        const pw = this.pageW;
        g.userData.geos.forEach((geo) => {
          const at = geo.attributes.position, base = geo.userData.base;
          for (let i = 0; i < at.count; i++) {
            const x = base[i * 3], z = base[i * 3 + 2];
            const s = Math.min(1, Math.abs(x) / pw);
            at.setXYZ(i, x * (1 - 0.055 * bend * s), base[i * 3 + 1],
              z + bend * (0.4 * Math.sin(s * Math.PI) + 0.22 * s * s));
          }
          at.needsUpdate = true;
          geo.computeVertexNormals();
        });
      }
    }

    const travelYaw = Math.atan2(tan.x, tan.z) + u * 6 * (1 - open);
    const cp = this.camera.position;
    const still = 1 - fin;
    // at a stop the album comes to a full rest — ramped, not switched: this multiplies live sines,
    // so flipping it on the first frame of a flight snapped the yaw and roll and read as a stutter
    const liveT = this.isAnimating ? 1 : 0;
    this.liveK = this.liveK === undefined ? liveT : this.liveK + (liveT - this.liveK) * (1 - Math.pow(0.0015, dt));
    const live = this.liveK;
    // the album is held up for the reader: square to camera at every stop, and most of the way there in flight
    // scene 3 and 4 are straight-on reading views: no held-back yaw, no drift
    const sq = 1 - s3;
    // measured from where the album actually is, so a camera-anchored album squares to the lens
    const bx = b.position.x, by = b.position.y, bz = b.position.z;
    const faceYaw = Math.atan2(cp.x - bx, cp.z - bz) + 0.07 * (1 - open) * still * sq + Math.sin(t * 0.35) * 0.03 * still * live * sq;
    const delta = ((faceYaw - travelYaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const turn = tan2.clone().sub(tan).dot(right);
    const facing = Math.max(fin, 1 - sq * (1 - (0.82 + 0.18 * Math.max(dwell, open))));
    b.rotation.set(0, 0, 0);
    b.rotateY(travelYaw + delta * facing);
    // and pitched to match, so the spread is square to the reader rather than foreshortened
    b.rotateX(-Math.asin(clamp((cp.y - by) / Math.max(1, cp.distanceTo(b.position)), -1, 1)) * facing);
    b.rotateZ((clamp(-turn * 9, -0.22, 0.22) * air * (1 - open * 0.6) + Math.sin(t * 0.5) * 0.02 * dwell * live) * still * sq);
    b.rotateX(Math.sin(t * 0.8) * 0.035 * air * (1 - open * 0.5) * still * sq);
    // held scenes want the spread parallel to the image plane, not merely pointed at the eye:
    // the slot is off the optical axis, so aiming at the camera position keystones it. adopt the
    // camera's own basis instead — that is what "square to the screen" actually means.
    if (s3 > 0) b.quaternion.slerp(this.camera.quaternion, s3);

    // Terrain clearance only ever applied to an album sitting out on the curve, and its whole
    // effect was `* (1 - max(fin, s3))`. With every scene camera-anchored s3 is 1, so the factor
    // is 0 and this can never move the album — it would only resample the slope four times a
    // frame to multiply the answer by nothing. Kept behind the guard so a future scene that goes
    // back to riding the curve still gets its clearance.
    if (s3 < 1) {
      const cv = this._cv || (this._cv = new THREE.Vector3());
      const hx = this.bookW * (0.5 + 0.5 * open) * bScale, hy = 2.05 * bScale;
      let need = -1e9;
      for (const [qx, qy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        cv.set(hx * qx, hy * qy, 0).applyQuaternion(b.quaternion);
        const g = this.surfaceY(b.position.x + cv.x, b.position.z + cv.z) - cv.y;
        if (g > need) need = g;
      }
      need += 0.55;
      // the four corners resample the slope every frame, so this target is noisy while the album
      // banks and drifts. rise with it at once (a corner must never cut the ground) but let it fall
      // away smoothly, which is what turns the trailhead lift from a chatter into a glide.
      this._need = this._need === undefined ? need
        : Math.max(need, this._need + (need - this._need) * (1 - Math.pow(0.002, dt)));
      if (b.position.y < this._need) b.position.y += (this._need - b.position.y) * (1 - Math.max(fin, s3));
    }

    this.key.target.position.copy(b.position);
    this.key.position.copy(b.position).add(this.keyOffset);
    const camX = this.camera.position.x, camZ = this.camera.position.z;
    if (this.trekkers) this.trekkers.forEach((m) => {
      const d = m.userData;
      // out and back: up to the snowline, a breather, then down the same tread
      if (d.hold > 0) d.hold -= dt;
      else {
        d.t += d.spd * dt * d.dir;
        if (d.t >= d.top) { d.t = d.top; d.dir = -1; d.hold = 1.4 + this.hash(d.phase * 7, 3) * 1.6; }
        else if (d.t <= 0.018) { d.t = 0.018; d.dir = 1; d.hold = 1.2; }
      }
      let s = this.walkAt(d.t, d.off);
      // far figures are a couple of pixels tall; drawing them costs a shadow pass they can't repay
      const camDist = Math.hypot(s.x - camX, s.z - camZ);
      m.visible = camDist < 120;
      if (!m.visible) { d.lastY = s.y; return; }
      // beyond reading distance a full gait solve (two ground samples, leg IK, pole IK) buys pixels
      // nobody can see. walk the body along the tread and leave the limbs in their last pose.
      if (camDist > 46) {
        const sc0 = m.scale.x || 1;
        if (d.hold <= 0) d.gait += dt * d.spd * (Math.PI * this.pathLen / (0.66 * sc0));
        m.rotation.y = s.yaw + (d.dir < 0 ? Math.PI : 0);
        // match the near solve's pelvis height so crossing the LOD boundary doesn't step the body
        m.position.set(s.x, this.treadY(s.x, s.z) + 0.16 * sc0, s.z);
        d.lastY = s.y;
        return;
      }
      // step off the tread to pass the album rather than walking through it
      const near = 1 - ss(2.4, 6.5, Math.hypot(s.x - b.position.x, s.z - b.position.z));
      if (near > 0) s = this.walkAt(d.t, d.off + (d.off < 0 ? -1 : 1) * near * (3.1 - Math.abs(d.off)));
      const go = d.hold > 0 ? 0 : 1;
      const sc = m.scale.x || 1, TAU = Math.PI * 2;
      // cadence comes out of ground covered — one step per 0.66m of trail — so boots never slide
      d.gait += dt * d.spd * (Math.PI * this.pathLen / (0.66 * sc)) * go;
      const w = d.gait + d.phase;
      const sw = Math.sin(w);
      m.rotation.y = s.yaw + (d.dir < 0 ? Math.PI : 0);
      const cy = Math.cos(m.rotation.y), sy = Math.sin(m.rotation.y);
      // every boot gets a target on the surface actually beneath it: linear drive back through
      // stance, an eased lift through swing, heel-to-toe roll across both
      const F = [];
      for (let i = 0; i < 2; i++) {
        const p = (((w + i * Math.PI) % TAU) + TAU) % TAU;
        let fz, lift, roll;
        if (!go) { fz = i ? -0.15 : 0.16; lift = 0; roll = 0; }
        else if (p < Math.PI) { fz = 0.66 * (0.5 - p / Math.PI); lift = 0; roll = -0.2 * Math.cos(p); }
        else {
          const v = (p - Math.PI) / Math.PI;
          fz = 0.66 * ((1 - Math.cos(Math.PI * v)) * 0.5 - 0.5);
          lift = 0.1 * Math.sin(Math.PI * v);
          roll = 0.2 * Math.cos(Math.PI * v);
        }
        const lx = (i ? 0.115 : -0.115) * sc, lz = fz * sc;
        F.push({ fz, lift, roll, g: this.treadY(s.x + lx * cy + lz * sy, s.z - lx * sy + lz * cy) });
      }
      // slope across the stride, read straight off the two boot samples
      const dfz = (F[0].fz - F[1].fz) * sc;
      if (Math.abs(dfz) > 0.12) {
        const raw = Math.atan2(F[0].g - F[1].g, Math.abs(dfz)) * (dfz < 0 ? -1 : 1);
        d.gp = (d.gp || 0) + (raw - (d.gp || 0)) * Math.min(1, dt * 8);
      }
      const gp = d.gp || 0;
      // the pelvis rides as high as the lower boot allows, so the uphill leg folds under the
      // walker instead of the boot being driven into the hillside
      // the pelvis has to clear the HIGHEST boot. taking the lowest let the uphill leg fold up
      // and dragged the body down through the hillside; the downhill leg extends to reach instead,
      // which is what a walker actually does on a slope.
      let hip = -Infinity;
      F.forEach((f) => { hip = Math.max(hip, f.g + (0.075 + f.lift) * sc + Math.sqrt(Math.max(0.04, 0.7534 - f.fz * f.fz)) * sc); });
      // and never below the ground directly under the walker, whatever the two boots read
      hip = Math.max(hip, this.treadY(s.x, s.z) + 0.86 * sc);
      m.position.set(s.x, hip - 0.92 * sc, s.z);
      F.forEach((f, i) => this.solveLeg(d, i, hip, f.g + (0.075 + f.lift) * sc, f.fz, sc, f.roll - gp));
      // arms lag the legs slightly, the way a loose shoulder actually swings
      const asw = Math.sin(w - 0.24) * go;
      d.arms[0].rotation.x = -0.5 * asw; d.arms[0].rotation.z = -0.07 - 0.03 * asw;
      d.arms[1].rotation.x = 0.5 * asw; d.arms[1].rotation.z = 0.07 - 0.03 * asw;
      d.elbows[0].rotation.x = -0.34 - Math.max(0, asw) * 0.48;
      d.elbows[1].rotation.x = -0.6 - Math.max(0, -asw) * 0.22;   // the pole arm holds its bend and swings from the shoulder
      // the wrist breaks at the end of the arm rather than running rigid into the hand
      const wr = 0.18 - asw * 0.14;
      if (d.hands) { d.hands[0].rotation.x = 0.18 + asw * 0.14; d.hands[1].rotation.x = wr; }
      // the pole: grip parked in the fist, then the shaft solved so its tip meets the ground the
      // boots are standing on — planted while the body walks past it, lifted through the recovery
      if (d.pole && d.pole.visible) {
        const P = d.pole, V = this._pv || (this._pv = new this.THREE.Vector3());
        m.updateMatrixWorld(true);
        d.hands[1].getWorldPosition(V);
        m.worldToLocal(V);
        P.position.set(V.x + 0.015, V.y + 0.025, V.z + 0.03);
        const ph = (((w - 0.24) % TAU) + TAU) % TAU, L = 0.81;
        const pitch = -0.3 * Math.cos(ph) * go * (1 - clamp(Math.abs(gp) * 1.4, 0, 0.62)), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const plift = ph > Math.PI ? 0.16 * Math.sin(ph - Math.PI) * go : 0;
        const rootY = m.position.y + P.position.y * sc;
        const need = (a, len) => {
          const lx = P.position.x + L * len * Math.sin(a), lz = P.position.z - L * len * sp;
          const tX = s.x + (lx * cy + lz * sy) * sc, tZ = s.z + (-lx * sy + lz * cy) * sc;
          return (rootY - this.treadY(tX, tZ) - plift * sc) / sc / (cp * Math.cos(a)) / L;
        };
        // the stride sets the lean; the shaft telescopes to whatever length puts the tip on the
        // ground under it \u2014 short on the uphill plant, long reaching downhill. two passes, so the
        // second reads the ground actually beneath where the first pass put the tip.
        // one degree of freedom only: the shaft length. letting the plant also swing sideways made
        // the solve flip between frames and stab the slope, so the lean stays fixed and small.
        const tz = 0.06;
        let sy2 = 1;
        for (let k = 0; k < 3; k++) sy2 = clamp(need(tz, sy2), 0.42, 1.55);
        // last word goes to the shorter of the two solutions, so a tip that cannot quite reach
        // hangs a little above the ground rather than sinking into it
        sy2 = Math.min(sy2, clamp(need(tz, sy2), 0.42, 1.55));
        P.rotation.set(pitch, 0, tz);
        P.scale.set(1, sy2, 1);
      }
      d.torso.rotation.z = sw * 0.028 * go;
      d.torso.rotation.y = -sw * 0.085 * go;
      d.lean = (d.lean === undefined ? 0 : d.lean) + (clamp(gp * 0.6, -0.1, 0.3) - (d.lean || 0)) * Math.min(1, dt * 3);
      d.torso.rotation.x = 0.05 + d.lean;
      if (d.head) { d.head.rotation.y = -d.torso.rotation.y * 0.8; d.head.rotation.x = -d.lean * 0.7; }
      d.lastY = m.position.y;
    });
    // the roped party is on the summit face — off screen until the last climb, and the rig solve
    // (two ground samples and leg IK per climber) is the most expensive thing in the frame.
    // one pass has to run at build time, though: position is only ever written in here, so gating
    // the first frame left all five stacked at the world origin, in frustum, floating.
    const climbOn = fin > 0.004 || this.sceneIdx >= 4 || this.toIdx >= 4;
    if (this.climbers && (climbOn || !this.climbersPlaced)) this.climbers.forEach((m) => {
      const d = m.userData;
      // the face is climbed in discrete hauls: reach, pull, kick a step in, rest on the rope
      d.ph += dt * d.rate;
      const k = Math.floor(d.ph), f = d.ph - k;
      if (k !== d.k) {
        d.k = k;
        d.u0 = d.u1;
        let n = d.u0 + d.step * d.dir;
        if (n > 0.93) { d.dir = -1; n = d.u0 - d.step; }        // topped out: back down the same line
        else if (n < 0.08) { d.dir = 1; n = d.u0 + d.step; }
        d.u1 = n;
      }
      const e2 = ss(0.16, 0.72, f);
      d.u = clamp(d.u0 + (d.u1 - d.u0) * e2, 0, 1);
      const p = this.route.getPoint(d.u), tg = this.route.getTangent(d.u).normalize();
      const reach = Math.sin(Math.PI * clamp(f / 0.78, 0, 1));
      const lead = k % 2, trail = 1 - lead;
      // stand just off the fixed line, crampons on the snow, weight into the face
      const cx = p.x + tg.z * d.side, cz = p.z - tg.x * d.side;
      m.rotation.y = Math.atan2(tg.x, tg.z);      // always facing the face, up or down
      m.rotation.x = 0.14 + clamp(tg.y, 0, 1) * 0.22;   // weight into the face, not folded into it
      d.arms[lead].rotation.set(-2.5 + reach * 0.55, 0, lead ? 0.2 : -0.2);
      d.elbows[lead].rotation.x = -0.15 - reach * 0.5;
      d.arms[trail].rotation.set(-1.45 - reach * 0.2, 0, trail ? 0.32 : -0.32);
      d.elbows[trail].rotation.x = -0.72 + reach * 0.2;
      if (d.hands) { d.hands[lead].rotation.x = 0.26; d.hands[trail].rotation.x = 0.32; }
      // crampons bite the snow that is actually under each boot: the lead kicks a step higher up
      // the face, the trailing one stands on the step below
      const sc = m.scale.x || 1, yc = Math.cos(m.rotation.y), ys = Math.sin(m.rotation.y);
      const pit = m.rotation.x, hz = 0.92 * Math.sin(pit) * sc;   // the pitch carries the pelvis out over the boots
      const step = [{ i: lead, fz: 0.1 + reach * 0.24, lf: reach * 0.12 }, { i: trail, fz: -0.18, lf: 0 }];
      let hip = -Infinity;
      step.forEach((f) => {
        const lx = (f.i ? 0.115 : -0.115) * sc, lz = hz + f.fz * sc;
        f.g = this.groundY(cx + lx * yc + lz * ys, cz - lx * ys + lz * yc) + f.lf * sc;
        hip = Math.max(hip, f.g + 0.075 * sc + Math.sqrt(Math.max(0.04, 0.7534 - f.fz * f.fz)) * sc);
      });
      // same rule on the face: stand off the higher crampon, never sink to the lower one
      hip = Math.max(hip, this.groundY(cx, cz) + 0.86 * sc);
      m.position.set(cx, hip - 0.92 * Math.cos(pit) * sc + reach * 0.02, cz);
      step.forEach((f) => this.solveLeg(d, f.i, hip + reach * 0.02, f.g + 0.075 * sc, f.fz, sc, -0.3, pit));
      d.torso.rotation.x = 0.14 + reach * 0.08;
      d.torso.rotation.z = Math.sin(d.ph * 2.1) * 0.035;
      if (d.head) d.head.rotation.x = -0.12 - reach * 0.12;
      this.climbersPlaced = true;
    });
    if (this.summitHero) {
      if (!this.summitPlanted) { this.summitPlanted = true; this.plantFeet(this.summitHero); this.plantFeet(this.summitMate); }
      this.summitHero.userData.torso.rotation.z = Math.sin(t * 0.85) * 0.035;
      this.summitHero.userData.arms[1].rotation.z = -0.34 + Math.sin(t * 1.1) * 0.09;
      this.summitMate.userData.arms[0].rotation.x = -2.2 + Math.sin(t * 1.4) * 0.1;
      this.summitMate.userData.torso.rotation.z = Math.sin(t * 0.7 + 1) * 0.04;
    }
    if (this.tricolour) {
      const at = this.tricolour.geometry.attributes.position, base = this.triBase;
      for (let i = 0; i < at.count; i++) {
        const bx = base[i * 3];
        at.setXYZ(i, bx, base[i * 3 + 1], Math.sin(t * 3.4 + (bx + 1.05) * 3.1) * (bx + 1.05) * 0.11);
      }
      at.needsUpdate = true;
    }
    if (this.flag) this.flag.rotation.y = Math.sin(t * 1.4) * 0.22;
    if (this.prayer) this.prayer.children.forEach((q) => { q.rotation.y = 0.5 + Math.sin(t * 2.6 + q.userData.p) * 0.5; });
    // fitAlbum() is NO LONGER CALLED. It pulled the CAMERA back or pushed it in until the album's
    // projected width matched its gutter — changing apparent album size by moving the camera,
    // which is precisely the scroll-driven zoom that had to stop. It would also now misbehave:
    // the album is anchored a fixed HOLD_D in front of the lens, so its projected width no longer
    // responds to `sl.d`, the ratio never converges, and 90 settle frames of `sl.d *= k` would
    // walk the camera to a clamp bound for nothing. readSlot's measured shared fit replaces it.
    // The method is left intact and unreferenced so it stays diffable against the artifact.

    // leaves
    const thin = 1 - dwell * 0.42;
    const active = Math.floor(this.leafCount * clamp(thin * (this.leafScale ?? 1) * (1 - ss(0.12, 0.7, fin)), 0, 1));
    for (let i = 0; i < this.leafCount; i++) {
      const L = this.leaves[i];
      if (i >= active) { this.dummy.scale.setScalar(0); this.dummy.position.set(0, -9999, 0); this.dummy.updateMatrix(); this.leafMesh.setMatrixAt(i, this.dummy.matrix); continue; }
      L.y -= L.fall * dt * (0.6 + 0.6 * (1 - dwell));
      L.x += Math.sin(t * 0.7 + L.phase) * 0.6 * dt + 0.35 * dt;
      L.z += Math.cos(t * 0.5 + L.phase * 1.7) * 0.5 * dt;
      L.rx += L.spin * dt; L.ry += L.spin * 0.7 * dt; L.rz += L.spin * 0.4 * dt;
      const wx = pos.x + L.x, wy = pos.y + L.y, wz = pos.z + L.z;
      if (L.y < -18 || Math.abs(L.x) > 46 || Math.abs(L.z) > 46) {
        L.x = (Math.random() - 0.5) * 80; L.z = (Math.random() - 0.5) * 80; L.y = 17 + Math.random() * 9;
      }
      this.dummy.position.set(wx, wy, wz);
      this.dummy.rotation.set(L.rx, L.ry, L.rz);
      this.dummy.scale.setScalar(this.dummy.position.distanceTo(this.camera.position) < 3.2 ? 0 : L.sc);
      this.dummy.updateMatrix();
      this.leafMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.leafMesh.instanceMatrix.needsUpdate = true;
    this.leafMesh.visible = fin < 0.985;
    // snow takes over for the last climb and the summit
    if (this.snowMesh) {
      const snowOn = fin > 0.02;
      this.snowMesh.visible = snowOn;
      if (snowOn) {
        const sq = this.camera.quaternion, amt = ss(0.02, 0.5, fin);
        for (let i = 0; i < this.snowCount; i++) {
          const S = this.snow[i];
          S.y -= S.fall * dt;
          S.x += Math.sin(t * 0.9 + S.phase) * S.sw * dt + 0.25 * dt;
          S.z += Math.cos(t * 0.7 + S.phase * 1.3) * S.sw * dt;
          if (S.y < -16 || Math.abs(S.x) > 32 || Math.abs(S.z) > 32) {
            S.x = (Math.random() - 0.5) * 56; S.z = (Math.random() - 0.5) * 56; S.y = 16 + Math.random() * 9;
          }
          this.dummy.position.set(pos.x + S.x, pos.y + S.y, pos.z + S.z);
          this.dummy.quaternion.copy(sq);
          this.dummy.scale.setScalar(this.dummy.position.distanceTo(this.camera.position) < 1.2 ? 0 : S.sc * amt);
          this.dummy.updateMatrix();
          this.snowMesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.snowMesh.instanceMatrix.needsUpdate = true;
      }
    }

    this.mistGroup.children.forEach((m, i) => { m.position.x += Math.sin(t * 0.05 + i) * 0.02 * m.userData.drift; });
    if (this.clouds && this.clouds.visible) this.clouds.children.forEach((q, i) => {
      q.position.x += Math.sin(t * 0.06 + i) * 0.03 * q.userData.d;
      q.quaternion.copy(this.camera.quaternion);   // soft billboards: cloud from any angle
    });

    this.renderer.render(this.scene, this.camera);
  };
}
