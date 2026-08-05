// THE LAST LOCAL — node test battery. Run: node tests/run.mjs
// The sim is pure JS, so the whole game loop runs headless here.
import {
  SHIFT, LAYOUT, TABLES, STATIONS, PLAYER_SPAWNS, GUEST_SPAWN, PEN_GATE,
  REQUESTS, ARCHETYPES, DIRECTOR_EVENTS, DIRECTOR, TUNING,
} from '../src/data.js';
import { Game, soak, autopilot, tileAt, DT } from '../src/sim.js';
import { netTest, INPUT_DELAY } from '../src/net.js';

let pass = 0; let fail = 0; const failures = [];
function T(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; failures.push(name + ': ' + e.message); console.log('  FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) { throw new Error((msg || 'eq') + ` (${a} !== ${b})`); } }
function ok(v, msg) { if (!v) { throw new Error(msg || 'expected truthy'); } }
function near(a, b, eps, msg) { if (Math.abs(a - b) > eps) { throw new Error((msg || 'near') + ` (${a} vs ${b})`); } }

console.log('== map integrity ==');
T('layout rows are uniform width', () => {
  for (const row of LAYOUT) { eq(row.length, LAYOUT[0].length, 'row width'); }
});
T('every station is reachable from player spawn', () => {
  const g = new Game({ seed: 1 });
  const s0 = PLAYER_SPAWNS[0];
  for (const key of Object.keys(STATIONS)) {
    const st = STATIONS[key];
    // reachable = some walkable neighbor of the station tile has a path
    const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => ({ x: st.x + dx, z: st.z + dz }))
      .filter((n) => !g.blockedAt(n.x, n.z));
    ok(nbrs.length > 0, key + ' has no walkable neighbor');
    const path = g.findPath(s0.x, s0.z, nbrs[0].x, nbrs[0].z);
    ok(path !== null, key + ' unreachable from spawn');
  }
});
T('every table seat is reachable from the guest spawn', () => {
  const g = new Game({ seed: 1 });
  for (const t of g.tables) {
    ok(t.seats.length >= 2, 'table ' + t.id + ' needs 2+ seats');
    for (const seat of t.seats) {
      const path = g.findPath(GUEST_SPAWN.x, GUEST_SPAWN.z, seat.x, seat.z);
      ok(path !== null, `table ${t.id} seat (${seat.x},${seat.z}) unreachable`);
    }
  }
});
T('pen gate connects pen mud to the floor', () => {
  eq(tileAt(PEN_GATE.x, PEN_GATE.z), 'G', 'gate glyph');
  const g = new Game({ seed: 1 });
  const path = g.findPath(2, 7, PLAYER_SPAWNS[0].x, PLAYER_SPAWNS[0].z);
  ok(path !== null, 'pen cut off from bar');
});

console.log('== determinism ==');
T('same seed, same rng stream', () => {
  const a = new Game({ seed: 42 }); const b = new Game({ seed: 42 });
  for (let i = 0; i < 10; i++) { eq(a.rng(), b.rng(), 'rng ' + i); }
});
T('same seed + script => identical fingerprint at 1200 ticks', () => {
  const script = [
    { t: 40, c: { c: 'in', mx: 1, mz: 0 } }, { t: 120, c: { c: 'in', mx: 0, mz: -1 } },
    { t: 200, c: { c: 'act' } }, { t: 400, c: { c: 'in', mx: -1, mz: 0.5 } },
    { t: 700, c: { c: 'act' } }, { t: 900, c: { c: 'in', mx: 0, mz: 0 } },
  ];
  const a = soak({ seed: 7, ticks: 1200, script });
  const b = soak({ seed: 7, ticks: 1200, script });
  eq(a.err, null, 'a err: ' + a.err);
  eq(a.fp, b.fp, 'fingerprints diverged');
});
T('different seed diverges', () => {
  const a = soak({ seed: 7, ticks: 2400 });
  const b = soak({ seed: 8, ticks: 2400 });
  ok(a.fp !== b.fp, 'seeds should diverge');
});

console.log('== tracks ==');
T('track delta without cause throws (no hidden scoring)', () => {
  const g = new Game({ seed: 1 });
  let threw = false;
  try { g.track('heat', 5, null, 'x'); } catch (e) { threw = true; }
  ok(threw, 'must throw');
});
T('bounded tracks clamp, journal records applied', () => {
  const g = new Game({ seed: 1 });
  g.track('heat', 500, 'evt.test', 'big');
  eq(g.tracks.heat, 100, 'clamp high');
  g.track('heat', -500, 'evt.test', 'down');
  eq(g.tracks.heat, 0, 'clamp low');
  ok(g.tracks.journal.length === 2, 'journal len');
  ok(g.tracks.journal.every((j) => j.cause === 'evt.test'), 'causes kept');
});

console.log('== full-shift soaks ==');
const SEEDS = [11, 31, 47, 101, 202, 303];
for (const seed of SEEDS) {
  T('soak seed ' + seed + ' completes clean', () => {
    const r = soak({ seed, autopilot: true });
    eq(r.err, null, 'err: ' + r.err);
    ok(r.over, 'shift must conclude');
    ok(r.result, 'result present');
    ok(r.decisionLog.length >= 3, 'director made decisions (' + r.decisionLog.length + ')');
    ok(r.journalLen > 0, 'journal has attributed deltas');
  });
}
T('autopilot actually plays: orders resolve and cash lands', () => {
  let done = 0; let cash = 0;
  for (const seed of SEEDS) {
    const r = soak({ seed, autopilot: true });
    done += r.ordersDone; cash += r.cash;
  }
  ok(done >= 6, 'autopilot resolved orders across seeds (' + done + ')');
  ok(cash > 0, 'cash earned (' + cash + ')');
});

console.log('== director fairness ==');
T('telegraphs precede every director effect by the lead time', () => {
  const g = new Game({ seed: 47 });
  const telegraphs = []; const effects = [];
  const effectKinds = { dishfault: 1, fryersmoke: 1, gatebreak: 1, retakewave: 1, darewave: 1 };
  const ticks = SHIFT.duration * TUNING.tickHz;
  for (let i = 0; i < ticks && !g.over; i++) {
    g.tick();
    for (const e of g.view) {
      if (e.kind === 'telegraph') { telegraphs.push(e); }
      if (effectKinds[e.kind]) { effects.push(e); }
    }
    g.view.length = 0;
  }
  for (const ef of effects) {
    const warned = telegraphs.some((tg) => tg.t < ef.t && ef.t - tg.t <= DIRECTOR.telegraphLeadSeconds + 2);
    ok(warned, ef.kind + ' fired without telegraph');
  }
});
T('at most two pressure families active (decision log audit)', () => {
  const r = soak({ seed: 31, autopilot: true });
  const windows = [];
  for (const d of r.decisionLog) {
    const fam = DIRECTOR_EVENTS[d.key].family;
    windows.push({ t: d.t, fam });
  }
  for (const w of windows) {
    const active = new Set(windows.filter((o) => o.t <= w.t && o.t > w.t - 45).map((o) => o.fam));
    ok(active.size <= DIRECTOR.maxActiveFamilies, 'families ' + [...active].join(',') + ' at t=' + w.t);
  }
});
T('exact seed reproduces director choices', () => {
  const a = soak({ seed: 202, autopilot: true });
  const b = soak({ seed: 202, autopilot: true });
  eq(JSON.stringify(a.decisionLog), JSON.stringify(b.decisionLog), 'decision logs differ');
});

console.log('== the Regulator ==');
T('firing the shotgun is loud, costly, and clears the room', () => {
  const g = new Game({ seed: 5 });
  g.time = 200; // warm
  ok(g.spawnParty('tourist'), 'party seated');
  ok(g.spawnParty('influencer'), 'influencer seated');
  for (let i = 0; i < 200; i++) { g.tick(); g.view.length = 0; }
  const p = g.players[0];
  g.shotgun.stowed = false; p.carry = { kind: 'shotgun' };
  const heatBefore = g.tracks.heat;
  g.execCommand(0, { c: 'fire' });
  ok(g.tracks.heat >= heatBefore + TUNING.shotgunHeat - 1, 'heat spiked');
  ok(g.tracks.journal.some((j) => j.cause === 'evt.gun.fired'), 'attributed');
  ok(g.parties.every((q) => q.state === 'leaving' || q.state === 'gone'), 'everyone flees');
  eq(g.shotgun.shells, TUNING.shotgunShells - 1, 'shell spent');
});
T('empty gun clicks, does nothing', () => {
  const g = new Game({ seed: 5 });
  const p = g.players[0];
  g.shotgun.stowed = false; p.carry = { kind: 'shotgun' }; g.shotgun.shells = 0;
  const heatBefore = g.tracks.heat;
  g.execCommand(0, { c: 'fire' });
  eq(g.tracks.heat, heatBefore, 'no heat on click');
});

console.log('== pigs ==');
T('broken gate frees pigs; pigs eat floor food; evidence can be pig-eaten', () => {
  const g = new Game({ seed: 9 });
  g.gate = 'broken';
  g.tracks.heat = 20; // evidence exists because something already went wrong
  g.items.push({ id: 900, kind: 'burger', x: 9.5, z: 5.5 });
  g.items.push({ id: 901, kind: 'phone', x: 10.5, z: 6.5 });
  let ate = 0;
  for (let i = 0; i < 20 * 120 && ate < 2; i++) {
    g.tick();
    for (const e of g.view) { if (e.kind === 'pigeat') { ate++; } }
    g.view.length = 0;
  }
  ok(g.pigs.some((p) => p.loose) || ate > 0, 'pigs got out');
  ok(ate >= 2, 'pigs ate both items (' + ate + ')');
  ok(g.tracks.journal.some((j) => j.cause === 'evt.pig.ate.evidence'), 'the pigs ate the evidence (attributed)');
});
T('feed lure + gate repair recovers the pen', () => {
  const g = new Game({ seed: 9 });
  g.gate = 'broken';
  for (let i = 0; i < 20 * 20; i++) { g.tick(); g.view.length = 0; }
  ok(g.pigs.some((p) => p.loose), 'pigs loose');
  const p = g.players[0];
  p.carry = { kind: 'feed' };
  // walk the player into the pen with the feed; pigs should follow, then repair
  p.x = 2.5; p.z = 7.5;
  for (let i = 0; i < 20 * 30 && g.pigs.some((q) => q.loose); i++) { g.tick(); g.view.length = 0; }
  g.gate = 'closed';
  for (let i = 0; i < 20 * 10; i++) { g.tick(); g.view.length = 0; }
  ok(g.pigs.every((q) => !q.loose), 'pigs home');
});

console.log('== service paths ==');
T('substitution can both succeed and get caught (seed sweep)', () => {
  let caught = false; let slipped = false;
  for (let seed = 1; seed <= 40 && !(caught && slipped); seed++) {
    const g = new Game({ seed });
    ok(g.spawnParty('techcouple'), 'seat techcouple');
    const party = g.parties[0];
    party.state = 'ordered';
    const tbl = g.tables.find((t) => t.id === party.tableId);
    const ord = { id: 999, tableId: tbl.id, partyId: party.id, reqKey: 'rangeoat', state: 'open', tLeft: 60, total: 80 };
    g.orders.push(ord);
    const p = g.players[0];
    p.carry = { kind: 'coffee' };
    g.deliver(p, tbl, ord);
    if (ord.state === 'done') { slipped = true; } else { caught = true; }
  }
  ok(slipped, 'substitution never succeeded in 40 seeds');
  ok(caught, 'substitution never got caught in 40 seeds');
});
T('honest path resolves, payment lands with attribution', () => {
  const g = new Game({ seed: 3 });
  ok(g.spawnParty('oldlocal'), 'seat local');
  const party = g.parties[0];
  const tbl = g.tables.find((t) => t.id === party.tableId);
  const ord = { id: 999, tableId: tbl.id, partyId: party.id, reqKey: 'beer', state: 'open', tLeft: 60, total: 75 };
  g.orders.push(ord);
  const p = g.players[0];
  p.carry = { kind: 'beer' };
  g.deliver(p, tbl, ord);
  eq(ord.state, 'done', 'order resolved');
  party.eatT = 0.01;
  g.tick();
  eq(party.state, 'waitpay', 'party waits to pay');
  g.collect(p, tbl, party);
  ok(g.tracks.cash > 0, 'cash collected');
  ok(g.tracks.journal.some((j) => j.key === 'loyalty' && j.amount > 0), 'local loyalty attributed');
});

console.log('== the throw verb ==');
T('a thrown fragile beer breaks into shards on a hard landing', () => {
  const g = new Game({ seed: 5 });
  const p = g.players[0];
  p.x = 9.5; p.z = 5.5; p.fx = 1; p.fz = 0; // facing open floor east
  p.carry = { kind: 'beer' };
  g.execCommand(0, { c: 'throw', p: 1 });
  ok(g.items.some((i) => i.fly), 'item is airborne');
  for (let i = 0; i < 60; i++) { g.tick(); g.view.length = 0; }
  ok(!g.items.some((i) => i.kind === 'beer'), 'beer gone');
  ok(g.spills.some((s) => s.kind === 'shards'), 'shards on the floor');
  ok(g.tracks.journal.some((j) => j.cause === 'evt.throw.break'), 'break attributed');
});
T('a soft-tossed burger survives and becomes pig bait', () => {
  const g = new Game({ seed: 5 });
  const p = g.players[0];
  p.x = 9.5; p.z = 5.5; p.fx = 1; p.fz = 0;
  p.carry = { kind: 'burger' };
  g.execCommand(0, { c: 'throw', p: 0.2 });
  for (let i = 0; i < 60; i++) { g.tick(); g.view.length = 0; }
  ok(g.items.some((i) => i.kind === 'burger' && !i.fly), 'burger landed intact');
});
T('a teammate with free hands catches a thrown item', () => {
  const g = new Game({ seed: 5, players: [{ employeeKey: 'mara' }, { employeeKey: 'jo' }] });
  const p0 = g.players[0]; const p1 = g.players[1];
  p0.x = 8.5; p0.z = 5.5; p0.fx = 1; p0.fz = 0;
  p1.x = 12.5; p1.z = 5.5; p1.carry = null;
  p0.carry = { kind: 'burger' };
  g.execCommand(0, { c: 'throw', p: 0.55 });
  let caught = false;
  for (let i = 0; i < 60 && !caught; i++) {
    g.tick();
    for (const e of g.view) { if (e.kind === 'catch') { caught = true; } }
    g.view.length = 0;
  }
  ok(caught, 'catch event fired');
  eq(p1.carry && p1.carry.kind, 'burger', 'jo holds the burger');
});
T('rough delivery: a thrown match lands at the table and serves it (badly)', () => {
  const g = new Game({ seed: 3 });
  ok(g.spawnParty('tourist'), 'party seated');
  const party = g.parties[0];
  const tbl = g.tables.find((t) => t.id === party.tableId);
  party.state = 'ordered';
  const ord = { id: 999, tableId: tbl.id, partyId: party.id, reqKey: 'beer', state: 'open', tLeft: 60, total: 75 };
  g.orders.push(ord);
  const p = g.players[0];
  // stand two tiles south of the table, face it, lob
  p.x = tbl.x + 0.5; p.z = tbl.z + 2.5; p.fx = 0; p.fz = -1;
  p.carry = { kind: 'beer' };
  g.execCommand(0, { c: 'throw', p: 0.32 });
  for (let i = 0; i < 60 && ord.state === 'open'; i++) { g.tick(); g.view.length = 0; }
  eq(ord.state, 'done', 'order resolved by air mail');
  eq(ord.path, 'thrown', 'path recorded');
  ok(party.satisfied <= 0.45, 'satisfaction capped for aggressive service');
});
T('bonking a guest costs hospitality and gets filmed sometimes', () => {
  let bonked = false;
  for (let seed = 1; seed <= 10 && !bonked; seed++) {
    const g = new Game({ seed });
    ok(g.spawnParty('influencer'), 'seat');
    // walk guests in a few ticks so one is on the floor mid-room
    for (let i = 0; i < 40; i++) { g.tick(); g.view.length = 0; }
    const target = g.guests.find((x) => x.state !== 'gone');
    if (!target) { continue; }
    const p = g.players[0];
    p.x = target.x - 2; p.z = target.z; p.fx = 1; p.fz = 0;
    p.carry = { kind: 'burger' };
    g.execCommand(0, { c: 'throw', p: 0.5 });
    for (let i = 0; i < 40; i++) {
      g.tick();
      for (const e of g.view) { if (e.kind === 'bonk') { bonked = true; } }
      g.view.length = 0;
    }
    if (bonked) {
      ok(g.tracks.journal.some((j) => j.cause === 'evt.bonk'), 'bonk attributed');
    }
  }
  ok(bonked, 'no bonk landed in 10 seeds');
});
T('sprint slip is a real knockdown', () => {
  const g = new Game({ seed: 7 });
  const p = g.players[0];
  g.addSpill(9, 12, 'spill');
  p.x = 9.5; p.z = 12.5;
  g.setInput(0, 1, 0, true); // sprinting through the puddle
  let hard = false;
  for (let i = 0; i < 400 && !hard; i++) {
    p.x = 9.5; p.z = 12.5; // keep them in the puddle until physics wins
    g.tick();
    for (const e of g.view) { if (e.kind === 'slip' && e.hard) { hard = true; } }
    g.view.length = 0;
  }
  ok(hard, 'hard slip fired');
  ok(g.players[0].stun > 1.0, 'knockdown stun applied (' + g.players[0].stun.toFixed(2) + ')');
});

console.log('== the tour bus ==');
T('tour bus seats three parties, the clock pays or punishes, then leaves', () => {
  const g = new Game({ seed: 13 });
  g.time = 400; // compression
  g.fireEvent('tourbus');
  const bus = g.parties.filter((q) => q.bus);
  eq(bus.length, 3, 'three bus parties');
  ok(g.busClock > 0, 'clock running');
  // serve none; run the clock out
  for (let i = 0; i < 20 * 80; i++) { g.tick(); g.view.length = 0; }
  ok(g.busClock === null, 'clock expired');
  ok(bus.every((q) => q.state === 'leaving' || q.state === 'gone'), 'bus parties left');
  const busHits = g.tracks.journal.filter((j) => j.cause === 'evt.bus.left');
  ok(busHits.length >= 1, 'unserved bus penalty attributed (' + busHits.length + ')');
});
T('throw commands stay deterministic across the wire', () => {
  const scripts = {
    0: [{ t: 60, c: { c: 'in', mx: 1, mz: 0 } }, { t: 120, c: { c: 'in', mx: 0, mz: 0 } }, { t: 140, c: { c: 'throw', p: 0.8 } }],
    1: [{ t: 90, c: { c: 'in', mx: 0, mz: -1 } }, { t: 200, c: { c: 'throw', p: 0.3 } }],
  };
  const a = netTest(Game, { seed: 77, ticks: 900, players: 2, scripts });
  const b = netTest(Game, { seed: 77, ticks: 900, players: 2, scripts });
  ok(a.inSync === true, 'clients diverged');
  eq(a.final[0], b.final[0], 'runs differ');
});

console.log('== lockstep co-op (the __ttNetTest doctrine) ==');
T('2 clients stay byte-identical across a scripted co-op run', () => {
  const scripts = {
    0: [{ t: 60, c: { c: 'in', mx: 1, mz: 0 } }, { t: 200, c: { c: 'act' } }, { t: 400, c: { c: 'in', mx: 0, mz: 0 } }],
    1: [{ t: 80, c: { c: 'in', mx: 0, mz: -1 } }, { t: 260, c: { c: 'act' } }, { t: 500, c: { c: 'in', mx: 0.5, mz: 0.5 } }],
  };
  const r = netTest(Game, { seed: 47, ticks: 1500, players: 2, scripts });
  ok(r.inSync === true, 'clients diverged: ' + JSON.stringify(r.final));
  eq(r.ticksRun[0], r.ticksRun[1], 'tick counts differ');
  ok(r.ticksRun[0] >= 1500 - INPUT_DELAY - 2, 'ran the full window (' + r.ticksRun[0] + ')');
});
T('4 clients stay in sync', () => {
  const r = netTest(Game, { seed: 101, ticks: 900, players: 4, scripts: {
    2: [{ t: 100, c: { c: 'in', mx: -1, mz: 0 } }],
    3: [{ t: 150, c: { c: 'ability' } }],
  } });
  ok(r.inSync === true, 'clients diverged: ' + JSON.stringify(r.final));
});
T('different scripts change the outcome (commands really travel)', () => {
  const a = netTest(Game, { seed: 47, ticks: 800, players: 2, scripts: { 0: [{ t: 60, c: { c: 'in', mx: 1, mz: 0 } }] } });
  const b = netTest(Game, { seed: 47, ticks: 800, players: 2, scripts: { 0: [{ t: 60, c: { c: 'in', mx: -1, mz: 0 } }] } });
  ok(a.final[0] !== b.final[0], 'scripts should diverge outcomes');
});
T('a mid-run guest drop does not stall or desync the survivors', () => {
  const r = netTest(Game, { seed: 31, ticks: 1000, players: 3,
    scripts: { 1: [{ t: 50, c: { c: 'in', mx: 1, mz: 0 } }] },
    dropAt: { t: 400, pid: 2 } });
  ok(r.inSync === true, 'survivors diverged: ' + JSON.stringify(r.final));
  ok(r.ticksRun[0] >= 1000 - INPUT_DELAY - 2, 'host stalled after drop (' + r.ticksRun[0] + ')');
});

console.log('== win/loss shape ==');
T('endShift stamps a result with journal + decisions', () => {
  const r = soak({ seed: 101, autopilot: true });
  ok(r.result, 'result');
  ok(typeof r.result.win === 'boolean', 'win flag');
  ok(r.result.journal.length > 0, 'journal in result');
  ok(Array.isArray(r.result.decisionLog), 'decision log in result');
});

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => '  FAIL ' + f).join('\n')); process.exit(1); }
