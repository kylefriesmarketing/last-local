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
you look · **E** context verb · **Space (hold)** charge a throw — release
to send it wherever you're facing · Shift hustle · **Q** ability · G drop ·
**F** fire the Regulator · M mute. Getting knocked down drops your eyes to
the floorboards. `?cam=iso` brings back the overhead diorama (QA/spectate).
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

29 tests: map reachability, rng/fingerprint determinism, track attribution
("no hidden scoring" — deltas without a cause THROW), full-shift soaks ×6
seeds, director fairness (telegraphs precede effects; ≤2 pressure families;
seed reproduces the decision log), the Regulator's costs, pigs eating
evidence, substitution both succeeding and getting caught, and **lockstep
co-op determinism** (2 and 4 in-memory clients, byte-identical fingerprints).

## What's in the shift (bible slice)

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
  staffing-aware arrivals, seeded + logged decisions.
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

`__llState()` live snapshot · `__llGame` / `__llView` · `__llSoak(opts)`
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

## Next sessions

1. Feel pass: carry two-hands/tray, throw arc preview, downed state, more
   absurd requests (S02 wedding, S04 tour bus…). MP polish: waiting-on-net
   indicator, host-lost card, rejoin.
2. Art pass (Higgsfield textures/portraits — costs credits, confirm first).
3. Balance battery: multi-seed autopilot matrix once a second employee AI
   exists (current pilot is the omniscient baseline: wins ~$430-500).
4. Deploy to GitHub Pages when Kyle wants a shareable link.
