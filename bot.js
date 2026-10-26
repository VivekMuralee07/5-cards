/* 5 Cards — bot brains. Bots only use information a human could see:
   their own hand, the open pile, hand sizes, and cards others took from the open pile. */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const val = c => FC.cardValue(c);
  const FULL = FC.makeDeck();

  const PROFILES = {
    easy:   { noise: 3.0, pairBonus: 0.0, sizeBonus: 0.3, bias: 0, threshold: 0.50, mc: 120, revealCost: 0 },
    medium: { noise: 1.0, pairBonus: 0.4, sizeBonus: 0.8, bias: 1, threshold: 0.68, mc: 250, revealCost: 0.3 },
    hard:   { noise: 0.0, pairBonus: 0.6, sizeBonus: 1.0, bias: 0, threshold: 0.60, mc: 400, revealCost: 0.6 }
  };

  // Probability that `total` is strictly lower than every opponent's hand.
  function winProbability(total, opps, pool, bias, samples) {
    if (!pool.length) return 0.5;
    let wins = 0;
    const work = pool.slice();
    for (let s = 0; s < samples; s++) {
      FC.shuffle(work);
      let ptr = 0, ok = true;
      for (const o of opps) {
        let sum = o.knownSum;
        if (o.unknown > 0) {
          const take = Math.min(o.unknown + bias, work.length - ptr);
          const drawn = work.slice(ptr, ptr + take).map(val).sort((a, b) => a - b);
          ptr += take;
          for (let i = 0; i < Math.min(o.unknown, drawn.length); i++) sum += drawn[i];
        }
        if (sum <= total) { ok = false; break; }
      }
      if (ok) wins++;
    }
    return wins / samples;
  }

  function decide(E, pi) {
    const me = E.players[pi];
    const prof = PROFILES[me.difficulty] || PROFILES.medium;
    const hand = me.hand;
    const T = FC.handTotal(hand);
    const top = E.discard[E.discard.length - 1];
    const n = E.players.length;

    // Cards whose location is unknown to me.
    const excluded = new Set(hand.map(c => c.id));
    E.discard.forEach(c => excluded.add(c.id));
    const opps = [];
    E.players.forEach((p, i) => {
      if (i === pi) return;
      const knownCards = [...(E.known[p.id] || [])].map(id => p.hand.find(c => c.id === id)).filter(Boolean);
      knownCards.forEach(c => excluded.add(c.id));
      opps.push({ knownSum: knownCards.reduce((s, c) => s + val(c), 0), unknown: p.hand.length - knownCards.length, score: p.score });
    });
    const pool = FULL.filter(c => !excluded.has(c.id));
    const mean = pool.length ? pool.reduce((s, c) => s + val(c), 0) / pool.length : 6.3;

    // ---- SHOOK? ----
    const laps = Math.floor(E.turnCount / n);
    const bias = me.difficulty === 'hard' ? Math.min(3, prof.bias + Math.floor(laps / 2)) : prof.bias;
    const p = winProbability(T, opps, pool, bias, prof.mc);
    let threshold = prof.threshold;
    if (me.difficulty === 'hard') {
      if (me.score + E.penalty >= E.limit) threshold += 0.12;   // a failed call would knock me out
      if (T <= 3) threshold -= 0.1;
      if (E.turnCount < n) threshold += 0.05;                    // everyone still holds 5 cards
    }
    if (me.difficulty === 'easy' && Math.random() < 0.2) threshold += 0.25; // easy bots hesitate
    if (p >= threshold) return { action: 'shook' };

    // ---- Which cards to play, and where to draw from ----
    const groups = {};
    hand.forEach(c => { (groups[c.r] = groups[c.r] || []).push(c); });
    let best = null;
    for (const r in groups) {
      const g = groups[r];
      const rest = hand.filter(c => c.r !== r);
      const restSum = FC.handTotal(rest);
      const restRanks = new Set(rest.map(c => c.r));
      const maxVal = Math.max(...g.map(val));
      const shape = -prof.sizeBonus * (g.length - 1) - 0.01 * maxVal;
      const noise = () => (Math.random() * 2 - 1) * prof.noise;

      const options = [{ source: 'deck', score: restSum + mean + shape + noise() }];
      if (top) {
        let tv = val(top);
        if (restRanks.has(top.r)) tv -= prof.pairBonus * Math.max(tv, 2);
        options.push({ source: 'discard', score: restSum + tv + prof.revealCost + shape + noise() });
      }
      for (const o of options) {
        if (!best || o.score < best.score) best = { cardIds: g.map(c => c.id), source: o.source, score: o.score };
      }
    }
    return { action: 'play', cardIds: best.cardIds, source: best.source };
  }

  const NAMES = ['Robo Ravi', 'Chip', 'Pixel Priya', 'Bolt', 'Nova', 'Turbo Tara', 'Zippy', 'Byte Bhai', 'Echo', 'Sparky'];
  FC.Bot = { decide, NAMES, winProbability };
})(typeof window !== 'undefined' ? window : globalThis);
