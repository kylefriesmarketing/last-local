// THE LAST LOCAL — view layer. Reads sim state, never writes it. Math.random
// is allowed here (view-only); the sim never imports this file.
import * as THREE from '../lib/three.module.js';
import { LAYOUT, TABLES, STATIONS, PEN_GATE, ARCHETYPES, ITEMS, EMPLOYEES, SHIFT, TUNING, REQUESTS } from './data.js';

const W = LAYOUT[0].length;
const H = LAYOUT.length;
const PAL = {
  navy: 0x17313a, amber: 0xd69a32, cream: 0xf4ebdd, pine: 0x6d8177,
  rust: 0x9d4e35, cold: 0x7aa2b8, wood: 0x6b4a2e, woodDark: 0x503620,
  steel: 0x8a95a0, mud: 0x5a4632, gravel: 0x3a4448, pig: 0xe8a8b8,
};

function canvasTex(draw, w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export class View {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a161c, 30, 70);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camBase = new THREE.Vector3(W / 2, 15.5, H + 6.5);
    this.camLook = new THREE.Vector3(W / 2, 0, H / 2 - 1.2);
    this.guestMeshes = new Map();
    this.pigMeshes = new Map();
    this.itemMeshes = new Map();
    this.spillMeshes = new Map();
    this.markerSprites = new Map();
    this.playerMeshes = [];
    this.flashT = 0;
    this.smokeSprites = [];
    this.glyphCache = new Map();
    this.chargePreview = null;
    this.arcLine = null;
    this.fpMode = true;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.camera.rotation.order = 'YXZ';
    this.viewModel = null;
    this.vmKind = undefined;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth || document.documentElement.clientWidth || 960;
    const h = innerHeight || document.documentElement.clientHeight || 540;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  build(game) {
    const S = this.scene;
    // lights: dim blue night + warm interior points
    S.add(new THREE.HemisphereLight(0x46586c, 0x241a10, 0.9));
    const moon = new THREE.DirectionalLight(0x7aa2b8, 0.5);
    moon.position.set(-14, 22, -10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -20; moon.shadow.camera.right = 20;
    moon.shadow.camera.top = 20; moon.shadow.camera.bottom = -20;
    this.moon = moon;
    S.add(moon);
    const warm = (x, z, i = 2.0, d = 10) => {
      const L = new THREE.PointLight(0xffb45e, i, d, 1.4);
      L.position.set(x, 2.7, z);
      S.add(L);
      return L;
    };
    warm(11, 9.5, 2.6, 12); warm(15, 4.5); warm(9, 4.5); warm(20, 6.5, 1.6); warm(20, 2.5, 1.4);
    this.barLight = warm(11.5, 12.5, 1.8, 9);
    // cold utility light over the lot + a pen glow
    const lot = new THREE.PointLight(0x7aa2b8, 1.2, 9, 1.5);
    lot.position.set(3, 3.2, 2.5);
    S.add(lot);
    const pen = new THREE.PointLight(0xc9a86a, 0.9, 7, 1.5);
    pen.position.set(3, 2.2, 7.5);
    S.add(pen);

    // floors per tile kind
    const woodTex = canvasTex((g, w, h) => {
      g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? '#5e3f25' : '#75533a';
        g.fillRect(0, i * (h / 6), w, h / 6 - 2);
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect((i * 37) % w, i * (h / 6), 2, h / 6);
      }
    });
    const mats = {
      wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 }),
      gravel: new THREE.MeshStandardMaterial({ color: PAL.gravel, roughness: 1 }),
      mud: new THREE.MeshStandardMaterial({ color: PAL.mud, roughness: 1 }),
    };
    const floorGeo = new THREE.BoxGeometry(1, 0.1, 1);
    const floorGroup = new THREE.Group();
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = LAYOUT[z][x];
        let m = null;
        if (c === '.' || c === 'D' || c === '=' || c === 'K') { m = mats.wood; }
        else if (c === ',') { m = mats.gravel; }
        else if (c === '_' || c === 'G') { m = mats.mud; }
        if (!m) { continue; }
        const f = new THREE.Mesh(floorGeo, m);
        f.position.set(x + 0.5, -0.05, z + 0.5);
        f.receiveShadow = true;
        floorGroup.add(f);
      }
    }
    S.add(floorGroup);

    // walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b2019, roughness: 0.9 });
    const wallGeo = new THREE.BoxGeometry(1, 2.4, 1);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = LAYOUT[z][x];
        if (c !== '#' && c !== ' ') { continue; }
        // only build walls that border something walkable (keeps the diorama open)
        let border = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = LAYOUT[z + dz] && LAYOUT[z + dz][x + dx];
          if (n && n !== '#' && n !== ' ') { border = true; break; }
        }
        if (!border) { continue; }
        const wl = new THREE.Mesh(wallGeo, wallMat);
        wl.position.set(x + 0.5, 1.2, z + 0.5);
        wl.castShadow = true; wl.receiveShadow = true;
        // iso QA camera peeks over lowered south walls; first person gets real
        // ones, tall enough to meet the ceiling with no sky slit
        if (!this.fpMode && z >= 14) { wl.scale.y = 0.35; wl.position.y = 0.42; }
        else if (this.fpMode) { wl.scale.y = 1.22; wl.position.y = 1.46; }
        S.add(wl);
      }
    }

    // bar + kitchen counters
    const barMat = new THREE.MeshStandardMaterial({ color: PAL.woodDark, roughness: 0.6, metalness: 0.1 });
    const steelMat = new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.35, metalness: 0.55 });
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = LAYOUT[z][x];
        if (c === '=') {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1.05, 1), barMat);
          b.position.set(x + 0.5, 0.52, z + 0.5);
          b.castShadow = true; b.receiveShadow = true;
          S.add(b);
          const top = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.06, 1.12),
            new THREE.MeshStandardMaterial({ color: PAL.amber, roughness: 0.35 }));
          top.position.set(x + 0.5, 1.08, z + 0.5);
          S.add(top);
        } else if (c === 'K') {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.95, 1), steelMat);
          b.position.set(x + 0.5, 0.47, z + 0.5);
          b.castShadow = true; b.receiveShadow = true;
          S.add(b);
        }
      }
    }

    // tables + stools
    const tableTop = canvasTex((g, w, h) => {
      g.fillStyle = '#8a2f2b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f4ebdd';
      const s = w / 8;
      for (let i = 0; i < 8; i++) { for (let j = 0; j < 8; j++) { if ((i + j) % 2) { g.fillRect(i * s, j * s, s, s); } } }
    });
    for (const t of TABLES) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x333 }));
      leg.position.set(t.x + 0.5, 0.4, t.z + 0.5);
      S.add(leg);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 20),
        new THREE.MeshStandardMaterial({ map: tableTop, roughness: 0.7 }));
      top.position.set(t.x + 0.5, 0.82, t.z + 0.5);
      top.castShadow = true;
      S.add(top);
      for (const dx of [-0.8, 0.8]) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10),
          new THREE.MeshStandardMaterial({ color: PAL.rust, roughness: 0.8 }));
        stool.position.set(t.x + 0.5 + dx, 0.25, t.z + 0.5);
        stool.castShadow = true;
        S.add(stool);
      }
    }

    // stations props (simple, readable silhouettes)
    this.stationGlow = {};
    const prop = (x, z, w2, h2, d2, color, y = null) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, d2),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
      m.position.set(x + 0.5, y == null ? 1.1 + h2 / 2 : y, z + 0.5);
      m.castShadow = true;
      S.add(m);
      return m;
    };
    prop(STATIONS.taps.x, STATIONS.taps.z, 0.5, 0.55, 0.3, PAL.amber);
    prop(STATIONS.coffee.x, STATIONS.coffee.z, 0.55, 0.45, 0.4, 0x2e2622);
    prop(STATIONS.pos.x, STATIONS.pos.z, 0.5, 0.4, 0.35, 0x39424a);
    this.grillProp = prop(STATIONS.grill.x, STATIONS.grill.z, 0.8, 0.25, 0.7, 0x222);
    this.fryerProp = prop(STATIONS.fryer.x, STATIONS.fryer.z, 0.7, 0.45, 0.6, PAL.steel);
    prop(STATIONS.dish.x, STATIONS.dish.z, 0.8, 0.5, 0.7, 0xb8c4cc);
    prop(STATIONS.jelly.x, STATIONS.jelly.z, 0.7, 0.6, 0.6, 0x4e6b76);
    const juke = prop(STATIONS.jukebox.x, STATIONS.jukebox.z, 0.7, 1.0, 0.5, 0x5a2a4a, 1.0);
    juke.material.emissive = new THREE.Color(0x8a3a6a);
    juke.material.emissiveIntensity = 0.6;
    prop(STATIONS.dumpster.x, STATIONS.dumpster.z, 0.9, 0.7, 0.8, 0x3a4a3f, 0.35);
    prop(STATIONS.trough.x, STATIONS.trough.z, 0.9, 0.3, 0.5, PAL.woodDark, 0.15);

    // pen fence + gate
    const fenceMat = new THREE.MeshStandardMaterial({ color: PAL.woodDark, roughness: 1 });
    const fence = (x, z, rot) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.12), fenceMat);
      f.position.set(x + 0.5, 0.55, z + 0.5);
      f.rotation.y = rot;
      S.add(f);
      return f;
    };
    for (let z = 6; z <= 9; z++) { fence(5, z, Math.PI / 2); }
    this.gateMesh = fence(PEN_GATE.x, PEN_GATE.z, Math.PI / 2);
    this.gateMesh.material = new THREE.MeshStandardMaterial({ color: PAL.amber, roughness: 0.8 });

    // neon sign over the bar
    const neon = canvasTex((g, w, h) => {
      g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
      g.font = 'bold 30px Georgia'; g.textAlign = 'center';
      g.shadowColor = '#ffb45e'; g.shadowBlur = 16;
      g.fillStyle = '#ffd27f'; g.fillText('THE LAST LOCAL', w / 2, h / 2 + 10);
    }, 512, 96);
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.9 }));
    signBoard.position.set(15, 2.55, 0.62);
    this.scene.add(signBoard);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2),
      new THREE.MeshBasicMaterial({ map: neon, transparent: true }));
    sign.position.set(15, 2.55, 0.72);
    this.scene.add(sign);
    this.sign = sign;
    const signGlow = new THREE.PointLight(0xffc370, 1.4, 7, 1.6);
    signGlow.position.set(15, 2.6, 1.6);
    this.scene.add(signGlow);

    // first person gets a roof over the room (pen + lot stay under the sky)
    if (this.fpMode) {
      const ceilTex = canvasTex((g, w, h) => {
        g.fillStyle = '#3a2a1c'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#33241a' : '#40301f';
          g.fillRect(0, i * (h / 8), w, (h / 8) - 1);
        }
      });
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(19, 14),
        new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95, side: THREE.DoubleSide }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(15.5, 2.75, 8);
      S.add(ceil);
      // hanging bulbs where the warm lights live
      for (const [bx, bz] of [[11, 9.5], [15, 4.5], [9, 4.5], [20, 6.5], [20, 2.5], [11.5, 12.5]]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 4),
          new THREE.MeshBasicMaterial({ color: 0x111 }));
        cord.position.set(bx, 2.45, bz);
        S.add(cord);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
        bulb.position.set(bx, 2.15, bz);
        S.add(bulb);
      }
      this.buildViewModel();
    }
    // moonlit backdrop: distant ridge silhouette behind the lot
    const ridge = new THREE.Mesh(new THREE.PlaneGeometry(70, 12),
      new THREE.MeshBasicMaterial({ color: 0x0d1b22 }));
    ridge.position.set(W / 2, 4.5, -6);
    S.add(ridge);
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8eef2 }));
    moonDisc.position.set(4, 9.5, -5.8);
    S.add(moonDisc);

    // players (+ name tags when the bar has a crew)
    for (const p of game.players) {
      const m = this.makePerson(EMPLOYEES[p.key].tint, true);
      if (game.players.length > 1) {
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.textTex(EMPLOYEES[p.key].label.split(' ')[0], '#f4ebdd'),
          transparent: true, depthWrite: false,
        }));
        tag.scale.set(1.5, 0.42, 1);
        tag.position.y = 2.0;
        m.add(tag);
      }
      this.playerMeshes[p.pid] = m;
      S.add(m);
    }
    this.game = game;
  }

  textTex(text, color) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 72;
    const g = c.getContext('2d');
    g.font = 'bold 34px Georgia';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(10,22,28,.72)';
    g.beginPath();
    g.roundRect(28, 8, 200, 54, 12);
    g.fill();
    g.fillStyle = color;
    g.fillText(text, 128, 47);
    return new THREE.CanvasTexture(c);
  }

  glyphTex(glyph) {
    if (this.glyphCache.has(glyph)) { return this.glyphCache.get(glyph); }
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#f4ebdd';
    g.strokeStyle = '#17313a';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(48, 42, 34, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.beginPath();
    g.moveTo(38, 70); g.lineTo(48, 90); g.lineTo(58, 70);
    g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#17313a';
    g.font = 'bold 44px Georgia';
    g.textAlign = 'center';
    g.fillText(glyph, 48, 58);
    const t = new THREE.CanvasTexture(c);
    this.glyphCache.set(glyph, t);
    return t;
  }

  makePerson(tint, isPlayer = false) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.72, 10),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7 }));
    body.position.y = 0.48;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8 }));
    head.position.y = 1.05;
    head.castShadow = true;
    g.add(head);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.25, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: isPlayer ? 0x2b2019 : tint, roughness: 0.9 }));
    hat.position.y = 1.2;
    g.add(hat);
    if (isPlayer) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 24),
        new THREE.MeshBasicMaterial({ color: 0xd69a32, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
    }
    g.userData.body = body;
    return g;
  }

  buildViewModel() {
    this.scene.add(this.camera); // camera joins the scene so children render
    const vm = new THREE.Group();
    vm.position.set(0.34, -0.42, -0.72);
    const handMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8 });
    const hand = new THREE.Mesh(new THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(0.055, 0.16, 3, 8)
      : new THREE.SphereGeometry(0.07, 8, 8), handMat);
    hand.rotation.x = -0.9;
    vm.add(hand);
    const hand2 = hand.clone();
    hand2.position.set(-0.62, -0.03, 0.05);
    vm.add(hand2);
    this.camera.add(vm);
    this.viewModel = vm;
    this.vmHolder = new THREE.Group();
    this.vmHolder.position.set(0, 0.1, -0.08);
    vm.add(this.vmHolder);
  }

  syncViewModel(kind) {
    if (this.vmKind === kind || !this.viewModel) { return; }
    this.vmKind = kind;
    while (this.vmHolder.children.length) { this.vmHolder.remove(this.vmHolder.children[0]); }
    if (!kind) { return; }
    const m = this.makeItem(kind === 'mopheld' ? 'garnish' : kind);
    if (kind === 'mopheld') {
      m.geometry = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6);
      m.material.color.set(0x8a7a5a);
      m.rotation.z = 0.5;
      m.position.set(-0.1, 0.25, 0);
    } else if (kind === 'shotgun') {
      m.scale.setScalar(1.4);
      m.position.set(-0.28, 0.02, -0.15);
      m.rotation.y = -1.35;
    } else if (kind === 'keg') {
      m.geometry = new THREE.CylinderGeometry(0.22, 0.22, 0.34, 12);
      m.position.set(-0.3, 0.05, -0.05);
    }
    this.vmHolder.add(m);
  }

  makePig() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.42),
      new THREE.MeshStandardMaterial({ color: PAL.pig, roughness: 0.85 }));
    body.position.y = 0.3;
    body.castShadow = true;
    g.add(body);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xd98a9c }));
    snout.position.set(0, 0.3, 0.26);
    g.add(snout);
    for (const dx of [-0.18, 0.18]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 6),
        new THREE.MeshStandardMaterial({ color: 0xd98a9c }));
      ear.position.set(dx, 0.52, 0.1);
      g.add(ear);
    }
    return g;
  }

  makeItem(kind) {
    const tint = (ITEMS[kind] || {}).tint || 0xffffff;
    let geo;
    if (kind === 'beer' || kind === 'coffee' || kind === 'fancywater' || kind === 'rangeoat') {
      geo = new THREE.CylinderGeometry(0.09, 0.11, 0.24, 8);
    } else if (kind === 'shotgun') {
      geo = new THREE.BoxGeometry(0.75, 0.09, 0.09);
    } else if (kind === 'phone') {
      geo = new THREE.BoxGeometry(0.16, 0.03, 0.28);
    } else {
      geo = new THREE.BoxGeometry(0.24, 0.14, 0.24);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.5,
      emissive: kind === 'phone' ? 0x223a4a : 0x000000, emissiveIntensity: 0.6,
    }));
    m.castShadow = true;
    return m;
  }

  // ── per-frame sync ───────────────────────────────────────────────────────
  sync(game, dt, focusPid = 0) {
    // self-healing size: the pane can report innerWidth 0 at construction
    if ((innerWidth && innerWidth !== this._w) || (innerHeight && innerHeight !== this._h)) {
      this.resize();
    }
    const S = this.scene;
    const t = performance.now() / 1000;
    // players
    for (const p of game.players) {
      const m = this.playerMeshes[p.pid];
      m.position.set(p.x, 0, p.z);
      const moving = Math.hypot(p.mx, p.mz) > 0.01;
      m.userData.body.position.y = 0.48 + (moving ? Math.abs(Math.sin(t * 9 + p.pid)) * 0.05 : 0);
      m.rotation.y = Math.atan2(p.fx, p.fz);
      if (p.stun > 1.0) {
        // proper knockdown: flat on the floor, seeing stars
        m.rotation.x = -1.35;
        m.rotation.z = 0;
        m.position.y = 0.12;
      } else if (p.stun > 0) {
        m.rotation.x = 0;
        m.rotation.z = Math.sin(t * 30) * 0.15;
      } else {
        m.rotation.x = 0;
        m.rotation.z = 0;
      }
      // carried item as a small mesh in front
      this.syncCarry(m, p.carry ? p.carry.kind : null);
    }
    // guests
    const liveGuests = new Set();
    for (const g of game.guests) {
      if (g.state === 'gone') { continue; }
      liveGuests.add(g.id);
      let m = this.guestMeshes.get(g.id);
      if (!m) {
        m = this.makePerson(ARCHETYPES[g.arche].tint);
        this.guestMeshes.set(g.id, m);
        S.add(m);
      }
      m.position.set(g.x, 0, g.z);
      const seated = g.state === 'seated';
      m.userData.body.scale.y = seated ? 0.78 : 1;
      if (g.slipT > 0) { m.rotation.z = 1.2; } else { m.rotation.z = 0; }
      if (!seated) { m.userData.body.position.y = 0.48 + Math.abs(Math.sin(t * 8 + g.id)) * 0.04; }
    }
    for (const [id, m] of this.guestMeshes) {
      if (!liveGuests.has(id)) { S.remove(m); this.guestMeshes.delete(id); }
    }
    // pigs
    for (const pig of game.pigs) {
      let m = this.pigMeshes.get(pig.id);
      if (!m) { m = this.makePig(); this.pigMeshes.set(pig.id, m); S.add(m); }
      m.position.set(pig.x, 0, pig.z);
      if (pig.tx != null) { m.rotation.y = Math.atan2(pig.tx - pig.x, pig.tz - pig.z); }
      m.children[0].rotation.z = Math.sin(t * 7 + pig.id * 3) * 0.06;
    }
    // items — on the floor or mid-flight
    const liveItems = new Set();
    for (const it of game.items) {
      liveItems.add(it.id);
      let m = this.itemMeshes.get(it.id);
      if (!m) { m = this.makeItem(it.kind); this.itemMeshes.set(it.id, m); S.add(m); }
      m.position.set(it.x, 0.15 + (it.y || 0), it.z);
      if (it.fly) {
        m.rotation.x = t * 9 + it.id;
        m.rotation.y = t * 7;
      } else {
        m.rotation.x = 0;
        m.rotation.y = t * 0.8 + it.id;
      }
    }
    for (const [id, m] of this.itemMeshes) {
      if (!liveItems.has(id)) { S.remove(m); this.itemMeshes.delete(id); }
    }
    // spills + shards
    const liveSpills = new Set();
    for (const s of game.spills) {
      const key = s.x + '_' + s.z + s.kind;
      liveSpills.add(key);
      if (!this.spillMeshes.has(key)) {
        let m;
        if (s.kind === 'shards') {
          m = new THREE.Group();
          for (let i = 0; i < 5; i++) {
            const sh = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 4),
              new THREE.MeshStandardMaterial({ color: 0xd8e8f0, roughness: 0.2 }));
            sh.position.set(s.x + 0.25 + Math.random() * 0.5, 0.05, s.z + 0.25 + Math.random() * 0.5);
            m.add(sh);
          }
        } else {
          m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16),
            new THREE.MeshBasicMaterial({ color: 0x2c1f14, transparent: true, opacity: 0.55 }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(s.x + 0.5, 0.02, s.z + 0.5);
        }
        this.spillMeshes.set(key, m);
        S.add(m);
      }
    }
    for (const [key, m] of this.spillMeshes) {
      if (!liveSpills.has(key)) { S.remove(m); this.spillMeshes.delete(key); }
    }
    // table-state bubbles (bible §34 world markers: read the room, not the rail)
    const liveMarkers = new Set();
    for (const party of game.parties) {
      if (party.state === 'gone' || party.state === 'leaving') { continue; }
      const tbl = game.tables.find((x) => x.id === party.tableId);
      if (!tbl) { continue; }
      let glyph = null;
      let color = 0xf4ebdd;
      let bounce = 0;
      if (party.state === 'deciding' && party.decideT <= 0) {
        glyph = '?'; color = 0xd69a32; bounce = Math.abs(Math.sin(t * 4)) * 0.14;
      } else if (party.state === 'waitpay') {
        glyph = '$'; color = 0x8fca8f;
      } else if (party.state === 'complaining') {
        glyph = '!'; color = 0x9d4e35; bounce = Math.abs(Math.sin(t * 7)) * 0.1;
      } else if (party.state === 'eating') {
        glyph = '♥'; color = 0xcc79a7;
      } else {
        const ord = game.orders.find((o) => o.partyId === party.id && o.state === 'open');
        if (ord) {
          glyph = '•';
          const pct = Math.max(0, ord.tLeft / ord.total);
          color = pct > 0.5 ? 0x6d8177 : pct > 0.25 ? 0xd69a32 : 0x9d4e35;
          if (pct <= 0.25) { bounce = Math.abs(Math.sin(t * 7)) * 0.1; }
        }
      }
      if (!glyph) { continue; }
      liveMarkers.add(party.id);
      let sp = this.markerSprites.get(party.id);
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
        sp.scale.set(0.8, 0.8, 1);
        this.markerSprites.set(party.id, sp);
        S.add(sp);
      }
      if (sp.userData.glyph !== glyph) {
        sp.userData.glyph = glyph;
        sp.material.map = this.glyphTex(glyph);
        sp.material.needsUpdate = true;
      }
      sp.material.color.setHex(color);
      sp.position.set(tbl.x + 0.5, 2.25 + bounce, tbl.z + 0.5);
    }
    for (const [id, sp] of this.markerSprites) {
      if (!liveMarkers.has(id)) { S.remove(sp); this.markerSprites.delete(id); }
    }
    // throw arc preview (view-only mirror of the sim's ballistics)
    if (this.chargePreview) {
      const { player, power } = this.chargePreview;
      const spd = TUNING.throwMinSpeed + ((TUNING.throwMaxSpeed - TUNING.throwMinSpeed) * power);
      const vy0 = TUNING.throwUpMin + ((TUNING.throwUpMax - TUNING.throwUpMin) * power);
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const tau = i * 0.055;
        const y = 1.15 + (vy0 * tau) - (0.5 * TUNING.throwGravity * tau * tau);
        if (y < 0) { break; }
        pts.push(new THREE.Vector3(
          player.x + (player.fx * 0.5) + (player.fx * spd * tau),
          y,
          player.z + (player.fz * 0.5) + (player.fz * spd * tau)));
      }
      if (!this.arcLine) {
        this.arcLine = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: 0xd69a32, transparent: true, opacity: 0.85 }));
        S.add(this.arcLine);
      }
      this.arcLine.geometry.setFromPoints(pts);
      this.arcLine.visible = true;
    } else if (this.arcLine) {
      this.arcLine.visible = false;
    }
    // gate visual
    this.gateMesh.rotation.z = game.gate === 'broken' ? 0.9 : 0;
    this.gateMesh.position.y = game.gate === 'broken' ? 0.25 : 0.55;
    // fryer smoke
    if (game.fryer.smoking && Math.random() < 0.3) { this.puffSmoke(STATIONS.fryer.x + 0.5, 1.6, STATIONS.fryer.z + 0.5); }
    for (let i = this.smokeSprites.length - 1; i >= 0; i--) {
      const sp = this.smokeSprites[i];
      sp.position.y += dt * 0.8;
      sp.material.opacity -= dt * 0.35;
      sp.scale.multiplyScalar(1 + dt * 0.6);
      if (sp.material.opacity <= 0) { this.scene.remove(sp); this.smokeSprites.splice(i, 1); }
    }
    // deepening night: moonlight cools/dims across the shift (heritage touch)
    const nf = Math.min(1, game.time / SHIFT.duration);
    this.moon.intensity = 0.35 - nf * 0.15;
    this.sign.material.opacity = 0.85 + Math.sin(t * 1.7) * 0.12; // neon breathing
    // camera
    const p0 = game.players[focusPid] || game.players[0];
    if (this.fpMode) {
      // first person: you ARE the bartender
      const local = this.playerMeshes[p0.pid];
      if (local) { local.visible = false; }
      const moving = Math.hypot(p0.mx, p0.mz) > 0.05;
      const bob = moving && p0.stun <= 0 ? Math.sin(t * (p0.sprint ? 13 : 9.5)) * 0.038 : 0;
      let eyeY = 1.52 + bob;
      let roll = 0;
      if (p0.stun > 1.0) { eyeY = 0.45; roll = 0.55; } // knocked flat, seeing stars
      else if (p0.stun > 0) { roll = Math.sin(t * 22) * 0.05; }
      this.camera.position.set(p0.x, eyeY, p0.z);
      this.camera.rotation.set(this.lookPitch, -this.lookYaw, roll);
      this.camera.fov = 74;
      this.camera.updateProjectionMatrix();
      this.syncViewModel(p0.carry ? p0.carry.kind : null);
      if (this.viewModel) {
        this.viewModel.position.x = 0.34 + (moving ? Math.sin(t * 4.7) * 0.014 : 0);
        this.viewModel.position.y = -0.42 + (moving ? Math.abs(Math.sin(t * 9.4)) * 0.02 : 0);
      }
    } else {
      // iso diorama (QA captures): gentle lean toward the focused player
      const lean = 0.16;
      this.camera.position.set(
        this.camBase.x + (p0.x - W / 2) * lean,
        this.camBase.y,
        this.camBase.z + (p0.z - H / 2) * lean * 0.6);
      this.camera.lookAt(this.camLook.x + (p0.x - W / 2) * lean * 0.5, 0, this.camLook.z);
    }
    // screen flash decay
    if (this.flashT > 0) {
      this.flashT -= dt * 2.2;
      document.getElementById('flash').style.opacity = Math.max(0, this.flashT) * 0.8;
    }
    this.renderer.render(this.scene, this.camera);
  }

  syncCarry(personMesh, kind) {
    if (personMesh.userData.carryKind === kind) { return; }
    if (personMesh.userData.carryMesh) {
      personMesh.remove(personMesh.userData.carryMesh);
      personMesh.userData.carryMesh = null;
    }
    personMesh.userData.carryKind = kind;
    if (!kind) { return; }
    const m = this.makeItem(kind === 'mopheld' ? 'garnish' : kind);
    if (kind === 'mopheld') {
      m.geometry = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6);
      m.material.color.set(0x8a7a5a);
      m.position.set(0.3, 0.7, 0.1);
      m.rotation.z = 0.3;
    } else if (kind === 'shotgun') {
      m.position.set(0, 0.75, 0.3);
      m.rotation.y = Math.PI / 2;
    } else {
      m.position.set(0, 0.78, 0.34);
    }
    personMesh.add(m);
    personMesh.userData.carryMesh = m;
  }

  puffSmoke(x, y, z) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0x9aa2a8, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    sp.position.set(x + (Math.random() - 0.5) * 0.3, y, z);
    sp.scale.set(0.5, 0.5, 1);
    this.scene.add(sp);
    this.smokeSprites.push(sp);
  }

  // view events from the sim
  onEvent(e) {
    if (e.kind === 'gunfire') {
      this.flashT = 1;
      const L = new THREE.PointLight(0xffe0a0, 4, 12);
      L.position.set(e.x, 1.4, e.z);
      this.scene.add(L);
      setTimeout(() => this.scene.remove(L), 90);
    } else if (e.kind === 'gatebreak') {
      // handled by gate visual each frame
    } else if (e.kind === 'fryersmoke') {
      for (let i = 0; i < 4; i++) { this.puffSmoke(STATIONS.fryer.x + 0.5, 1.5, STATIONS.fryer.z + 0.5); }
    }
  }
}
