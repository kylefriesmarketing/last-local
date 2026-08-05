// THE LAST LOCAL — HUD/DOM layer. Reads sim state + drains view events.
import { REQUESTS, ARCHETYPES, PHASE_LINES, AFTERMATH_STAMPS, TUNING, SHIFT } from './data.js';

const $ = (id) => document.getElementById(id);

const TELEGRAPH_LINES = {
  headlights: 'Headlights swing across the lot…',
  doorchime: 'The door chime is about to earn its pay…',
  gurgle: 'The dishwasher makes a sound dishwashers should not make.',
  puddle_shine: 'Something shines on the kitchen floor.',
  fryer_hiss: 'The fryer hisses like it means it.',
  smoke_wisp: 'A wisp of smoke curls off the fryer.',
  gate_rattle: 'The pig gate rattles. Twice.',
  squeal_far: 'A distant, ambitious squeal.',
  ringlight: 'Someone is assembling a ring light.',
  pose: 'A table rearranges itself for the camera.',
  chant: 'A chant is forming. It has your name in it.',
  table_drum: 'Table drumming. The dares are coming.',
  sedan_parks: 'A gray sedan parks with terrible precision.',
  clipboard: 'Somebody just uncapped a pen.',
};

const EVENT_TOASTS = {
  dishfault:   { text: '💦 The dishwasher gives up. It’s leaking.', cls: 'warn' },
  fryersmoke:  { text: '🔥 FRYER SMOKE — kill the circuit!', cls: 'warn' },
  gatebreak:   { text: '🐷 The pig gate just lost the argument.', cls: 'warn' },
  gatefixed:   { text: '🔧 Gate holds. For now.', cls: 'good' },
  dishfixed:   { text: '🔧 Dishwasher lives again.', cls: 'good' },
  fryerout:    { text: '😮‍💨 Circuit killed. The smoke thins.', cls: 'good' },
  pigout:      { text: '🐷 A pig is INDOORS.', cls: 'warn' },
  pigeat:      { text: '🐷 A pig ate something off the floor.', cls: '' },
  evidencegone:{ text: '🌚 The evidence… is gone.', cls: 'good' },
  gunout:      { text: '⚠️ The Regulator is OUT. Everyone saw.', cls: 'warn' },
  gunstow:     { text: 'The Regulator goes back under the bar.', cls: 'good' },
  gunfire:     { text: '💥 THAT was loud. The room empties.', cls: 'warn' },
  gunclick:    { text: 'Click. Out of shells.', cls: '' },
  subcaught:   { text: '🕵️ “This is NOT range oat.” Busted.', cls: 'warn' },
  retake:      { text: '📸 “Again please — the shot died.”', cls: '' },
  stoolfreed:  { text: '🪑 The stool is liberated. A local nods.', cls: 'good' },
  ejected:     { text: '🚪 And STAY out.', cls: '' },
  slip:        { text: '🫠 Somebody found the spill.', cls: '' },
  glassbreak:  { text: '🍺 Glass down! Shards everywhere.', cls: 'warn' },
  clipboard:   { text: '🖊️ The quiet one wrote something down.', cls: 'warn' },
  song:        { text: '🎸 Jo plays the one everybody knows.', cls: 'good' },
  waitpay:     { text: '💵 A table wants to settle up.', cls: 'good' },
};

export class Hud {
  constructor() {
    this.telegraphT = 0;
    this.trackEls = {};
    const defs = [
      ['hosp', 'HOSPITALITY', 'hospitality'], ['loy', 'LOYALTY', 'loyalty'],
      ['heat', 'HEAT', 'heat'], ['gent', 'GENTRIFY', 'gentrification'], ['chaos', 'CHAOS', 'chaos'],
    ];
    for (const [cls, label, key] of defs) {
      const el = document.createElement('div');
      el.className = 'tr ' + cls;
      el.innerHTML = `${label}<div class="bar"><i></i></div>`;
      $('tracks').appendChild(el);
      this.trackEls[key] = el.querySelector('i');
    }
  }

