// THE LAST LOCAL — Claude's build. ALL content/tuning lives here (toybox rule:
// balance changes go HERE and only here). Pure data — no logic imports.
// Source of truth: Docs bible (Kyle's ChatGPT design bible, 2026-08-04).

export const VERSION = '0.1.0';

// ── Shift dramaturgy (bible §7, schema B-ShiftDefinition; seconds) ─────────
export const SHIFT = {
  phases: [
    { id: 'prep',        start: 0,    end: 120 },
    { id: 'warm',        start: 120,  end: 330 },
    { id: 'compression', start: 330,  end: 570 },
    { id: 'break',       start: 570,  end: 810 },
    { id: 'last_call',   start: 810,  end: 960 },
  ],
  duration: 960, // 16 real minutes — inside the bible's 15-25 window
};

// ── The room (26×17). #wall ,lot .floor D door =bar K kitchen counter
//    _ pen mud  G pen gate (state lives in sim). Everything else is entities.
export const LAYOUT = [
  '##########################',
  '#,,,,#...................#',
  '#,,,,#...................#',
  '#,,,,D...................#',
  '#,,,,#...................#',
  '######...................#',
  '#____#...................#',
  '#____#...................#',
  '#____G...................#',
  '#____#...................#',
  '######.==========........#',
  '#     #..................#',
  '#     #..........#.......#',
  '#     #..........#.......#',
  '#     #KKKKKKKKKK#..K.K..#',
  '#     ####################',
  '#                        #',
];
// NOTE row z11..14 x1..4 is void (' ' = wall-solid). Interior x6..24 z1..13.

export const TABLES = [
  { id: 1, x: 9,  z: 3 }, { id: 2, x: 13, z: 3 }, { id: 3, x: 17, z: 3 }, { id: 4, x: 21, z: 3 },
  { id: 5, x: 9,  z: 6 }, { id: 6, x: 13, z: 6 }, { id: 7, x: 17, z: 6 }, { id: 8, x: 21, z: 6 },
]; // seats = west+east neighbors of each table tile

export const STATIONS = {
  taps:    { x: 9,  z: 10, label: 'Taps',        verb: 'Pour beer',    time: 1.4, makes: 'beer' },
  coffee:  { x: 12, z: 10, label: 'Coffee rig',  verb: 'Brew coffee',  time: 1.8, makes: 'coffee' },
  pos:     { x: 15, z: 10, label: 'Register',    verb: 'Ring up',      time: 0.8 },
  shotgun: { x: 11, z: 10, label: 'Under-bar',   verb: 'Reach under',  time: 2.0, hidden: true },
  grill:   { x: 8,  z: 14, label: 'Grill',       verb: 'Work grill',   time: 3.2, makes: 'burger' },
  fryer:   { x: 11, z: 14, label: 'Fryer',       verb: 'Drop basket',  time: 2.6, makes: 'fries' },
  dish:    { x: 14, z: 14, label: 'Dishwasher',  verb: 'Repair',       time: 3.0 },
  mop:     { x: 16, z: 14, label: 'Mop closet',  verb: 'Grab mop',     time: 0.6 },
  jelly:   { x: 20, z: 14, label: 'Cold shelf',  verb: 'Grab garnish', time: 0.7, makes: 'garnish' },
  jukebox: { x: 22, z: 14, label: 'Jukebox',     verb: 'Kick jukebox', time: 0.5 },
  trough:  { x: 2,  z: 7,  label: 'Pig trough',  verb: 'Feed pigs',    time: 1.2 },
  dumpster:{ x: 2,  z: 1,  label: 'Dumpster',    verb: 'Toss',         time: 0.9 },
};

export const DOOR = { x: 5, z: 3 };
export const PEN_GATE = { x: 5, z: 8 };
export const GUEST_SPAWN = { x: 2, z: 3 };
export const QUEUE_TILE = { x: 7, z: 3 };
export const PLAYER_SPAWNS = [ { x: 9, z: 12 }, { x: 12, z: 12 }, { x: 8, z: 9 }, { x: 14, z: 9 } ];
export const PIG_HOME = [ { x: 2, z: 7 }, { x: 3, z: 8 } ];

