/* 5 Cards — client networking.
   Remote: talks to the game server over a WebSocket and reconnects automatically.
   Local:  an offline practice table against bots that runs entirely in this browser. */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const FIRST_CONNECT_MS = 80 * 1000;    // free hosting can take about a minute to wake up
  const GIVE_UP_MS = 3 * 60 * 1000;      // stop reconnecting after this long
  const PING_MS = 20 * 1000;
  const SILENCE_MS = 50 * 1000;

  function serverUrl() {
    if (root.FC_SERVER_URL) return root.FC_SERVER_URL;
    const proto = root.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + root.location.host + '/ws';
  }

  class Remote {
    constructor(o) {
      this.mode = o.mode;                                   // 'create' | 'join'
      this.code = String(o.code || '').toUpperCase().trim();
      this.me = o.me;
      this.onView = o.onView;
      this.onError = o.onError || (() => {});
      this.onStatus = o.onStatus || (() => {});
      this.established = false;
      this.closed = false;
      this.attempt = 0;
      this.lostAt = 0;
      this.lastRx = 0;
      this._vis = () => {
        if (document.visibilityState === 'visible' && !this.closed && this.established &&
            (!this.ws || this.ws.readyState > 1)) this.connect();
      };
    }

    start() {
      return new Promise((resolve, reject) => {
        if (this.mode === 'join' && !/^[A-Z0-9]{5}$/.test(this.code)) {
          return reject(new Error('Room codes are 5 letters or numbers.'));
        }
        this._resolve = resolve; this._reject = reject;
        this.firstAt = Date.now();
        document.addEventListener('visibilitychange', this._vis);
        this.connect();
      });
    }

    connect() {
      clearTimeout(this.retryTimer);
      if (this.closed) return;
      let ws;
      try { ws = new WebSocket(serverUrl()); }
      catch (e) { return this.dropped(); }
      this.ws = ws;
      ws.onopen = () => {
        this.attempt = 0;
        this.lastRx = Date.now();
        const rejoin = this.established || this.mode === 'join';
        ws.send(JSON.stringify({
          t: rejoin ? 'join' : 'create', code: this.code,
          name: this.me.name, avatar: this.me.avatar, key: this.me.key
        }));
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (ws.readyState !== 1) return;
          if (Date.now() - this.lastRx > SILENCE_MS) return ws.close();
          ws.send('{"t":"ping"}');
        }, PING_MS);
      };
      ws.onmessage = ev => {
        this.lastRx = Date.now();
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        switch (msg.t) {
          case 'welcome':
            this.myId = msg.id; this.code = msg.code;
            if (!this.established) { this.established = true; this._resolve(this); }
            else if (this.lostAt) { this.lostAt = 0; this.onStatus('Back online.'); }
            break;
          case 'state': this.onView(msg.view); break;
          case 'error': this.onError(msg.msg, true); break;
          case 'rejected':
            this.closed = true;
            if (!this.established) this._reject(new Error(msg.msg));
            else this.onError(msg.msg, false);
            this.cleanup();
            break;
          case 'closed':
            // Server is shutting down: keep retrying in case it comes straight back.
            this.onStatus(msg.msg);
            break;
        }
      };
      ws.onclose = () => { clearInterval(this.pingTimer); if (this.ws === ws) this.dropped(); };
      ws.onerror = () => {};
    }

    dropped() {
      if (this.closed) return;
      if (!this.established) {
        if (Date.now() - this.firstAt > FIRST_CONNECT_MS) {
          this.closed = true; this.cleanup();
          return this._reject(new Error('Could not reach the game server. Check your connection and try again.'));
        }
        this.retryTimer = setTimeout(() => this.connect(), 1500);
        return;
      }
      if (!this.lostAt) { this.lostAt = Date.now(); this.onStatus('Connection lost. Reconnecting…'); }
      if (Date.now() - this.lostAt > GIVE_UP_MS) {
        this.closed = true; this.cleanup();
        return this.onError('Lost connection to the game server.', false);
      }
      const delay = Math.min(8000, 800 * Math.pow(1.7, this.attempt++));
      this.retryTimer = setTimeout(() => this.connect(), delay);
    }

    send(msg) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
      else this.onError('Reconnecting… try again in a moment.', true);
    }

    cleanup() {
      clearInterval(this.pingTimer); clearTimeout(this.retryTimer);
      document.removeEventListener('visibilitychange', this._vis);
    }

    leave() {
      if (this.ws && this.ws.readyState === 1) { try { this.ws.send('{"t":"leave"}'); } catch (e) {} }
      this.closed = true;
      this.cleanup();
      try { this.ws && this.ws.close(); } catch (e) {}
    }
  }

  class Local {
    constructor(o) {
      this.me = o.me;
      this.onView = o.onView;
      this.onError = o.onError || (() => {});
    }
    start() {
      this.room = new FC.Room({ local: true });
      const conn = { send: m => { if (m.t === 'state') this.onView(m.view); }, close() {} };
      this.myId = this.room.join(this.me, conn);
      this.room.addBot('medium');
      this.room.addBot('hard');
      this.room.broadcast();
      return Promise.resolve(this);
    }
    send(msg) {
      try { this.room.handle(this.myId, msg); }
      catch (e) { this.onError(e.message, true); }
    }
    leave() { this.room && this.room.close(); }
  }

  FC.Net = { Remote, Local };
})(typeof window !== 'undefined' ? window : globalThis);
