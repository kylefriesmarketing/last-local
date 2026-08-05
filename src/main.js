// THE LAST LOCAL — boot/loop/input. Restart = location.reload (NO same-page
// restarts, learned the hard way on Age of Toys). Input reaches the sim ONLY
// through queueCmd: solo = execCommand direct; co-op = lockstep relay. The
// sim cannot tell the difference — that is the whole design.
import { Game, soak, autopilot, DT } from './sim.js';
import { EMPLOYEES } from './data.js';
import { Lockstep } from './net.js';
import { PeerSession } from './net-peer.js';
import { View } from './render.js';
import { Hud } from './ui.js';
import * as sfx from './sfx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

let game = null;
let view = null;
let hud = null;
let mp = null; // { session, lockstep, myPid }
let chosenEmp = params.get('emp') || 'mara';
const autoMode = params.get('auto') === '1';
const fpLog = new Map(); // tick -> fingerprint (MP desync tripwire)

// ── menu ───────────────────────────────────────────────────────────────────
function buildMenu() {
  const row = $('emp-row');
  for (const key of Object.keys(EMPLOYEES)) {
    const e = EMPLOYEES[key];
    const el = document.createElement('div');
    el.className = 'emp' + (key === chosenEmp ? ' sel' : '');
    el.innerHTML = `<b>${e.label}</b><i>${e.role}</i><s>Q: ${e.abilityLabel}</s>`;
    el.title = e.abilityDesc + '\n' + e.stake;
    el.onclick = () => {
      chosenEmp = key;
      for (const c of row.children) { c.classList.remove('sel'); }
      el.classList.add('sel');
    };
    row.appendChild(el);
  }
  $('start').onclick = () => { sfx.unlock(); startSolo(); };
  $('host-btn').onclick = () => { sfx.unlock(); hostCoop(); };
  $('join-btn').onclick = () => { sfx.unlock(); joinCoop($('join-code').value.trim()); };
  $('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { joinCoop($('join-code').value.trim()); }
    e.stopPropagation();
  });
}

function lobbyLine(html, showStart) {
  $('coop-row').style.display = 'none';
  $('start').style.display = 'none';
  $('lobby').style.display = 'block';
  $('lobby-line').innerHTML = html;
  $('mp-start').style.display = showStart ? 'inline-block' : 'none';
}

// ── co-op lobby ────────────────────────────────────────────────────────────
let session = null;
let joinedCount = 0;

async function hostCoop() {
  if (session || game) { return; }
  session = new PeerSession();
  lobbyLine('Opening the room…', false);
  try {
    await session.host(chosenEmp, onLobbyEvent);
  } catch (e) {
    lobbyFail(e);
  }
}

async function joinCoop(code) {
  if (session || game || !code || code.length < 4) { return; }
  session = new PeerSession();
  lobbyLine('Knocking on the door…', false);
  try {
    await session.join(code, chosenEmp, onLobbyEvent);
  } catch (e) {
    lobbyFail(e);
  }
}

function lobbyFail(e) {
  lobbyLine('❌ ' + (e && e.message ? e.message : e) + '<br><a href="' + location.pathname + '" style="color:var(--amber)">back</a>', false);
  session = null;
}

function onLobbyEvent(kind, data) {
  if (kind === 'code') {
    window.__llCode = data;
    lobbyLine('ROOM <b>' + data + '</b><br>Friends join with this code. Party of ' + (joinedCount + 1) + '.', false);
    $('mp-start').onclick = () => {
      const cfg = session.start(parseInt(params.get('seed'), 10) || 0);
      if (cfg) { beginGame(cfg, 0, true); }
    };
  } else if (kind === 'join') {
    joinedCount++;
    lobbyLine('ROOM <b>' + session.code + '</b><br>Party of ' + (joinedCount + 1) + ' — ready when you are.', true);
    if (params.get('autostart2') === '1') { $('mp-start').onclick(); }
  } else if (kind === 'seated') {
    lobbyLine('Seated as <b>P' + (data.pid + 1) + '</b>. Waiting for the host to start…', false);
  } else if (kind === 'start') {
    beginGame(data.cfg, data.pid, true);
  } else if (kind === 'leave') {
    if (!data.started) {
      joinedCount = Math.max(0, joinedCount - 1);
      lobbyLine('ROOM <b>' + session.code + '</b><br>Party of ' + (joinedCount + 1) + '.', joinedCount > 0);
    } else if (mp) {
      mp.lockstep.markLeft(data.pid);
      hud && hud.toast('👋 P' + (data.pid + 1) + ' dropped — their toy goes quiet.', 'warn');
    }
  } else if (kind === 'hostlost') {
    if (hud) { hud.toast('☎️ Lost the host. The night ends here.', 'warn'); }
    if (game) { game.over = true; }
  } else if (kind === 'error') {
    console.warn('[net]', data);
  }
}

