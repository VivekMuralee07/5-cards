/* 5 Cards — user interface */
(function () {
  'use strict';
  const FC = window.FC;
  const Sound = FC.Sound;

  const AVATARS = [
    ['🦁', '#E0A93B'], ['🐯', '#E8743B'], ['🦊', '#D9572B'], ['🐼', '#8FA3B8'], ['🐨', '#7C8DA6'],
    ['🐸', '#5FAF6B'], ['🐵', '#A9744F'], ['🦄', '#C58AD8'], ['🐲', '#3F9E7E'], ['🐙', '#D9667A'],
    ['🦉', '#9C7A4F'], ['🐺', '#6C7A91'], ['🤖', '#4FA3C7'], ['👑', '#D4A537'], ['😎', '#E6B84A'],
    ['🥷', '#5A5A72'], ['🐘', '#8E9AAF'], ['🦚', '#2F8F8A']
  ];
  FC.AVATAR_COUNT = AVATARS.length;
  const EMOTES = ['👍', '😂', '😮', '😤', '🔥', '🙏'];

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fc5_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fc5_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const sstore = {
    get(k, d) { try { const v = sessionStorage.getItem('fc5_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem('fc5_' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    name: store.get('name', ''),
    avatar: store.get('avatar', Math.floor(Math.random() * AVATARS.length)),
    key: sstore.get('key', null),
    session: null, view: null, selected: new Set(),
    lastSeq: 0, lastEmote: 0, resultSeq: 0, modal: null, busy: false, emoteOpen: false
  };
  if (!S.key) { S.key = Math.random().toString(36).slice(2) + Date.now().toString(36); sstore.set('key', S.key); }
  const app = $('#app');

  // ---------- building blocks ----------
  function avatarHTML(i, cls) {
    const a = AVATARS[(i | 0) % AVATARS.length] || AVATARS[0];
    return `<span class="av ${cls || ''}" style="--av:${a[1]}" aria-hidden="true">${a[0]}</span>`;
  }
  const isRed = c => (c.r === 'JK' ? c.s === 'R' : c.s === '♥' || c.s === '♦');
  const COURT = { J: '♞', Q: '♛', K: '♚' };
  function cardHTML(c, cls, attrs) {
    cls = cls || ''; attrs = attrs || '';
    if (!c) return `<div class="card back ${cls}" ${attrs}><span class="medal">5</span></div>`;
    const color = isRed(c) ? 'red' : 'black';
    const label = esc(FC.cardLabel(c)) + ', ' + FC.cardValue(c) + ' points';
    if (c.r === 'JK') {
      return `<div class="card face joker ${color} ${cls}" data-cid="${c.id}" aria-label="${label}" ${attrs}>
        <span class="corner">★</span><span class="jk-star">★</span><span class="jk-word">Joker</span><span class="pts">0</span></div>`;
    }
    const center = COURT[c.r]
      ? `<span class="court"><b>${COURT[c.r]}</b></span>`
      : `<span class="pip">${c.s}</span>`;
    return `<div class="card face ${color} ${cls}" data-cid="${c.id}" aria-label="${label}" ${attrs}>
      <span class="corner">${c.r}<small>${c.s}</small></span>${center}<span class="pts">${FC.cardValue(c)}</span></div>`;
  }
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }
  const me = v => v.players[v.me];
  const isMyTurn = v => v.phase === 'playing' && v.turn === v.me;
  const amHost = v => v.myId === v.hostId;
  const shareLink = code => location.origin + location.pathname + '?room=' + code;

  // ---------- home ----------
  function renderHome(prefillCode) {
    S.screen = 'home';
    const fan = [{ r: 'A', s: '♠' }, { r: '2', s: '♥' }, { r: 'JK', s: 'R' }, { r: '3', s: '♣' }, { r: 'K', s: '♦' }]
      .map((c, i) => cardHTML(Object.assign({ id: 'f' + i }, c), 'fan-card', `style="--i:${i - 2}"`)).join('');
    app.innerHTML = `
    <main class="home">
      <header class="brand">
        <div class="fan" aria-hidden="true">${fan}</div>
        <h1>5 Cards</h1>
        <p class="tag">Keep your hand low. Call SHOOK when you’re sure. First to 100 loses.</p>
      </header>
      <section class="panel" aria-label="Set up your player">
        <label class="field"><span>Your name</span>
          <input id="name" maxlength="16" autocomplete="nickname" placeholder="Enter a name" value="${esc(S.name)}"></label>
        <div class="field"><span>Avatar</span>
          <div class="avpick" role="radiogroup" aria-label="Choose an avatar">
            ${AVATARS.map((a, i) => `<button class="avbtn ${i === S.avatar ? 'on' : ''}" role="radio" aria-checked="${i === S.avatar}" data-act="avatar" data-i="${i}" style="--av:${a[1]}">${a[0]}</button>`).join('')}
          </div></div>
        <div class="actions">
          <button class="btn primary" data-act="solo">Play with bots</button>
          <button class="btn" data-act="create">Create a room</button>
          <div class="join">
            <input id="code" maxlength="5" placeholder="Room code" autocapitalize="characters" autocomplete="off" value="${esc(prefillCode || '')}" aria-label="Room code">
            <button class="btn" data-act="join">Join</button>
          </div>
        </div>
        <button class="link" data-act="rules">How to play</button>
      </section>
    </main>`;
    if (prefillCode) $('#name').focus();
  }

  function readMe() {
    const name = ($('#name') ? $('#name').value : S.name).trim();
    if (!name) { toast('Enter your name first.', 'bad'); $('#name') && $('#name').focus(); return null; }
    S.name = name; store.set('name', name); store.set('avatar', S.avatar);
    return { name, avatar: S.avatar, key: S.key };
  }

  async function begin(kind, autoCode) {
    if (S.busy) return;
    const meInfo = autoCode ? { name: S.name || 'Player', avatar: S.avatar, key: S.key } : readMe();
    if (!meInfo) return;
    Sound.unlock();
    let code = '';
    if (kind === 'join') {
      code = autoCode || ($('#code').value || '').toUpperCase().trim();
      if (!code) { toast('Type the room code you were sent.', 'bad'); $('#code').focus(); return; }
    }
    const opts = { me: meInfo, onView, onError: onSessionError, onStatus: m => toast(m) };
    const session = kind === 'solo'
      ? new FC.Net.Local(opts)
      : new FC.Net.Remote(Object.assign(opts, { mode: kind, code }));
    S.busy = true;
    const label = kind === 'join' ? (autoCode ? 'Rejoining room…' : 'Joining room…') : kind === 'create' ? 'Opening a room…' : 'Shuffling…';
    showBusy(label);
    const note = kind === 'solo' ? 0 : setTimeout(() => {
      const p = $('#busy p');
      if (p) p.innerHTML = esc(label) + '<br><small>The free server may be waking up. This can take up to a minute.</small>';
    }, 4000);
    try {
      S.session = session;
      S.lastSeq = 0; S.view = null; S.selected.clear();
      await session.start();
      if (kind !== 'solo') {
        history.replaceState(null, '', location.pathname + '?room=' + session.code);
        sstore.set('session', { code: session.code, t: Date.now() });
      }
    } catch (e) {
      S.session = null;
      sstore.set('session', null);
      renderHome(kind === 'join' ? code : '');
      toast(e.message, 'bad');
    } finally { clearTimeout(note); S.busy = false; hideBusy(); }
  }
  function showBusy(msg) {
    const b = document.createElement('div');
    b.className = 'busy'; b.id = 'busy';
    b.innerHTML = `<div class="spinner" aria-hidden="true">${cardHTML(null)}</div><p>${esc(msg)}</p>`;
    document.body.appendChild(b);
  }
  function hideBusy() { const b = $('#busy'); if (b) b.remove(); }

  function onSessionError(msg, soft) {
    if (soft) { toast(msg, 'bad'); return; }
    sstore.set('session', null);
    S.modal = { type: 'gone', msg };
    if (S.view) render(S.view); else { renderHome(); toast(msg, 'bad'); }
  }

  function leave() {
    if (S.session) {
      const v = S.view;
      if (v && !v.local && (v.phase === 'playing' || v.phase === 'roundEnd') &&
          !confirm('Leave this game? A bot will take your seat.')) return;
      S.session.leave();
    }
    S.session = null; S.view = null; S.modal = null;
    sstore.set('session', null);
    history.replaceState(null, '', location.pathname);
    renderHome();
  }

  // ---------- lobby ----------
  function renderLobby(v) {
    const host = amHost(v);
    const seats = [];
    for (let i = 0; i < 5; i++) {
      const p = v.players[i];
      if (!p) { seats.push(`<li class="seat-row empty"><span class="av ghost" aria-hidden="true">+</span><span>Open seat</span></li>`); continue; }
      const tags = [];
      if (p.id === v.hostId) tags.push('Host');
      if (p.id === v.myId) tags.push('You');
      if (!p.connected && !p.isBot) tags.push('Offline');
      const level = p.isBot
        ? (host ? `<select data-act="botLevel" data-id="${p.id}" aria-label="Bot level for ${esc(p.name)}">
              ${['easy', 'medium', 'hard'].map(l => `<option value="${l}" ${p.difficulty === l ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)} bot</option>`).join('')}
            </select>` : `<span class="tagpill">${p.difficulty} bot</span>`)
        : '';
      seats.push(`<li class="seat-row">${avatarHTML(p.avatar)}
        <span class="nm">${esc(p.name)} ${tags.map(t => `<span class="tagpill">${t}</span>`).join('')}</span>
        ${level}
        ${host && p.id !== v.myId ? `<button class="x" data-act="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </li>`);
    }
    const full = v.players.length >= 5;
    app.innerHTML = `
    <main class="lobby">
      ${topbar(v, false)}
      <section class="room">
        ${v.local
          ? `<h2>Practice table</h2><p class="muted">Add up to four bots, then start.</p>`
          : `<p class="muted">Share this code with friends</p>
             <div class="code" aria-label="Room code ${v.code.split('').join(' ')}">${v.code.split('').map(ch => `<span>${ch}</span>`).join('')}</div>
             <div class="row"><button class="btn small" data-act="copy">Copy invite link</button>
             ${navigator.share ? '<button class="btn small" data-act="share">Share</button>' : ''}</div>`}
      </section>
      <ol class="seats">${seats.join('')}</ol>
      ${host ? `
        <div class="addbots"><span>Add a bot</span>
          ${['easy', 'medium', 'hard'].map(l => `<button class="btn small" data-act="addBot" data-level="${l}" ${full ? 'disabled' : ''}>${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}
        </div>
        <button class="btn primary big" data-act="start" ${v.players.length < 2 ? 'disabled' : ''}>Start game</button>
        ${v.players.length < 2 ? '<p class="muted center">You need at least 2 players.</p>' : ''}`
        : `<p class="waiting">Waiting for the host to start<span class="dots"><i></i><i></i><i></i></span></p>`}
    </main>${modalHTML(v)}`;
  }

  function topbar(v, inGame) {
    return `<nav class="topbar">
      <button class="iconbtn" data-act="leave" aria-label="Leave">✕</button>
      ${inGame ? `<span class="roundpill">Round ${v.round}</span>` : '<span></span>'}
      <span class="spacer"></span>
      ${!v.local && v.code ? `<button class="codepill" data-act="copy" aria-label="Copy invite link">Room ${v.code}</button>` : ''}
      ${inGame ? `<button class="iconbtn" data-act="scores" aria-label="Scoreboard">📊</button>
                  <button class="iconbtn" data-act="log" aria-label="Game log">📜</button>` : ''}
      <button class="iconbtn" data-act="rules" aria-label="Rules">?</button>
      <button class="iconbtn" data-act="mute" aria-label="${Sound.muted ? 'Unmute' : 'Mute'}">${Sound.muted ? '🔇' : '🔊'}</button>
    </nav>`;
  }

  // ---------- table ----------
  function seatHTML(p, i, v) {
    const active = v.phase === 'playing' && v.turn === i;
    const knownIds = new Set(p.known.map(c => c.id));
    const minis = p.known.map(c => cardHTML(c, 'mini')).join('') +
      Array.from({ length: Math.max(0, p.handCount - knownIds.size) }, () => cardHTML(null, 'mini')).join('');
    return `<div class="seat ${active ? 'active' : ''} ${p.connected ? '' : 'offline'}" data-pid="${p.id}">
      <div class="seat-av">${avatarHTML(p.avatar, 'lg')}
        ${active ? '<span class="thinking"><i></i><i></i><i></i></span>' : ''}
        <span class="bubble" hidden></span></div>
      <div class="seat-name">${esc(p.name)}${p.isBot ? ` <span class="bot">${p.takeover ? 'auto' : 'bot'}</span>` : ''}</div>
      <div class="seat-score" title="Score">${p.score}<small>/${v.limit}</small></div>
      <div class="minis">${minis}</div>
    </div>`;
  }

  function renderTable(v) {
    const mine = me(v);
    const n = v.players.length;
    const order = [];
    for (let k = 1; k < n; k++) order.push((v.me + k) % n);
    const myTurn = isMyTurn(v);
    // Drop selections that are no longer in hand.
    const handIds = new Set(v.hand.map(c => c.id));
    [...S.selected].forEach(id => { if (!handIds.has(id)) S.selected.delete(id); });
    const sel = S.selected.size > 0;
    const total = FC.handTotal(v.hand);
    const cur = v.players[v.turn];
    let status;
    if (v.phase !== 'playing') status = 'Round over';
    else if (myTurn) status = sel ? 'Now take a card: tap the deck or the open card.' : 'Your turn. Pick card(s) to play, or call SHOOK.';
    else status = `${esc(cur.name)} is playing…`;
    const lastLog = v.log.length ? v.log[v.log.length - 1].text : '';
    const ev = v.lastEv;
    const fresh = ev && ev.type === 'play' && ev.player === v.myId ? ev.drawnId : null;
    const discard = v.discard.map((c, i) => cardHTML(c, 'pile-card', `style="--r:${((c.id * 37) % 15) - 7}deg;--z:${i}"`)).join('');

    app.innerHTML = `
    <main class="table ${ev && ev.type === 'deal' && ev.seq !== S.lastSeq ? 'dealing' : ''}">
      ${topbar(v, true)}
      <section class="felt">
        <div class="opps n${order.length}">${order.map(i => seatHTML(v.players[i], i, v)).join('')}</div>
        <div class="center">
          <button class="pile deck ${myTurn && sel ? 'ready' : ''}" id="deck" data-act="take" data-src="deck" aria-label="Take from the deck, ${v.deckCount} cards left">
            <span class="stack">${cardHTML(null)}${cardHTML(null)}${cardHTML(null)}</span>
            <span class="pile-label">Deck · ${v.deckCount}</span>
          </button>
          <button class="pile open ${myTurn && sel ? 'ready' : ''}" id="open" data-act="take" data-src="discard" aria-label="Take the open card${v.discard.length ? ', ' + esc(FC.cardLabel(v.discard[v.discard.length - 1])) : ''}">
            <span class="stack">${discard}</span>
            <span class="pile-label">Open card</span>
          </button>
        </div>
        <p class="ticker" role="status">${esc(lastLog)}</p>
      </section>
      <section class="mine ${myTurn ? 'myturn' : ''}">
        <div class="me-info">
          ${avatarHTML(mine.avatar)}
          <span class="nm">${esc(mine.name)}</span>
          <span class="stat">Score <b>${mine.score}</b></span>
          <span class="stat">Hand <b>${total}</b></span>
          <span class="spacer"></span>
          <div class="emotes ${S.emoteOpen ? 'open' : ''}">
            <button class="iconbtn" data-act="emotes" aria-label="Send a reaction">😀</button>
            <div class="emote-row">${EMOTES.map(e => `<button data-act="emote" data-e="${e}">${e}</button>`).join('')}</div>
          </div>
        </div>
        <div class="hand" role="group" aria-label="Your hand">
          ${v.hand.map((c, i) => cardHTML(c, `${S.selected.has(c.id) ? 'sel' : ''} ${c.id === fresh ? 'fresh' : ''}`,
            `role="button" tabindex="0" aria-pressed="${S.selected.has(c.id)}" data-act="card" style="--d:${i}"`)).join('')}
        </div>
        <div class="controls">
          <p class="status">${status}</p>
          <button class="shook" data-act="shook" ${myTurn ? '' : 'disabled'} aria-label="Call SHOOK">SHOOK</button>
        </div>
      </section>
    </main>${modalHTML(v)}`;
  }

  // ---------- modals ----------
  function modalHTML(v) {
    let inner = '';
    const m = S.modal;
    if (m && m.type === 'gone') {
      inner = `<div class="sheet"><h2>Room closed</h2><p>${esc(m.msg)}</p><button class="btn primary" data-act="home">Back to home</button></div>`;
    } else if (m && m.type === 'confirm') {
      inner = `<div class="sheet small"><h2>Call SHOOK?</h2>
        <p>Your hand is worth <b>${FC.handTotal(v.hand)}</b>. If anyone has the same or less, you take ${v.penalty} points.</p>
        <div class="row"><button class="btn" data-act="close">Keep playing</button><button class="btn danger" data-act="shook-yes">Call SHOOK</button></div></div>`;
    } else if (m && m.type === 'rules') {
      inner = rulesHTML();
    } else if (m && m.type === 'scores' && v) {
      const rounds = Math.max(0, ...v.players.map(p => p.history.length));
      inner = `<div class="sheet"><h2>Scoreboard</h2><div class="scroll"><table class="scores">
        <thead><tr><th>Player</th>${Array.from({ length: rounds }, (_, i) => `<th>R${i + 1}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${v.players.map(p => `<tr><td>${avatarHTML(p.avatar, 'sm')} ${esc(p.name)}</td>
          ${p.history.map(h => `<td>${h}</td>`).join('')}<td><b>${p.score}</b></td></tr>`).join('')}</tbody></table></div>
        <button class="btn" data-act="close">Close</button></div>`;
    } else if (m && m.type === 'log' && v) {
      inner = `<div class="sheet"><h2>What happened</h2><ol class="log">${v.log.slice().reverse().map(l => `<li>${esc(l.text)}</li>`).join('')}</ol>
        <button class="btn" data-act="close">Close</button></div>`;
    } else if (v && (v.phase === 'roundEnd' || v.phase === 'gameOver') && v.result) {
      inner = resultHTML(v);
    }
    return inner ? `<div class="overlay ${!m && v && v.result && S.resultSeq === v.evSeq ? 'instant' : ''}" ${m ? 'data-act="close-bg"' : ''}>${inner}</div>` : '';
  }

  function resultHTML(v) {
    const r = v.result;
    const over = v.phase === 'gameOver';
    const host = amHost(v);
    const callerP = v.players.find(p => p.id === r.caller);
    const won = over && v.winners.includes(v.myId);
    const head = over
      ? `<div class="trophy">${won ? '🏆' : '👏'}</div><h2>${won ? 'You win!' : esc(v.players.filter(p => v.winners.includes(p.id)).map(p => p.name).join(' & ')) + ' wins'}</h2>
         <p class="muted">${esc(v.players.filter(p => p.score >= v.limit).map(p => p.name).join(' & '))} reached ${v.limit}.</p>`
      : `<h2>Round ${v.round}</h2>`;
    const verdict = `<p class="verdict ${r.success ? 'ok' : 'bad'}">${esc(callerP ? callerP.name : r.callerName)} called SHOOK with ${r.callerTotal}
      ${r.success ? 'and had the lowest hand: 0 points.' : `but someone had ${r.callerTotal === Math.min(...r.rows.filter(x => x.id !== r.caller).map(x => x.total)) ? 'the same' : 'less'}: +${v.penalty}.`}</p>`;
    const rows = r.rows.slice().sort((a, b) => {
      const pa = v.players.find(p => p.id === a.id), pb = v.players.find(p => p.id === b.id);
      return over ? pa.score - pb.score : 0;
    }).map(row => {
      const p = v.players.find(x => x.id === row.id) || { name: '?', avatar: 0 };
      return `<li class="${row.id === r.caller ? 'caller' : ''} ${over && v.winners.includes(row.id) ? 'winner' : ''}">
        ${avatarHTML(p.avatar, 'sm')}<span class="nm">${esc(p.name)}</span>
        <span class="cards">${row.hand.map(c => cardHTML(c, 'tiny')).join('')}</span>
        <span class="sum">${row.total}</span>
        <span class="plus ${row.points === 0 ? 'zero' : ''}">+${row.points}</span>
        <span class="tot">${row.score}</span></li>`;
    }).join('');
    const btn = over
      ? (host ? `<button class="btn primary" data-act="again">Play again</button>` : `<p class="muted">Waiting for the host…</p>`) + `<button class="btn" data-act="leave">Leave</button>`
      : (host ? `<button class="btn primary" data-act="next">Deal next round</button>` : `<p class="muted">Waiting for the host to deal…</p>`);
    return `<div class="sheet result ${over ? 'final' : ''}">${head}${verdict}
      <ul class="results"><li class="hdr"><span></span><span class="nm">Player and hand</span><span class="cards"></span><span class="sum">Hand</span><span class="plus">Round</span><span class="tot">Total</span></li>${rows}</ul>
      <div class="row">${btn}</div></div>`;
  }

  function rulesHTML() {
    return `<div class="sheet rules"><h2>How to play</h2>
      <ol>
        <li>Everyone gets 5 cards from a 54-card deck (two jokers). One card is turned face up as the open card. A random player starts and play goes clockwise.</li>
        <li>Card points: Joker 0, Ace 1, 2–9 face value, 10/J/Q/K are 10 each. Suits don’t matter.</li>
        <li>On your turn, play one card, or several cards of the same rank together. Then take one card: from the deck, or the open card left by the previous player.</li>
        <li>Instead of playing, you can call <b>SHOOK</b> when you think your hand is the lowest.</li>
        <li>If your total is lower than everyone else’s, you score 0 and everyone else scores their hand. If anyone has the same or less, you score 50 and they still score their hands.</li>
        <li>The game ends when someone reaches 100. The lowest total wins.</li>
      </ol>
      <p class="muted">Tip: cards someone took from the open pile stay face up next to their seat, so you know part of their hand.</p>
      <button class="btn primary" data-act="close">Got it</button></div>`;
  }

  // ---------- view updates, sounds, animations ----------
  function render(v) {
    if (v.phase === 'lobby') renderLobby(v); else renderTable(v);
  }

  const rectOf = el => (el ? el.getBoundingClientRect() : null);
  function shrinkTo(rect, ref) {
    if (!rect) return null;
    const w = ref ? ref.width * 0.55 : 40, h = w * 1.4;
    return { left: rect.left + rect.width / 2 - w / 2, top: rect.top + rect.height / 2 - h / 2, width: w, height: h };
  }
  function fly(html, from, to, opts) {
    opts = opts || {};
    return new Promise(res => {
      if (!from || !to || reduceMotion) return res();
      const wrap = document.createElement('div');
      wrap.className = 'flyer';
      wrap.innerHTML = html;
      wrap.style.setProperty('--cw', from.width + 'px');
      Object.assign(wrap.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
      document.body.appendChild(wrap);
      const dx = to.left - from.left, dy = to.top - from.top, sx = to.width / from.width, sy = to.height / from.height;
      const a = wrap.animate([
        { transform: 'translate(0,0) scale(1,1) rotate(0deg)' },
        { transform: `translate(${dx * 0.6}px,${dy * 0.6 - 30}px) scale(${(1 + sx) / 2 * 1.08},${(1 + sy) / 2 * 1.08}) rotate(${(opts.rot || 0) / 2}deg)`, offset: 0.6 },
        { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy}) rotate(${opts.rot || 0}deg)` }
      ], { duration: opts.dur || 430, delay: opts.delay || 0, easing: 'cubic-bezier(.25,.8,.25,1)', fill: 'forwards' });
      a.onfinish = () => { wrap.remove(); res(); };
    });
  }

  function onView(v) {
    const prev = S.view;
    S.view = v;
    if (S.screen === 'home' && !S.session) return;
    S.screen = v.phase === 'lobby' ? 'lobby' : 'table';
    if (v.phase === 'lobby') { S.selected.clear(); S.modal = S.modal && S.modal.type === 'gone' ? S.modal : null; }

    const ev = v.lastEv;
    const isNew = ev && ev.seq !== S.lastSeq;
    let pre = null;
    if (isNew && ev.type === 'play' && prev && prev.phase === 'playing' && $('.table')) {
      const mine = ev.player === v.myId;
      pre = {
        cards: ev.cards.map(c => (mine ? rectOf($(`.hand [data-cid="${c.id}"]`)) : null)),
        seat: rectOf($(`.seat[data-pid="${ev.player}"] .seat-av`)),
        src: rectOf(ev.source === 'discard' ? $('#open .stack .card:last-child') : $('#deck .stack .card:last-child'))
      };
    }
    if (isNew && ev.type === 'play' && ev.player === v.myId) S.selected.clear();
    if (isNew && ev.type === 'deal') { S.selected.clear(); S.modal = null; Sound.deal(); }

    render(v);

    if (pre) animatePlay(ev, pre, v);
    if (isNew && ev.type === 'shook') onShook(ev, v);

    // Reactions
    if (v.emote && v.emote.seq !== S.lastEmote) {
      S.lastEmote = v.emote.seq;
      showEmote(v.emote);
    } else if (v.emote) S.lastEmote = v.emote.seq;

    // Your-turn chime
    if (v.phase === 'playing' && isMyTurn(v) && (!prev || prev.turn !== v.turn || prev.phase !== 'playing')) {
      setTimeout(() => Sound.turn(), pre ? 550 : 250);
      if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) try { navigator.vibrate(30); } catch (e) {}
    }
    if (ev) S.lastSeq = ev.seq;
  }

  function animatePlay(ev, pre, v) {
    const mine = ev.player === v.myId;
    const pileCards = [...document.querySelectorAll('#open .stack .card')];
    const n = ev.cards.length;
    const landing = pileCards.slice(-Math.min(n, pileCards.length));
    const pileRect = rectOf(pileCards[pileCards.length - 1]);
    landing.forEach(el => el.classList.add('pending'));
    let drawTarget = mine ? $(`.hand [data-cid="${ev.drawnId}"]`) : $(`.seat[data-pid="${ev.player}"] .seat-av`);
    if (mine && drawTarget) drawTarget.classList.add('pending');

    const plays = ev.cards.map((c, i) => {
      const from = pre.cards[i] || shrinkTo(pre.seat, pileRect);
      return fly(cardHTML(c), from, pileRect, { delay: i * 70, rot: ((c.id * 37) % 15) - 7 });
    });
    Promise.all(plays).then(() => {
      landing.forEach(el => el.classList.remove('pending'));
      Sound.play(n);
      const pile = $('#open'); if (pile) { pile.classList.remove('thud'); void pile.offsetWidth; pile.classList.add('thud'); }
    });

    setTimeout(() => {
      Sound.draw();
      const drawnCard = mine ? v.hand.find(c => c.id === ev.drawnId) : ev.drawnPublic;
      const to = mine ? rectOf(drawTarget) : shrinkTo(rectOf(drawTarget), pileRect);
      fly(cardHTML(drawnCard || null), pre.src, to, { dur: 480 }).then(() => {
        if (drawTarget) drawTarget.classList.remove('pending');
      });
    }, reduceMotion ? 0 : 330);
  }

  function onShook(ev, v) {
    const p = v.players.find(x => x.id === ev.player);
    Sound.shook();
    const splash = document.createElement('div');
    splash.className = 'splash ' + (ev.success ? 'ok' : 'bad');
    splash.innerHTML = `<span class="word">SHOOK!</span><span class="who">${esc(p ? p.name : '')}</span>`;
    document.body.appendChild(splash);
    setTimeout(() => splash.remove(), 1500);
    S.resultSeq = -1;
    setTimeout(() => {
      S.resultSeq = ev.seq;
      if (v.phase === 'gameOver') {
        const won = v.winners.includes(v.myId);
        if (won) { Sound.win(); confetti(); } else Sound.lose();
      }
    }, 1300);
  }

  function showEmote(em) {
    let target = $(`.seat[data-pid="${em.id}"] .bubble`);
    if (!target && S.view && em.id === S.view.myId) target = null;
    if (target) {
      target.textContent = em.e; target.hidden = false;
      target.classList.remove('pop'); void target.offsetWidth; target.classList.add('pop');
      setTimeout(() => { target.hidden = true; }, 2200);
    } else {
      const p = S.view && S.view.players.find(x => x.id === em.id);
      toast(`${p ? p.name : ''} ${em.e}`);
    }
  }

  // ---------- confetti ----------
  function confetti() {
    if (reduceMotion) return;
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.display = 'block';
    ctx.scale(dpr, dpr);
    const colors = ['#E0A93B', '#FBF5E6', '#B3202A', '#4CC38A', '#4FA3C7', '#C58AD8'];
    const parts = Array.from({ length: 180 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0]
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(p => {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); ctx.restore();
      });
      if (t - t0 < 4200) requestAnimationFrame(frame);
      else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; }
    })(t0);
  }

  // ---------- input ----------
  function act(el, e) {
    const a = el.dataset.act;
    const v = S.view;
    const send = msg => S.session && S.session.send(msg);
    switch (a) {
      case 'avatar':
        S.avatar = +el.dataset.i; store.set('avatar', S.avatar); Sound.select();
        document.querySelectorAll('.avbtn').forEach(b => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
        return;
      case 'solo': return begin('solo');
      case 'create': return begin('create');
      case 'join': return begin('join');
      case 'rules': S.modal = { type: 'rules' }; return v && S.session ? render(v) : showRulesHome();
      case 'close': case 'close-bg':
        if (a === 'close-bg' && e.target !== el) return;
        if (S.modal && S.modal.type === 'gone') return;
        S.modal = null; if (S.session && v) render(v); else { const o = $('.overlay'); o && o.remove(); }
        return;
      case 'home': S.modal = null; return leave();
      case 'leave': return leave();
      case 'mute': Sound.toggleMute(); return v && S.session ? render(v) : null;
      case 'copy': {
        const link = shareLink(v.code);
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
          .then(() => toast('Invite link copied.'), () => toast('Room code: ' + v.code));
        return;
      }
      case 'share':
        navigator.share({ title: '5 Cards', text: `Join my 5 Cards room: ${v.code}`, url: shareLink(v.code) }).catch(() => {});
        return;
      case 'addBot': Sound.select(); return send({ t: 'addBot', difficulty: el.dataset.level });
      case 'remove': return send({ t: 'remove', id: el.dataset.id });
      case 'start': Sound.unlock(); return send({ t: 'start' });
      case 'next': S.modal = null; return send({ t: 'next' });
      case 'again': S.modal = null; return send({ t: 'lobby' });
      case 'scores': S.modal = { type: 'scores' }; return render(v);
      case 'log': S.modal = { type: 'log' }; return render(v);
      case 'emotes': S.emoteOpen = !S.emoteOpen; return render(v);
      case 'emote': S.emoteOpen = false; send({ t: 'emote', e: el.dataset.e }); return render(v);
      case 'card': {
        if (!v || v.phase !== 'playing') return;
        const id = +el.dataset.cid;
        const card = v.hand.find(c => c.id === id);
        if (!card) return;
        const first = v.hand.find(c => S.selected.has(c.id));
        if (S.selected.has(id)) S.selected.delete(id);
        else { if (first && first.r !== card.r) S.selected.clear(); S.selected.add(id); }
        Sound.select();
        return render(v);
      }
      case 'take': {
        if (!v || v.phase !== 'playing') return;
        if (!isMyTurn(v)) return toast(`Wait for ${v.players[v.turn].name} to finish.`);
        if (!S.selected.size) return toast('First tap the card(s) you want to play.');
        send({ t: 'play', cards: [...S.selected], source: el.dataset.src });
        return;
      }
      case 'shook':
        if (!v || !isMyTurn(v)) return;
        S.modal = { type: 'confirm' }; return render(v);
      case 'shook-yes': S.modal = null; send({ t: 'shook' }); return;
    }
  }
  function showRulesHome() {
    const o = document.createElement('div');
    o.className = 'overlay'; o.dataset.act = 'close-bg'; o.innerHTML = rulesHTML();
    app.appendChild(o);
  }

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    Sound.unlock();
    act(el, e);
  });
  app.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'botLevel') S.session.send({ t: 'botLevel', id: el.dataset.id, difficulty: el.value });
  });
  app.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card[data-act]')) { e.preventDefault(); act(e.target, e); }
    if (e.key === 'Enter' && e.target.id === 'code') begin('join');
    if (e.key === 'Escape' && S.modal && S.modal.type !== 'gone') { S.modal = null; if (S.view && S.session) render(S.view); else { const o = $('.overlay'); o && o.remove(); } }
  });
  app.addEventListener('input', e => {
    if (e.target.id === 'code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase();
  const saved = sstore.get('session', null);
  renderHome(urlRoom);
  // Reloaded the page, or the phone put the tab to sleep? Slide back into the same seat.
  if (saved && saved.code && Date.now() - saved.t < 6 * 3600 * 1000 && S.name && (!urlRoom || urlRoom === saved.code)) {
    begin('join', saved.code);
  }
})();
