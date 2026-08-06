# THE LAST LOCAL — Claude's build (the bake-off entry)

**▶ PLAY IT: https://kylefriesmarketing.github.io/last-local/**
(public repo `kylefriesmarketing/last-local`, Pages from **master** root;
deploy = `git push origin master`. Co-op works on the live link — HTTPS
origin + PeerJS cloud signaling verified.)

Serve the tourists. Save the bar. Protect the town — or pull the shotgun and
let the pigs sort it out. A deterministic co-op service-industry catastrophe
in Copperhead, Montana, built from Kyle's design bible
(`../the-last-local/Docs/The_Last_Local_Development_Bible.pdf`).

**This is the Claude entry in a two-track bake-off.** The sibling
`../the-last-local/` Unity repo is the Codex track (do not cross-edit).
Instantly playable in a browser; judged on which is the better game.

## Run it

```bash
powershell -ExecutionPolicy Bypass -File "C:\Users\kylef\Downloads\New folder\the-last-local-claude\serve.ps1"
```

Then http://localhost:8433 — pick an employee, CLOCK IN.

**Co-op (up to 4, LIVE over PeerJS):** pick your employee, hit 🤝 HOST CO-OP,
read your friend the 4-letter room code; they type it in JOIN. Host starts
the shift. True lockstep — everyone simulates the same night; only commands
travel. Needs internet for signaling (vendored `lib/peerjs.min.js`, unpkg
fallback).

Useful URLs: `?seed=47` (fixed night) · `?autostart=1` (skip menu) ·
`?auto=1` (autopilot demo) · `?host=1` (auto-host; `&autostart2=1` starts on
first join) · `?join=CODE` (auto-join).

**FIRST PERSON** (the friendslop camera): click to lock the mouse and look
around; a reticle marks your aim. **WASD** strafe/walk relative to where
you look · **E** context verb · **C** shout (a context callout every
teammate sees) · **Space (hold)** charge a throw · Shift hustle · **Q**
ability · G drop · **F** fire the Regulator · M mute. Getting knocked down
drops your eyes to the floorboards — and a teammate's **E** gets you back up
in a fifth of the time. `?cam=iso` brings back the overhead diorama (QA).
**🎙️ Proximity voice in co-op**: hit the mic button — friends sound louder
up close, quieter across the room, panned to where they actually stand.
**Phones work**: virtual stick + DO/THROW/Q/DROP buttons appear on touch
devices (full-tilt stick = hustle). Solo players can **hire a temp** — a
deterministic bot teammate (menu checkbox or `?bot=1`) who takes orders,
pours, delivers, collects, and hauls kegs.

## Tests (run before ANY sim/data change — non-negotiable)

```bash
C:\Users\kylef\tools\node\node.exe tests/run.mjs
```

66 tests: map reachability, rng/fingerprint determinism, track attribution
("no hidden scoring" — deltas without a cause THROW), full-shift soaks ×6
seeds, director fairness (telegraphs precede effects; ≤2 **pressure** families
— service modules don't pad the count; every module announces itself in two
channels; the authored prep fault and one headline per pressure phase all
fire), the Regulator's costs, pigs eating evidence, substitution both
succeeding and getting caught, **the tray** (cap, loading, delivering the
right item off it, hard vs soft dumps, sprinting as a measurable gamble),
**the crew** (solid bodies, shoves that cost your coworker their hands, the
callout reading the room, help-up), and **lockstep co-op determinism**
(2/3/4 in-memory clients, byte-identical fingerprints, incl. runs scripted
with pings, sprints and trays).

## What's in the shift (bible slice)

- **The tray** (bible §9 "trays trade speed for fragility"): grab one at the
  TRAYS station on the bar and carry **three** items a trip. Stations load onto
  it. Delivering picks whatever that table wanted. Set it down and nothing
  breaks; have it taken from you — sprint fumble, a spill, a coworker barging
  past — and **everything** goes, glass into real shards, attributed on the
  aftermath card. Walking never drops it; running often does.
