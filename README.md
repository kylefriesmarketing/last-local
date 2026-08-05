# THE LAST LOCAL — Claude's build (the bake-off entry)

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
Useful URLs: `?seed=47` (fixed night) · `?autostart=1` (skip menu) ·
`?auto=1` (autopilot demo — watch the game play itself).

**Controls:** WASD move · **E** context verb (the one readable action) ·
Shift hustle · **Q** ability · G drop · **F** fire the Regulator · M mute.

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
| `src/net.js` | Lockstep core (star topology, INPUT_DELAY 6) + MemoryHub + `netTest` — node-testable, transport-agnostic |
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

## Next sessions

1. **PeerJS adapter** for `net.js` (the core + determinism proof are done;
   port the toybox `net.js` star pattern: room code, hello/seat, host echo).
   Then a lobby card in the menu.
2. Second playable pass on feel: carry two-hands/tray, throw arc, downed
   state, more absurd requests (S02 wedding, S04 tour bus…).
3. Art pass (Higgsfield textures/portraits — costs credits, confirm first).
4. Balance battery: multi-seed autopilot matrix once a second employee AI
   exists (current pilot is the omniscient baseline: wins ~$430-500).
