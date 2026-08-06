// THE LAST LOCAL — deterministic sim. IRON RULE (toybox heritage): everything
// in here uses this.rng — NEVER Math.random. No DOM, no THREE, no Date. The
// view reads state + drains this.view events; it never writes back.
import {
  SHIFT, LAYOUT, TABLES, STATIONS, DOOR, PEN_GATE, GUEST_SPAWN, QUEUE_TILE,
  PLAYER_SPAWNS, PIG_HOME, EMPLOYEES, ARCHETYPES, REQUESTS, ITEMS,
  DIRECTOR_EVENTS, DIRECTOR, TUNING, VERSION,
} from './data.js';

export const DT = 1 / TUNING.tickHz;
const W = LAYOUT[0].length;
const H = LAYOUT.length;

// ── grid ───────────────────────────────────────────────────────────────────
const CH = [];
const WALK = [];
for (let z = 0; z < H; z++) {
  for (let x = 0; x < W; x++) {
    const c = LAYOUT[z][x];
    CH[z * W + x] = c;
    WALK[z * W + x] = c === '.' || c === ',' || c === '_' || c === 'D' || c === 'G';
  }
}
for (const t of TABLES) { WALK[t.z * W + t.x] = false; }
const inb = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
export const tileAt = (x, z) => (inb(x, z) ? CH[z * W + x] : '#');

export class Game {
  constructor(opts = {}) {
    this.opts = opts;
    this.cb = opts.cb || {};
    this.seed = (opts.seed >>> 0) || 1;
    this.rngState = this.seed;
    this.time = 0;
    this.frame = 0;
    this.over = false;
    this.view = [];            // view-event queue (drained by render/ui)
    this.decisionLog = [];     // director reproducibility (bible §12)
    this.setup(opts.players || [{ employeeKey: 'mara' }]);
  }

