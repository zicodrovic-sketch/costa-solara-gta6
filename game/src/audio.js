// Costa Solara — procedural WebAudio sound, no audio files. Everything is wrapped in
// try/catch: headless runs (and browsers without audio) must never throw.
// The AudioContext is created in unlock(), on first user interaction — never here.
// Continuous sounds (engine, siren) build their nodes once and only retune them;
// one-shots (blip, thud, jingle, crash, cash) build short envelopes per call.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineNodes = null;
  let sirenNodes = null;

  /** Create the context and the shared nodes. Safe to call repeatedly; no-ops after the first. */
  function unlock() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);

      // Engine: sawtooth through a lowpass, retuned per frame by engine().
      const engOsc = ctx.createOscillator();
      engOsc.type = 'sawtooth';
      engOsc.frequency.value = 60;
      const engFilter = ctx.createBiquadFilter();
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 420;
      const engGain = ctx.createGain();
      engGain.gain.value = 0;
      engOsc.connect(engFilter);
      engFilter.connect(engGain);
      engGain.connect(master);
      engOsc.start();
      engineNodes = { osc: engOsc, filter: engFilter, gain: engGain };

      // Siren: triangle wave wailing between two tones on a slow LFO.
      const sirOsc = ctx.createOscillator();
      sirOsc.type = 'triangle';
      sirOsc.frequency.value = 800;
      const sirGain = ctx.createGain();
      sirGain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.55;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 160;
      lfo.connect(lfoGain);
      lfoGain.connect(sirOsc.frequency);
      sirOsc.connect(sirGain);
      sirGain.connect(master);
      sirOsc.start();
      lfo.start();
      sirenNodes = { gain: sirGain };
    } catch {
      // No audio in this environment; every method below stays silent.
    }
  }

  /** Mute or unmute the master gain. Works before unlock() too (applies when built). */
  function setMuted(value) {
    muted = !!value;
    try {
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
    } catch {
      // Ignore.
    }
  }

  /**
   * Engine hum: on/off plus speed 0..1. Retunes the shared oscillator — no new
   * nodes per frame, so calling this every frame is cheap.
   */
  function engine(on, speed01) {
    try {
      if (!ctx || !engineNodes) return;
      const speed = Math.max(0, Math.min(1, speed01 || 0));
      engineNodes.osc.frequency.setTargetAtTime(55 + speed * 165, ctx.currentTime, 0.05);
      engineNodes.filter.frequency.setTargetAtTime(380 + speed * 900, ctx.currentTime, 0.05);
      engineNodes.gain.gain.setTargetAtTime(on ? 0.045 + speed * 0.03 : 0, ctx.currentTime, 0.08);
    } catch {
      // Ignore.
    }
  }

  /** Police siren on/off: fades the shared triangle + LFO pair in or out. */
  function siren(on) {
    try {
      if (!ctx || !sirenNodes) return;
      sirenNodes.gain.gain.setTargetAtTime(on ? 0.05 : 0, ctx.currentTime, 0.15);
    } catch {
      // Ignore.
    }
  }

  /** One short sine blip with a fast decay envelope (UI tick / pickup). */
  function blip() {
    oneShot('sine', 880, 660, 0.09, 0.12);
  }

  /** One low thud: a sine dropping fast in pitch (punch / bump). */
  function thud() {
    oneShot('sine', 130, 45, 0.16, 0.22);
  }

  /** One bright two-note jingle (mission complete). */
  function jingle() {
    oneShot('sine', 660, 660, 0.12, 0.14);
    setTimeout(() => oneShot('sine', 990, 990, 0.18, 0.14), 110);
  }

  /** One harsh burst: detuned sawtooth through a lowpass (crash). */
  function crash() {
    try {
      if (!ctx || !master) return;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Ignore.
    }
  }

  /** One cash-register chime: two high notes, quick and bright. */
  function cash() {
    oneShot('sine', 1320, 1320, 0.1, 0.12);
    setTimeout(() => oneShot('sine', 1760, 1760, 0.16, 0.12), 90);
  }

  /** Helper: a single sine (or given type) gliding start->end Hz with an exponential decay. */
  function oneShot(type, startHz, endHz, seconds, volume) {
    try {
      if (!ctx || !master) return;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(startHz, ctx.currentTime);
      if (endHz !== startHz) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), ctx.currentTime + seconds);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + seconds + 0.02);
    } catch {
      // Ignore.
    }
  }

  return {
    unlock,
    setMuted,
    get muted() {
      return muted;
    },
    engine,
    siren,
    blip,
    thud,
    jingle,
    crash,
    cash,
  };
}
