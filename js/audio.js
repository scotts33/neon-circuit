/**
 * Procedural Web Audio for Neon Circuit — SFX + lightweight BGM loop.
 * Separate music / SFX gain buses. Safe no-op without AudioContext (Node tests).
 */
(function (root) {
  "use strict";

  var ctx = null;
  var master = null;
  var sfxBus = null;
  var musicBus = null;
  var engineOsc = null;
  var engineGain = null;
  var sfxVolume = 0.7;
  var musicVolume = 0.35;
  var muted = false; // SFX bus zeroed by volume slider
  var musicMuted = false; // music bus zeroed by volume slider
  /** Master mute — silences all audio while keeping slider levels */
  var masterMuted = false;
  var started = false;
  var musicNodes = null; // { oscs, gains, intervalId or nextNote }
  var musicTimer = null;
  var musicStep = 0;

  // Layered race beds (not licensed music): lead + bass + pad patterns
  var MUSIC_STYLES = {
    default: {
      lead: [196, 247, 294, 330, 392, 330, 294, 247],
      bass: [98, 98, 110, 98, 123, 110, 98, 87],
      pad: [392, 0, 494, 0, 587, 0, 494, 0],
      tempoMs: 300,
    },
    night: {
      lead: [220, 262, 330, 392, 330, 294, 262, 196],
      bass: [110, 110, 98, 110, 131, 98, 110, 82],
      pad: [440, 0, 523, 0, 659, 0, 523, 0],
      tempoMs: 280,
    },
    desert: {
      lead: [185, 220, 277, 330, 370, 330, 277, 220],
      bass: [92, 92, 110, 92, 123, 110, 92, 82],
      pad: [370, 0, 440, 0, 554, 0, 440, 0],
      tempoMs: 340,
    },
    rain: {
      lead: [175, 208, 262, 311, 349, 311, 262, 208],
      bass: [87, 87, 98, 87, 116, 98, 87, 78],
      pad: [349, 0, 415, 0, 523, 0, 415, 0],
      tempoMs: 320,
    },
  };
  var MUSIC_NOTES = MUSIC_STYLES.default.lead;
  var musicStyleId = "default";
  var engineOsc2 = null;
  var engineGain2 = null;
  var ambienceTimer = null;

  function ensure() {
    // Still create context when master-muted so unmute works without delay
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = masterMuted ? 0 : 1;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = masterMuted || muted ? 0 : sfxVolume;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = masterMuted || musicMuted ? 0 : musicVolume;
      musicBus.connect(master);
    } catch (e) {
      ctx = null;
      return null;
    }
    return ctx;
  }

  function applyBusGains() {
    if (master) master.gain.value = masterMuted ? 0 : 1;
    if (sfxBus) {
      sfxBus.gain.value =
        masterMuted || muted || sfxVolume <= 0.001 ? 0 : sfxVolume;
    }
    if (musicBus) {
      musicBus.gain.value =
        masterMuted || musicMuted || musicVolume <= 0.001 ? 0 : musicVolume;
    }
  }

  /** Master mute (SFX + music). Does not change volume sliders. */
  function setMuted(on) {
    masterMuted = !!on;
    applyBusGains();
    return masterMuted;
  }

  function isMuted() {
    return !!masterMuted;
  }

  function toggleMute() {
    return setMuted(!masterMuted);
  }

  /** Legacy: sets SFX volume (keeps old call sites working). */
  function setVolume(v) {
    setSfxVolume(v);
  }

  function getVolume() {
    return sfxVolume;
  }

  function setSfxVolume(v) {
    sfxVolume = Math.max(0, Math.min(1, v == null ? 0.7 : v));
    muted = sfxVolume <= 0.001;
    applyBusGains();
  }

  function getSfxVolume() {
    return sfxVolume;
  }

  function setMusicVolume(v) {
    musicVolume = Math.max(0, Math.min(1, v == null ? 0.35 : v));
    musicMuted = musicVolume <= 0.001;
    applyBusGains();
  }

  function getMusicVolume() {
    return musicVolume;
  }

  function resume() {
    var c = ensure();
    if (c && c.state === "suspended" && c.resume) c.resume();
    started = true;
  }

  function beep(freq, dur, type, gainVal, when) {
    var c = ensure();
    if (!c || !sfxBus) return;
    if (masterMuted || muted || sfxVolume <= 0.001) return;
    var t0 = when != null ? when : c.currentTime;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(
      gainVal != null ? gainVal : 0.12,
      t0 + 0.01
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, gainVal, hpFreq) {
    var c = ensure();
    if (!c || !sfxBus) return;
    if (masterMuted || muted || sfxVolume <= 0.001) return;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource();
    src.buffer = buf;
    var g = c.createGain();
    var t0 = c.currentTime;
    g.gain.setValueAtTime(gainVal != null ? gainVal : 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (hpFreq && c.createBiquadFilter) {
      var f = c.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hpFreq;
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function play(name) {
    resume();
    var c = ensure();
    if (!c) return;
    if (name === "boost") {
      beep(180, 0.08, "sawtooth", 0.1);
      beep(320, 0.18, "sawtooth", 0.08, c.currentTime + 0.05);
      beep(520, 0.12, "triangle", 0.06, c.currentTime + 0.12);
    } else if (name === "item") {
      beep(660, 0.06, "square", 0.08);
      beep(880, 0.08, "square", 0.07, c.currentTime + 0.06);
      beep(1100, 0.1, "triangle", 0.06, c.currentTime + 0.12);
    } else if (name === "missile") {
      beep(120, 0.15, "sawtooth", 0.12);
      noiseBurst(0.2, 0.1, 400);
    } else if (name === "hit" || name === "explode") {
      noiseBurst(0.35, 0.22, 80);
      beep(90, 0.25, "sawtooth", 0.15);
    } else if (name === "oil") {
      beep(200, 0.1, "triangle", 0.06);
      noiseBurst(0.12, 0.06, 200);
    } else if (name === "mine") {
      beep(140, 0.12, "square", 0.1);
      noiseBurst(0.18, 0.1, 120);
      beep(90, 0.15, "sawtooth", 0.08, c.currentTime + 0.08);
    } else if (name === "shield") {
      beep(440, 0.08, "sine", 0.08);
      beep(660, 0.12, "sine", 0.07, c.currentTime + 0.07);
    } else if (name === "shock") {
      noiseBurst(0.25, 0.14, 600);
      beep(900, 0.08, "square", 0.08);
      beep(400, 0.15, "sawtooth", 0.1, c.currentTime + 0.05);
    } else if (name === "drift") {
      noiseBurst(0.08, 0.04, 900);
    } else if (name === "driftBoost") {
      beep(240, 0.1, "sawtooth", 0.1);
      beep(480, 0.15, "triangle", 0.08, c.currentTime + 0.06);
    } else if (name === "lap") {
      beep(520, 0.08, "sine", 0.09);
      beep(780, 0.12, "sine", 0.08, c.currentTime + 0.08);
    } else if (name === "finish") {
      beep(392, 0.12, "triangle", 0.1);
      beep(523, 0.12, "triangle", 0.1, c.currentTime + 0.12);
      beep(659, 0.2, "triangle", 0.12, c.currentTime + 0.24);
    } else if (name === "results") {
      beep(330, 0.1, "sine", 0.1);
      beep(440, 0.12, "sine", 0.1, c.currentTime + 0.1);
      beep(554, 0.18, "triangle", 0.12, c.currentTime + 0.22);
    } else if (name === "countdown") {
      beep(220, 0.12, "square", 0.12);
    } else if (name === "go") {
      beep(523, 0.1, "sawtooth", 0.12);
      beep(784, 0.2, "triangle", 0.14, c.currentTime + 0.08);
    } else if (name === "placeUp") {
      beep(660, 0.07, "square", 0.09);
      beep(880, 0.1, "triangle", 0.08, c.currentTime + 0.06);
    } else if (name === "taunt") {
      beep(300, 0.06, "square", 0.07);
      beep(380, 0.1, "sawtooth", 0.06, c.currentTime + 0.05);
    } else if (name === "replay") {
      beep(440, 0.08, "sine", 0.08);
      beep(554, 0.12, "triangle", 0.07, c.currentTime + 0.1);
    } else if (name === "wrongWay") {
      beep(160, 0.15, "square", 0.07);
    } else if (name === "pickup") {
      play("item");
    } else if (name === "itemTick") {
      beep(500 + Math.random() * 400, 0.035, "square", 0.04);
    } else if (name === "itemReady") {
      beep(880, 0.07, "square", 0.09);
      beep(1320, 0.12, "triangle", 0.08, c.currentTime + 0.06);
    } else if (name === "fever") {
      beep(300, 0.1, "sawtooth", 0.1);
      beep(450, 0.12, "sawtooth", 0.09, c.currentTime + 0.08);
      beep(700, 0.18, "triangle", 0.1, c.currentTime + 0.16);
    } else {
      beep(440, 0.05, "sine", 0.05);
    }
  }

  /** Continuous dual-osc engine (fundamental + harmonic) driven by speed 0..1 */
  function updateEngine(speedFrac, boosting) {
    var c = ensure();
    if (!c || !sfxBus) return;
    speedFrac = Math.max(0, Math.min(1, speedFrac || 0));
    if (!engineOsc) {
      engineOsc = c.createOscillator();
      engineGain = c.createGain();
      engineOsc.type = "sawtooth";
      engineGain.gain.value = 0.0001;
      engineOsc.connect(engineGain);
      engineGain.connect(sfxBus);
      try {
        engineOsc.start();
      } catch (e) {}
    }
    if (!engineOsc2) {
      engineOsc2 = c.createOscillator();
      engineGain2 = c.createGain();
      engineOsc2.type = "triangle";
      engineGain2.gain.value = 0.0001;
      engineOsc2.connect(engineGain2);
      engineGain2.connect(sfxBus);
      try {
        engineOsc2.start();
      } catch (e2) {}
    }
    var base = 55 + speedFrac * 140;
    if (boosting) base *= 1.25;
    engineOsc.frequency.setTargetAtTime(base, c.currentTime, 0.05);
    engineOsc2.frequency.setTargetAtTime(base * 2.01, c.currentTime, 0.05);
    var g =
      masterMuted || muted || sfxVolume <= 0.001
        ? 0
        : 0.02 + speedFrac * 0.06 + (boosting ? 0.03 : 0);
    engineGain.gain.setTargetAtTime(
      Math.max(0.0001, g * sfxVolume),
      c.currentTime,
      0.08
    );
    engineGain2.gain.setTargetAtTime(
      Math.max(0.0001, g * 0.45 * sfxVolume),
      c.currentTime,
      0.08
    );
  }

  function stopEngine() {
    if (engineGain && ctx) {
      engineGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    }
    if (engineGain2 && ctx) {
      engineGain2.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    }
  }

  function getMusicStyle(id) {
    return MUSIC_STYLES[id] || MUSIC_STYLES.default;
  }

  /**
   * Pick layered bed from course theme / weather. Pure mapping for tests.
   */
  function musicStyleForCourse(courseMeta) {
    if (!courseMeta) return "default";
    if (courseMeta.weather === "rain" || courseMeta.timeOfDay === "night")
      return "rain";
    if (courseMeta.timeOfDay === "night") return "night";
    if (
      courseMeta.id === "dubai" ||
      courseMeta.id === "red-rock" ||
      (courseMeta.city && /rock|desert|dubai/i.test(courseMeta.city))
    )
      return "desert";
    if (courseMeta.id === "neo-tokyo-night") return "night";
    return "default";
  }

  function setMusicStyle(id) {
    musicStyleId = MUSIC_STYLES[id] ? id : "default";
    MUSIC_NOTES = getMusicStyle(musicStyleId).lead;
    return musicStyleId;
  }

  function scheduleMusicNote() {
    if (!ctx || !musicBus || masterMuted || musicMuted || musicVolume <= 0.001)
      return;
    var style = getMusicStyle(musicStyleId);
    var idx = musicStep % style.lead.length;
    musicStep++;
    var freq = style.lead[idx];
    var bass = style.bass[idx % style.bass.length];
    var pad = style.pad[idx % style.pad.length];
    var t0 = ctx.currentTime;

    function tone(f, type, peak, dur) {
      if (!f || f <= 0) return;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(musicBus);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    // Lead + bass + optional pad = 3-layer production bed
    tone(freq, "triangle", 0.042, 0.28);
    tone(bass, "sine", 0.055, 0.32);
    if (pad) tone(pad, "sine", 0.014, 0.36);
    // Soft octave shimmer
    tone(freq * 2, "sine", 0.012, 0.3);
  }

  function scheduleAmbience() {
    if (!ctx || !sfxBus || masterMuted || muted || sfxVolume <= 0.001) return;
    // Light noise bed tick (road whoosh) — production layer beyond one-shot beeps
    noiseBurst(0.05, 0.012 * sfxVolume, 300);
  }

  /**
   * Start looping procedural race bed (idempotent).
   * Uses setInterval when available; no-op in pure Node without timers still OK.
   */
  function startMusic(styleOrCourse) {
    resume();
    var c = ensure();
    if (!c || !musicBus) return false;
    if (styleOrCourse) {
      if (typeof styleOrCourse === "string" && MUSIC_STYLES[styleOrCourse]) {
        setMusicStyle(styleOrCourse);
      } else if (typeof styleOrCourse === "object") {
        setMusicStyle(musicStyleForCourse(styleOrCourse));
      }
    }
    if (musicTimer != null) return true;
    musicStep = 0;
    applyBusGains();
    scheduleMusicNote();
    var tempo = getMusicStyle(musicStyleId).tempoMs || 300;
    if (typeof root.setInterval === "function") {
      musicTimer = root.setInterval(function () {
        try {
          scheduleMusicNote();
        } catch (e) {}
      }, tempo);
      if (ambienceTimer == null) {
        ambienceTimer = root.setInterval(function () {
          try {
            scheduleAmbience();
          } catch (e2) {}
        }, 900);
      }
    }
    return true;
  }

  function stopMusic() {
    if (musicTimer != null && typeof root.clearInterval === "function") {
      root.clearInterval(musicTimer);
    }
    if (ambienceTimer != null && typeof root.clearInterval === "function") {
      root.clearInterval(ambienceTimer);
    }
    musicTimer = null;
    ambienceTimer = null;
    musicStep = 0;
  }

  function isMusicPlaying() {
    return musicTimer != null;
  }

  /** Map race state.events[] to one-shots */
  function consumeEvents(events) {
    if (!events || !events.length) return;
    var i, e, n;
    for (i = 0; i < events.length; i++) {
      e = events[i];
      n = typeof e === "string" ? e : e && e.type;
      if (n) play(n);
    }
  }

  var api = {
    play: play,
    setVolume: setVolume,
    getVolume: getVolume,
    setSfxVolume: setSfxVolume,
    getSfxVolume: getSfxVolume,
    setMusicVolume: setMusicVolume,
    getMusicVolume: getMusicVolume,
    setMuted: setMuted,
    isMuted: isMuted,
    toggleMute: toggleMute,
    resume: resume,
    updateEngine: updateEngine,
    stopEngine: stopEngine,
    startMusic: startMusic,
    stopMusic: stopMusic,
    isMusicPlaying: isMusicPlaying,
    consumeEvents: consumeEvents,
    ensure: ensure,
    setMusicStyle: setMusicStyle,
    musicStyleForCourse: musicStyleForCourse,
    getMusicStyle: getMusicStyle,
    MUSIC_STYLES: MUSIC_STYLES,
  };

  root.NeoKartAudio = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