// ── Playable employees (bible §16 — competence + blind spot + stake) ───────
export const EMPLOYEES = {
  mara:   { label: 'Mara Vale',      role: 'Burned-Out Manager', tint: 0xd69a32,
            speed: 3.3, prepMul: 1.0, ability: 'takeitoutside', abilityLabel: 'Take It Outside',
            abilityDesc: 'Instantly convert a complaint into a clean ejection.', cooldown: 45,
            stake: 'Needs the bar to protect her mother’s housing.' },
  cal:    { label: 'Cal Rusk',       role: 'Ranch Kid', tint: 0x6d8177,
            speed: 3.1, prepMul: 1.15, ability: 'fencepost', abilityLabel: 'Fencepost',
            abilityDesc: 'Next 10s: walk full speed while carrying anything; pigs obey you.', cooldown: 40,
            stake: 'The family ranch is under developer option.' },
  jo:     { label: 'Jo Vega',        role: 'Failed Musician', tint: 0x9d4e35,
            speed: 3.5, prepMul: 0.85, ability: 'housefavorite', abilityLabel: 'House Favorite',
            abilityDesc: 'A song: every seated party gains patience and mood.', cooldown: 60,
            stake: 'Saving for one final tour that never starts.' },
  dottie: { label: 'Dottie Crane',   role: 'Conspiracy Cook', tint: 0x7aa2b8,
            speed: 3.2, prepMul: 0.7,  ability: 'offmenu', abilityLabel: 'Off-Menu',
            abilityDesc: 'Instantly finish the station you’re working — with a side effect.', cooldown: 50,
            stake: 'Owes the owner and distrusts every exit.' },
};

// ── Customer archetypes (bible §17) ────────────────────────────────────────
export const ARCHETYPES = {
  tourist:    { label: 'Park Tourist',      tint: 0xe8b48c, patienceMul: 1.0, tipMul: 1.0,
                savvy: 0.35, films: 0.10, partySize: [2, 3], gentOnHappy: 1,
                pool: ['beer', 'burger', 'coffee'] },
  influencer: { label: 'Influencer',        tint: 0xf0e442, patienceMul: 0.75, tipMul: 1.6,
                savvy: 0.55, films: 0.85, partySize: [1, 2], gentOnHappy: 2,
                pool: ['rangeoat', 'burger', 'retake'] },
  techcouple: { label: 'Tech Couple',       tint: 0x7aa2b8, patienceMul: 0.9, tipMul: 1.4,
                savvy: 0.75, films: 0.25, partySize: [2, 2], gentOnHappy: 2,
                pool: ['rangeoat', 'fancywater', 'coffee'] },
  oldlocal:   { label: 'Old Local',         tint: 0x6d8177, patienceMul: 1.6, tipMul: 0.6,
                savvy: 0.9,  films: 0.0,  partySize: [1, 2], gentOnHappy: 0, local: true,
                pool: ['beer', 'burger', 'mystool'] },
  bachelor:   { label: 'Bachelor Party',    tint: 0xcc79a7, patienceMul: 0.8, tipMul: 1.2,
                savvy: 0.3,  films: 0.4,  partySize: [3, 4], gentOnHappy: 1, rowdy: true,
                pool: ['beer', 'beer', 'dare'] },
  inspector:  { label: 'Quiet Stranger',    tint: 0xb8b8c8, patienceMul: 1.4, tipMul: 0.0,
                savvy: 1.0,  films: 0.0,  partySize: [1, 1], gentOnHappy: 0, inspector: true,
                pool: ['coffee'] },
};

