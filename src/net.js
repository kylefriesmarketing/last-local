// THE LAST LOCAL — lockstep co-op core (Age of Toys star-topology pattern).
// Deterministic sim + command-passing: only inputs travel; every client
// simulates. TRUE lockstep: every client commits a (possibly empty) command
// list for every tick; the host finalizes a tick only when every live seat
// has spoken, then echoes the merged batch. Nobody runs ahead of the party.
// Transport-agnostic: MemoryHub for tests, a PeerJS adapter for real play.
export const INPUT_DELAY = 6; // ticks of command latency (300ms @ 20Hz)

export class Lockstep {
  constructor({ isHost, myPid, playerCount, send }) {
    this.isHost = isHost;
    this.myPid = myPid;
    this.playerCount = playerCount;
    this.send = send;             // (msg) => void — to host (guest) or broadcast (host)
    this.tick = 0;                // last executed tick
    this.batches = new Map();     // finalized: tick -> [[pid, cmd], ...]
    this.pending = new Map();     // host only: tick -> Map(pid -> cmds[])
    this.left = new Set();        // seats that disconnected
    this.localQueue = [];
    this._committedFor = -1;
    // the first DELAY ticks are sealed empties on every node — no chicken/egg
    for (let t = 1; t <= INPUT_DELAY; t++) { this.batches.set(t, []); }
  }

  /** Buffer a local command; it ships with this tick's commit. */
  queueLocal(cmd) { this.localQueue.push(cmd); }

  /** Once per local tick: flush queued commands for tick+DELAY (empty counts as spoken). */
  commitLocal() {
    if (this._committedFor === this.tick) { return; }
    this._committedFor = this.tick;
    const t = this.tick + INPUT_DELAY + 1;
    const cmds = this.localQueue;
    this.localQueue = [];
    if (this.isHost) {
      this.hostAccept(this.myPid, t, cmds);
    } else {
      this.send({ k: 'cmds', pid: this.myPid, t, cmds });
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
    if (t <= this.tick) { return; } // tick already executed — a reconnect race; drop
    if (!this.pending.has(t)) { this.pending.set(t, new Map()); }
    const slot = this.pending.get(t);
    slot.set(pid, (slot.get(pid) || []).concat(cmds || []));
  }

  markLeft(pid) {
    this.left.add(pid);
    if (this.isHost) {
      this.send({ k: 'left', pid });
      // re-check ticks this seat was blocking
    }
  }

  hostReady(t) {
    const slot = this.pending.get(t);
    for (let pid = 0; pid < this.playerCount; pid++) {
      if (this.left.has(pid)) { continue; }
      if (!slot || !slot.has(pid)) { return false; }
    }
    return true;
  }

  hostFinalize(t) {
    const slot = this.pending.get(t) || new Map();
    const list = [];
    for (let pid = 0; pid < this.playerCount; pid++) {
      if (this.left.has(pid)) { continue; }
      for (const c of (slot.get(pid) || [])) { list.push([pid, c]); }
    }
    this.pending.delete(t);
    this.batches.set(t, list);
    this.send({ k: 'batch', t, list });
  }

  canStep() {
    const t = this.tick + 1;
    if (this.batches.has(t)) { return true; }
    if (this.isHost && this.hostReady(t)) {
      this.hostFinalize(t);
      return true;
    }
    return false;
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
        for (const e of this.nodes) { if (!e.isHost) { e.inbox.push(wire); } }
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
// Verifies every client's fingerprint stays identical under scripted play,
// including a mid-run guest drop.
export function netTest(GameCtor, opts = {}) {
  const seed = opts.seed || 47;
  const ticks = opts.ticks || 1200;
  const playerCount = opts.players || 2; // HUMAN seats (lockstep participants)
  const scripts = opts.scripts || {}; // {pid: [{t, c}...]}
  const dropAt = opts.dropAt || null; // {t, pid}
  const defs = [];
  for (let i = 0; i < playerCount; i++) { defs.push({ employeeKey: i === 0 ? 'mara' : 'jo' }); }
  // bot seats live inside the sim — every client simulates them identically
  for (const d of (opts.extraDefs || [])) { defs.push(d); }

  const hub = new MemoryHub();
  const clients = [];
  for (let pid = 0; pid < playerCount; pid++) {
    const game = new GameCtor({ seed, players: defs });
    const node = new Lockstep({ isHost: pid === 0, myPid: pid, playerCount, send: null });
    hub.attach(node, pid === 0);
    clients.push({ pid, game, node, dropped: false });
  }

  const checkpoints = [];
  for (let w = 0; w < ticks; w++) {
    for (const c of clients) {
      if (c.dropped) { continue; }
      if (dropAt && dropAt.pid === c.pid && w === dropAt.t) {
        c.dropped = true;
        clients[0].node.markLeft(c.pid);
        continue;
      }
      const script = scripts[c.pid] || [];
      for (const s of script) { if (s.t === w) { c.node.queueLocal(s.c); } }
      c.node.commitLocal();
    }
    hub.pump();
    // step everyone whose batch is ready (host finalizes inside canStep)
    for (const c of clients) {
      if (c.dropped) { continue; }
      if (c.node.canStep()) { hub.pump(); c.game.view.length = 0; c.node.execTick(c.game); }
    }
    hub.pump();
    if (w % 300 === 299) {
      checkpoints.push(clients.filter((c) => !c.dropped).map((c) => c.game.fingerprint()));
    }
  }
  const live = clients.filter((c) => !c.dropped);
  const final = live.map((c) => c.game.fingerprint());
  const inSync = final.every((f) => f === final[0])
    && checkpoints.every((cp) => cp.every((f) => f === cp[0]));
  return {
    inSync: inSync === true,
    final,
    checkpoints,
    ticksRun: live.map((c) => c.node.tick),
    cash: live.map((c) => c.game.tracks.cash),
  };
}