// ── game start (once per page load) ────────────────────────────────────────
function startSolo() {
  if (game) { return; }
  const seed = parseInt(params.get('seed'), 10) || ((Math.random() * 99999) | 1);
  beginGame({ seed, players: [{ employeeKey: chosenEmp }] }, 0, false);
}

function beginGame(cfg, myPid, isMp) {
  if (game) { return; }
  game = new Game({
    seed: cfg.seed,
    players: cfg.players,
    cb: { gameOver: (result) => onGameOver(result, cfg.seed) },
  });
  if (isMp) {
    const lockstep = new Lockstep({
      isHost: session.isHost,
      myPid,
      playerCount: cfg.players.length,
      send: (m) => session.sendNet(m),
    });
    session.onNetMessage = (m) => {
      if (m.k === 'fp') { checkRemoteFp(m); return; }
      lockstep.onMessage(m);
    };
    mp = { session, lockstep, myPid };
    window.__llMp = () => ({ tick: lockstep.tick, pid: myPid, players: cfg.players.length, fps: [...fpLog.entries()].slice(-3) });
  }
  view = new View($('c'));
  view.build(game);
  hud = new Hud();
  hud.show();
  $('menu').style.display = 'none';
  hud.toast('🌲 Copperhead, Montana. Friday. Seed ' + cfg.seed + (isMp ? ' — party of ' + cfg.players.length : '') + '.');
  hud.toast('🔎 Prep: something is already broken. Find it.');
  window.__llGame = game;
  window.__llView = view;
  runLoops();
}

function onGameOver(result, seed) {
  sfx.cue('gameover');
  hud.aftermath(result, game);
  $('again').onclick = () => { location.href = location.pathname + '?emp=' + chosenEmp; };
  $('sameseed').onclick = () => { location.href = location.pathname + '?emp=' + chosenEmp + '&seed=' + seed; };
}

// ── MP fingerprint tripwire (netTest proves determinism; this catches drift) ─
function recordFp(tick) {
  if (tick % 100 !== 0) { return; }
  const fp = game.fingerprint();
  fpLog.set(tick, fp);
  if (fpLog.size > 12) { fpLog.delete(fpLog.keys().next().value); }
  if (mp && !mp.session.isHost) { mp.session.sendNet({ k: 'fp', pid: mp.myPid, t: tick, fp }); }
}

function checkRemoteFp(m) {
  const mine = fpLog.get(m.t);
  if (mine && mine !== m.fp) {
    console.error('[net] DESYNC at tick ' + m.t + ': host=' + mine + ' p' + m.pid + '=' + m.fp);
    hud && hud.toast('⚠️ Desync detected (tick ' + m.t + ') — please report this seed.', 'warn');
  }
}

// ── input (queueCmd boundary — identical shape solo and co-op) ─────────────
function queueCmd(cmd) {
  if (!game || game.over) { return; }
  if (mp) { mp.lockstep.queueLocal(cmd); } else { game.execCommand(0, cmd); }
}

const held = new Set();
let lastIn = { mx: 0, mz: 0, sp: false };
addEventListener('keydown', (e) => {
  if (!game || game.over) { return; }
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
    held.add(k);
    e.preventDefault();
  } else if (k === 'e') { queueCmd({ c: 'act' }); }
  else if (k === 'g') { queueCmd({ c: 'drop' }); }
  else if (k === 'f') { queueCmd({ c: 'fire' }); }
  else if (k === 'q') { queueCmd({ c: 'ability' }); }
  else if (k === 'm') { sfx.setMuted(!(window.__muted = !window.__muted)); }
});
addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); });
addEventListener('blur', () => held.clear());

