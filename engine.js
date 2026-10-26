/* 5 Cards — rules engine (runs on the host only; clients get filtered views) */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];

  function cardValue(c) {
    if (c.r === 'JK') return 0;
    if (c.r === 'A') return 1;
    if (c.r === '10' || c.r === 'J' || c.r === 'Q' || c.r === 'K') return 10;
    return parseInt(c.r, 10);
  }
  function rankOrder(r) { return r === 'JK' ? 0 : RANKS.indexOf(r) + 1; }
  function makeDeck() {
    const d = []; let id = 0;
    for (const s of SUITS) for (const r of RANKS) d.push({ id: id++, r, s });
    d.push({ id: id++, r: 'JK', s: 'R' });
    d.push({ id: id++, r: 'JK', s: 'B' });
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function handTotal(h) { return h.reduce((s, c) => s + cardValue(c), 0); }
  function sortHand(h) {
    return h.slice().sort((a, b) => cardValue(a) - cardValue(b) || rankOrder(a.r) - rankOrder(b.r) || a.id - b.id);
  }
  function cardLabel(c) { return c.r === 'JK' ? 'Joker' : c.r + c.s; }

  class Engine {
    constructor(opts) {
      opts = opts || {};
      this.limit = opts.limit || 100;
      this.penalty = opts.penalty || 50;
      this.players = [];
      this.phase = 'lobby';
      this.round = 0;
      this.deck = [];
      this.discard = [];
      this.turn = 0;
      this.starter = -1;
      this.turnCount = 0;
      this.known = {};       // SERVER/BOT ONLY: cards each player took from the open pile. Never sent to clients.
      this.gameId = null;
      this.log = [];
      this.evSeq = 0;
      this.lastEv = null;
      this.result = null;
      this.winners = null;
      this.onChange = null;
    }

    changed() { if (this.onChange) this.onChange(); }
    idx(id) { return this.players.findIndex(p => p.id === id); }
    emit(ev, text) {
      this.evSeq++;
      this.lastEv = Object.assign({ seq: this.evSeq }, ev);
      if (text) {
        this.log.push({ seq: this.evSeq, text });
        if (this.log.length > 40) this.log.shift();
      }
    }

    addPlayer(p) {
      if (this.phase !== 'lobby') throw new Error('The game has already started');
      if (this.players.length >= 5) throw new Error('This room is full (5 players max)');
      this.players.push(Object.assign({ isBot: false, difficulty: 'medium', key: null }, p,
        { hand: [], score: 0, history: [], connected: true }));
      this.known[p.id] = new Set();
      this.changed();
    }

    removePlayer(id) {
      const i = this.idx(id);
      if (i < 0) return;
      if (this.phase !== 'lobby') throw new Error('Players can only be removed in the lobby');
      this.players.splice(i, 1);
      delete this.known[id];
      this.changed();
    }

    startGame() {
      if (this.players.length < 2) throw new Error('You need at least 2 players to start');
      this.players.forEach(p => { p.score = 0; p.history = []; });
      this.round = 0;
      this.winners = null;
      this.log = [];
      this.gameId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.starter = Math.floor(Math.random() * this.players.length);
      this.startRound(true);
    }

    startRound(first) {
      this.round++;
      this.deck = shuffle(makeDeck());
      this.players.forEach(p => { p.hand = this.deck.splice(0, 5); this.known[p.id] = new Set(); });
      this.discard = [this.deck.pop()];
      if (!first) this.starter = (this.starter + 1) % this.players.length;
      this.turn = this.starter;
      this.turnCount = 0;
      this.phase = 'playing';
      this.result = null;
      this.emit({ type: 'deal', round: this.round },
        `Round ${this.round} dealt. ${this.players[this.turn].name} starts.`);
      this.changed();
    }

    reshuffle() {
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = top ? [top] : [];
      this.log.push({ seq: this.evSeq, text: 'Deck ran out, so the discard pile was reshuffled.' });
    }

    play(id, cardIds, source) {
      if (this.phase !== 'playing') throw new Error('No round in progress');
      const pi = this.idx(id);
      if (pi !== this.turn) throw new Error("It's not your turn");
      const p = this.players[pi];
      if (!Array.isArray(cardIds) || cardIds.length === 0) throw new Error('Select at least one card to play');
      const ids = [...new Set(cardIds)];
      const cards = ids.map(cid => p.hand.find(c => c.id === cid));
      if (cards.some(c => !c)) throw new Error('That card is not in your hand');
      if (cards.some(c => c.r !== cards[0].r)) throw new Error('Cards played together must share the same rank');

      if (source === 'discard' && this.discard.length === 0) source = 'deck';
      let drawn;
      if (source === 'discard') {
        drawn = this.discard.pop();
      } else {
        source = 'deck';
        if (this.deck.length === 0) this.reshuffle();
        drawn = this.deck.pop();
      }

      p.hand = p.hand.filter(c => !ids.includes(c.id));
      cards.forEach(c => this.known[id].delete(c.id));
      p.hand.push(drawn);
      if (source === 'discard') this.known[id].add(drawn.id);
      this.discard.push(...cards);
      if (this.deck.length === 0) this.reshuffle();

      this.turnCount++;
      this.emit({
        type: 'play', player: id, cards, source,
        drawnId: drawn.id      // only ever delivered to the player who drew it (see viewFor)
      }, `${p.name} played ${cards.map(cardLabel).join(' ')} and took ${source === 'discard' ? 'the open card' : 'a card from the deck'}.`);
      this.turn = (this.turn + 1) % this.players.length;
      this.changed();
    }

    shook(id) {
      if (this.phase !== 'playing') throw new Error('No round in progress');
      const pi = this.idx(id);
      if (pi !== this.turn) throw new Error("You can only call SHOOK on your turn");
      const caller = this.players[pi];
      const callerTotal = handTotal(caller.hand);
      const others = this.players.filter((_, i) => i !== pi);
      const minOther = Math.min(...others.map(o => handTotal(o.hand)));
      // Someone has less        -> caller scores the penalty (50).
      // Best tie (nobody less)   -> caller scores their own hand total, like everyone else.
      // Caller is strictly lowest -> caller scores 0.
      let outcome = 'win', callerPoints = 0;
      if (callerTotal > minOther) { outcome = 'caught'; callerPoints = this.penalty; }
      else if (callerTotal === minOther) { outcome = 'tie'; callerPoints = callerTotal; }
      const success = outcome === 'win';
      const rows = this.players.map(pl => {
        const total = handTotal(pl.hand);
        const points = pl.id === id ? callerPoints : total;
        pl.score += points;
        pl.history.push(points);
        return { id: pl.id, hand: sortHand(pl.hand), total, points, score: pl.score };
      });
      this.result = { caller: id, callerName: caller.name, outcome, success, callerTotal, rows };
      const over = this.players.some(pl => pl.score >= this.limit);
      if (over) {
        const best = Math.min(...this.players.map(pl => pl.score));
        this.winners = this.players.filter(pl => pl.score === best).map(pl => pl.id);
        this.phase = 'gameOver';
      } else {
        this.phase = 'roundEnd';
      }
      const what = outcome === 'win' ? 'had the lowest hand (0 points)'
        : outcome === 'tie' ? `tied for lowest and scores ${callerTotal}`
        : `was caught (+${this.penalty})`;
      this.emit({ type: 'shook', player: id, success, outcome }, `${caller.name} called SHOOK with ${callerTotal} points and ${what}.`);
      this.changed();
    }

    nextRound() {
      if (this.phase !== 'roundEnd') throw new Error('The round is not over yet');
      this.startRound(false);
    }

    backToLobby() {
      this.phase = 'lobby';
      this.players.forEach(p => { p.hand = []; p.score = 0; p.history = []; });
      this.result = null;
      this.winners = null;
      this.round = 0;
      this.changed();
    }

    // What one player is allowed to know. Opponents are only ever a face-down count.
    viewFor(id) {
      const me = this.idx(id);
      let ev = this.lastEv;
      if (ev && ev.type === 'play' && ev.player !== id) {
        ev = Object.assign({}, ev);
        delete ev.drawnId;          // card ids map to real cards, so an opponent's draw must stay hidden
      }
      return {
        phase: this.phase, round: this.round, turn: this.turn, starter: this.starter,
        limit: this.limit, penalty: this.penalty, me, gameId: this.gameId,
        players: this.players.map(pl => ({
          id: pl.id, name: pl.name, avatar: pl.avatar, isBot: pl.isBot, difficulty: pl.difficulty,
          takeover: !!pl.takeover, score: pl.score, history: pl.history,
          handCount: pl.hand.length, connected: pl.connected, voice: !!pl.voice
        })),
        hand: me >= 0 ? sortHand(this.players[me].hand) : [],
        deckCount: this.deck.length,
        discard: this.discard.slice(-3),
        evSeq: this.evSeq, lastEv: ev,
        log: this.log.slice(-25),
        result: this.result, winners: this.winners
      };
    }
  }

  Object.assign(FC, { Engine, cardValue, handTotal, makeDeck, shuffle, sortHand, cardLabel, RANKS, SUITS });
})(typeof window !== 'undefined' ? window : globalThis);