  rng() { // LCG (numerical recipes) — the ONLY randomness in the sim
    this.rngState = (Math.imul(1664525, this.rngState) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }
  ri(n) { return Math.floor(this.rng() * n); }
  pick(arr) { return arr[this.ri(arr.length)]; }

  // ── setup ────────────────────────────────────────────────────────────────
  setup(playerDefs) {
    this.players = playerDefs.map((d, i) => {
      const e = EMPLOYEES[d.employeeKey] || EMPLOYEES.mara;
      const s = PLAYER_SPAWNS[i % PLAYER_SPAWNS.length];
      return {
        pid: i, key: d.employeeKey, e, x: s.x + 0.5, z: s.z + 0.5,
        mx: 0, mz: 0, sprint: false, fx: 0, fz: 1, stamina: 1,
        carry: null, busy: null, stun: 0, abilityCd: 0, calBoost: 0,
        isBot: !!d.isBot, botWait: 0, shoveCd: 0, pingCd: 0,
        stats: { served: 0, prepped: 0, cleaned: 0, ejections: 0, shells: 0 },
      };
    });
    this.tables = TABLES.map((t) => ({ ...t, partyId: null, seats: [
      { x: t.x - 1, z: t.z }, { x: t.x + 1, z: t.z },
      { x: t.x, z: t.z - 1 }, { x: t.x, z: t.z + 1 },
    ].filter((s) => WALK[s.z * W + s.x]) }));
    this.parties = [];
    this.guests = [];
    this.orders = [];
    this.pings = [];    // crew callouts — shared sim state, so every client agrees
    this.items = [];
    this.spills = [];   // {x,z,kind:'spill'|'shards'}
    this.pigs = PIG_HOME.map((p, i) => ({
      id: i, x: p.x + 0.5, z: p.z + 0.5, loose: false,
      tx: null, tz: null, eatT: 0, carriedBy: null, stunT: 0,
    }));
    this.gate = 'closed'; // closed | broken | repaired(=closed)
    this.dishFault = false;
    this.dishDripT = 0;
    this.fryer = { smoking: false, t: 0 };
    this.shotgun = { stowed: true, shells: TUNING.shotgunShells };
    this.busClock = null;
    this.tapsKeg = TUNING.kegPours;
    this.nextId = 1;
    this.tracks = {
      cash: 0, hospitality: 50, loyalty: 50, heat: 0, gentrification: 20, chaos: 0,
      journal: [],
    };
    this.stats = { partiesSeated: 0, partiesResolved: 0, walkouts: 0, filmed: 0, pigMeals: 0 };
    this.director = {
      budget: 0, valveT: 0, used: {}, cooldown: {}, pending: [],
      famActive: {}, tick1: 0, headlineDone: {}, prepDone: false,
    };
    this.phasePrev = null;
    // two spare kegs wait in the lot from open (the taps will not last the night)
    this.items.push({ id: this.nextId++, kind: 'keg', x: 2.5, z: 2.5 });
    this.items.push({ id: this.nextId++, kind: 'keg', x: 3.5, z: 1.5 });
    this.inspector = { present: false, violations: 0, partyId: null, seen: {} };
  }

  // ── tracks (attribution mandatory — bible: no hidden scoring) ────────────
  track(key, amount, cause, note) {
    if (!cause) { throw new Error('track delta without cause: ' + key); }
    const t = this.tracks;
    if (key === 'cash') { t.cash += amount; }
    else {
      const before = t[key];
      t[key] = Math.max(0, Math.min(100, t[key] + amount));
      amount = t[key] - before;
    }
    if (amount !== 0) { t.journal.push({ t: this.time | 0, key, amount, cause, note }); }
  }

  ev(kind, data) { this.view.push(Object.assign({ kind, t: this.time }, data)); }

  // ── input & commands (lockstep boundary: only these mutate from outside) ─
  setInput(pid, mx, mz, sprint, fx, fz) {
    const p = this.players[pid];
    if (!p) { return; }
    p.mx = mx; p.mz = mz; p.sprint = !!sprint;
    if (fx != null && fz != null && Math.hypot(fx, fz) > 0.01) {
      // first-person: facing follows the LOOK, not the feet
      const fm = Math.hypot(fx, fz);
      p.fx = fx / fm; p.fz = fz / fm;
    } else {
      const m = Math.hypot(mx, mz);
      if (m > 0.01) { p.fx = mx / m; p.fz = mz / m; }
    }
  }

  execCommand(pid, cmd) {
    const p = this.players[pid];
    if (!p || this.over) { return; }
    if (cmd.c === 'in') { this.setInput(pid, cmd.mx || 0, cmd.mz || 0, cmd.sp, cmd.fx, cmd.fz); return; }
    // a downed coworker is not out of the game — they can still shout (bible §11)
    if (cmd.c === 'ping') { this.callOut(p); return; }
    if (p.stun > 0) { return; }
    if (cmd.c === 'act') { this.doContext(p); }
    else if (cmd.c === 'drop') { this.dropCarry(p, true); }
    else if (cmd.c === 'fire') { this.fireShotgun(p); }
    else if (cmd.c === 'ability') { this.useAbility(p); }
    else if (cmd.c === 'throw') { this.throwItem(p, cmd.p); }
  }

  // ── the callout (bible §8 "Shout/ping — context callout") ────────────────
  // One button, and the bar decides what you meant. It is sim state so every
  // client agrees on the marker, which is what makes it a coordination tool
  // rather than a local decoration. Consumes no rng: the read is pure.
  callOut(p) {
    if (p.pingCd > 0) { return; }
    p.pingCd = TUNING.pingCooldown;
    let kind = 'here';
    let x = p.x; let z = p.z;
    const R = TUNING.pingDangerRadius;
    const near = (ax, az) => Math.hypot(ax - p.x, az - p.z) < R;
    if (p.stun > 0) {
      kind = 'help';
    } else if (this.fryer.smoking && near(STATIONS.fryer.x + 0.5, STATIONS.fryer.z + 0.5)) {
      kind = 'fire'; x = STATIONS.fryer.x + 0.5; z = STATIONS.fryer.z + 0.5;
    } else if (!this.shotgun.stowed) {
      kind = 'gun';
    } else {
      const pig = this.pigs.find((q) => q.loose && !q.carriedBy && near(q.x, q.z));
      const mess = this.spills.find((s) => near(s.x + 0.5, s.z + 0.5));
      const needy = this.parties.find((q) => (q.state === 'waitpay'
        || (q.state === 'deciding' && q.decideT <= 0) || q.state === 'complaining')
        && this.tblNear(q.tableId, p.x, p.z));
      if (pig) { kind = 'pig'; x = pig.x; z = pig.z; }
      else if (this.tapsKeg <= 0) { kind = 'keg'; x = STATIONS.taps.x + 0.5; z = STATIONS.taps.z + 0.5; }
      else if (needy) {
        const t = this.tables.find((q) => q.id === needy.tableId);
        kind = needy.state === 'waitpay' ? 'money' : 'order';
        if (t) { x = t.x + 0.5; z = t.z + 0.5; }
      } else if (mess) { kind = 'mess'; x = mess.x + 0.5; z = mess.z + 0.5; }
      else if (p.carry) { kind = 'hands'; }
    }
    this.pings.push({ id: this.nextId++, pid: p.pid, kind, x, z, tLeft: TUNING.pingSeconds });
    if (this.pings.length > 8) { this.pings.shift(); }
    this.ev('ping', { pid: p.pid, what: kind, x, z });
  }

  // ── the throw verb (bible §8: charge and release) ────────────────────────
  throwItem(p, power01) {
    if (!p.carry || p.busy) { return; }
    if (p.carry.kind === 'shotgun' || p.carry.kind === 'mopheld') { return; }
    if (p.carry.kind === 'pig') { this.tossPig(p, Math.max(0, Math.min(1, power01 || 0))); return; }
    if (ITEMS[p.carry.kind] && ITEMS[p.carry.kind].heavy) { this.ev('tooheavy'); return; }
    const kind = p.carry.kind;
    p.carry = null;
    const pw = Math.max(0, Math.min(1, power01 || 0));
    const spd = TUNING.throwMinSpeed + ((TUNING.throwMaxSpeed - TUNING.throwMinSpeed) * pw);
    this.items.push({
      id: this.nextId++, kind,
      x: p.x + (p.fx * 0.5), z: p.z + (p.fz * 0.5), y: 1.15,
      fly: true, vx: p.fx * spd, vz: p.fz * spd,
      vy: TUNING.throwUpMin + ((TUNING.throwUpMax - TUNING.throwUpMin) * pw),
      power: pw, thrower: p.pid, bonked: false,
    });
    this.ev('throw', { pid: p.pid, item: kind, power: pw });
  }

  /** A pig is not a projectile. It is a short, indignant flight. */
  tossPig(p, power01) {
    const pig = this.pigs.find((q) => q.id === p.carry.pigId);
    p.carry = null;
    if (!pig) { return; }
    pig.carriedBy = null;
    const dist = 1.2 + (power01 * 2.6);
    const tx = p.x + (p.fx * dist);
    const tz = p.z + (p.fz * dist);
    if (!this.blockedAt(tx, tz)) { pig.x = tx; pig.z = tz; }
    pig.stunT = TUNING.pigTossStun;
    pig.tx = null;
    pig.loose = tileAt(pig.x | 0, pig.z | 0) !== '_';
    if (!pig.loose) {
      this.track('chaos', -2, 'evt.pig.penned', 'a pig was returned by air');
      this.ev('pigpenned', { id: pig.id });
    } else {
      this.track('chaos', 2, 'evt.pig.tossed', 'somebody threw a pig');
      this.witnessMoment('pigtoss', pig.x, pig.z, 0.6);
      this.ev('pigtoss', { id: pig.id, x: pig.x, z: pig.z });
    }
  }

  flightTick(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.fly) { continue; }
      it.vy -= TUNING.throwGravity * dt;
      it.y += it.vy * dt;
      const nx = it.x + (it.vx * dt);
      const nz = it.z + (it.vz * dt);
      if (this.blockedAt(nx, nz) && it.y < 1.9) { it.vx = 0; it.vz = 0; } else { it.x = nx; it.z = nz; }
      // a teammate with free hands catches it clean
      let caught = false;
      for (const q of this.players) {
        if (q.pid === it.thrower || q.carry || q.busy || q.stun > 0) { continue; }
        if (it.y < 1.6 && Math.hypot(q.x - it.x, q.z - it.z) < TUNING.catchRadius) {
          this.items.splice(i, 1);
          q.carry = { kind: it.kind };
          this.ev('catch', { pid: q.pid, item: it.kind });
          caught = true;
          break;
        }
      }
      if (caught) { continue; }
      // one bonk per flight — comedy, consequences, cameras
      if (!it.bonked && it.y > 0.2 && it.y < 1.7) {
        for (const g of this.guests) {
          if (g.state === 'gone' || g.state === 'leaving') { continue; }
          if (Math.hypot(g.x - it.x, g.z - it.z) < TUNING.bonkRadius) {
            it.bonked = true;
            it.vx *= 0.2; it.vz *= 0.2; it.vy = Math.min(it.vy, 1);
            g.slipT = Math.max(g.slipT, 1.0);
            const party = this.parties.find((q2) => q2.id === g.partyId);
            if (party) { party.mood -= 2; }
            this.track('hospitality', -2, 'evt.bonk', 'a guest took one off the head');
            this.ev('bonk', { x: it.x, z: it.z });
            this.witnessMoment('bonk', it.x, it.z, 0.4);
            break;
          }
        }
      }
      if (it.y <= 0) {
        it.y = 0;
        it.fly = false;
        this.landThrow(it);
      }
    }
  }

  landThrow(it) {
    // rough delivery: a matching open order at the table it landed by
    const tbl = this.tables.find((t) =>
      t.partyId != null && Math.hypot(t.x + 0.5 - it.x, t.z + 0.5 - it.z) < 1.4);
    if (tbl) {
      const ord = this.orders.find((o) => o.tableId === tbl.id && o.state === 'open');
      if (ord) {
        const req = REQUESTS[ord.reqKey];
        const match = it.kind === req.needItem || (req.substitute && it.kind === req.substitute.item);
        const party = this.parties.find((q) => q.id === ord.partyId);
        if (match && party) {
          this.items.splice(this.items.indexOf(it), 1);
          ord.state = 'done';
          ord.path = 'thrown';
          party.state = 'eating';
          party.eatT = TUNING.eatSeconds;
          party.satisfied = Math.min(0.45, (ord.tLeft / ord.total) * 0.6);
          party.pay = req.pay;
          party.mood -= 1;
          this.track('chaos', 1, 'evt.throw.delivery', 'service, airborne');
          this.ev('served', { tableId: tbl.id, path: 'thrown' });
          return;
        }
      }
    }
    // fragile things do not love landing hard
    if (ITEMS[it.kind] && ITEMS[it.kind].fragile && it.power > 0.45) {
      this.items.splice(this.items.indexOf(it), 1);
      this.addSpill(it.x | 0, it.z | 0, 'shards');
      this.ev('glassbreak', { x: it.x, z: it.z });
      this.track('chaos', 1, 'evt.throw.break', 'glass, everywhere');
      return;
    }
    this.ev('land', { item: it.kind });
  }

  // ── context action: the single readable verb (bible §8 tap interact) ─────
  contextHint(p) {
    if (p.busy) {
      return { verb: p.busy.label + '…', progress: 1 - p.busy.tLeft / p.busy.total,
        at: p.busy.at, tag: 'busy' };
    }
    const c = this.contextOf(p);
    return c ? { verb: c.verb, at: c.at, tag: c.tag, station: c.station, dead: !c.act } : null;
  }

  /** Every context result carries `at` (world position) and `tag` (what kind of
   *  thing it is). The view uses them to halo the actual object and float the
   *  verb on it — bible §32 "thin warm rim plus icon". Pure data: no rng, no
   *  state change, so bots/autopilot/tests are unaffected. */
  contextOf(p) {
    const px = p.x | 0; const pz = p.z | 0;
    const near = (x, z) => Math.abs(px - x) + Math.abs(pz - z) <= 1;
    const at = (x, z, y) => ({ x, z, y: y == null ? 1.15 : y });
    // a coworker on the floor outranks everything — you can be the reason they
    // get up in half a second instead of lying there watching the shift burn
    const down = this.players.find((q) => q.pid !== p.pid && q.stun > TUNING.helpUpLeaves + 0.3
      && Math.hypot(q.x - p.x, q.z - p.z) < TUNING.helpUpRadius);
    if (down) {
      return { verb: 'Help ' + down.e.label.split(' ')[0] + ' up', tag: 'crew',
        at: at(down.x, down.z, 0.5), act: () => {
          down.stun = TUNING.helpUpLeaves;
          this.ev('helpup', { pid: p.pid, who: down.pid, x: down.x, z: down.z });
        } };
    }
    // carried-item verbs first
    if (p.carry) {
      if (p.carry.kind === 'mopheld') {
        const s = this.spills.find((sp) => near(sp.x, sp.z));
        if (s) { return { verb: s.kind === 'shards' ? 'Sweep shards' : 'Mop spill', tag: 'mess', at: at(s.x + 0.5, s.z + 0.5, 0.3), act: () => this.cleanSpill(p, s) }; }
        if (near(STATIONS.mop.x, STATIONS.mop.z)) { return { verb: 'Stow mop', tag: 'station', at: at(STATIONS.mop.x + 0.5, STATIONS.mop.z + 0.5), act: () => { p.carry = null; } }; }
      }
      if (p.carry.kind === 'shotgun' && near(STATIONS.shotgun.x, STATIONS.shotgun.z)) {
        return { verb: 'Stow the Regulator', tag: 'danger', at: at(STATIONS.shotgun.x + 0.5, STATIONS.shotgun.z + 0.5), act: () => { this.shotgun.stowed = true; p.carry = null; this.ev('gunstow'); } };
      }
      if (p.carry.kind === 'feed' && tileAt(px, pz) === '_') {
        return { verb: 'Pour feed', tag: 'pig', at: at(px + 0.5, pz + 0.5, 0.4), act: () => { p.carry = null; this.ev('feedpour', { x: px, z: pz }); } };
      }
      if (near(STATIONS.dumpster.x, STATIONS.dumpster.z)) {
        return { verb: 'Toss ' + (ITEMS[p.carry.kind] || {}).label, tag: 'station', at: at(STATIONS.dumpster.x + 0.5, STATIONS.dumpster.z + 0.5, 0.8), act: () => this.tossDumpster(p) };
      }
      // deliver to adjacent table
      const tbl = this.tables.find((t) => near(t.x, t.z) && t.partyId != null);
      if (tbl) {
        const ord = this.orders.find((o) => o.tableId === tbl.id && o.state === 'open');
        if (ord) {
          const req = REQUESTS[ord.reqKey];
          const right = p.carry.kind === req.needItem;
          const fake = !right && req.substitute && p.carry.kind === req.substitute.item;
          return { verb: right ? 'Serve table ' + tbl.id
            : fake ? 'Pass it off as the real thing (T' + tbl.id + ')'
              : 'Serve table ' + tbl.id + ' — they wanted ' + REQUESTS[ord.reqKey].label,
          tag: fake ? 'risk' : right ? 'serve' : 'wrong',
          at: at(tbl.x + 0.5, tbl.z + 0.5, 1.0), act: () => this.deliver(p, tbl, ord) };
        }
      }
    }
    // table verbs
    const tbl = this.tables.find((t) => near(t.x, t.z) && t.partyId != null);
    if (tbl) {
      const party = this.parties.find((q) => q.id === tbl.partyId);
      const tAt = at(tbl.x + 0.5, tbl.z + 0.5, 1.0);
      if (party) {
        if (party.state === 'deciding' && party.decideT <= 0) { return { verb: 'Take order', tag: 'serve', at: tAt, act: () => this.takeOrder(p, tbl, party) }; }
        if (party.state === 'waitpay') { return { verb: 'Collect payment', tag: 'money', at: tAt, act: () => this.collect(p, tbl, party) }; }
        if (party.state === 'complaining' && !this.orders.some((o) => o.partyId === party.id)) {
          // ignored too long but recoverable: grovel and take the order anyway
          return { verb: 'Take order (grovel)', tag: 'serve', at: tAt, act: () => { party.complainT = undefined; party.mood -= 1; this.takeOrder(p, tbl, party); } };
        }
        if (party.state === 'complaining' || party.mood <= -2 || this.socialTargets(party).length) {
          return { verb: 'Eject (struggle)', tag: 'danger', at: tAt, act: () => this.startBusy(p, 'Ejecting', TUNING.struggleEjectSeconds, () => this.eject(p, party, false)) };
        }
      }
    }
    // stations
    for (const key of Object.keys(STATIONS)) {
      const s = STATIONS[key];
      if (!near(s.x, s.z)) { continue; }
      const a = this.stationAction(p, key, s);
      if (a) {
        a.at = a.at || at(s.x + 0.5, s.z + 0.5, key === 'trough' || key === 'dumpster' ? 0.7 : 1.35);
        a.tag = a.tag || 'station';
        a.station = key;
        return a;
      }
    }
    // pen gate repair
    if (this.gate === 'broken' && near(PEN_GATE.x, PEN_GATE.z)) {
      return { verb: 'Repair gate', tag: 'fix', at: at(PEN_GATE.x + 0.5, PEN_GATE.z + 0.5, 0.7), act: () => this.startBusy(p, 'Repairing gate', 2, () => { this.gate = 'closed'; this.ev('gatefixed'); }) };
    }
    // scoop a loose pig (the single funniest verb in the building)
    if (!p.carry) {
      const pig = this.pigs.find((q) => q.loose && !q.carriedBy
        && Math.hypot(q.x - p.x, q.z - p.z) < TUNING.pigScoopRadius);
      if (pig) {
        return { verb: 'Grab the pig', tag: 'pig', at: at(pig.x, pig.z, 0.5), act: () => {
          pig.carriedBy = p.pid;
          p.carry = { kind: 'pig', pigId: pig.id };
          this.ev('pigscoop', { pid: p.pid, id: pig.id });
        } };
      }
    }
    // put the pig back where pigs live
    if (p.carry && p.carry.kind === 'pig' && (tileAt(px, pz) === '_' || near(PEN_GATE.x, PEN_GATE.z))) {
      return { verb: 'Put the pig back', tag: 'pig', at: at(px + 0.5, pz + 0.5, 0.5), act: () => this.releasePig(p, true) };
    }
    // pick up world item
    const it = this.items.find((i) => !i.held && Math.hypot(i.x - p.x, i.z - p.z) < 1.1);
    if (it && !p.carry) { return { verb: 'Pick up ' + (ITEMS[it.kind] || {}).label, tag: 'item', at: at(it.x, it.z, 0.35), act: () => { this.items.splice(this.items.indexOf(it), 1); p.carry = { kind: it.kind }; } }; }
    return null;
  }

  /** Drop a carried pig. penned = it's home (or it just wriggled free). */
  releasePig(p, penned) {
    if (!p.carry || p.carry.kind !== 'pig') { return; }
    const pig = this.pigs.find((q) => q.id === p.carry.pigId);
    p.carry = null;
    if (!pig) { return; }
    pig.carriedBy = null;
    pig.x = p.x; pig.z = p.z;
    pig.tx = null;
    if (penned && (tileAt(p.x | 0, p.z | 0) === '_' || Math.hypot(PEN_GATE.x + 0.5 - p.x, PEN_GATE.z + 0.5 - p.z) < 1.6)) {
      pig.loose = false;
      pig.x = PIG_HOME[pig.id % PIG_HOME.length].x + 0.5;
      pig.z = PIG_HOME[pig.id % PIG_HOME.length].z + 0.5;
      this.track('chaos', -2, 'evt.pig.penned', 'a pig went back where pigs go');
      this.ev('pigpenned', { id: pig.id });
    } else {
      this.ev('pigloose', { id: pig.id });
    }
  }

  stationAction(p, key, s) {
    if (key === 'taps') {
      if (this.tapsKeg <= 0) {
        if (p.carry && p.carry.kind === 'keg') {
          return { verb: 'Tap the fresh keg', act: () => this.startBusy(p, 'Tapping keg', TUNING.kegTapSeconds, () => {
            p.carry = null;
            this.tapsKeg = TUNING.kegPours;
            this.ev('kegtapped');
          }) };
        }
        return { verb: 'Taps are DRY — bring a keg from the lot' };
      }
      if (!p.carry) {
        return { verb: s.verb, act: () => this.startBusy(p, s.label, s.time * p.e.prepMul, () => {
          p.carry = { kind: 'beer' };
          p.stats.prepped++;
          this.tapsKeg--;
          if (this.tapsKeg === 2) { this.ev('keglow'); }
          if (this.tapsKeg === 0) { this.ev('kegdry'); }
        }) };
      }
      return null;
    }
    if (key === 'shotgun') {
      if (this.shotgun.stowed && !p.carry) {
        return { verb: 'Reach under the bar', act: () => this.startBusy(p, 'Reaching under', s.time, () => {
          this.shotgun.stowed = false; p.carry = { kind: 'shotgun' }; this.ev('gunout', { pid: p.pid }); this.witnessMoment('gunout', p.x, p.z, 0.5);
        }) };
      }
      return null;
    }
    if (key === 'dish') {
      if (this.dishFault) { return { verb: 'Repair dishwasher', act: () => this.startBusy(p, 'Repairing', s.time, () => { this.dishFault = false; this.ev('dishfixed'); }) }; }
      return null;
    }
    if (key === 'fryer' && this.fryer.smoking) {
      return { verb: 'KILL THE CIRCUIT', act: () => this.startBusy(p, 'Killing circuit', 2, () => { this.fryer.smoking = false; this.fryer.t = 0; this.ev('fryerout'); }) };
    }
    if (key === 'mop') { if (!p.carry) { return { verb: s.verb, act: () => this.startBusy(p, 'Grabbing mop', s.time, () => { p.carry = { kind: 'mopheld' }; }) }; } return null; }
    if (key === 'trough') { if (!p.carry) { return { verb: s.verb, act: () => this.startBusy(p, 'Scooping feed', s.time, () => { p.carry = { kind: 'feed' }; }) }; } return null; }
    if (key === 'dumpster' || key === 'pos' || key === 'jukebox') { return null; }
    if (s.makes && !p.carry) {
      return { verb: s.verb, act: () => this.startBusy(p, s.label, s.time * p.e.prepMul, () => {
        p.carry = { kind: s.makes }; p.stats.prepped++;
      }) };
    }
    return null;
  }

  doContext(p) {
    if (p.busy) { return; }
    const c = this.contextOf(p);
    if (c && c.act) { c.act(); }
  }

  startBusy(p, label, seconds, done) {
    p.busy = { label, tLeft: seconds, total: seconds, done, at: { x: p.x, z: p.z, y: 1.35 } };
    p.lastStation = label;
  }

  dropCarry(p, deliberate) {
    if (!p.carry) { return; }
    const kind = p.carry.kind;
    if (kind === 'pig') { this.releasePig(p, true); return; }
    p.carry = null;
    if (kind === 'shotgun') { this.items.push({ id: this.nextId++, kind, x: p.x, z: p.z }); this.ev('gundrop'); return; }
    if (kind === 'mopheld') { return; }
    // anything breakable that leaves your hands unwillingly, breaks
    if (!deliberate && ITEMS[kind] && ITEMS[kind].fragile) {
      this.addSpill(p.x | 0, p.z | 0, 'shards');
      this.ev('glassbreak', { x: p.x, z: p.z });
      return;
    }
    this.items.push({ id: this.nextId++, kind, x: p.x, z: p.z });
  }

  tossDumpster(p) {
    const kind = p.carry.kind;
    p.carry = null;
    if (ITEMS[kind] && ITEMS[kind].evidence) {
      this.track('heat', -5, 'evt.evidence.tossed', 'evidence in the dumpster');
      this.ev('evidencegone', { how: 'dumpster' });
    }
  }

  // ── service ──────────────────────────────────────────────────────────────
  takeOrder(p, tbl, party) {
    const reqKey = party.bus && this.rng() < 0.5
      ? 'buscheck'
      : this.pick(ARCHETYPES[party.arche].pool);
    const req = REQUESTS[reqKey];
    party.state = req.social ? 'social' : 'ordered';
    const o = {
      id: this.nextId++, tableId: tbl.id, partyId: party.id, reqKey,
      state: 'open', tLeft: req.patience * ARCHETYPES[party.arche].patienceMul,
      total: req.patience * ARCHETYPES[party.arche].patienceMul,
    };
    this.orders.push(o);
    this.ev('ordertaken', { tableId: tbl.id, reqKey, bark: req.bark });
    if (req.social) { o.state = 'social'; }
    if (req.rowdyTrigger) { party.rowdy = true; }
  }

  deliver(p, tbl, ord) {
    const req = REQUESTS[ord.reqKey];
    const party = this.parties.find((q) => q.id === ord.partyId);
    if (!party) { return; }
    const kind = p.carry.kind;
    if (req.needItem && kind === req.needItem) {
      this.resolveOrder(p, ord, party, 'honest');
    } else if (req.substitute && kind === req.substitute.item) {
      const arche = ARCHETYPES[party.arche];
      if (this.rng() < req.substitute.risk * arche.savvy) {
        p.carry = null;
        this.track('hospitality', TUNING.substituteCaughtHosp, 'evt.sub.caught', req.substitute.cover + ' — caught');
        this.track('heat', this.inspector.present ? TUNING.substituteCaughtHeat : 0, 'evt.sub.caught', 'inspector noted it');
        party.mood -= 2;
        this.ev('subcaught', { tableId: tbl.id });
        ord.tLeft = Math.min(ord.tLeft, 12);
      } else {
        this.resolveOrder(p, ord, party, 'deception');
      }
    } else {
      this.ev('wrongitem', { tableId: tbl.id, want: req.needItem });
    }
  }

  resolveOrder(p, ord, party, path) {
    const req = REQUESTS[ord.reqKey];
    p.carry = null;
    ord.state = 'done'; ord.path = path;
    party.state = 'eating'; party.eatT = TUNING.eatSeconds;
    party.satisfied = ord.tLeft / ord.total;
    party.pay = req.pay;
    p.stats.served++;
    const st = this.tables.find((q) => q.id === ord.tableId);
    this.ev('served', { tableId: ord.tableId, path, x: st ? st.x + 0.5 : p.x, z: st ? st.z + 0.5 : p.z });
    if (req.redeliver && !ord.redelivered) {
      // the influencer's shot died: same item, again (bible §17 signature)
      party.state = 'deciding'; party.decideT = 4;
      const again = { ...ord, id: this.nextId++, redelivered: true, state: 'open', tLeft: ord.total * 0.7, total: ord.total * 0.7 };
      this.orders.push(again);
      this.ev('retake', { tableId: ord.tableId });
    }
  }

  collect(p, tbl, party) {
    const arche = ARCHETYPES[party.arche];
    let tip = party.pay * (party.satisfied > 0.5 ? TUNING.tipHappy : TUNING.tipOk) * arche.tipMul;
    if (party.bus && this.busClock != null) { tip += party.pay * TUNING.busTipBonus; }
    const total = Math.round(party.pay + tip);
    // the view floats the money where the money actually happened
    this.ev('paid', { tableId: tbl.id, amount: total, tip: Math.round(tip), x: tbl.x + 0.5, z: tbl.z + 0.5 });
    this.track('cash', total, 'evt.pay.t' + tbl.id, arche.label + ' paid');
    this.track('hospitality', party.satisfied > 0.5 ? 2 : 1, 'evt.pay.t' + tbl.id, 'service landed');
    if (arche.local) { this.track('loyalty', 2, 'evt.local.happy', 'a local went home happy'); }
    if (arche.gentOnHappy && party.satisfied > 0.5) {
      this.track('gentrification', arche.gentOnHappy, 'evt.gent.review', arche.label + ' posted about us');
    }
    this.partyLeave(party, 'paid');
    this.stats.partiesResolved++;
  }

  socialTargets(party) {
    // a 'mystool' local wants the nearest tourist party gone
    if (party.arche !== 'oldlocal') { return []; }
    const o = this.orders.find((x) => x.partyId === party.id && x.state === 'social');
    if (!o) { return []; }
    return this.parties.filter((q) => q.id !== party.id && ARCHETYPES[q.arche].gentOnHappy > 0 && q.state !== 'leaving');
  }

  eject(p, party, clean) {
    const arche = ARCHETYPES[party.arche];
    if (arche.local) { this.track('loyalty', -TUNING.ejectLocalLoyalty, 'evt.eject.local', 'threw out a regular'); }
    else {
      this.track('loyalty', TUNING.ejectTouristLoyalty, 'evt.eject', 'the room approved');
      this.track('hospitality', clean ? -1 : TUNING.ejectTouristHosp, 'evt.eject', 'scene at table');
      this.track('gentrification', -1, 'evt.eject', 'word gets around');
    }
    p.stats.ejections++;
    // resolve any social request that wanted this
    for (const q of this.parties) {
      const o = this.orders.find((x) => x.partyId === q.id && x.state === 'social');
      if (o && q.arche === 'oldlocal') { o.state = 'done'; q.state = 'waitpay'; q.pay = 900; q.satisfied = 1; this.ev('stoolfreed', { tableId: o.tableId }); }
    }
    const et = this.tables.find((q) => q.id === party.tableId);
    this.partyLeave(party, 'ejected');
    this.ev('ejected', { arche: party.arche, x: et ? et.x + 0.5 : p.x, z: et ? et.z + 0.5 : p.z });
  }

  partyLeave(party, why) {
    party.state = 'leaving';
    party.why = why;
    const tbl = this.tables.find((t) => t.partyId === party.id);
    if (tbl) { tbl.partyId = null; }
    for (const g of this.guests) { if (g.partyId === party.id) { g.state = 'leaving'; g.path = null; } }
    for (const o of this.orders) { if (o.partyId === party.id && (o.state === 'open' || o.state === 'social')) { o.state = 'failed'; } }
  }

  // ── the Regulator (bible §5: optional, costly, absurdly overqualified) ───
  fireShotgun(p) {
    if (!p.carry || p.carry.kind !== 'shotgun') { return; }
    if (this.shotgun.shells <= 0) { this.ev('gunclick'); return; }
    this.shotgun.shells--;
    p.stats.shells++;
    this.ev('gunfire', { x: p.x, z: p.z, fx: p.fx, fz: p.fz });
    this.track('heat', TUNING.shotgunHeat, 'evt.gun.fired', 'somebody called somebody');
    this.track('chaos', TUNING.shotgunChaos, 'evt.gun.fired', 'the room went off');
    const sx = (p.x + p.fx * 2) | 0; const sz = (p.z + p.fz * 2) | 0;
    if (WALK[sz * W + sx]) { this.addSpill(sx, sz, 'shards'); }
    this.witnessMoment('gunfire', p.x, p.z, 0.95);
    let anyThreat = false;
    for (const party of this.parties) {
      if (party.state === 'leaving' || party.state === 'gone') { continue; }
      if (party.rowdy || party.state === 'complaining') { anyThreat = true; }
      party.panic = TUNING.panicFleeSeconds;
      this.partyLeave(party, 'fled');
      this.stats.walkouts++;
    }
    for (const pig of this.pigs) { if (pig.loose) { pig.tx = null; } }
    if (!anyThreat) { this.track('hospitality', -10, 'evt.gun.vibe', 'you shot the vibe'); }
    else { this.track('loyalty', 3, 'evt.gun.order', 'order, restored loudly'); }
  }

  witnessMoment(what, x, z, filmChance) {
    for (const g of this.guests) {
      if (g.state === 'gone' || g.state === 'leaving') { continue; }
      const arche = ARCHETYPES[this.parties.find((q) => q.id === g.partyId)?.arche || 'tourist'];
      if (arche.films > 0 && this.rng() < arche.films * filmChance) {
        this.stats.filmed++;
        this.track('heat', 3, 'evt.filmed.' + what, arche.label + ' got it on camera');
        if (this.rng() < 0.5) {
          this.items.push({ id: this.nextId++, kind: 'phone', x: g.x, z: g.z });
          this.ev('phonedrop', { x: g.x, z: g.z });
        }
      }
    }
    if (this.inspector.present && (what === 'gunout' || what === 'gunfire')) { this.noteViolation('firearm'); }
  }

  noteViolation(what) {
    if (this.inspector.seen[what]) { return; }
    this.inspector.seen[what] = true;
    this.inspector.violations++;
    this.ev('clipboard', { what });
  }

  // ── abilities (bible §16) ────────────────────────────────────────────────
  useAbility(p) {
    if (p.abilityCd > 0) { return; }
    const a = p.e.ability;
    if (a === 'takeitoutside') {
      const tbl = this.tables.find((t) => Math.abs((p.x | 0) - t.x) + Math.abs((p.z | 0) - t.z) <= 1 && t.partyId != null);
      const party = tbl && this.parties.find((q) => q.id === tbl.partyId);
      if (!party) { return; }
      this.eject(p, party, true);
    } else if (a === 'housefavorite') {
      for (const q of this.parties) { if (q.state !== 'leaving') { q.mood = Math.min(2, q.mood + 1); } }
      for (const o of this.orders) { if (o.state === 'open') { o.tLeft = Math.min(o.total, o.tLeft + 15); } }
      this.ev('song', { pid: p.pid });
    } else if (a === 'fencepost') {
      p.calBoost = 10;
      this.ev('fencepost', { pid: p.pid });
    } else if (a === 'offmenu') {
      if (!p.busy) { return; }
      const done = p.busy.done; p.busy = null; done();
      if (this.rng() < 0.5) { this.addSpill(p.x | 0, p.z | 0, 'spill'); this.ev('sideeffect', { what: 'spill' }); }
      else if (p.carry) { p.carry.kind = this.pick(['fries', 'garnish', p.carry.kind]); this.ev('sideeffect', { what: 'swap' }); }
    } else { return; }
    p.abilityCd = p.e.cooldown;
  }

  // ── mess ─────────────────────────────────────────────────────────────────
  addSpill(x, z, kind) {
    if (!WALK[z * W + x]) { return; }
    if (this.spills.some((s) => s.x === x && s.z === z)) { return; }
    this.spills.push({ x, z, kind });
    // ⚠ `what:`, never `kind:` — ev() Object.assigns the payload OVER the event
    // kind, so `{kind}` here silently renamed the event to 'shards' and the view
    // never saw a 'spill'. This is the exact trap the README warns about.
    this.ev('spill', { x, z, what: kind });
  }

  cleanSpill(p, s) {
    this.startBusy(p, s.kind === 'shards' ? 'Sweeping' : 'Mopping', 1.0, () => {
      const i = this.spills.indexOf(s);
      if (i >= 0) { this.spills.splice(i, 1); }
      p.stats.cleaned++;
      this.track('chaos', -1, 'evt.cleaned', 'mess handled');
    });
  }

  // ── guests ───────────────────────────────────────────────────────────────
  spawnParty(archeKey) {
    const arche = ARCHETYPES[archeKey];
    const free = this.tables.filter((t) => t.partyId == null && t.seats.length >= 2);
    if (!free.length) { return false; }
    const tbl = this.pick(free);
    const size = arche.partySize[0] + this.ri(arche.partySize[1] - arche.partySize[0] + 1);
    const party = {
      id: this.nextId++, arche: archeKey, size, mood: 0, state: 'arriving',
      tableId: tbl.id, decideT: 3 + this.rng() * 3, eatT: 0, panic: 0, satisfied: 0, pay: 0,
    };
    tbl.partyId = party.id;
    this.parties.push(party);
    this.stats.partiesSeated++;
    for (let i = 0; i < size; i++) {
      const seat = tbl.seats[i % tbl.seats.length];
      this.guests.push({
        id: this.nextId++, partyId: party.id, arche: archeKey,
        x: GUEST_SPAWN.x + 0.5, z: GUEST_SPAWN.z + 0.5 + i * 0.02,
        seat, state: 'toseat', path: null, slipT: 0,
      });
    }
    if (arche.inspector) { this.inspector.present = true; this.inspector.partyId = party.id; }
    this.ev('arrive', { arche: archeKey, tableId: tbl.id, size });
    return true;
  }

  guestTick(g, dt) {
    if (g.slipT > 0) { g.slipT -= dt; return; }
    const party = this.parties.find((q) => q.id === g.partyId);
    if (!party) { g.state = 'gone'; return; }
    if (g.state === 'toseat') {
      if (this.walkTo(g, g.seat.x + 0.5, g.seat.z + 0.5, TUNING.guestWalk, dt)) {
        g.state = 'seated';
        if (party.state === 'arriving') { party.state = 'deciding'; }
      }
    } else if (g.state === 'seated') {
      // slip hazard while seated? no — only walkers slip
    } else if (g.state === 'leaving') {
      const speed = party.panic > 0 ? TUNING.guestWalk * 1.8 : TUNING.guestWalk;
      if (this.walkTo(g, GUEST_SPAWN.x + 0.5, GUEST_SPAWN.z + 0.5, speed, dt)) { g.state = 'gone'; }
    }
    // spill slips for walking guests
    if ((g.state === 'toseat' || g.state === 'leaving') && g.slipT <= 0) {
      const s = this.spills.find((sp) => sp.kind === 'spill' && sp.x === (g.x | 0) && sp.z === (g.z | 0));
      if (s && this.rng() < TUNING.spillSlipChance * dt) {
        g.slipT = 1.2; party.mood -= 1; this.ev('slip', { x: g.x, z: g.z, who: 'guest' });
        this.witnessMoment('slip', g.x, g.z, 0.3);
      }
    }
  }

  partyTick(party, dt) {
    if (party.state === 'deciding') {
      party.decideT -= dt;
      // waiting too long to take the order = patience burn
      if (party.decideT < -45) {
        party.state = 'complaining';
        this.ev('complaint', { tableId: party.tableId, why: 'ignored' });
      }
    } else if (party.state === 'eating') {
      party.eatT -= dt;
      if (party.eatT <= 0) { party.state = 'waitpay'; this.ev('waitpay', { tableId: party.tableId }); }
    } else if (party.state === 'complaining') {
      party.complainT = (party.complainT || 18) - dt;
      if (party.complainT <= 0) {
        this.track('hospitality', TUNING.walkoutHospitality, 'evt.walkout.t' + party.tableId, ARCHETYPES[party.arche].label + ' walked out');
        this.stats.walkouts++;
        this.partyLeave(party, 'walkout');
      }
    }
    if (party.panic > 0) { party.panic -= dt; }
    // pigs at the table
    if (party.state !== 'leaving' && party.state !== 'gone') {
      for (const pig of this.pigs) {
        if (pig.loose && this.tblNear(party.tableId, pig.x, pig.z)) {
          party.mood -= dt * 0.3;
          if (!party.piggedEv && (party.piggedEv = true)) { this.witnessMoment('pig', pig.x, pig.z, 0.5); }
        }
      }
    }
  }

  tblNear(tableId, x, z) {
    const t = this.tables.find((q) => q.id === tableId);
    return t && Math.hypot(t.x + 0.5 - x, t.z + 0.5 - z) < 2.2;
  }

  // ── orders tick ──────────────────────────────────────────────────────────
  ordersTick(dt) {
    for (const o of this.orders) {
      if (o.state !== 'open') { continue; }
      o.tLeft -= dt;
      const party = this.parties.find((q) => q.id === o.partyId);
      if (!party || party.state === 'leaving' || party.state === 'gone') { o.state = 'failed'; continue; }
      if (o.tLeft <= 0) {
        o.state = 'failed';
        party.state = 'complaining';
        this.track('hospitality', TUNING.complaintHospitality, 'evt.slow.t' + o.tableId, 'order took too long');
        this.ev('complaint', { tableId: o.tableId, why: 'slow' });
      }
    }
  }

  // ── pigs (bible: unpredictable gameplay agents, comic abstraction) ───────
  pigTick(pig, dt) {
    // being carried: you are now a pig-handler, and the pig has opinions
    if (pig.carriedBy != null) {
      const carrier = this.players[pig.carriedBy];
      if (!carrier || !carrier.carry || carrier.carry.kind !== 'pig' || carrier.carry.pigId !== pig.id) {
        pig.carriedBy = null;
        return;
      }
      pig.x = carrier.x;
      pig.z = carrier.z;
      pig.loose = true;
      // Cal grew up doing this; everyone else eventually loses the wrestling match
      if (carrier.key !== 'cal' && carrier.calBoost <= 0 && this.rng() < TUNING.pigSquirmPerSec * dt) {
        this.releasePig(carrier, false);
        this.ev('pigsquirm', { pid: carrier.pid });
      }
      return;
    }
    if (pig.stunT > 0) { pig.stunT -= dt; return; }
    const speed = pig.chaseP != null ? TUNING.pigChase : TUNING.pigWalk;
    if (!pig.loose) {
      if (this.gate === 'broken') { pig.loose = true; this.ev('pigout', { id: pig.id }); }
      else { return; }
    }
    // Cal's fencepost or feed carrier lure
    let lure = null;
    for (const p of this.players) {
      if (p.calBoost > 0 || (p.carry && p.carry.kind === 'feed')) {
        if (Math.hypot(p.x - pig.x, p.z - pig.z) < TUNING.pigFeedLure) { lure = p; break; }
      }
    }
    if (lure) {
      this.walkTo(pig, lure.x, lure.z, TUNING.pigChase, dt);
      if (tileAt(pig.x | 0, pig.z | 0) === '_' && this.gate !== 'broken') { pig.loose = false; }
      return;
    }
    // seek nearest floor item to eat
    if (pig.eatT > 0) { pig.eatT -= dt; return; }
    let best = null; let bd = 99;
    for (const it of this.items) {
      if (it.held || it.fly || it.kind === 'shotgun') { continue; }
      if (ITEMS[it.kind] && ITEMS[it.kind].heavy) { continue; } // even pigs have limits
      const d = Math.hypot(it.x - pig.x, it.z - pig.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (best && bd < TUNING.pigStealRadius) {
      this.items.splice(this.items.indexOf(best), 1);
      pig.eatT = 2.5;
      this.stats.pigMeals++;
      this.ev('pigeat', { item: best.kind, x: pig.x, z: pig.z });
      if (ITEMS[best.kind] && ITEMS[best.kind].evidence) {
        this.track('heat', -6, 'evt.pig.ate.evidence', 'the pigs ate the evidence');
        this.ev('evidencegone', { how: 'pig' });
      }
    } else if (best && bd < 9) {
      this.walkTo(pig, best.x, best.z, speed, dt);
    } else {
      if (pig.tx == null || Math.hypot(pig.tx - pig.x, pig.tz - pig.z) < 0.6) {
        const wx = 7 + this.ri(17); const wz = 1 + this.ri(9);
        if (!this.blockedAt(wx, wz)) { pig.tx = wx + 0.5; pig.tz = wz + 0.5; }
      }
      if (pig.tx != null) { this.walkTo(pig, pig.tx, pig.tz, speed * 0.7, dt); }
    }
    // pen check: wandered home through open gate
    if (this.gate !== 'broken' && tileAt(pig.x | 0, pig.z | 0) === '_') { pig.loose = false; }
  }

  // ── inspector LOS-ish scan (1 Hz batch below) ────────────────────────────
  inspectorScan() {
    if (!this.inspector.present) { return; }
    const ig = this.guests.find((g) => g.partyId === this.inspector.partyId && g.state !== 'gone');
    if (!ig) { return; }
    for (const s of this.spills) {
      if (Math.hypot(s.x + 0.5 - ig.x, s.z + 0.5 - ig.z) < 6) { this.noteViolation('mess'); break; }
    }
    for (const pig of this.pigs) {
      if (pig.loose && tileAt(pig.x | 0, pig.z | 0) !== '_' && Math.hypot(pig.x - ig.x, pig.z - ig.z) < 7) { this.noteViolation('pig'); break; }
    }
  }

  // ── director (bible §12: authored modules, fairness budgets, seeded) ─────
  directorTick() {
    const d = this.director;
    const phase = this.phaseId();
    const cap = DIRECTOR.budgetByPhase[phase] || 0;
    d.budget = Math.min(cap, d.budget + DIRECTOR.budgetRegenPerSec);
    if (d.valveT > 0) { d.valveT -= 1; }
    for (const k of Object.keys(d.cooldown)) { if (d.cooldown[k] > 0) { d.cooldown[k] -= 1; } }
    // fire pending effects whose telegraph lead elapsed
    for (let i = d.pending.length - 1; i >= 0; i--) {
      const pe = d.pending[i];
      pe.tLeft -= 1;
      if (pe.tLeft <= 0) { d.pending.splice(i, 1); this.fireEvent(pe.key); }
    }
    // ── authored beats first: the shift's shape is not left to a dice roll ──
    // Prep exposes one known fault (bible §7). The weighted path skips atPrep
    // modules entirely, so without this the "something is already broken" line
    // in the opening toast was a lie — dishfault never fired in any seed.
    if (phase === 'prep') {
      if (!d.prepDone && this.time >= DIRECTOR.prepFault.at) {
        d.prepDone = true;
        this.schedule(this.pick(DIRECTOR.prepFault.pool.slice()), 'prep');
      }
      return;
    }
    if (this.over) { return; }
    if (phase === 'last_call') { return; }
    const activeFams = Object.keys(d.famActive).filter((f) => d.famActive[f] > this.time - 45);
    const famOpen = (key) => {
      const e = DIRECTOR_EVENTS[key];
      return e.service || activeFams.includes(e.family)
        || activeFams.length < DIRECTOR.maxActiveFamilies;
    };
    // Compression fails one system; the break point lands one headline. Both are
    // guaranteed and budget-free — the budget buys EXTRA friction, never the plot.
    // A headline still obeys the ≤2 pressure-family rule: if the room is already
    // carrying two disasters it WAITS for a slot rather than piling on a third.
    const hl = DIRECTOR.headline[phase];
    if (hl && !d.headlineDone[phase]) {
      const ph = SHIFT.phases.find((q) => q.id === phase);
      if (this.time - ph.start >= hl.at) {
        const live = hl.pool.filter((k) => (d.used[k] || 0) < DIRECTOR_EVENTS[k].maxPerShift);
        const pool = live.filter(famOpen);
        if (pool.length) {
          d.headlineDone[phase] = true;
          this.schedule(this.pick(pool), 'headline');
          return;
        }
        if (!live.length) { d.headlineDone[phase] = true; } // nothing left to headline with
        else { return; }                                    // wait for a family slot
      }
    }
    // mess feeds intensity: heavy mess and the post-spike valve hold back NEW
    // DISASTERS only. Service keeps arriving — a bar that stops filling because
    // the floor is wet is a spreadsheet, not a Friday night.
    const mess = this.messScore();
    const held = d.valveT > 0 || mess > 26;
    const candidates = [];
    for (const key of Object.keys(DIRECTOR_EVENTS)) {
      const e = DIRECTOR_EVENTS[key];
      if (e.atPrep) { continue; }
      if (held && !e.service) { continue; }
      if (e.phases && !e.phases.includes(phase)) { continue; }
      if ((d.used[key] || 0) >= e.maxPerShift) { continue; }
      if ((d.cooldown[key] || 0) > 0) { continue; }
      if (e.cost > d.budget) { continue; }
      if (!famOpen(key)) { continue; }
      if (e.needsArchetype && !this.parties.some((q) => q.arche === e.needsArchetype && (q.state === 'deciding' || q.state === 'ordered' || q.state === 'eating'))) { continue; }
      candidates.push({ key, e });
    }
    if (!candidates.length) { return; }
    let total = 0;
    for (const c of candidates) { total += c.e.weight; }
    let roll = this.rng() * total;
    let chosen = candidates[0];
    for (const c of candidates) { roll -= c.e.weight; if (roll <= 0) { chosen = c; break; } }
    d.budget -= chosen.e.cost;
    this.schedule(chosen.key, 'budget');
  }

  /** Book a module: bookkeeping, both telegraph channels, then the lead-in wait.
   *  Every path into the disaster web goes through here so the fairness rule
   *  ("announces itself through at least two channels") can never be bypassed. */
  schedule(key, why) {
    const d = this.director;
    const e = DIRECTOR_EVENTS[key];
    if (!e) { return; }
    d.used[key] = (d.used[key] || 0) + 1;
    d.cooldown[key] = e.cooldown;
    if (!e.service) { d.famActive[e.family] = this.time; }
    if (e.cost >= 20) { d.valveT = DIRECTOR.recoveryValveSeconds; }
    this.decisionLog.push({ t: this.time | 0, key, why, seed: this.rngState });
    for (const tg of e.telegraphs) { this.ev('telegraph', { key: tg, event: key }); }
    d.pending.push({ key, tLeft: DIRECTOR.telegraphLeadSeconds });
  }

  fireEvent(key) {
    if (key === 'arrivals') {
      // staffing-aware fairness valve: never bury the crew beyond response reach
      const live = this.parties.filter((q) =>
        q.state === 'arriving' || q.state === 'deciding' || q.state === 'ordered' || q.state === 'complaining').length;
      if (live >= 2 + (3 * this.players.length)) { return; }
      const phase = this.phaseId();
      const pool = phase === 'warm' ? ['tourist', 'tourist', 'oldlocal']
        : phase === 'compression' ? ['tourist', 'influencer', 'techcouple', 'oldlocal']
          : ['tourist', 'influencer', 'techcouple', 'bachelor'];
      this.spawnParty(this.pick(pool));
    } else if (key === 'dishfault') {
      this.dishFault = true; this.ev('dishfault');
    } else if (key === 'fryersmoke') {
      this.fryer.smoking = true; this.fryer.t = 0; this.ev('fryersmoke');
    } else if (key === 'piggate') {
      this.gate = 'broken'; this.ev('gatebreak');
    } else if (key === 'retakewave') {
      const infl = this.parties.find((q) => q.arche === 'influencer' && q.state === 'eating');
      if (infl) {
        infl.state = 'deciding'; infl.decideT = 2;
        this.ev('retakewave', { tableId: infl.tableId });
      }
    } else if (key === 'darewave') {
      const b = this.parties.find((q) => q.arche === 'bachelor' && q.state !== 'leaving');
      if (b) { b.rowdy = true; b.mood -= 1; this.ev('darewave', { tableId: b.tableId }); }
    } else if (key === 'inspector') {
      this.spawnParty('inspector');
    } else if (key === 'tourbus') {
      let spawned = 0;
      for (let i = 0; i < 3; i++) { if (this.spawnParty('tourist')) { spawned++; } }
      if (spawned > 0) {
        this.busClock = TUNING.busClockSeconds;
        const fresh = this.parties.slice(-spawned);
        for (const q of fresh) { q.bus = true; }
        this.ev('tourbus', { parties: spawned });
      }
    } else if (key === 'kegdrop') {
      this.items.push({ id: this.nextId++, kind: 'keg', x: 2.5, z: 3.5 });
      this.items.push({ id: this.nextId++, kind: 'keg', x: 3.5, z: 3.0 });
      this.ev('kegdrop');
    }
  }

  messScore() {
    let m = 0;
    for (const s of this.spills) { m += DIRECTOR.messWeight[s.kind === 'shards' ? 'shards' : 'spill']; }
    for (const pig of this.pigs) { if (pig.loose) { m += DIRECTOR.messWeight.pigLoose; } }
    if (this.fryer.smoking) { m += DIRECTOR.messWeight.smokingFryer; }
    m += this.orders.filter((o) => o.state === 'open').length * DIRECTOR.messWeight.unresolvedOrder;
    return m;
  }

  phaseId() {
    const t = this.time;
    for (const p of SHIFT.phases) { if (t >= p.start && t < p.end) { return p.id; } }
    return 'last_call';
  }

  // ── movement helpers ─────────────────────────────────────────────────────
  blockedAt(x, z) {
    if (!inb(x | 0, z | 0)) { return true; }
    return !WALK[(z | 0) * W + (x | 0)];
  }

  moveActor(a, tx, tz, speed, dt) {
    // straight-line steering with wall slide (guests use A* below)
    const dx = tx - a.x; const dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { return true; }
    const step = Math.min(d, speed * dt);
    const nx = a.x + (dx / d) * step;
    const nz = a.z + (dz / d) * step;
    if (!this.blockedAt(nx, a.z)) { a.x = nx; }
    if (!this.blockedAt(a.x, nz)) { a.z = nz; }
    return Math.hypot(tx - a.x, tz - a.z) < 0.1;
  }

  walkTo(g, tx, tz, speed, dt) {
    if (!g.path || g.pathGoalX !== (tx | 0) || g.pathGoalZ !== (tz | 0)) {
      g.path = this.findPath(g.x | 0, g.z | 0, tx | 0, tz | 0);
      g.pathGoalX = tx | 0; g.pathGoalZ = tz | 0; g.pathI = 0;
    }
    if (!g.path || !g.path.length) { return this.moveActor(g, tx, tz, speed, dt); }
    const node = g.path[Math.min(g.pathI, g.path.length - 1)];
    const gx = g.pathI >= g.path.length ? tx : node.x + 0.5;
    const gz = g.pathI >= g.path.length ? tz : node.z + 0.5;
    if (this.moveActor(g, gx, gz, speed, dt)) {
      if (g.pathI >= g.path.length) { return true; }
      g.pathI++;
    }
    return Math.hypot(tx - g.x, tz - g.z) < 0.35;
  }

  findPath(sx, sz, tx, tz) {
    if (sx === tx && sz === tz) { return []; }
    const open = [{ x: sx, z: sz, g: 0, f: 0, from: null }];
    const seen = new Map();
    seen.set(sz * W + sx, open[0]);
    let goal = null;
    let guard = 0;
    while (open.length && guard++ < 4000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) { if (open[i].f < open[bi].f) { bi = i; } }
      const cur = open.splice(bi, 1)[0];
      if (cur.x === tx && cur.z === tz) { goal = cur; break; }
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dz] of dirs) {
        const nx = cur.x + dx; const nz = cur.z + dz;
        const k = nz * W + nx;
        if (!inb(nx, nz)) { continue; }
        const walkable = WALK[k] || (nx === tx && nz === tz);
        if (!walkable) { continue; }
        // shards cost extra so guests route around glass
        let cost = 1;
        if (this.spills.some((s) => s.kind === 'shards' && s.x === nx && s.z === nz)) { cost = 6; }
        const ng = cur.g + cost;
        const ex = seen.get(k);
        if (ex && ex.g <= ng) { continue; }
        const node = { x: nx, z: nz, g: ng, f: ng + Math.abs(tx - nx) + Math.abs(tz - nz), from: cur };
        seen.set(k, node);
        open.push(node);
      }
    }
    if (!goal) { return null; }
    const path = [];
    for (let n = goal; n && n.from; n = n.from) { path.push({ x: n.x, z: n.z }); }
    path.reverse();
    return path;
  }

  // ── main tick ────────────────────────────────────────────────────────────
  tick() {
    if (this.over) { return; }
    const dt = DT;
    this.time += dt;
    this.frame++;

    // players
    for (const p of this.players) {
      if (p.abilityCd > 0) { p.abilityCd -= dt; }
      if (p.calBoost > 0) { p.calBoost -= dt; }
      // these tick even when downed/busy: you can always shout, and a shove
      // cooldown that froze while stunned let a knocked-down player chain shoves
      if (p.pingCd > 0) { p.pingCd -= dt; }
      if (p.shoveCd > 0 && (p.stun > 0 || p.busy)) { p.shoveCd -= dt; }
      if (p.stun > 0) { p.stun -= dt; continue; }
      if (p.isBot) { this.botTick(p, dt); }
      if (p.busy) {
        p.busy.tLeft -= dt;
        if (p.busy.tLeft <= 0) { const d = p.busy.done; p.busy = null; d(); }
        continue;
      }
      let speed = p.e.speed;
      if (p.carry) {
        speed *= p.carry.kind === 'shotgun' ? TUNING.shotgunSlow
          : p.carry.kind === 'keg' ? (p.calBoost > 0 ? 0.82 : TUNING.kegSlow)
            : p.carry.kind === 'pig' ? TUNING.pigCarrySlow
              : (p.calBoost > 0 ? 1 : TUNING.carrySlow);
      }
      if (p.shoveCd > 0) { p.shoveCd -= dt; }
      if (p.sprint && p.stamina > 0.05) {
        speed *= TUNING.dashMul;
        p.stamina = Math.max(0, p.stamina - dt / TUNING.dashStamina);
      } else {
        p.stamina = Math.min(1, p.stamina + dt / 3);
      }
      const m = Math.hypot(p.mx, p.mz);
      if (m > 0.01) {
        const nx = p.x + (p.mx / m) * speed * dt;
        const nz = p.z + (p.mz / m) * speed * dt;
        if (!this.blockedAt(nx + Math.sign(p.mx) * 0.25, p.z)) { p.x = nx; }
        if (!this.blockedAt(p.x, nz + Math.sign(p.mz) * 0.25)) { p.z = nz; }
        // hustling into a COWORKER is the loudest thing in the building: they
        // stumble, and whatever they were carrying hits the floor. Checked before
        // guests on purpose — the friend collision is the one you want to feel.
        if (p.sprint && p.shoveCd <= 0) {
          for (const q of this.players) {
            if (q.pid === p.pid || q.stun > 0) { continue; }
            if (Math.hypot(q.x - p.x, q.z - p.z) > TUNING.shoveRadius) { continue; }
            const im = Math.hypot(p.mx, p.mz) || 1;
            const qx = q.x + (p.mx / im) * TUNING.crewShoveForce;
            const qz = q.z + (p.mz / im) * TUNING.crewShoveForce;
            if (!this.blockedAt(qx, qz)) { q.x = qx; q.z = qz; }
            q.stun = Math.max(q.stun, TUNING.crewShoveStun);
            if (q.busy) { q.busy = null; }
            p.shoveCd = 1.2;
            const lost = q.carry && q.carry.kind !== 'shotgun' && q.carry.kind !== 'mopheld';
            if (lost) { this.dropCarry(q, false); }
            this.track('chaos', 1, 'evt.crewshove', 'the crew ran into each other');
            this.ev('crewshove', { pid: p.pid, who: q.pid, x: q.x, z: q.z, dropped: !!lost });
            break;
          }
        }
        // hustling through a crowd moves people (and rowdy rooms shove back)
        if (p.sprint && p.shoveCd <= 0) {
          for (const g of this.guests) {
            if (g.state === 'gone' || g.state === 'leaving') { continue; }
            if (Math.hypot(g.x - p.x, g.z - p.z) > TUNING.shoveRadius) { continue; }
            const gx = g.x + (p.mx / (Math.hypot(p.mx, p.mz) || 1)) * TUNING.shoveForce;
            const gz = g.z + (p.mz / (Math.hypot(p.mx, p.mz) || 1)) * TUNING.shoveForce;
            if (!this.blockedAt(gx, gz)) { g.x = gx; g.z = gz; }
            g.slipT = Math.max(g.slipT, 0.6);
            g.path = null;
            p.shoveCd = 1.2;
            const party = this.parties.find((q) => q.id === g.partyId);
            if (party) {
              party.mood -= 1;
              if (party.rowdy && this.rng() < TUNING.shoveBackChance) {
                p.stun = Math.max(p.stun, TUNING.shoveStun);
                if (p.carry && p.carry.kind !== 'shotgun' && p.carry.kind !== 'mopheld') { this.dropCarry(p, false); }
                this.track('chaos', 2, 'evt.shoved', 'the bachelor party shoved back');
                this.ev('shovedback', { pid: p.pid, x: p.x, z: p.z });
              } else {
                this.ev('shove', { x: g.x, z: g.z });
              }
            }
            break;
          }
        }
        const s = this.spills.find((sp) => sp.kind === 'spill' && sp.x === (p.x | 0) && sp.z === (p.z | 0));
        // sprinting with something breakable is its own gamble
        if (p.sprint && p.carry && ITEMS[p.carry.kind] && ITEMS[p.carry.kind].fragile
          && this.rng() < TUNING.fumbleChancePerSec * dt) {
          this.ev('fumble', { pid: p.pid, item: p.carry.kind });
          this.dropCarry(p, false);
        }
        if (s && this.rng() < TUNING.spillSlipChance * dt * (p.sprint ? 2.2 : 1)) {
          // full-speed hustle = a proper knockdown; a walk is just a stumble
          p.stun = p.sprint ? TUNING.knockdownSeconds : 0.8;
          this.ev('slip', { x: p.x, z: p.z, who: 'player', pid: p.pid, hard: p.sprint });
          if (p.carry && p.carry.kind !== 'shotgun' && p.carry.kind !== 'mopheld') { this.dropCarry(p, false); }
        }
      }
    }

    // bodies are solid. Deterministic pairwise separation (array order, no rng)
    // so a coworker can genuinely block the pass-through behind the bar.
    const rr = TUNING.playerRadius * 2;
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i]; const b = this.players[j];
        const dx = b.x - a.x; const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= rr) { continue; }
        const ux = d > 1e-4 ? dx / d : 1; const uz = d > 1e-4 ? dz / d : 0;
        const push = ((rr - d) * 0.5) + 1e-4;
        if (!this.blockedAt(b.x + ux * push, b.z + uz * push)) { b.x += ux * push; b.z += uz * push; }
        if (!this.blockedAt(a.x - ux * push, a.z - uz * push)) { a.x -= ux * push; a.z -= uz * push; }
      }
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].tLeft -= dt;
      if (this.pings[i].tLeft <= 0) { this.pings.splice(i, 1); }
    }

    this.flightTick(dt);
    for (const g of this.guests) { if (g.state !== 'gone') { this.guestTick(g, dt); } }
    for (const party of this.parties) { if (party.state !== 'gone') { this.partyTick(party, dt); } }
    this.ordersTick(dt);
    for (const pig of this.pigs) { this.pigTick(pig, dt); }
    // the bus waits for no burger
    if (this.busClock != null) {
      this.busClock -= dt;
      if (this.busClock <= 0) {
        this.busClock = null;
        for (const q of this.parties) {
          if (!q.bus || q.state === 'leaving' || q.state === 'gone') { continue; }
          if (q.state === 'waitpay' || q.state === 'eating') {
            this.track('cash', Math.round(q.pay || 0), 'evt.bus.cash', 'cash left under a ketchup bottle');
            this.stats.partiesResolved++;
            this.partyLeave(q, 'paid');
          } else {
            this.track('hospitality', TUNING.busUnservedHosp, 'evt.bus.left', 'the bus left them unfed');
            this.stats.walkouts++;
            this.partyLeave(q, 'bus');
          }
        }
        this.ev('busgone');
      }
    }

    // dishwasher drips
    if (this.dishFault) {
      this.dishDripT -= dt;
      if (this.dishDripT <= 0) {
        this.dishDripT = 20;
        const dx = STATIONS.dish.x + (this.ri(3) - 1);
        this.addSpill(dx, STATIONS.dish.z - 1, 'spill');
      }
    }
    // fryer smoke
    if (this.fryer.smoking) {
      this.fryer.t += dt;
      if (this.fryer.t > TUNING.fryerPanicSeconds) {
        this.fryer.t = 12;
        const victim = this.parties.find((q) => q.state !== 'leaving' && q.state !== 'gone');
        if (victim) {
          this.track('chaos', 4, 'evt.smoke', 'smoke cleared a table');
          this.partyLeave(victim, 'smoke');
          this.stats.walkouts++;
        }
      }
    }

    // phase turns are EVENTS, not a changing label: the view gets a beat to
    // score (card + light + audio) and last call converts pressure to closure.
    const ph = this.phaseId();
    if (ph !== this.phasePrev) {
      const from = this.phasePrev;
      this.phasePrev = ph;
      if (from !== null) {
        this.ev('phase', { id: ph, from });
        if (ph === 'last_call') {
          for (const q of this.parties) {
            if (q.state === 'eating') { q.eatT *= DIRECTOR.lastCallEatMul; }
          }
        }
      }
    }

    // 1 Hz batch
    this.director.tick1 -= dt;
    if (this.director.tick1 <= 0) {
      this.director.tick1 = 1;
      this.directorTick();
      this.inspectorScan();
      // heat decays a hair when the gun is stowed and nothing is on fire
      if (this.shotgun.stowed && !this.fryer.smoking && this.tracks.heat > 0 && this.frame % 3 === 0) {
        this.tracks.heat = Math.max(0, this.tracks.heat - 1);
      }
    }

    // shift end
    if (this.time >= SHIFT.duration) { this.endShift(); }
  }

  endShift() {
    this.over = true;
    // inspector files the report at cash-out (bible S03 shape)
    if (this.inspector.present && this.inspector.violations > 0) {
      this.track('heat', 4 * this.inspector.violations, 'evt.inspector.report', this.inspector.violations + ' violation(s) filed');
      this.track('hospitality', -2 * this.inspector.violations, 'evt.inspector.report', 'the report reads badly');
    }
    const resolved = this.stats.partiesResolved;
    const seated = Math.max(1, this.stats.partiesSeated);
    const ratio = resolved / seated;
    const win = this.tracks.cash >= TUNING.registerGoal && ratio >= TUNING.resolveGoalRatio;
    this.result = {
      win, ratio, cash: this.tracks.cash, tracks: { ...this.tracks, journal: undefined },
      journal: this.tracks.journal.slice(),
      stats: { ...this.stats },
      players: this.players.map((p) => ({ key: p.key, ...p.stats })),
      decisionLog: this.decisionLog.slice(),
    };
    this.ev('gameover', { win });
    if (this.cb.gameOver) { this.cb.gameOver(this.result); }
  }

  // ── service brain, shared by the temp bot and the QA autopilot ───────────
  serviceCandidates(p) {
    const out = [];
    const openOrders = this.orders.filter((o) => o.state === 'open');
    if (p.carry && p.carry.kind !== 'mopheld' && p.carry.kind !== 'feed'
      && p.carry.kind !== 'shotgun' && p.carry.kind !== 'keg') {
      const match = openOrders.find((o) => {
        const req = REQUESTS[o.reqKey];
        return p.carry.kind === req.needItem || (req.substitute && p.carry.kind === req.substitute.item);
      });
      if (match) {
        const t = this.tables.find((x) => x.id === match.tableId);
        if (t) { out.push({ x: t.x, z: t.z + 1 }); }
      } else {
        out.push({ drop: true });
      }
      return out;
    }
    if (p.carry && p.carry.kind === 'keg') {
      out.push({ x: STATIONS.taps.x, z: STATIONS.taps.z - 1 });
      return out;
    }
    if (this.tapsKeg <= 0 && !p.carry) {
      const keg = this.items.find((i) => i.kind === 'keg' && !i.fly);
      if (keg) { out.push({ x: keg.x | 0, z: keg.z | 0 }); }
    }
    if (openOrders.length && !p.carry) {
      const urgent = openOrders.slice().sort((a, b) => a.tLeft - b.tLeft)[0];
      const req = REQUESTS[urgent.reqKey];
      const wanted = req.needItem || 'beer';
      let st = Object.values(STATIONS).find((s) => s.makes === wanted)
        || (req.substitute ? Object.values(STATIONS).find((s) => s.makes === req.substitute.item) : null);
      if (st === STATIONS.taps && this.tapsKeg <= 0) { st = null; }
      if (st) { out.push({ x: st.x, z: st.z - 1 }); }
    }
    for (const q of this.parties) {
      if ((q.state === 'deciding' && q.decideT <= 0)
        || q.state === 'waitpay'
        || (q.state === 'complaining' && !this.orders.some((o) => o.partyId === q.id))) {
        const t = this.tables.find((x) => x.partyId === q.id);
        if (t) { out.push({ x: t.x, z: t.z + 1 }); }
      }
    }
    return out;
  }

  // The hired temp: a sim-internal teammate. Deterministic (this.rng only),
  // so bot seats are free in MP — every client simulates the same coworker.
  // Hesitation between jobs keeps it hired-help, not omniscient.
  botTick(p, dt) {
    if (p.busy || p.stun > 0) { return; }
    if (p.botWait > 0) { p.botWait -= dt; return; }
    const cands = this.serviceCandidates(p);
    if (!cands.length) { return; }
    if (cands[0].drop) {
      this.dropCarry(p, true);
      p.botWait = 0.5;
      return;
    }
    let goal = cands[0]; let bd = 1e9;
    for (const c of cands) {
      const d = Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z);
      if (d < bd) { bd = d; goal = c; }
    }
    if ((p.x | 0) === goal.x && (p.z | 0) === goal.z && bd < 0.45) {
      this.doContext(p);
      p.botWait = TUNING.botWaitMin + (this.rng() * (TUNING.botWaitMax - TUNING.botWaitMin));
    } else {
      this.walkTo(p, goal.x + 0.5, goal.z + 0.5, p.e.speed * 0.92, dt);
    }
  }

  // ── QA: deterministic fingerprint (toybox fp pattern) ────────────────────
  fingerprint() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (v * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; };
    for (const p of this.players) { mix(p.x); mix(p.z); mix(p.carry ? 7 : 1); }
    for (const g of this.guests) { if (g.state !== 'gone') { mix(g.x); mix(g.z); } }
    for (const pig of this.pigs) { mix(pig.x); mix(pig.z); }
    mix(this.tracks.cash); mix(this.tracks.heat); mix(this.tracks.hospitality);
    mix(this.orders.length); mix(this.items.length); mix(this.spills.length);
    mix(this.pings.length);
    mix(this.rngState);
    return h.toString(16) + '|' + (this.time | 0) + '|' + this.tracks.journal.length;
  }
}

