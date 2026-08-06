// THE LAST LOCAL — proximity voice over the PeerJS mesh. THE friendslop
// feature: your friend's voice gets quieter across the room and pans toward
// where they actually are. Opt-in (mic button); view-only — the sim never
// knows anyone can talk.
export class VoiceMesh {
  constructor(peer, myPid) {
    this.peer = peer;
    this.myPid = myPid;
    this.remote = new Map(); // pid -> {call, gain, pan, el}
    this.roster = [];        // [{pid, peer}]
    this.stream = null;
    this.enabled = false;
    this.ac = null;
    this._answering = false;
  }

  setRoster(list) {
    this.roster = list || [];
    if (this.enabled) { this.dial(); }
  }

  async enable() {
    if (this.enabled) { return true; }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') { this.ac.resume(); }
    this.enabled = true;
    if (!this._answering) {
      this._answering = true;
      this.peer.on('call', (call) => {
        if (!this.enabled) { return; }
        call.answer(this.stream);
        this.wire(call, call.metadata && call.metadata.pid);
      });
    }
    this.dial();
    return true;
  }

  dial() {
    for (const r of this.roster) {
      if (r.pid === this.myPid || this.remote.has(r.pid)) { continue; }
      if (r.pid < this.myPid) { continue; } // smaller pid calls larger: one call per pair
      try {
        const call = this.peer.call(r.peer, this.stream, { metadata: { pid: this.myPid } });
        if (call) { this.wire(call, r.pid); }
      } catch { /* peer unreachable; roster refresh will retry */ }
    }
  }

  wire(call, pid) {
    call.on('stream', (remoteStream) => {
      // Chrome quirk: a MediaStream must feed a (muted) media element or the
      // WebAudio graph gets silence
      const el = new Audio();
      el.srcObject = remoteStream;
      el.muted = true;
      el.play().catch(() => { /* autoplay policies; WebAudio path still works after gesture */ });
      const src = this.ac.createMediaStreamSource(remoteStream);
      const gain = this.ac.createGain();
      gain.gain.value = 0.5;
      const pan = this.ac.createStereoPanner();
      src.connect(gain);
      gain.connect(pan);
      pan.connect(this.ac.destination);
      this.remote.set(pid, { call, gain, pan, el });
    });
    call.on('close', () => { this.remote.delete(pid); });
    call.on('error', () => { this.remote.delete(pid); });
  }

  /** Per-frame: distance rolloff + stereo pan from the actual room. */
  update(game, myPid) {
    if (!this.enabled || !game) { return; }
    const me = game.players[myPid];
    if (!me) { return; }
    for (const [pid, r] of this.remote) {
      const other = game.players[pid];
      if (!other) { continue; }
      const d = Math.hypot(other.x - me.x, other.z - me.z);
      const g = Math.pow(Math.max(0, 1 - (d / 15)), 1.35);
      r.gain.gain.value = Math.max(0.03, g);
      r.pan.pan.value = Math.max(-0.9, Math.min(0.9, (other.x - me.x) / 8));
    }
  }

  disable() {
    this.enabled = false;
    if (this.stream) { for (const tr of this.stream.getTracks()) { tr.stop(); } }
    for (const [, r] of this.remote) { try { r.call.close(); } catch { /* already down */ } }
    this.remote.clear();
  }
}
