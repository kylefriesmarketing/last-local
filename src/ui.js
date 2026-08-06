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
  air_brakes: 'Air brakes hiss out on the highway…',
  headlights_many: 'That is a LOT of headlights.',
  truck_rumble: 'A delivery truck rumbles up the lot…',
  crate_thud: 'Something heavy just hit the gravel.',
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
  crewshove:   { text: '💢 You BARGED into your own coworker.', cls: 'warn' },
  helpup:      { text: '🤝 Back on your feet.', cls: 'good' },
  feedpour:    { text: '🌾 Feed is down. Here, pig.', cls: '' },
  glassbreak:  { text: '🍺 Glass down! Shards everywhere.', cls: 'warn' },
  clipboard:   { text: '🖊️ The quiet one wrote something down.', cls: 'warn' },
  song:        { text: '🎸 Jo plays the one everybody knows.', cls: 'good' },
  waitpay:     { text: '💵 A table wants to settle up.', cls: 'good' },
  bonk:        { text: '🎯 …that hit a customer.', cls: 'warn' },
  catch:       { text: '🧤 CAUGHT. The crew has hands.', cls: 'good' },
  tourbus:     { text: '🚌 TOUR BUS. Three parties. One clock.', cls: 'warn' },
  busgone:     { text: '🚌 The bus pulls out. Whoever missed it, missed it.', cls: '' },
  keglow:      { text: '🍺 The keg is running low.', cls: '' },
  kegdry:      { text: '🛢️ TAPS DRY — kegs are out in the lot!', cls: 'warn' },
  kegtapped:   { text: '🍻 Fresh keg tapped. The taps live again.', cls: 'good' },
  kegdrop:     { text: '🚚 Keg delivery — two fresh ones in the lot.', cls: 'good' },
  tooheavy:    { text: '🏋️ Too heavy to throw. Physics wins this one.', cls: '' },
  pigscoop:    { text: '🐷 You are holding an entire pig.', cls: '' },
  pigsquirm:   { text: '🐷 The pig wriggles free. Of course it does.', cls: 'warn' },
  pigpenned:   { text: '🐷 Pig returned to the pen. Hero.', cls: 'good' },
  pigtoss:     { text: '🐷 …you THREW the pig.', cls: 'warn' },
  shove:       { text: '💢 You barged straight through somebody.', cls: '' },
  shovedback:  { text: '💢 The party shoved back. You are on the floor.', cls: 'warn' },
  fumble:      { text: '🫳 Fumbled it at speed.', cls: 'warn' },
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

  /** The turn of a phase is the shift's punctuation. It used to be a word
   *  quietly changing in the top bar; nobody noticed the night escalating. */
  phaseCard(id) {
    const card = $('phasecard');
    const titles = {
      prep: 'PREP', warm: 'WARM SERVICE', compression: 'COMPRESSION',
      break: 'THE BREAK POINT', last_call: 'LAST CALL',
    };
    card.querySelector('b').textContent = titles[id] || id.toUpperCase();
    card.querySelector('i').textContent = PHASE_LINES[id] || '';
    card.style.display = 'flex';
    const inner = card.firstElementChild;
    inner.style.animation = 'none';
    void inner.offsetWidth;            // restart the keyframes (toybox trick)
    inner.style.animation = '';
    clearTimeout(this._pcT);
    this._pcT = setTimeout(() => { card.style.display = 'none'; }, 3300);
  }

  onEvent(e, game) {
    if (e.kind === 'phase') { this.phaseCard(e.id); return; }
    if (e.kind === 'paid') {
      const el = $('cashpop');
      el.textContent = '+$' + (e.amount / 100).toFixed(0)
        + (e.tip > 0 ? '  (tip $' + (e.tip / 100).toFixed(0) + ')' : '');
      el.classList.remove('go');
      void el.offsetWidth;
      el.classList.add('go');
      return;
    }
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
      this.toast(e.path === 'deception' ? '🤫 Served… something. They bought it.'
        : e.path === 'thrown' ? '🥏 Table ' + e.tableId + ' served. Airborne. They noticed.'
          : '✅ Table ' + e.tableId + ' served.', e.path === 'thrown' ? '' : 'good');
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

  sync(game, player, dt, chargePower, stallSeconds) {
    const phase = game.phaseId();
    $('phase').textContent = phase.replace('_', ' ').toUpperCase();
    const left = Math.max(0, SHIFT.duration - game.time);
    let clockText = Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
    if (game.busClock != null) {
      clockText += '  🚌 ' + Math.max(0, game.busClock | 0) + 's';
    }
    $('clock').textContent = clockText;
    $('clock').style.color = game.busClock != null && game.busClock < 20 ? 'var(--rust)' : '';
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
    if (player.carry) { chips += `<span class="chip">CARRY <b>${player.carry.kind}</b> <i style="opacity:.6">(Space: throw)</i></span>`; }
    const cd = player.abilityCd > 0 ? ' (' + Math.ceil(player.abilityCd) + 's)' : '';
    chips += `<span class="chip"><b>Q</b> ${player.e.abilityLabel}${cd}</span>`;
    if (!game.shotgun.stowed) { chips += `<span class="chip" style="border-color:var(--rust)">🔫 shells <b>${game.shotgun.shells}</b></span>`; }
    if (chargePower != null) {
      chips += `<span class="chip" style="border-color:var(--amber)">🥏 <b>${(chargePower * 100) | 0}%</b></span>`;
    }
    if (stallSeconds > 0.6) {
      chips += `<span class="chip" style="border-color:var(--cold)">⏳ waiting on the party…</span>`;
    }
    $('carry').innerHTML = chips;

    if (this.telegraphT > 0) {
      this.telegraphT -= dt;
      if (this.telegraphT <= 0) { $('telegraph').style.display = 'none'; }
    }

    // ── readable panic ────────────────────────────────────────────────────
    // One honest number from live sim state, not a mood light. It is what the
    // room would feel like: people shouting at you, something on fire, a pig.
    let danger = 0;
    for (const q of game.parties) {
      if (q.state === 'complaining') { danger += 0.3; }
    }
    for (const o of game.orders) {
      if (o.state === 'open' && o.tLeft / o.total < 0.25) { danger += 0.22; }
    }
    if (game.fryer.smoking) { danger += 0.35; }
    for (const pg of game.pigs) { if (pg.loose && !pg.carriedBy) { danger += 0.16; } }
    if (!game.shotgun.stowed) { danger += 0.45; }
    if (game.busClock != null && game.busClock < 25) { danger += 0.3; }
    if (game.tracks.hospitality < 25) { danger += 0.3; }
    this.danger = (this.danger || 0) + ((Math.min(1, danger) - (this.danger || 0)) * Math.min(1, dt * 2.2));
    $('vignette').style.opacity = (this.danger * 0.62).toFixed(3);
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
