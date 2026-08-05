// THE LAST LOCAL — boot/loop/input. Restart = location.reload (NO same-page
// restarts, learned the hard way on Age of Toys). Input reaches the sim ONLY
// through execCommand — the exact boundary net.js will relay in co-op.
import { Game, soak, autopilot, DT } from './sim.js';
import { EMPLOYEES } from './data.js';
import { View } from './render.js';
import { Hud } from './ui.js';
import * as sfx from './sfx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

let game = null;
let view = null;
let hud = null;
let chosenEmp = params.get('emp') || 'mara';
const autoMode = params.get('auto') === '1';

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
  $('start').onclick = () => { sfx.unlock(); start(); };
}

// ── start (once per page load) ─────────────────────────────────────────────
function start() {
  if (game) { return; }
  const seed = parseInt(params.get('seed'), 10) || ((Math.random() * 99999) | 1);
  game = new Game({
    seed,
    players: [{ employeeKey: chosenEmp }],
    cb: { gameOver: (result) => onGameOver(result, seed) },
  });
  view = new View($('c'));
  view.build(game);
  hud = new Hud();
  hud.show();
  $('menu').style.display = 'none';
  hud.toast('🌲 Copperhead, Montana. Friday. Seed ' + seed + '.');
  hud.toast('🔎 Prep: something is already broken. Find it.');
  window.__llGame = game;
  window.__llView = view;
  runLoops();
}

function onGameOver(result, seed) {
  sfx.cue('gameover');
  hud.aftermath(result, game);
  $('again').onclick = () => {
    location.href = location.pathname + '?emp=' + chosenEmp;
  };
  $('sameseed').onclick = () => {
    location.href = location.pathname + '?emp=' + chosenEmp + '&seed=' + seed;
  };
}

// ── input (execCommand boundary — identical shape to future net relay) ─────
const held = new Set();
let lastIn = { mx: 0, mz: 0, sp: false };
addEventListener('keydown', (e) => {
  if (!game || game.over) { return; }
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
    held.add(k);
    e.preventDefault();
  } else if (k === 'e') { game.execCommand(0, { c: 'act' }); }
  else if (k === 'g') { game.execCommand(0, { c: 'drop' }); }
  else if (k === 'f') { game.execCommand(0, { c: 'fire' }); }
  else if (k === 'q') { game.execCommand(0, { c: 'ability' }); }
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
    game.execCommand(0, { c: 'in', mx, mz, sp });
  }
}

// ── loops: rAF foreground + interval fallback for hidden tabs ──────────────
let accum = 0;
let lastT = 0;
let rafId = 0;

function stepSim() {
  pumpInput();
  if (autoMode) { autopilot(game); }
  game.tick();
  for (const e of game.view) {
    hud.onEvent(e, game);
    view.onEvent(e);
    const cueKey = sfx.EVENT_CUES[e.kind];
    if (cueKey) { sfx.cue(cueKey); }
  }
  game.view.length = 0;
}

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.25, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (!game.over) {
    accum += dt;
    let steps = 0;
    while (accum >= DT && steps < 6) {
      stepSim();
      accum -= DT;
      steps++;
    }
  }
  view.sync(game, dt, 0);
  if (!game.over) { hud.sync(game, game.players[0], dt); }
}

function runLoops() {
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
  // hidden-tab path: time-based catch-up keeps the shift at full speed even
  // when the browser throttles intervals (toybox sub-stepping lesson)
  let hiddenLast = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (document.hidden && game && !game.over) {
      let steps = Math.min(40, Math.floor((now - hiddenLast) / (DT * 1000)));
      while (steps-- > 0) { stepSim(); }
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
  start();
  return 'started';
};
window.__llState = () => game && {
  t: game.time | 0, phase: game.phaseId(), over: game.over,
  cash: game.tracks.cash, orders: game.orders.filter((o) => o.state === 'open').length,
  parties: game.parties.filter((q) => q.state !== 'gone' && q.state !== 'leaving').length,
  guests: game.guests.filter((g) => g.state !== 'gone').length,
  pigsLoose: game.pigs.filter((p) => p.loose).length,
  spills: game.spills.length, fp: game.fingerprint(),
};

buildMenu();
if (params.get('autostart') === '1' || autoMode) { sfx.setMuted(true); start(); }
