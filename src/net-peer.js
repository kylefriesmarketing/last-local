// THE LAST LOCAL — PeerJS adapter for the lockstep core (toybox net.js
// lineage: star topology, host-dealt seed, hello/seat/roster/start).
// The Lockstep core never knows PeerJS exists — this file only moves JSON.
const PREFIX = 'lastlocal-';

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) { c += A[(Math.random() * A.length) | 0]; }
  return c;
}

async function loadLib() {
  if (window.Peer) { return; }
  const tryLoad = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
  try {
    await tryLoad('lib/peerjs.min.js');
  } catch {
    await tryLoad('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js');
  }
  if (!window.Peer) { throw new Error('PeerJS unavailable (co-op needs internet or lib/peerjs.min.js)'); }
}

export class PeerSession {
  constructor() {
    this.isHost = false;
    this.myPid = 0;
    this.peer = null;
    this.conns = [];        // host: [{conn, pid, emp}]
    this.hostConn = null;   // guest
    this.started = false;
    this.onEvent = null;    // (kind, data) lobby events: code/join/leave/start/error/hostlost
    this.onNetMessage = null; // in-game lockstep messages
  }

  async host(empKey, onEvent) {
    this.isHost = true;
    this.myPid = 0;
    this.emp = empKey;
    this.onEvent = onEvent;
    await loadLib();
    return new Promise((resolve, reject) => {
      const code = randomCode();
      this.code = code;
      this.peer = new window.Peer(PREFIX + code);
      const timeout = setTimeout(() => reject(new Error('Signaling timeout — try again.')), 20000);
      this.peer.on('open', () => { clearTimeout(timeout); onEvent('code', code); resolve({ code }); });
      this.peer.on('error', (e) => { clearTimeout(timeout); onEvent('error', String(e)); reject(e); });
      this.peer.on('connection', (conn) => {
        conn.on('data', (d) => this.hostOnData(conn, d));
        conn.on('close', () => this.hostOnClose(conn));
        conn.on('error', () => this.hostOnClose(conn));
      });
    });
  }

  hostOnData(conn, d) {
    if (!d) { return; }
    if (d.k === 'hello') {
      if (this.started || this.conns.length >= 3) {
        try { conn.send({ k: 'full' }); } catch { /* gone */ }
        return;
      }
      const pid = this.conns.length + 1;
      conn._pid = pid;
      this.conns.push({ conn, pid, emp: d.emp || 'jo' });
      try { conn.send({ k: 'seat', pid }); } catch { /* gone */ }
      this.onEvent && this.onEvent('join', { pid, emp: d.emp });
      return;
    }
    if (this.onNetMessage) { this.onNetMessage(d); }
  }

  hostOnClose(conn) {
    const pid = conn._pid;
    this.conns = this.conns.filter((c) => c.conn !== conn);
    if (pid != null) { this.onEvent && this.onEvent('leave', { pid, started: this.started }); }
  }

  /** Host locks the lobby: everyone (incl. host) gets the same config. */
  start(seed) {
    if (!this.isHost || this.started) { return null; }
    this.started = true;
    const players = [{ employeeKey: this.emp }];
    for (const c of this.conns) { players.push({ employeeKey: c.emp }); }
    const cfg = { seed: seed >>> 0 || ((Math.random() * 99999) | 1), players };
    for (const c of this.conns) { try { c.conn.send({ k: 'start', cfg, pid: c.pid }); } catch { /* gone */ } }
    this.onEvent && this.onEvent('start', { cfg, pid: 0 });
    return cfg;
  }

  async join(code, empKey, onEvent) {
    this.isHost = false;
    this.onEvent = onEvent;
    await loadLib();
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer();
      const timeout = setTimeout(() => reject(new Error('Signaling timeout — check the code.')), 20000);
      this.peer.on('error', (e) => { clearTimeout(timeout); onEvent('error', String(e)); reject(e); });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        this.hostConn = conn;
        conn.on('open', () => { conn.send({ k: 'hello', emp: empKey }); });
        conn.on('data', (d) => {
          if (!d) { return; }
          if (d.k === 'seat') { clearTimeout(timeout); this.myPid = d.pid; onEvent('seated', { pid: d.pid }); resolve({ pid: d.pid }); return; }
          if (d.k === 'full') { clearTimeout(timeout); reject(new Error('Room is full or already started.')); return; }
          if (d.k === 'start') { this.started = true; this.myPid = d.pid; onEvent('start', { cfg: d.cfg, pid: d.pid }); return; }
          if (this.onNetMessage) { this.onNetMessage(d); }
        });
        conn.on('close', () => { onEvent('hostlost', {}); });
        conn.on('error', () => { onEvent('hostlost', {}); });
      });
    });
  }

  /** Lockstep transport: host broadcasts, guest sends to host. */
  sendNet(msg) {
    if (this.isHost) {
      for (const c of this.conns) { try { c.conn.send(msg); } catch { /* dropped; close handler cleans up */ } }
    } else if (this.hostConn) {
      try { this.hostConn.send(msg); } catch { /* hostlost fires via close */ }
    }
  }

  playerCount() { return this.isHost ? this.conns.length + 1 : -1; }
}