function pumpInput() {
  const mx = (held.has('d') || held.has('arrowright') ? 1 : 0) - (held.has('a') || held.has('arrowleft') ? 1 : 0);
  const mz = (held.has('s') || held.has('arrowdown') ? 1 : 0) - (held.has('w') || held.has('arrowup') ? 1 : 0);
  const sp = held.has('shift');
  if (mx !== lastIn.mx || mz !== lastIn.mz || sp !== lastIn.sp) {
    lastIn = { mx, mz, sp };
    queueCmd({ c: 'in', mx, mz, sp });
  }
}

// ── loops ──────────────────────────────────────────────────────────────────
let accum = 0;
let lastT = 0;

function drainView() {
  for (const e of game.view) {
    hud.onEvent(e, game);
    view.onEvent(e);
    const cueKey = sfx.EVENT_CUES[e.kind];
    if (cueKey) { sfx.cue(cueKey); }
  }
  game.view.length = 0;
}

function stepSolo() {
  pumpInput();
  if (autoMode) { autopilot(game); }
  game.tick();
  drainView();
}

function stepMp() {
  pumpInput();
  mp.lockstep.commitLocal(); // idempotent per tick — every seat speaks every tick
  if (!mp.lockstep.canStep()) { return false; }
  mp.lockstep.execTick(game);
  drainView();
  recordFp(mp.lockstep.tick);
  return true;
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (game && !game.over) {
    accum += dt;
    let steps = 0;
    while (accum >= DT && steps < 8) {
      if (mp) {
        if (!stepMp()) { accum = Math.min(accum, DT * 3); break; } // waiting on the net: cap the debt
      } else {
        stepSolo();
      }
      accum -= DT;
      steps++;
    }
  }
  if (view) { view.sync(game, dt, mp ? mp.myPid : 0); }
  if (hud && game && !game.over) { hud.sync(game, game.players[mp ? mp.myPid : 0], dt); }
}

function runLoops() {
  lastT = performance.now();
  requestAnimationFrame(frame);
  // hidden-tab path: time-based catch-up keeps the shift at full speed even
  // when the browser throttles intervals (toybox sub-stepping lesson)
  let hiddenLast = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (document.hidden && game && !game.over) {
      let steps = Math.min(40, Math.floor((now - hiddenLast) / (DT * 1000)));
      while (steps-- > 0) {
        if (mp) { if (!stepMp()) { break; } } else { stepSolo(); }
      }
    }
    hiddenLast = now;
  }, 250);
}

// ── QA handles (the toybox tradition) ──────────────────────────────────────
window.__llSoak = (opts) => soak(opts || {});
window.__llPilot = autopilot;
window.__llStart = (emp, seed) => {
  if (game) { return 'already started — reload the page (no same-page restarts)'; }
  chosenEmp = emp || chosenEmp;
  if (seed) { params.set('seed', String(seed)); }
  startSolo();
  return 'started';
};
window.__llState = () => game && {
  t: game.time | 0, phase: game.phaseId(), over: game.over,
  cash: game.tracks.cash, orders: game.orders.filter((o) => o.state === 'open').length,
  parties: game.parties.filter((q) => q.state !== 'gone' && q.state !== 'leaving').length,
  guests: game.guests.filter((g) => g.state !== 'gone').length,
  pigsLoose: game.pigs.filter((p) => p.loose).length,
  spills: game.spills.length, fp: game.fingerprint(),
  mpTick: mp ? mp.lockstep.tick : null,
};

buildMenu();
if (params.get('host') === '1') { sfx.setMuted(true); hostCoop(); }
else if (params.get('join')) { sfx.setMuted(true); joinCoop(params.get('join')); }
else if (params.get('autostart') === '1' || autoMode) { sfx.setMuted(true); startSolo(); }
