// THE LAST LOCAL — view layer. Reads sim state, never writes it. Math.random
// is allowed here (view-only); the sim never imports this file.
import * as THREE from '../lib/three.module.js';
import {
  LAYOUT, TABLES, STATIONS, PEN_GATE, ARCHETYPES, ITEMS, EMPLOYEES, SHIFT,
  TUNING, REQUESTS, STATION_LOOK, PING_LOOK,
} from './data.js';

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
    // Lights. The first-person pass proved the old rig was a cave: hemisphere
    // 0.9 over near-black walls meant a wall two metres away was invisible, so
    // the room read as a void with tables in it. A dive bar is DIM, not unlit —
    // the fix is a warmer, stronger interior bounce plus a practical over every
    // work surface, keeping the cold/warm contrast the bible asks for.
    S.add(new THREE.HemisphereLight(0x5a6d80, 0x3a2a1c, 1.15));
    S.add(new THREE.AmbientLight(0xffcf9a, 0.22)); // interior bounce off the wood
    const moon = new THREE.DirectionalLight(0x9dc0d8, 0.55);
    moon.position.set(-14, 22, -10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -20; moon.shadow.camera.right = 20;
    moon.shadow.camera.top = 20; moon.shadow.camera.bottom = -20;
    this.moon = moon;
    S.add(moon);
    this.warmLights = [];
    const warm = (x, z, i = 2.0, d = 10, y = 2.7) => {
      const L = new THREE.PointLight(0xffb45e, i, d, 1.4);
      L.position.set(x, y, z);
      L.userData.base = i;
      this.warmLights.push(L);
      S.add(L);
      return L;
    };
    warm(11, 9.5, 2.6, 12); warm(15, 4.5, 2.4); warm(9, 4.5, 2.4); warm(20, 6.5, 2.0); warm(20, 2.5, 1.8);
    this.barLight = warm(11.5, 12.5, 1.8, 9);
    // practicals where the work happens — you must be able to SEE the station
    warm(12, 11.4, 2.2, 9, 2.4);            // behind the bar
    warm(11, 13.2, 2.0, 8, 2.4);            // the line
    warm(21, 13.5, 1.5, 7, 2.4);            // the jukebox corner
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

    // walls — panelled wainscot over painted board, so a wall two metres away
    // has grain and a horizontal line to read depth against
    const wallTex = canvasTex((g, w, h) => {
      g.fillStyle = '#5c4530'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 10; i++) {          // vertical boards
        g.fillStyle = i % 2 ? '#553f2b' : '#634a34';
        g.fillRect(i * (w / 10), 0, (w / 10) - 1, h);
      }
      g.fillStyle = '#3b2b1d'; g.fillRect(0, h * 0.52, w, h * 0.48); // wainscot below
      g.fillStyle = '#7a5c40'; g.fillRect(0, h * 0.5, w, 4);         // chair rail
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, w, 6);
    }, 128, 128);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92 });
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

    this.dressRoom();

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
        // 1.5 world units at arm's length filled a quarter of the screen the
        // first time a teammate stood on top of me. Smaller, and it fades out
        // when they're close enough that you can obviously see who it is.
        tag.scale.set(1.0, 0.28, 1);
        tag.position.y = 1.62;
        m.userData.tag = tag;
        m.add(tag);
      }
      this.playerMeshes[p.pid] = m;
      S.add(m);
    }
    this.game = game;
  }

  /** Everything that makes the box a BAR. Pure dressing — no sim contact.
   *  The first-person capture that motivated this showed five identical dark
   *  surfaces: no landmark to orient by, no way to tell the fryer from the
   *  dishwasher, and no sign that Montana existed outside. */
  dressRoom() {
    const S = this.scene;

    // ── hanging station signage ────────────────────────────────────────────
    for (const key of Object.keys(STATION_LOOK)) {
      const st = STATIONS[key];
      const look = STATION_LOOK[key];
      if (!st) { continue; }
      const tex = canvasTex((g, w, h) => {
        g.fillStyle = '#150f0b'; g.fillRect(0, 0, w, h);
        g.strokeStyle = look.tint; g.lineWidth = 6;
        g.strokeRect(6, 6, w - 12, h - 12);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '52px serif';
        g.fillText(look.icon, w * 0.22, h * 0.52);
        g.fillStyle = look.tint;
        g.font = 'bold 34px Georgia';
        g.fillText(look.name, w * 0.62, h * 0.54);
      }, 256, 80);
      tex.magFilter = THREE.LinearFilter;
      // TWO planes back to back, not one DoubleSide plane: a double-sided plane
      // shows the texture MIRRORED from behind, and "REGISTER" backwards is worse
      // than no sign at all (caught in the first capture of this pass).
      for (const flip of [0, Math.PI]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        board.position.set(st.x + 0.5, 2.12, st.z + 0.5 + (flip ? -0.012 : 0.012));
        board.rotation.y = look.face + flip;
        S.add(board);
      }
      // a stub of chain so it hangs off the ceiling rather than floating
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4),
        new THREE.MeshBasicMaterial({ color: 0x2a2118 }));
      chain.position.set(st.x + 0.5, 2.58, st.z + 0.5);
      S.add(chain);
    }

    // ── the back bar: bottles, glass rack, under-shelf glow ────────────────
    const bottleCols = [0x6b8e23, 0x8b3a2f, 0xd9c07a, 0x2f4f6b, 0x7a4a8a, 0xc08a3a];
    for (let x = 7; x <= 16; x++) {
      if ([9, 11, 12, 15].includes(x)) { continue; } // stations own these tiles
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.34 + (i % 2) * 0.1, 6),
          new THREE.MeshStandardMaterial({
            color: bottleCols[(x + i) % bottleCols.length], roughness: 0.25, metalness: 0.1,
          }));
        b.position.set(x + 0.2 + i * 0.3, 1.28, 10.72);
        b.castShadow = true;
        S.add(b);
      }
    }
    const rack = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.08, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x30251a, roughness: 0.8 }));
    rack.position.set(11.6, 2.18, 10.5);
    S.add(rack);
    for (let i = 0; i < 14; i++) {                        // glasses hanging stem-down
      const gl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 8),
        new THREE.MeshStandardMaterial({
          color: 0xcfe6f0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55,
        }));
      gl.position.set(7.2 + i * 0.68, 2.02, 10.3 + (i % 2) * 0.4);
      S.add(gl);
    }
    const strip = new THREE.PointLight(0xffca7a, 1.5, 8, 1.5);
    strip.position.set(11.6, 1.9, 10.6);
    S.add(strip);

    // ── windows: Montana is the whole point, and you could not see it ──────
    const nightTex = canvasTex((g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0b1c2a'); sky.addColorStop(0.55, '#16303f'); sky.addColorStop(1, '#20323a');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8eef2';
      for (let i = 0; i < 70; i++) {
        g.globalAlpha = 0.25 + Math.random() * 0.7;
        g.fillRect(Math.random() * w, Math.random() * h * 0.55, 1.6, 1.6);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#0a1720';                            // ridge line
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 9) {
        g.lineTo(x, h * (0.58 + Math.sin(x * 0.021) * 0.13 + Math.cos(x * 0.007) * 0.06));
      }
      g.lineTo(w, h); g.closePath(); g.fill();
      g.fillStyle = '#123'; g.globalAlpha = 0.8;
      for (let i = 0; i < 26; i++) {                      // pines on the ridge
        const px = Math.random() * w; const py = h * (0.62 + Math.random() * 0.16);
        g.beginPath(); g.moveTo(px, py - 22); g.lineTo(px - 7, py); g.lineTo(px + 7, py);
        g.closePath(); g.fill();
      }
    }, 256, 160);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 0.9 });
    const window3 = (x, z, ry) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.12), frameMat);
      f.position.set(x, 1.72, z); f.rotation.y = ry; S.add(f);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2),
        new THREE.MeshBasicMaterial({ map: nightTex }));
      pane.position.set(x + Math.sin(ry + Math.PI) * 0.08, 1.72, z + Math.cos(ry + Math.PI) * 0.08);
      pane.rotation.y = ry + Math.PI;
      S.add(pane);
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.24, 0.06), frameMat);
      mull.position.copy(pane.position); mull.rotation.y = ry; S.add(mull);
      const spill = new THREE.PointLight(0x8fb6d0, 0.5, 6, 1.6);
      spill.position.set(x + Math.sin(ry + Math.PI) * 0.9, 1.9, z + Math.cos(ry + Math.PI) * 0.9);
      S.add(spill);
    };
    window3(11, 1.02, Math.PI);  window3(19, 1.02, Math.PI);   // north wall, over the tables
    window3(24.98, 5, Math.PI / 2); window3(24.98, 9, Math.PI / 2); // east wall

    // ── the landmarks you navigate by ──────────────────────────────────────
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xcbb894, roughness: 0.85 });
    const antler = new THREE.Group();
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.09), frameMat);
    plaque.position.set(0, -0.16, -0.03);
    antler.add(plaque);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), boneMat);
    skull.scale.set(0.85, 1.15, 0.7);
    skull.position.set(0, -0.08, 0.08);
    antler.add(skull);
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.05, 0.9, 6), boneMat);
      beam.position.set(side * 0.32, 0.28, 0.05);
      beam.rotation.z = side * 0.62;
      beam.rotation.x = -0.25;
      antler.add(beam);
      for (let i = 0; i < 3; i++) {               // tines fork UP off the beam
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3 + i * 0.06, 5), boneMat);
        t.position.set(side * (0.2 + i * 0.22), 0.16 + i * 0.24, 0.1);
        t.rotation.z = side * (0.15 - i * 0.1);
        t.rotation.x = -0.35;
        antler.add(t);
      }
    }
    antler.position.set(15, 1.95, 1.12);
    S.add(antler);
    const beerNeon = canvasTex((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = 'bold 44px Georgia'; g.textAlign = 'center';
      g.shadowColor = '#7ad0ff'; g.shadowBlur = 22; g.fillStyle = '#cfeaff';
      g.fillText('COLD BEER', w / 2, h * 0.46);
      g.font = 'italic 26px Georgia'; g.shadowColor = '#ff9ad0'; g.fillStyle = '#ffd6ea';
      g.fillText('open till it isn’t', w / 2, h * 0.82);
    }, 384, 128);
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.86),
      new THREE.MeshBasicMaterial({ map: beerNeon, transparent: true }));
    bn.position.set(24.9, 2.15, 12); bn.rotation.y = -Math.PI / 2;
    S.add(bn);
    this.beerNeon = bn;
    const bnGlow = new THREE.PointLight(0x8fd8ff, 1.1, 7, 1.6);
    bnGlow.position.set(24, 2.1, 12); S.add(bnGlow);
    // framed pictures — cheap, but they turn a wall into somewhere specific
    const picTex = (a, b) => canvasTex((g, w, h) => {
      g.fillStyle = a; g.fillRect(0, 0, w, h);
      g.fillStyle = b;
      g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) { g.lineTo(x, h * (0.45 + Math.sin(x * 0.05) * 0.18)); }
      g.lineTo(w, h); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.arc(w * 0.74, h * 0.24, 9, 0, 7); g.fill();
    }, 96, 72);
    const pics = [[8, 1.05, 0, '#2b3d4a', '#101d24'], [21, 1.05, 0, '#3b3326', '#161208'],
      [24.9, 5.5, -Math.PI / 2, '#2d3a2c', '#111a11']];
    for (const [x, z, ry, a, b] of pics) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.07), frameMat);
      fr.position.set(x, 1.75, z + (ry ? 0 : 0.1)); fr.rotation.y = ry; S.add(fr);
      const im = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.55),
        new THREE.MeshBasicMaterial({ map: picTex(a, b) }));
      im.position.set(x + (ry ? -0.06 : 0), 1.75, z + (ry ? 0 : 0.15));
      im.rotation.y = ry;   // face INTO the room (was +PI, i.e. into the wall)
      S.add(im);
    }
    // ── the front door: the west end was a blank wall with a black hole in it ──
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.3, 1.5), frameMat);
    jamb.position.set(6.1, 1.15, 3.5); S.add(jamb);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 1.9), frameMat);
    lintel.position.set(6.1, 2.35, 3.5); S.add(lintel);
    const openTex = canvasTex((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = 'bold 60px Georgia'; g.textAlign = 'center';
      g.shadowColor = '#ff7a5a'; g.shadowBlur = 26; g.fillStyle = '#ffd0bf';
      g.fillText('OPEN', w / 2, h * 0.66);
    }, 256, 96);
    const openSign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.5),
      new THREE.MeshBasicMaterial({ map: openTex, transparent: true }));
    openSign.position.set(6.28, 2.05, 3.5); openSign.rotation.y = Math.PI / 2;
    S.add(openSign);
    this.openSign = openSign;
    const porch = new THREE.PointLight(0xffa070, 1.6, 7, 1.5);
    porch.position.set(6.9, 2.2, 3.5); S.add(porch);
    // coat hooks + a chalkboard, so the entry reads as somewhere people arrive
    for (let i = 0; i < 4; i++) {
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 5),
        new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.7 }));
      hook.position.set(6.16, 1.7, 5.4 + i * 0.42);
      hook.rotation.z = Math.PI / 2;
      S.add(hook);
    }
    const boardTex = canvasTex((g, w, h) => {
      g.fillStyle = '#1d241f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e8e2d4'; g.lineWidth = 2;
      g.font = 'italic 22px Georgia'; g.textAlign = 'center';
      g.fillStyle = '#e8e2d4';
      g.fillText('TONIGHT', w / 2, 30);
      g.font = '18px Georgia';
      g.fillText('burgers · cold beer', w / 2, 58);
      g.fillText('no oat milk. stop asking.', w / 2, 82);
    }, 200, 100);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.4), frameMat);
    board.position.set(6.14, 1.5, 8.6); S.add(board);
    const boardArt = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.66),
      new THREE.MeshBasicMaterial({ map: boardTex }));
    boardArt.position.set(6.2, 1.5, 8.6); boardArt.rotation.y = Math.PI / 2;
    S.add(boardArt);

    // string lights across the room: the strongest single "this is a bar" cue
    this.stringBulbs = [];
    for (const [z, x0, x1] of [[4.2, 6.6, 24.4], [8.2, 6.6, 24.4]]) {
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = x0 + (x1 - x0) * f;
        const y = 2.62 - Math.sin(f * Math.PI) * 0.26;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6),
          new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffd9a0 : 0xffb45e }));
        b.position.set(x, y, z);
        b.userData.ph = i * 0.7;
        this.stringBulbs.push(b);
        S.add(b);
      }
    }
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

  /** Table bubble. `frac` (0..1) draws a countdown ring instead of a glyph —
   *  a bullet point told you nothing; a draining clock tells you WHICH table is
   *  about to walk out, from across the room. Cached in twelfths. */
  glyphTex(glyph, frac) {
    const key = frac == null ? glyph : 'ring' + Math.round(frac * 12);
    if (this.glyphCache.has(key)) { return this.glyphCache.get(key); }
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#f4ebdd';
    g.strokeStyle = '#17313a';
    g.lineWidth = 6;
    g.beginPath(); g.arc(64, 56, 46, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(50, 94); g.lineTo(64, 122); g.lineTo(78, 94);
    g.closePath(); g.fill(); g.stroke();
    if (frac == null) {
      g.fillStyle = '#17313a';
      g.font = 'bold 64px Georgia';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(glyph, 64, 58);
    } else {
      const f = Math.max(0, Math.min(1, frac));
      g.fillStyle = '#d8d0c2';
      g.beginPath(); g.arc(64, 56, 34, 0, Math.PI * 2); g.fill();
      g.fillStyle = f > 0.5 ? '#4f7f5a' : f > 0.25 ? '#d69a32' : '#9d4e35';
      g.beginPath(); g.moveTo(64, 56);
      g.arc(64, 56, 34, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      g.closePath(); g.fill();
      g.fillStyle = '#f4ebdd';
      g.beginPath(); g.arc(64, 56, 15, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    this.glyphCache.set(key, t);
    return t;
  }

  /** A person you can read at five metres in a dim room. The old version was a
   *  cylinder + a sphere + a disc of hat: seated guests were indistinguishable
   *  from the stools they sat on (verified in the pre-pass capture). Arms, a
   *  face, and an archetype prop are all it takes. `arche` is optional. */
  makePerson(tint, isPlayer = false, arche = null) {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.72, 10), cloth);
    body.position.y = 0.48;
    body.castShadow = true;
    g.add(body);
    const arms = new THREE.Group();
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry
        ? new THREE.CapsuleGeometry(0.065, 0.34, 3, 6)
        : new THREE.CylinderGeometry(0.065, 0.065, 0.44, 6), cloth);
      arm.position.set(side * 0.3, 0.55, 0.04);
      arm.rotation.z = side * 0.16;
      arm.castShadow = true;
      arms.add(arm);
    }
    g.add(arms);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
    head.position.y = 1.05;
    head.castShadow = true;
    g.add(head);
    // eyes: the cheapest possible "which way is this person looking"
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.036, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
      eye.position.set(side * 0.075, 1.09, 0.19);
      g.add(eye);
    }
    const hatCol = isPlayer ? 0x2b2019 : (arche === 'oldlocal' ? 0x4a3320 : tint);
    const brim = arche === 'oldlocal' ? 0.4 : 0.25;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.23, brim, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: hatCol, roughness: 0.9 }));
    hat.position.y = 1.2;
    g.add(hat);
    if (arche === 'oldlocal') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.16, 10),
        new THREE.MeshStandardMaterial({ color: hatCol, roughness: 0.9 }));
      crown.position.y = 1.3;
      g.add(crown);
    } else if (arche === 'influencer') {         // ring light, always on
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.032, 6, 18),
        new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
      ring.position.set(0.26, 1.18, 0.3);
      g.add(ring);
    } else if (arche === 'inspector') {          // the clipboard
      const cb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.03),
        new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 }));
      cb.position.set(0.24, 0.7, 0.24);
      cb.rotation.x = -0.5;
      g.add(cb);
    } else if (arche === 'bachelor') {           // sash. of course there's a sash.
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.62),
        new THREE.MeshStandardMaterial({ color: 0xf0e442, roughness: 0.6 }));
      sash.position.y = 0.62;
      sash.rotation.y = 0.6;
      g.add(sash);
    }
    if (isPlayer) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 24),
        new THREE.MeshBasicMaterial({ color: 0xd69a32, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
    }
    g.userData.body = body;
    g.userData.arms = arms;
    g.userData.cloth = cloth;
    return g;
  }

  buildViewModel() {
    this.scene.add(this.camera); // camera joins the scene so children render
    const vm = new THREE.Group();
    vm.position.set(0.34, -0.42, -0.72);
    const handMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8 });
    // sleeve + forearm + fist, not a floating sausage: the capture showed two
    // detached tubes, which reads as a glitch rather than as your own arms
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2f4a52, roughness: 0.85 });
    const arm = (dx) => {
      const gA = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.42, 8), sleeveMat);
      sleeve.position.set(0, -0.16, 0.24);
      sleeve.rotation.x = -1.18;
      gA.add(sleeve);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry
        ? new THREE.CapsuleGeometry(0.055, 0.2, 3, 8)
        : new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), handMat);
      fore.rotation.x = -1.05;
      gA.add(fore);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.072, 8, 7), handMat);
      fist.position.set(0, 0.09, -0.11);
      fist.scale.set(1, 0.9, 1.15);
      gA.add(fist);
      gA.position.set(dx, 0, 0);
      gA.rotation.z = dx > 0 ? -0.12 : 0.12;
      return gA;
    };
    vm.add(arm(0));
    vm.add(arm(-0.62));
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

  /** A label sprite for a short line of text, cached by content. Used by the
   *  focus highlight and callout beacons — both change text rarely, so building
   *  a canvas per frame would be the only expensive thing in this renderer. */
  labelTex(text, tint, sub) {
    const key = text + '|' + tint + '|' + (sub || '');
    if (this.glyphCache.has(key)) { return this.glyphCache.get(key); }
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = 'bold 40px Georgia';
    const w = Math.min(500, g.measureText(text).width + 54);
    const x0 = (512 - w) / 2;
    g.fillStyle = 'rgba(8,17,22,.88)';
    g.beginPath(); g.roundRect(x0, sub ? 12 : 26, w, sub ? 74 : 62, 14); g.fill();
    g.strokeStyle = tint; g.lineWidth = 3; g.stroke();
    g.textAlign = 'center';
    g.fillStyle = tint;
    g.fillText(text, 256, sub ? 54 : 68);
    if (sub) {
      g.font = 'italic 24px Georgia';
      g.fillStyle = 'rgba(244,235,221,.72)';
      g.fillText(sub, 256, 80);
    }
    const t = new THREE.CanvasTexture(c);
    this.glyphCache.set(key, t);
    return t;
  }

  // ── focus highlight (bible §32: thin warm rim plus icon) ─────────────────
  // Before this you had to memorise tile coordinates: the verb lived in a DOM
  // chip at the bottom of the screen and NOTHING in the world told you which
  // dark box it meant. Now the target wears the verb.
  syncFocus(hint, t) {
    if (!this.focusGroup) {
      this.focusGroup = new THREE.Group();
      this.focusHalo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28),
        new THREE.MeshBasicMaterial({
          color: 0xd69a32, transparent: true, opacity: 0.7,
          side: THREE.DoubleSide, depthWrite: false,
        }));
      this.focusHalo.rotation.x = -Math.PI / 2;
      this.focusGroup.add(this.focusHalo);
      this.focusLabel = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthWrite: false, depthTest: false,
      }));
      this.focusGroup.add(this.focusLabel);
      this.scene.add(this.focusGroup);
    }
    const at = hint && hint.at;
    this.focusGroup.visible = !!at;
    if (!at) { return; }
    const TAG_TINT = {
      serve: '#d69a32', money: '#8fca8f', danger: '#e0917a', risk: '#e0917a',
      wrong: '#8a8f96', mess: '#7aa2b8', pig: '#e8a8b8', crew: '#8fca8f',
      fix: '#7aa2b8', busy: '#d69a32', item: '#f4ebdd', station: '#d69a32',
    };
    const tint = TAG_TINT[hint.tag] || '#d69a32';
    const text = hint.progress != null ? hint.verb : hint.verb;
    if (this.focusLabel.userData.text !== text + tint) {
      this.focusLabel.userData.text = text + tint;
      this.focusLabel.material.map = this.labelTex(text, tint,
        hint.progress != null || hint.dead ? null : 'press E');
      this.focusLabel.material.needsUpdate = true;
    }
    const pulse = 1 + Math.sin(t * 4.6) * 0.06;
    this.focusGroup.position.set(at.x, 0, at.z);
    this.focusHalo.position.y = 0.035;
    this.focusHalo.scale.setScalar(pulse);
    this.focusHalo.material.color.set(tint);
    this.focusHalo.material.opacity = hint.dead ? 0.3 : 0.62;
    // the focus target is by definition ~1m away, so a fixed world-scale sprite
    // covered a third of the screen. Scale with distance to hold a constant,
    // modest size on screen (captured, then dialled down).
    const d = Math.hypot(at.x - this.camera.position.x, at.z - this.camera.position.z);
    const wide = Math.max(0.55, Math.min(1.7, d * 0.40));
    this.focusLabel.scale.set(wide, wide * 0.25, 1);
    this.focusLabel.position.y = (at.y || 1.15) + (wide * 0.24) + Math.sin(t * 2.2) * 0.02;
  }

  // ── callout beacons: a friend shouting is a thing you can SEE ────────────
  syncPings(game, t) {
    if (!this.pingMeshes) { this.pingMeshes = new Map(); }
    const live = new Set();
    for (const pg of game.pings) {
      live.add(pg.id);
      let m = this.pingMeshes.get(pg.id);
      const look = PING_LOOK[pg.kind] || PING_LOOK.here;
      if (!m) {
        m = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.22, 3.2, 10, 1, true),
          new THREE.MeshBasicMaterial({
            color: look.tint, transparent: true, opacity: 0.2,
            depthWrite: false, side: THREE.DoubleSide,
          }));
        beam.position.y = 1.6;
        m.add(beam);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.labelTex(look.icon + ' ' + look.text,
            '#' + look.tint.toString(16).padStart(6, '0'),
            (EMPLOYEES[game.players[pg.pid] ? game.players[pg.pid].key : 'mara'] || {}).label),
          transparent: true, depthWrite: false, depthTest: false,
        }));
        sp.scale.set(2.9, 0.73, 1);
        sp.position.y = 2.5;
        m.add(sp);
        m.userData.beam = beam;
        m.userData.sp = sp;
        this.pingMeshes.set(pg.id, m);
        this.scene.add(m);
      }
      const f = Math.min(1, pg.tLeft / TUNING.pingSeconds);
      m.position.set(pg.x, 0, pg.z);
      m.userData.beam.material.opacity = 0.24 * f * (0.7 + Math.sin(t * 7) * 0.3);
      m.userData.sp.material.opacity = Math.min(1, f * 3);
      const d = Math.hypot(pg.x - this.camera.position.x, pg.z - this.camera.position.z);
      const wide = Math.max(1.1, Math.min(3.2, d * 0.42));
      m.userData.sp.scale.set(wide, wide * 0.25, 1);
      m.userData.sp.position.y = 2.5 + Math.sin(t * 3.4) * 0.06;
    }
    for (const [id, m] of this.pingMeshes) {
      if (!live.has(id)) { this.scene.remove(m); this.pingMeshes.delete(id); }
    }
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
      if (m.userData.tag) {
        const d = Math.hypot(p.x - this.camera.position.x, p.z - this.camera.position.z);
        m.userData.tag.material.opacity = Math.max(0, Math.min(0.95, (d - 1.4) * 0.5));
        m.userData.tag.visible = d > 1.5;
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
        m = this.makePerson(ARCHETYPES[g.arche].tint, false, g.arche);
        m.userData.baseTint = new THREE.Color(ARCHETYPES[g.arche].tint);
        this.guestMeshes.set(g.id, m);
        S.add(m);
      }
      m.position.set(g.x, 0, g.z);
      const seated = g.state === 'seated';
      m.userData.body.scale.y = seated ? 0.78 : 1;
      if (g.slipT > 0) { m.rotation.z = 1.2; } else { m.rotation.z = 0; }
      if (seated) {
        // face your table, not north: a room full of people staring the same way
        // read as scenery. Now the guests look at each other and at you.
        const tb = game.tables.find((q) => q.partyId === g.partyId);
        if (tb) { m.rotation.y = Math.atan2(tb.x + 0.5 - g.x, tb.z + 0.5 - g.z); }
        m.userData.arms.rotation.x = -0.7;      // elbows on the table
      } else {
        m.userData.body.position.y = 0.48 + Math.abs(Math.sin(t * 8 + g.id)) * 0.04;
        m.userData.arms.rotation.x = Math.sin(t * 8 + g.id) * 0.4;
        // last position lives on the MESH, never on the sim entity — the view
        // does not get to write sim state, not even a harmless scratch field
        const px = m.userData.px; const pz = m.userData.pz;
        const dx = px == null ? 0 : g.x - px; const dz = pz == null ? 0 : g.z - pz;
        if (Math.abs(dx) + Math.abs(dz) > 1e-4) { m.rotation.y = Math.atan2(dx, dz); }
      }
      m.userData.px = g.x; m.userData.pz = g.z;
      // a party losing patience visibly reddens — readable panic at a glance
      const party = game.parties.find((q) => q.id === g.partyId);
      const heat = party ? Math.max(0, Math.min(1, (-party.mood) * 0.35
        + (party.state === 'complaining' ? 0.8 : 0))) : 0;
      m.userData.cloth.color.copy(m.userData.baseTint).lerp(new THREE.Color(0xc23a28), heat);
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
      let frac = null;
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
          frac = Math.max(0, ord.tLeft / ord.total);
          glyph = 'ring';
          color = 0xffffff;                       // the ring carries its own colour
          if (frac <= 0.25) { bounce = Math.abs(Math.sin(t * 7)) * 0.12; }
        }
      }
      if (!glyph) { continue; }
      liveMarkers.add(party.id);
      let sp = this.markerSprites.get(party.id);
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
        this.markerSprites.set(party.id, sp);
        S.add(sp);
      }
      const gkey = frac == null ? glyph : 'ring' + Math.round(frac * 12);
      if (sp.userData.glyph !== gkey) {
        sp.userData.glyph = gkey;
        sp.material.map = this.glyphTex(glyph, frac);
        sp.material.needsUpdate = true;
      }
      sp.material.color.setHex(color);
      // shrink up close, grow at range: a sprite at fixed world scale becomes a
      // billboard in your face when you walk up to the table you are serving
      const dcam = Math.hypot(tbl.x + 0.5 - this.camera.position.x, tbl.z + 0.5 - this.camera.position.z);
      sp.scale.setScalar(Math.max(0.5, Math.min(1.25, 0.34 + dcam * 0.075)));
      sp.position.set(tbl.x + 0.5, 1.95 + sp.scale.x * 0.4 + bounce, tbl.z + 0.5);
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
    this.syncFocus(this.focusHint, t);
    this.syncPings(game, t);
    for (const b of this.stringBulbs || []) {
      b.material.color.setHSL(0.09, 0.72, 0.62 + Math.sin(t * 1.4 + b.userData.ph) * 0.06);
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