// ── Requests: stateful contracts w/ the solution lattice (bible §9) ────────
// paths: honest (make needItem), substitute {needItem→subItem, risk}, refuse
// (eject window), plus universal: threaten (shotgun) / chaos fallout.
export const REQUESTS = {
  beer:       { label: 'Cold one',           needItem: 'beer',   patience: 75,  pay: 700,
                bark: '“Whatever’s local. Actually local.”' },
  burger:     { label: 'Bar burger',         needItem: 'burger', patience: 95,  pay: 1400,
                bark: '“Burger. Don’t art it up.”' },
  coffee:     { label: 'Black coffee',       needItem: 'coffee', patience: 70,  pay: 500,
                bark: '“Coffee. It’s been a day.”' },
  rangeoat:   { label: 'Oat-milk elk cappuccino', needItem: 'rangeoat', patience: 80, pay: 2100, absurd: true,
                substitute: { item: 'coffee', risk: 0.45, cover: 'Rename it “range oat.”' },
                bark: '“Is the elk milk pasture-raised?”' },
  fancywater: { label: 'Glacier still water', needItem: 'fancywater', patience: 60, pay: 900, absurd: true,
                substitute: { item: 'coffee', risk: 0.3, cover: 'Tap water in the fancy bottle. Chilled.' },
                bark: '“Is the water… trauma-informed?”' },
  retake:     { label: 'Bring it AGAIN (the shot died)', needItem: 'burger', patience: 55, pay: 1400, absurd: true,
                redeliver: true, bark: '“The cheese pull DIED. Again please. Same energy.”' },
  mystool:    { label: 'Get them off my stool', needItem: null, patience: 90, pay: 0, social: true,
                target: 'tourist', bark: '“That’s been my stool since Carter.”' },
  dare:       { label: 'Shots for the boys!!', needItem: 'beer', patience: 50, pay: 2400, rowdyTrigger: true,
                bark: '“BULL RIDE WITH SPARKLERS? anyway beers”' },
  buscheck:   { label: 'Twenty-seven separate checks', needItem: 'coffee', patience: 60, pay: 1600,
                absurd: true, bark: '“Twenty-seven separate checks. The driver pays LAST.”' },
};

// Items that can exist in hands/world.
export const ITEMS = {
  beer:      { label: 'Beer',        tint: 0xd69a32, fragile: true },
  coffee:    { label: 'Coffee',      tint: 0x4a3628, fragile: true },
  burger:    { label: 'Burger',      tint: 0x9d4e35 },
  fries:     { label: 'Fries',       tint: 0xf0e442 },
  rangeoat:  { label: 'Range Oat',   tint: 0xf4ebdd, fragile: true },
  water:     { label: 'Tap water',   tint: 0x7aa2b8, fragile: true },
  fancywater:{ label: 'Glacier still', tint: 0xbfe3f0, fragile: true },
  garnish:   { label: 'Garnish',     tint: 0x6d8177 },
  feed:      { label: 'Pig feed',    tint: 0xc9a86a },
  keg:       { label: 'Fresh keg',   tint: 0x8a6a3a, heavy: true },
  pig:       { label: 'An entire pig', tint: 0xe8a8b8, livestock: true },
  mopheld:   { label: 'Mop',         tint: 0x8a7a5a },
  shotgun:   { label: 'The Regulator', tint: 0x30343c, twoHands: true },
  phone:     { label: 'Dropped phone (evidence)', tint: 0x222831, evidence: true },
};

// ── Director modules (bible §12 + schema B-DirectorEvent) ──────────────────
// Every module: 2+ telegraphs, a recovery hook, family, cooldown, budget cost.
export const DIRECTOR_EVENTS = {
  arrivals:   { family: 'tourist',  weight: 3.0, cost: 8,  cooldown: 18, maxPerShift: 99,
                phases: ['warm', 'compression', 'break'], telegraphs: ['headlights', 'doorchime'] },
  dishfault:  { family: 'failure',  weight: 1.0, cost: 10, cooldown: 999, maxPerShift: 1, atPrep: true,
                telegraphs: ['gurgle', 'puddle_shine'], recovery: 'Repair at the dishwasher' },
  fryersmoke: { family: 'failure',  weight: 1.4, cost: 26, cooldown: 200, maxPerShift: 2,
                phases: ['compression', 'break'], telegraphs: ['fryer_hiss', 'smoke_wisp'],
                recovery: 'Kill the circuit at the fryer' },
  piggate:    { family: 'wildlife', weight: 1.2, cost: 24, cooldown: 240, maxPerShift: 2,
                phases: ['compression', 'break'], telegraphs: ['gate_rattle', 'squeal_far'],
                recovery: 'Lure with feed, repair the gate' },
  retakewave: { family: 'tourist',  weight: 0.9, cost: 14, cooldown: 120, maxPerShift: 2,
                phases: ['compression', 'break'], needsArchetype: 'influencer',
                telegraphs: ['ringlight', 'pose'], recovery: 'Deliver again or refuse' },
  darewave:   { family: 'social',   weight: 0.9, cost: 16, cooldown: 150, maxPerShift: 2,
                phases: ['break'], needsArchetype: 'bachelor',
                telegraphs: ['chant', 'table_drum'], recovery: 'Serve fast or eject the loudest' },
  inspector:  { family: 'social',   weight: 0.8, cost: 20, cooldown: 999, maxPerShift: 1,
                phases: ['break'], telegraphs: ['sedan_parks', 'clipboard'],
                recovery: 'Keep the floor clean until cash-out' },
  tourbus:    { family: 'tourist',  weight: 1.0, cost: 30, cooldown: 999, maxPerShift: 1,
                phases: ['compression', 'break'], telegraphs: ['air_brakes', 'headlights_many'],
                recovery: 'Serve them before the bus leaves' },
  kegdrop:    { family: 'failure',  weight: 0.8, cost: 12, cooldown: 999, maxPerShift: 1,
                phases: ['warm', 'compression'], telegraphs: ['truck_rumble', 'crate_thud'],
                recovery: 'Haul them in before you run dry' },
};