- **The crew is solid**: players collide (you can block the pass-through),
  hustling into a coworker stumbles them and empties their hands, a downed
  teammate can still **shout**, and your **E** picks them up.
- **The callout** (C / SHOUT on touch): one button that reads the room — fire,
  the gun being out, a loose pig, dry taps, a table that needs someone, a mess,
  "need hands". It is sim state, so every client sees the same beacon.
- **Service loop**: seat → take order → prep at taps/coffee/grill → deliver →
  collect. Request lattice per order: honest / **substitute** (deception roll
  vs archetype savvy — "rename it range oat") / refuse-eject / grovel-recover
  an ignored table / threaten (see below).
- **The Regulator**: two shells under the bar. Firing empties the room,
  spikes heat + chaos, breaks glass, and gets you filmed — optional, costly,
  absurdly overqualified, exactly per the bible's violence contract.
- **Pigs**: the director breaks the gate; pigs invade, eat anything on the
  floor — including dropped phone evidence (heat DOWN: the pigs ate the
  evidence). Lure them home with feed, repair the gate.
- **Disaster web**: dishwasher fault drips spills (slips, drops), broken
  glass reroutes guests, fryer smoke clears tables until you kill the circuit.
- **Director** (§12): phase timeline (prep→warm→compression→break→last call),
  intensity budgets, ≤2 pressure families, every event telegraphed ~4s ahead
  in two channels (banner + audio cue), recovery valve after severe events,
  staffing-aware arrivals, seeded + logged decisions. **Authored beats sit on
  top of the budget** (§7): the prep fault always fires, and compression and the
  break point are each guaranteed a headline. Arrivals are a *service* module —
  cost 0, no pressure-family slot, never held back by the recovery valve, so
  the room keeps filling while everything burns.
- **Readable panic**: the screen edges redden and the mix lifts on one honest
  danger score (parties complaining, orders under 25% patience, smoke, loose
  pigs, the gun out, the bus clock, hospitality collapse). Phase turns get a
  card and a sting. Every action gets camera kick, debris and floating text.
- **An objective line** that says the single most worth-doing thing right now,
  in the bible's §34 information order, and never invents a task.
- **The throw verb**: hold Space, release to lob whatever you're holding —
  arc preview included. Teammates with free hands **catch** it (drink
  relays!). A match landing by a table is a **rough delivery** (served,
  badly — capped satisfaction, +chaos). Fragile items shatter into shards
  on hard landings; burgers survive and become pig bait; guests you bonk
  get filmed being bonked. Sprint through a spill and it's a full
  **knockdown**, flat on the floor.
