/* 5 Cards — statistics.
   Every finished game is saved in this browser (localStorage) and shown on the home page. */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const KEY = 'fc5_stats_v1';
  const MAX_GAMES = 1000;
  const WIN = '#1E8E5A', LOSS = '#B3202A', LINE = '#9A6A1E', GRID = 'rgba(34,22,22,.16)', INK = '#221616', MUTED = 'rgba(34,22,22,.6)';

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && Array.isArray(d.games)) return d;
    } catch (e) {}
    return { games: [] };
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }

  // Saves a finished game once, even if the screen refreshes or the player reconnects.
  function record(g) {
    if (!g || !g.id) return false;
    const d = load();
    if (d.games.some(x => x.id === g.id)) return false;
    d.games.push({ id: g.id, t: Date.now(), won: !!g.won, score: g.score | 0, players: g.players | 0, mode: g.mode, rounds: g.rounds | 0 });
    if (d.games.length > MAX_GAMES) d.games.splice(0, d.games.length - MAX_GAMES);
    save(d);
    return true;
  }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function summary() {
    const games = load().games;
    const wins = games.filter(g => g.won).length;
    const losses = games.length - wins;
    return {
      games, total: games.length, wins, losses,
      rate: games.length ? wins / games.length : 0,
      ratio: losses ? wins / losses : (wins ? Infinity : 0)
    };
  }

  const pct = x => Math.round(x * 100) + '%';
  const ratioText = s => !s.total ? '—' : (s.ratio === Infinity ? '∞' : s.ratio.toFixed(2));

  function donut(s) {
    const r = 46, C = 2 * Math.PI * r, w = s.total ? C * s.wins / s.total : 0;
    const base = s.total ? LOSS : 'rgba(34,22,22,.12)';
    return `<svg viewBox="0 0 120 120" class="chart donut" role="img" aria-label="${s.wins} wins and ${s.losses} losses">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="${base}" stroke-width="16"/>
      ${s.wins ? `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${WIN}" stroke-width="16" stroke-dasharray="${w.toFixed(2)} ${(C - w).toFixed(2)}" transform="rotate(-90 60 60)"/>` : ''}
      <text x="60" y="62" text-anchor="middle" font-size="22" font-weight="800" fill="${INK}">${s.total ? pct(s.rate) : '—'}</text>
      <text x="60" y="78" text-anchor="middle" font-size="9.5" fill="${MUTED}">win rate</text></svg>`;
  }

  // Win rate after each game (cumulative), with a dot per game: green = win, red = loss.
  function trend(s) {
    if (!s.total) return '';
    const W = 320, H = 150, L = 34, R = 10, T = 12, B = 24;
    let w = 0;
    const all = s.games.map((g, i) => { if (g.won) w++; return { won: g.won, rate: w / (i + 1) }; });
    const pts = all.slice(-40);
    const n = pts.length;
    const x = i => n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1);
    const y = v => T + (1 - v) * (H - T - B);
    const grid = [0, 0.5, 1].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/>
      <text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="${MUTED}">${pct(v)}</text>`).join('');
    const line = n > 1 ? `<polyline fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')}"/>` : '';
    const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.rate).toFixed(1)}" r="3.4" fill="${p.won ? WIN : LOSS}" stroke="#fff" stroke-width="1"/>`).join('');
    const first = s.total - n + 1;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart trend" role="img" aria-label="Win rate over your last ${n} games">
      ${grid}${line}${dots}
      <text x="${n === 1 ? (L + W - R) / 2 : L}" y="${H - 6}" ${n === 1 ? 'text-anchor="middle"' : ''} font-size="9" fill="${MUTED}">game ${first}</text>
      ${n > 1 ? `<text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="9" fill="${MUTED}">game ${s.total}</text>` : ''}</svg>`;
  }

  // The whole statistics panel as HTML (used on the home page).
  function panelHTML() {
    const s = summary();
    if (!s.total) {
      return `<div class="sheet stats"><h2>Statistics</h2>
        <p class="muted">No finished games yet. Play a game to the end and your results will show up here.</p>
        <div class="row"><button class="btn primary" data-act="close">Close</button></div></div>`;
    }
    const tile = (label, value, cls) => `<div class="tile ${cls || ''}"><b>${value}</b><span>${label}</span></div>`;
    return `<div class="sheet stats"><h2>Statistics</h2>
      <div class="tiles">${tile('Games played', s.total)}${tile('Wins', s.wins, 'win')}${tile('Losses', s.losses, 'loss')}${tile('Win/loss ratio', ratioText(s))}</div>
      <div class="charts">
        <figure>${donut(s)}<figcaption>Wins vs losses</figcaption></figure>
        <figure class="wide">${trend(s)}<figcaption>Win rate after each game <span class="key"><i class="w"></i>win <i class="l"></i>loss</span></figcaption></figure>
      </div>
      <p class="muted small">Saved on this device. A win means you finished with the lowest score.</p>
      <div class="row"><button class="btn" data-act="reset-stats">Reset</button><button class="btn primary" data-act="close">Close</button></div></div>`;
  }

  FC.Stats = { record, reset, summary, panelHTML };
})(typeof window !== 'undefined' ? window : globalThis);