export const DIRECTOR = {
  maxActiveFamilies: 2,          // bible §7 fairness
  budgetByPhase: { prep: 0, warm: 24, compression: 46, break: 60, last_call: 10 },
  budgetRegenPerSec: 0.55,
  recoveryValveSeconds: 30,      // after a severe event, no new module
  telegraphLeadSeconds: 4,       // tells land before the event bites
  messWeight: { spill: 3, shards: 4, pigLoose: 8, smokingFryer: 10, unresolvedOrder: 2 },
};

export const TUNING = {
  tickHz: 20,
  guestWalk: 2.2, pigWalk: 1.9, pigChase: 2.6,
  carrySlow: 0.85, shotgunSlow: 0.62, dashMul: 1.55, dashStamina: 2.2,
  throwMinSpeed: 5.5, throwMaxSpeed: 12.5, throwUpMin: 3.2, throwUpMax: 5.0,
  throwChargeSeconds: 0.85, throwGravity: 16, catchRadius: 0.75, bonkRadius: 0.55,
  busClockSeconds: 75, busUnservedHosp: -2, busTipBonus: 0.15,
  knockdownSeconds: 1.8,
  kegPours: 10, kegSlow: 0.5, kegTapSeconds: 2.0,
  botWaitMin: 0.35, botWaitMax: 1.25,
  pigScoopRadius: 1.1, pigCarrySlow: 0.72, pigSquirmPerSec: 0.16, pigTossStun: 2.2,
  shoveRadius: 0.85, shoveForce: 1.4, shoveBackChance: 0.5, shoveStun: 1.2,
  fumbleChancePerSec: 0.5,
  patienceGraceAtDoor: 20,
  eatSeconds: 22, struggleEjectSeconds: 3.0,
  spillSlipChance: 0.35, shardStress: 8,
  fryerPanicSeconds: 45,
  shotgunShells: 2, shotgunHeat: 25, shotgunChaos: 18,
  panicFleeSeconds: 9,
  pigStealRadius: 1.2, pigFeedLure: 6.5,
  walkoutHospitality: -6, complaintHospitality: -3,
  substituteCaughtHosp: -8, substituteCaughtHeat: 4,
  ejectTouristLoyalty: 5, ejectTouristHosp: -4, ejectLocalLoyalty: -9,
  tipHappy: 0.22, tipOk: 0.12,
  registerGoal: 18000, resolveGoalRatio: 0.6,
};

// ── Narrator/flavor (view-only) ────────────────────────────────────────────
export const PHASE_LINES = {
  prep:        'Prep. One thing already broken — find it.',
  warm:        'Warm service. Headlights on the highway.',
  compression: 'Compression. Everything at once, please.',
  break:       'The break point. Something big walks in.',
  last_call:   'LAST CALL. Land this thing.',
};

export const AFTERMATH_STAMPS = {
  win:  'THE LIGHTS STAY ON',
  loss: 'WE NEARLY HAD IT',
};