// ── headless soak (the __ttSoak pattern — the battery workhorse) ──────────
export function soak(opts = {}) {
  const ticks = opts.ticks || SHIFT.duration * TUNING.tickHz + 40;
  const g = new Game({
    seed: opts.seed || 1,
    players: opts.players || [{ employeeKey: 'mara' }],
  });
  const script = opts.script || [];
  let err = null;
  try {
    for (let i = 0; i < ticks && !g.over; i++) {
      for (const s of script) { if (s.t === i) { g.execCommand(s.pid || 0, s.c); } }
      if (opts.autopilot) { autopilot(g); }
      g.tick();
      g.view.length = 0; // headless: drain
    }
  } catch (e) { err = String(e && e.stack || e); }
  return {
    err, over: g.over, fp: g.fingerprint(), time: g.time,
    cash: g.tracks.cash, tracks: { ...g.tracks, journal: undefined },
    journalLen: g.tracks.journal.length,
    stats: { ...g.stats }, result: g.result || null,
    decisionLog: g.decisionLog.slice(),
    ordersFailed: g.orders.filter((o) => o.state === 'failed').length,
    ordersDone: g.orders.filter((o) => o.state === 'done').length,
  };
}

// Tiny deterministic autopilot: greedy nearest-actionable QA driver that
// exercises the whole loop headlessly (take, prep, deliver, collect, keg
// runs). Shares serviceCandidates with the temp bot; unlike the bot it never
// hesitates and consumes no rng — the omniscient baseline.
export function autopilot(g) {
  const p = g.players[0];
  if (p.busy || p.stun > 0) { return; }
  const candidates = g.serviceCandidates(p);
  if (!candidates.length) { g.setInput(0, 0, 0, false); return; }
  if (candidates[0].drop) { g.execCommand(0, { c: 'drop' }); return; }
  let goal = candidates[0]; let bd = 1e9;
  for (const c of candidates) {
    const d = Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z);
    if (d < bd) { bd = d; goal = c; }
  }
  g.setInput(0, 0, 0, false);
  // act only from INSIDE the goal tile — contextOf reach is tile-Manhattan-1,
  // so hovering near the tile edge would spam E at nothing (the frozen-pilot bug)
  if ((p.x | 0) === goal.x && (p.z | 0) === goal.z && bd < 0.45) {
    g.execCommand(0, { c: 'act' });
  } else {
    // QA driver walks the real grid via A* (it tests service logic, not input)
    g.walkTo(p, goal.x + 0.5, goal.z + 0.5, p.e.speed, DT);
  }
}
