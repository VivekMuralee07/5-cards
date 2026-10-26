/* 5 Cards — all sounds are synthesized with Web Audio, so there are no audio files to host. */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('fc5_muted') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, start);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, start + (opts.glide || dur));
    const peak = opts.gain == null ? 0.4 : opts.gain;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let node = o;
    if (opts.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; o.connect(f); node = f; }
    if (opts.vibrato) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = opts.vibrato; lg.gain.value = freq * 0.03;
      lfo.connect(lg); lg.connect(o.frequency); lfo.start(start); lfo.stop(start + dur);
    }
    node.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }

  function noise(start, dur, opts) {
    opts = opts || {};
    const c = ac(); if (!c) return;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = opts.filter || 'highpass';
    f.frequency.setValueAtTime(opts.freq || 2000, start);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
    f.Q.value = opts.q || 0.8;
    const g = c.createGain(); g.gain.value = opts.gain == null ? 0.3 : opts.gain;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(start);
  }

  const S = {
    // Card slapped on the table: crisp click on top of a deep bass thump.
    play(count) {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      const hits = Math.max(1, Math.min(count || 1, 4));
      for (let i = 0; i < hits; i++) {
        const s = t + i * 0.07;
        noise(s, 0.035, { freq: 2600, gain: 0.45 });
        tone(140, s, 0.32, { to: 42, glide: 0.22, gain: 0.95 });
        tone(55, s, 0.4, { gain: 0.5, lp: 180 });
      }
    },
    draw() {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      noise(t, 0.16, { filter: 'bandpass', freq: 900, to: 3800, q: 1.2, gain: 0.35 });
      tone(90, t + 0.02, 0.15, { to: 60, gain: 0.35 });
    },
    select() {
      const c = ac(); if (!c || muted) return;
      tone(1300, c.currentTime, 0.05, { type: 'triangle', gain: 0.12 });
    },
    deal() {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      for (let i = 0; i < 6; i++) noise(t + i * 0.06, 0.05, { filter: 'bandpass', freq: 1800 + i * 150, gain: 0.25 });
    },
    turn() {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      tone(784, t, 0.35, { type: 'triangle', gain: 0.18 });
      tone(1175, t + 0.09, 0.45, { type: 'triangle', gain: 0.14 });
    },
    shook() {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      tone(220, t, 0.6, { type: 'sawtooth', to: 55, glide: 0.5, gain: 0.35, lp: 900 });
      tone(48, t, 0.7, { gain: 1.0 });
      noise(t, 0.4, { filter: 'lowpass', freq: 400, gain: 0.5 });
      [523, 659, 784].forEach((f, i) => tone(f, t + 0.25 + i * 0.03, 0.5, { type: 'square', gain: 0.07, lp: 2400 }));
    },
    win() {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => tone(f, t + i * 0.11, 0.4, { type: 'triangle', gain: 0.22 }));
      [130.8, 196, 261.6].forEach((f, i) => tone(f, t + i * 0.22, 0.6, { gain: 0.6, lp: 400 }));
      tone(1046.5, t + 0.8, 1.2, { type: 'triangle', gain: 0.2, vibrato: 6 });
      tone(65.4, t + 0.8, 1.2, { gain: 0.8 });
      for (let i = 0; i < 10; i++) tone(2000 + Math.random() * 2000, t + 0.9 + i * 0.07, 0.15, { type: 'sine', gain: 0.05 });
    },
    lose() {
      const c = ac(); if (!c || muted) return;
      const t = c.currentTime;
      const notes = [392, 370, 349.2, 329.6];
      notes.forEach((f, i) => {
        const last = i === notes.length - 1;
        tone(f, t + i * 0.42, last ? 1.3 : 0.4, { type: 'sawtooth', gain: 0.22, lp: 1100, vibrato: last ? 5 : 0, to: last ? f * 0.94 : null, glide: 1.2 });
        tone(f / 4, t + i * 0.42, last ? 1.3 : 0.4, { gain: 0.6, lp: 200 });
      });
    },
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('fc5_muted', muted ? '1' : '0'); } catch (e) {}
      if (!muted) S.select();
      return muted;
    },
    unlock() { ac(); }
  };
  FC.Sound = S;
})(typeof window !== 'undefined' ? window : globalThis);