  show() { $('hud').style.display = 'block'; }

  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = text;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 5) { $('toasts').firstChild.remove(); }
    setTimeout(() => el.remove(), 6100);
  }

  onEvent(e, game) {
    if (e.kind === 'telegraph') {
      const line = TELEGRAPH_LINES[e.key];
      if (line) {
        $('telegraph').textContent = line;
        $('telegraph').style.display = 'block';
        this.telegraphT = 4;
      }
      return;
    }
    if (e.kind === 'ordertaken') {
      this.toast('🗒️ Table ' + e.tableId + ': ' + e.bark);
      return;
    }
    if (e.kind === 'complaint') {
      this.toast('😤 Table ' + e.tableId + (e.why === 'ignored' ? ' has been waiting to ORDER.' : ' waited too long.'), 'warn');
      return;
    }
    if (e.kind === 'arrive') {
      this.toast('🚪 ' + ARCHETYPES[e.arche].label + ' — party of ' + e.size + ' → table ' + e.tableId);
      return;
    }
    if (e.kind === 'served') {
      this.toast(e.path === 'deception' ? '🤫 Served… something. They bought it.' : '✅ Table ' + e.tableId + ' served.', 'good');
      return;
    }
    if (e.kind === 'wrongitem') {
      const req = REQUESTS[Object.keys(REQUESTS).find((k) => REQUESTS[k].needItem === e.want)] || {};
      this.toast('❌ Wrong item — they want: ' + (e.want || 'something else'), 'warn');
      return;
    }
    const t = EVENT_TOASTS[e.kind];
    if (t) { this.toast(t.text, t.cls); }
  }

  sync(game, player, dt) {
    const phase = game.phaseId();
    $('phase').textContent = phase.replace('_', ' ').toUpperCase();
    const left = Math.max(0, SHIFT.duration - game.time);
    $('clock').textContent = Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
    $('cash').textContent = '$' + (game.tracks.cash / 100).toFixed(0) + ' / $' + (TUNING.registerGoal / 100).toFixed(0);

    for (const key of Object.keys(this.trackEls)) {
      this.trackEls[key].style.width = game.tracks[key] + '%';
    }

    // tickets
    const open = game.orders.filter((o) => o.state === 'open' || o.state === 'social').slice(0, 7);
    const tk = $('tickets');
    let html = '';
    for (const o of open) {
      const req = REQUESTS[o.reqKey];
      const pct = o.state === 'social' ? 100 : Math.max(0, (o.tLeft / o.total) * 100);
      html += `<div class="tk${req.absurd || req.social ? ' absurd' : ''}${pct < 30 ? ' low' : ''}">
        <span class="t">T${o.tableId}</span> ${req.label}
        <div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }
    tk.innerHTML = html;

    // context verb
    const hint = game.contextHint(player);
    const verbEl = $('verb');
    if (hint) {
      verbEl.style.display = 'block';
      verbEl.innerHTML = (hint.progress != null
        ? `${hint.verb}<span class="prog"><i style="width:${(hint.progress * 100) | 0}%"></i></span>`
        : `<b>E</b> — ${hint.verb}`);
    } else {
      verbEl.style.display = 'none';
    }

    // carry + ability chips
    let chips = '';
    if (player.carry) { chips += `<span class="chip">CARRY <b>${player.carry.kind}</b></span>`; }
    const cd = player.abilityCd > 0 ? ' (' + Math.ceil(player.abilityCd) + 's)' : '';
    chips += `<span class="chip"><b>Q</b> ${player.e.abilityLabel}${cd}</span>`;
    if (!game.shotgun.stowed) { chips += `<span class="chip" style="border-color:var(--rust)">🔫 shells <b>${game.shotgun.shells}</b></span>`; }
    $('carry').innerHTML = chips;

    if (this.telegraphT > 0) {
      this.telegraphT -= dt;
      if (this.telegraphT <= 0) { $('telegraph').style.display = 'none'; }
    }
  }

  aftermath(result, game) {
    $('hud').style.display = 'none';
    $('after').style.display = 'flex';
    $('stamp').textContent = result.win ? AFTERMATH_STAMPS.win : AFTERMATH_STAMPS.loss;
    $('stampline').textContent = result.win
      ? 'Register made. Most of them left fed. The bar sees another Friday.'
      : 'Short of the register goal — but the story was worth something.';
    $('n-cash').textContent = '$' + (result.cash / 100).toFixed(0);
    $('n-res').textContent = Math.round(result.ratio * 100) + '%';
    $('n-walk').textContent = result.stats.walkouts;
    $('n-filmed').textContent = result.stats.filmed;
    // attributed journal: biggest movements first (bible: every delta attributed)
    const j = result.journal.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 10);
    $('journal').innerHTML = j.map((x) => {
      const sign = x.amount > 0 ? '+' : '';
      const cls = (x.key === 'heat' || x.key === 'chaos' || x.key === 'gentrification')
        ? (x.amount > 0 ? 'down' : 'up')
        : (x.amount > 0 ? 'up' : 'down');
      const val = x.key === 'cash' ? '$' + (x.amount / 100).toFixed(0) : sign + x.amount + ' ' + x.key;
      return `<div><span class="${cls}">${val}</span> — ${x.note}</div>`;
    }).join('');
  }
}
