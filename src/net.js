// THE LAST LOCAL — lockstep co-op core (Age of Toys star-topology pattern).
// Deterministic sim + command-passing: only inputs travel; every client
// simulates. Host merges each tick's commands and echoes the finalized batch
// (host executes only echoed batches too — one code path for everyone).
// Transport-agnostic: MemoryHub for tests, a PeerJS adapter for real play.
export const INPUT_DELAY = 6; // ticks of command latency (300ms @ 20Hz)

export class Lockstep {
  constructor({ isHost, myPid, playerCount, send }) {
    this.isHost = isHost;
    this.myPid = myPid;
    this.playerCount = playerCount;
    this.send = send;             // (msg) => void — delivers to host (guest) or broadcast (host)
    this.tick = 0;                // next tick to execute
    this.batches = new Map();     // finalized: tick -> [[pid, cmd], ...]
    this.pending = new Map();     // host only: tick -> Map(pid -> cmds[])
    this.left = new Set();        // seats that disconnected (host stops waiting on them)
  }

  // queue a local command for the future tick everyone will agree on
  queueLocal(cmd) {
    const t = this.tick + INPUT_DELAY;
    if (this.isHost) {
      this.hostAccept(this.myPid, t, [cmd]);
    } else {
      this.send({ k: 'cmds', pid: this.myPid, t, cmds: [cmd] });
    }
  }

  onMessage(msg) {
    if (msg.k === 'cmds' && this.isHost) {
      this.hostAccept(msg.pid, msg.t, msg.cmds);
    } else if (msg.k === 'batch' && !this.isHost) {
      this.batches.set(msg.t, msg.list);
    } else if (msg.k === 'left' && !this.isHost) {
      this.left.add(msg.pid);
    }
  }

  hostAccept(pid, t, cmds) {
    if (t < this.tick + 1) { return; } // too late — drop (sender lagged badly)
    if (!this.pending.has(t)) { this.pending.set(t, new Map()); }
    const slot = this.pending.get(t);
    if (!slot.has(pid)) { slot.set(pid, []); }
    for (const c of cmds) { slot.get(pid).push(c); }
  }

  markLeft(pid) {
    this.left.add(pid);
    if (this.isHost) { this.send({ k: 'left', pid }); }
  }

  // host finalizes tick t when every live seat has spoken (empty counts after finalize call)
  hostFinalize(t) {
    const slot = this.pending.get(t) || new Map();
    const list = [];
    for (let pid = 0; pid < this.playerCount; pid++) {
      if (this.left.has(pid)) { continue; }
      const cmds = slot.get(pid) || [];
      for (const c of cmds) { list.push([pid, c]); }
    }
    this.pending.delete(t);
    this.batches.set(t, list);
    this.send({ k: 'batch', t, list });
  }

  canStep() {
    const t = this.tick + 1;
    if (this.isHost) {
      if (!this.batches.has(t)) { this.hostFinalize(t); }
      return true;
    }
    return this.batches.has(t);
  }

  execTick(game) {
    const t = this.tick + 1;
    const list = this.batches.get(t) || [];
    for (const [pid, cmd] of list) { game.execCommand(pid, cmd); }
    this.batches.delete(t);
    game.tick();
    this.tick = t;
  }
}

// ── in-memory transport for the authoritative determinism test ─────────────
export class MemoryHub {
  constructor() { this.nodes = []; }

  attach(node, isHost) {
    const entry = { node, isHost, inbox: [] };
    this.nodes.push(entry);
    node.send = (msg) => {
      const wire = JSON.parse(JSON.stringify(msg)); // enforce serializability
      if (isHost) {
        for (const e of this.nodes) { e.inbox.push(wire); }
      } else {
        const host = this.nodes.find((e) => e.isHost);
        if (host) { host.inbox.push(wire); }
      }
    };
  }

  pump() {
    let moved = false;
    for (const e of this.nodes) {
      while (e.inbox.length) {
        moved = true;
        e.node.onMessage(e.inbox.shift());
      }
    }
    return moved;
  }
}

// ── the __ttNetTest equivalent: N real Lockstep nodes over N real Games ────
// Verifies every client's fingerprint stays identical under scripted play.
export function netTest(GameCtor, opts = {}) {
  const seed = opts.seed || 47;
  const ticks = opts.ticks || 1200;
  const playerCount = opts.players || 2;
  const scripts = opts.scripts || {}; // {pid: [{t, c}...]}
  const defs = [];
  for (let i = 0; i < playerCount; i++) { defs.push({ employeeKey: i === 0 ? 'mara' : 'jo' }); }

  const hub = new MemoryHub();
  const clients = [];
  for (let pid = 0; pid < playerCount; pid++) {
    const game = new GameCtor({ seed, players: defs });
    const node = new Lockstep({ isHost: pid === 0, myPid: pid, playerCount, send: null });
    hub.attach(node, pid === 0);
    clients.push({ pid, game, node });
  }

  const checkpoints = [];
  for (let t = 0; t < ticks; t++) {
    // local command queues fire by wall tick
    for (const c of clients) {
      const script = scripts[c.pid] || [];
      for (const s of script) { if (s.t === t) { c.node.queueLocal(s.c); } }
    }
    hub.pump();
    // everyone steps when their batch arrives (host finalizes on demand)
    for (const c of clients) {
      if (c.node.canStep()) { hub.pump(); }
    }
    hub.pump();
    for (const c of clients) {
      if (c.node.canStep()) { c.game.view.length = 0; c.node.execTick(c.game); }
    }
    hub.pump();
    if (t % 300 === 299) {
      checkpoints.push(clients.map((c) => c.game.fingerprint()));
    }
  }
  const final = clients.map((c) => c.game.fingerprint());
  const inSync = final.every((f) => f === final[0])
    && checkpoints.every((cp) => cp.every((f) => f === cp[0]));
  return {
    inSync: inSync === true,
    final,
    checkpoints,
    ticksRun: clients.map((c) => c.node.tick),
    cash: clients.map((c) => c.game.tracks.cash),
  };
}
