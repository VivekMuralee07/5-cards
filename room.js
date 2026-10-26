/* 5 Cards — one game room.
   Pure game-room logic with no networking. It runs inside the Node server (online rooms)
   and inside the browser (offline practice table). A "connection" is any object with
   send(obj) and close(reason). */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  FC.AVATAR_COUNT = FC.AVATAR_COUNT || 18;

  const LOBBY_GRACE_MS = 30 * 1000;       // how long a dropped lobby player keeps their seat
  const EMPTY_ROOM_MS = 5 * 60 * 1000;    // how long a room with no humans stays alive
  const EMOTES = ['👍', '😂', '😮', '😤', '🔥', '🙏'];

  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  const newId = () => 'p' + Math.random().toString(36).slice(2, 10);

  class Room {
    constructor(opts) {
      opts = opts || {};
      this.code = opts.code || null;
      this.local = !!opts.local;
      this.onEmpty = opts.onEmpty || null;
      this.engine = new FC.Engine();
      this.engine.onChange = () => this.broadcast();
      this.conns = new Map();          // player id -> connection
      this.hostId = null;
      this.emote = null;
      this.closed = false;
      this.botTimer = null;
      this.emptyTimer = null;
      this.graceTimers = new Map();
    }

    // ---- helpers ----
    player(id) { return this.engine.players[this.engine.idx(id)]; }
    hasHumans() { return this.engine.players.some(p => !p.isBot && p.connected); }
    log(text) { this.engine.log.push({ seq: this.engine.evSeq, text }); if (this.engine.log.length > 40) this.engine.log.shift(); }

    fixHost() {
      const cur = this.player(this.hostId);
      if (cur && cur.connected && !cur.isBot) return;
      const next = this.engine.players.find(p => !p.isBot && p.connected);
      if (next) this.hostId = next.id;
    }

    dropPlayer(id) {
      clearTimeout(this.graceTimers.get(id));
      this.graceTimers.delete(id);
      this.conns.delete(id);
      if (this.player(id)) this.engine.removePlayer(id);
    }

    // ---- membership ----
    // Adds a player, or re-attaches someone who dropped (matched by their secret key).
    // Does not broadcast: the caller sends "welcome" first, then calls broadcast().
    join(info, conn) {
      info = info || {};
      const E = this.engine;
      const key = clean(info.key, 64) || null;
      const name = clean(info.name, 16) || 'Player';
      const avatar = Math.max(0, Math.min(FC.AVATAR_COUNT - 1, parseInt(info.avatar, 10) || 0));
      this.cancelEmpty();

      const back = key ? E.players.find(x => x.key === key) : null;
      if (back) {
        const old = this.conns.get(back.id);
        if (old && old !== conn) { try { old.close('You joined from another tab or device.'); } catch (e) {} }
        this.conns.set(back.id, conn);
        clearTimeout(this.graceTimers.get(back.id));
        this.graceTimers.delete(back.id);
        const wasAway = !back.connected || back.takeover;
        back.connected = true; back.isBot = false; back.takeover = false;
        if (wasAway && E.phase !== 'lobby') this.log(`${back.name} is back.`);
        if (!this.player(this.hostId)) this.hostId = back.id;
        return back.id;
      }

      if (E.phase !== 'lobby') throw new Error('That game has already started.');
      const id = newId();
      E.addPlayer({ id, name, avatar, key });
      this.conns.set(id, conn);
      if (!this.player(this.hostId)) this.hostId = id;
      return id;
    }

    // The connection for this player closed (network drop, tab closed, phone locked).
    detach(pid, conn) {
      if (this.conns.get(pid) !== conn) return;   // stale socket that was already replaced
      this.conns.delete(pid);
      const E = this.engine;
      const p = this.player(pid);
      if (!p) return;
      p.connected = false;
      p.voice = false;
      if (E.phase === 'lobby') {
        const t = setTimeout(() => {
          this.graceTimers.delete(pid);
          const q = this.player(pid);
          if (q && !q.connected && E.phase === 'lobby') { E.removePlayer(pid); this.fixHost(); }
          this.checkEmpty();
        }, LOBBY_GRACE_MS);
        this.graceTimers.set(pid, t);
      } else {
        // A bot keeps their seat warm until they come back.
        p.isBot = true; p.takeover = true; p.difficulty = 'medium';
        this.log(`${p.name} disconnected, so a bot is playing for them.`);
        this.fixHost();
      }
      this.broadcast();
      this.checkEmpty();
    }

    // The player chose to leave for good.
    leave(pid) {
      const E = this.engine;
      const p = this.player(pid);
      const conn = this.conns.get(pid);
      this.conns.delete(pid);
      if (!p) return;
      if (E.phase === 'lobby') {
        this.dropPlayer(pid);
      } else {
        p.connected = false; p.voice = false; p.isBot = true; p.takeover = true; p.key = null; p.difficulty = 'medium';
        this.log(`${p.name} left, so a bot is playing for them.`);
      }
      this.fixHost();
      this.broadcast();
      this.checkEmpty();
      if (conn) try { conn.close('left'); } catch (e) {}
    }

    checkEmpty() {
      if (this.local || this.closed) return;
      if (this.hasHumans()) return this.cancelEmpty();
      if (!this.emptyTimer) {
        this.emptyTimer = setTimeout(() => { this.close(); if (this.onEmpty) this.onEmpty(this); }, EMPTY_ROOM_MS);
      }
    }
    cancelEmpty() { clearTimeout(this.emptyTimer); this.emptyTimer = null; }

    // ---- actions ----
    handle(pid, msg) {
      const E = this.engine;
      if (!this.player(pid)) throw new Error('You are not in this room.');
      switch (msg.t) {
        case 'play': return E.play(pid, msg.cards, msg.source === 'discard' ? 'discard' : 'deck');
        case 'shook': return E.shook(pid);
        case 'leave': return this.leave(pid);
        case 'voice': {
          const me = this.player(pid), on = !!msg.on;
          if (this.local || !me || !!me.voice === on) return;
          me.voice = on;
          return this.broadcast();
        }
        case 'rtc': {
          // Voice chat signaling: relay a WebRTC offer/answer/candidate to one other player in this room.
          const me = this.player(pid), to = this.player(msg.to), target = this.conns.get(msg.to);
          if (this.local || !me || !to || !target || msg.to === pid || !me.voice || !to.voice) return;
          if (!msg.data || typeof msg.data !== 'object' || JSON.stringify(msg.data).length > 12000) return;
          try { target.send({ t: 'rtc', from: pid, data: msg.data }); } catch (e) {}
          return;
        }
        case 'emote':
          if (!EMOTES.includes(msg.e)) return;
          this.emote = { seq: (this.emote ? this.emote.seq : 0) + 1, id: pid, e: msg.e };
          return this.broadcast();
      }
      const hostOnly = ['addBot', 'remove', 'botLevel', 'start', 'next', 'lobby'];
      if (!hostOnly.includes(msg.t)) return;
      if (pid !== this.hostId) throw new Error('Only the host can do that.');
      switch (msg.t) {
        case 'addBot': return this.addBot(msg.difficulty);
        case 'botLevel': {
          const p = this.player(msg.id);
          if (p && p.isBot && !p.takeover && ['easy', 'medium', 'hard'].includes(msg.difficulty)) { p.difficulty = msg.difficulty; this.broadcast(); }
          return;
        }
        case 'remove': {
          if (msg.id === pid) throw new Error("You can't remove yourself.");
          if (E.phase !== 'lobby') throw new Error('Players can only be removed in the lobby.');
          const c = this.conns.get(msg.id);
          if (c) {
            try { c.send({ t: 'rejected', msg: 'The host removed you from the room.', fatal: true }); } catch (e) {}
            this.conns.delete(msg.id);
            setTimeout(() => { try { c.close('removed'); } catch (e) {} }, 200);
          }
          return this.dropPlayer(msg.id);
        }
        case 'start': {
          if (E.phase !== 'lobby') throw new Error('The game has already started.');
          // Anyone still reconnecting in the lobby loses their seat.
          E.players.filter(p => !p.isBot && !p.connected).forEach(p => this.dropPlayer(p.id));
          this.fixHost();
          return E.startGame();
        }
        case 'next': return E.nextRound();
        case 'lobby': {
          if (E.phase !== 'gameOver') throw new Error('The game is still in progress.');
          E.backToLobby();
          E.players.filter(p => p.takeover || (!p.isBot && !p.connected)).forEach(p => this.dropPlayer(p.id));
          this.fixHost();
          return this.broadcast();
        }
      }
    }

    addBot(difficulty) {
      const E = this.engine;
      const used = new Set(E.players.map(p => p.name));
      const name = FC.Bot.NAMES.find(n => !used.has(n)) || 'Bot ' + (E.players.length + 1);
      const usedAv = new Set(E.players.map(p => p.avatar));
      const free = [...Array(FC.AVATAR_COUNT).keys()].filter(a => !usedAv.has(a));
      const avatar = free.length ? free[Math.floor(Math.random() * free.length)] : 0;
      E.addPlayer({
        id: 'bot-' + Math.random().toString(36).slice(2, 8), name, avatar, isBot: true,
        difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium'
      });
    }

    // ---- output ----
    viewFor(id) {
      return Object.assign(this.engine.viewFor(id), {
        myId: id, hostId: this.hostId, code: this.code, local: this.local, emote: this.emote
      });
    }

    broadcast() {
      if (this.closed) return;
      for (const [pid, conn] of this.conns) {
        try { conn.send({ t: 'state', view: this.viewFor(pid) }); } catch (e) {}
      }
      this.scheduleBots();
    }

    scheduleBots() {
      const E = this.engine;
      if (this.botTimer || this.closed || E.phase !== 'playing') return;
      const cur = E.players[E.turn];
      if (!cur || !cur.isBot) return;
      if (!this.local && !this.hasHumans()) return;   // nobody is watching: pause
      const seq = E.evSeq;
      const delay = cur.takeover ? 600 + Math.random() * 500 : 1100 + Math.random() * 900;
      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (this.closed) return;
        if (E.phase !== 'playing' || E.evSeq !== seq) return this.scheduleBots();
        const pi = E.turn;
        const d = FC.Bot.decide(E, pi);
        try {
          if (d.action === 'shook') E.shook(E.players[pi].id);
          else E.play(E.players[pi].id, d.cardIds, d.source);
        } catch (e) { console.error('bot error', e); }
      }, delay);
    }

    close() {
      this.closed = true;
      clearTimeout(this.botTimer); this.botTimer = null;
      this.cancelEmpty();
      this.graceTimers.forEach(t => clearTimeout(t));
      this.graceTimers.clear();
    }
  }

  FC.Room = Room;
})(typeof window !== 'undefined' ? window : globalThis);
