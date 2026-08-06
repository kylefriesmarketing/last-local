// THE LAST LOCAL — WebAudio synth cues. View-only; nothing here touches the sim.
let ac = null;
let master = null;
let muted = false;

function ctx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
    roomTone();
  }
  if (ac.state === 'suspended') { ac.resume(); }
  return ac;
}

export function unlock() { ctx(); }
export function setMuted(m) { muted = m; if (master) { master.gain.value = m ? 0 : 0.5; } }

function tone(freq, dur, type = 'sine', gain = 0.2, when = 0, sweep = null) {
  if (muted) { return; }
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  if (sweep) { o.frequency.linearRampToValueAtTime(sweep, a.currentTime + when + dur); }
  g.gain.setValueAtTime(0, a.currentTime + when);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + when + dur);
  o.connect(g); g.connect(master);
  o.start(a.currentTime + when);
  o.stop(a.currentTime + when + dur + 0.05);
}

function noise(dur, gain = 0.3, lowpass = 1200) {
  if (muted) { return; }
  const a = ctx();
  const len = a.sampleRate * dur;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) { d[i] = (Math.random() * 2 - 1) * (1 - i / len); }
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = lowpass;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(master);
  src.start();
}

function roomTone() {
  // breathing bar-room hush (soft, not the R6 drone mistake)
  const a = ac;
  const o = a.createOscillator();
  o.type = 'triangle'; o.frequency.value = 68;
  const g = a.createGain(); g.gain.value = 0.012;
  const lfo = a.createOscillator(); lfo.frequency.value = 0.13;
  const lg = a.createGain(); lg.gain.value = 0.006;
  lfo.connect(lg); lg.connect(g.gain);
  o.connect(g); g.connect(master);
  o.start(); lfo.start();
}

export function cue(kind) {
  switch (kind) {
    case 'doorchime': tone(880, 0.25, 'sine', 0.12); tone(1174, 0.35, 'sine', 0.1, 0.12); break;
    case 'ordertaken': tone(520, 0.08, 'square', 0.05); break;
    case 'served': tone(660, 0.1, 'sine', 0.1); tone(990, 0.16, 'sine', 0.08, 0.08); break;
    case 'pay': tone(1320, 0.06, 'square', 0.06); tone(1760, 0.1, 'square', 0.05, 0.06); break;
    case 'complaint': tone(220, 0.3, 'sawtooth', 0.06, 0, 180); break;
    case 'telegraph': tone(392, 0.12, 'triangle', 0.08); tone(370, 0.14, 'triangle', 0.07, 0.16); break;
    case 'gunfire': noise(0.5, 0.6, 900); tone(60, 0.4, 'sine', 0.3, 0, 40); break;
    case 'gunout': tone(140, 0.4, 'sawtooth', 0.05, 0, 90); break;
    case 'glassbreak': noise(0.2, 0.25, 4000); break;
    case 'squeal': tone(700, 0.3, 'sawtooth', 0.08, 0, 1100); break;
    case 'slip': tone(300, 0.18, 'sine', 0.08, 0, 120); break;
    case 'fryersmoke': noise(0.6, 0.12, 500); break;
    case 'song': { const notes = [392, 494, 587, 494, 392, 330, 392]; notes.forEach((n, i) => tone(n, 0.22, 'triangle', 0.09, i * 0.19)); break; }
    case 'gameover': { [523, 494, 392, 330].forEach((n, i) => tone(n, 0.4, 'sine', 0.1, i * 0.3)); break; }
    case 'throw': noise(0.14, 0.12, 2600); break;
    case 'catch': tone(880, 0.06, 'square', 0.07); tone(1320, 0.08, 'square', 0.06, 0.05); break;
    case 'bonk': tone(150, 0.16, 'square', 0.14, 0, 85); noise(0.07, 0.16, 700); break;
    case 'tourbus': noise(0.9, 0.16, 420); tone(92, 0.7, 'sawtooth', 0.05); break;
    case 'busgone': tone(220, 0.28, 'square', 0.1, 0, 180); tone(220, 0.4, 'square', 0.1, 0.34, 170); break;
    default: break;
  }
}

export const EVENT_CUES = {
  arrive: 'doorchime', ordertaken: 'ordertaken', served: 'served', waitpay: 'pay',
  complaint: 'complaint', telegraph: 'telegraph', gunfire: 'gunfire', gunout: 'gunout',
  glassbreak: 'glassbreak', pigout: 'squeal', pigeat: 'squeal', slip: 'slip',
  fryersmoke: 'fryersmoke', song: 'song', gameover: 'gameover',
  throw: 'throw', catch: 'catch', bonk: 'bonk', tourbus: 'tourbus', busgone: 'busgone',
  kegdry: 'complaint', kegtapped: 'served', kegdrop: 'telegraph',
};