- **The tour bus** (S04's essence): three parties at once on one departure
  clock. Serve them for bonus tips; eating/paying parties fling cash and
  run when the bus honks; the unserved leave hungry and post about it.
- **World markers**: bubbles over tables — ? take my order · • patience
  (green→amber→red) · $ settle up · ! complaint · ♥ eating. You read the
  room, not the ticket rail. Name tags over players in co-op.
- **The keg loop**: the taps hold ten pours. Dry taps mean somebody hauls a
  keg in from the lot — heavy, half speed, unthrowable, pig-proof (Cal
  hauls at near full speed: his moment). A mid-shift keg delivery event
  restocks the lot. Bot teammates run kegs too.
- **Six tracks** with mandatory attribution; the aftermath card shows the ten
  biggest attributed swings of the night. Hospitality up can push
  gentrification up — no single score is "good".
- **Employees**: Mara (clean ejection), Cal (heavy carry + pigs obey), Jo
  (a song buys patience), Dottie (instant prep, with a side effect).
- **Archetypes**: tourists, influencers (film everything, demand retakes),
  tech couple, old locals (defend their stool), bachelor party, and a quiet
  stranger with a clipboard.

## Architecture (toybox doctrine)

| File | Role |
|---|---|
| `src/data.js` | ALL content/tuning. Balance changes go here and only here |
| `src/sim.js` | The ENTIRE deterministic sim. `this.rng` (LCG) only — **never Math.random in sim code**. No DOM/THREE imports. `soak()`/`autopilot()` = headless QA |
| `src/net.js` | TRUE lockstep core: every seat commits (possibly empty) cmds per tick; host finalizes only when all live seats spoke; first INPUT_DELAY ticks pre-sealed. MemoryHub + `netTest` — node-testable |
| `src/net-peer.js` | PeerJS adapter (room codes, hello/seat/start, drop → markLeft) + fp desync tripwire every 100 ticks |
| `src/render.js` | Three.js diorama. View-only; Math.random allowed |
| `src/ui.js` | HUD/DOM: tickets, tracks, verbs, toasts, telegraphs, aftermath |
| `src/main.js` | Boot/loop/input. Input reaches the sim ONLY via `execCommand` — the lockstep wire boundary |
| `tests/run.mjs` | The battery. 29 tests, zero frameworks |

**Iron rules inherited from Age of Toys:** no same-page restarts (buttons
reload); fixed 20 Hz tick with hidden-tab time-based catch-up; sim/view
split absolute; every new sim feature lands with a battery test.

## QA handles (in-page)

`__llState()` live snapshot · `__llGame` / `__llView` / `__llHud` · `__llSoak(opts)`
headless shift · `__llPilot` the QA driver · fingerprints via
`__llGame.fingerprint()`.

## Verified traps (don't rediscover)

- The Browser pane can report `innerWidth 0` at boot → canvas 0×0. Render
  self-heals per frame; don't remove that check.
- The pane suspends rAF when hidden (`document.hidden` true even when
  "open"): sim continues via interval catch-up, but **input/renders need the
  pane actually displayed**. Verify gameplay via `__llState` + self-shots
  (render → `toDataURL` → POST to a shot receiver), not pane screenshots.
- `ev('kind', {kind: x})` — a payload field named `kind` clobbers the event
  kind via Object.assign. Payloads use `item:`/`what:` instead.
- serve.mjs must use `fileURLToPath` (a raw `import.meta.url.pathname` keeps
  `%20` and 404s everything under "New folder").
- Workspace-root `.claude/launch.json` (shared registry) has the
  `last-local-claude` entry; the 5-managed-server cap may force a plain
  background `node serve.mjs` + `preview_start {url}` instead.

## Co-op verification record (2026-08-05)

Live 2-tab test over real PeerJS/WebRTC in the Browser pane: room code dealt,
guest seated as P2, host auto-started, both players' inputs applied on both
peers, fingerprints at ticks 100 and 200 **byte-identical across peers**,
zero console errors. Plus battery: 30/30 incl. 2-client, 4-client, and
mid-run-drop lockstep tests. ⚠️ The first version of the host finalizer did
NOT wait for guest commits — a throttled guest's commands arrived late and
were dropped (host monologue, not lockstep). If you ever "optimize" the
wait-gate away, that bug comes back.

## Difficulty, honestly

The register goal is **$280**, tuned against the hesitating temp bot as a human
proxy over 20 seeds (cash p10 $293 / p50 $358 / p90 $430; resolve p10 58%). The
bot clears it 17/20, the omniscient autopilot 19/20. **This is proxy-tuned, not
human-playtested** — a first-person human who has to find things will do worse,
and a crew who actually uses the tray should do better. Re-measure after a real
group plays. Both gates matter: cash AND a 60% resolve ratio.

## Next sessions

1. **Playtest with real humans and re-tune** the register goal — everything
   above is measured against bots.
2. Two hand slots + pocket slots (bible §11); the tray is the two-handed case,
   but small items should stack in pockets.
3. Multi-item orders (a party of 3 wanting 3 things) — the tray exists now, so
   this is the natural next pressure and it costs almost nothing to author.
4. MP polish: waiting-on-net indicator, host-lost card, rejoin. Human-to-human
   throw relays already work; two-person carries do not exist yet.
5. Art pass (Higgsfield textures/portraits — costs credits, confirm first).
