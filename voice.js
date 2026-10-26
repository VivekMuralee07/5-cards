/* 5 Cards — voice chat.
   Audio goes directly between players over WebRTC (a small mesh: at most 4 connections each).
   The game server only relays the connection setup messages. If two players' networks cannot
   reach each other directly, audio goes through a TURN relay configured on the server. */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const SPEAK_LEVEL = 0.045;

  const V = {
    on: false, muted: false, stream: null, session: null, myId: null,
    peers: new Map(),            // player id -> { pc, pending[], audio, analyser, offerer, timer }
    speaking: new Set(),
    onChange: null,
    ctx: null, stopLocal: null, tick: null,

    supported() {
      return !!(root.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    emit() { if (V.onChange) V.onChange(); },
    iceServers() { return (V.session && V.session.iceServers) || DEFAULT_ICE; },
    open() { return !!(V.session && V.session.ws && V.session.ws.readyState === 1); },
    sig(to, data) { if (V.open()) V.session.send({ t: 'rtc', to, data }); },

    async join(session) {
      if (V.on) return;
      if (!V.supported()) throw new Error('Voice chat needs a secure (https) page and a recent browser.');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
        });
      } catch (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new Error('Microphone blocked. Allow it for this site in your browser settings, then tap the mic again.');
        if (e && e.name === 'NotFoundError') throw new Error('No microphone found on this device.');
        throw new Error('Could not start the microphone.');
      }
      V.stream = stream; V.session = session; V.on = true; V.muted = false;
      V.stopLocal = V.watch(stream, 'me');
      if (V.ctx && V.ctx.state === 'suspended') V.ctx.resume().catch(() => {});
      session.send({ t: 'voice', on: true });
      V.startTick();
      V.emit();
    },

    leave() {
      const wasOn = V.on;
      V.on = false; V.muted = false;
      [...V.peers.keys()].forEach(id => V.closePeer(id));
      if (V.stream) V.stream.getTracks().forEach(t => t.stop());
      V.stream = null;
      if (V.stopLocal) { V.stopLocal(); V.stopLocal = null; }
      clearInterval(V.tick); V.tick = null;
      V.speaking.clear(); V.paint();
      if (wasOn && V.open()) { try { V.session.send({ t: 'voice', on: false }); } catch (e) {} }
      V.session = null;
      V.emit();
    },

    toggleMute() {
      if (!V.on || !V.stream) return;
      V.muted = !V.muted;
      V.stream.getAudioTracks().forEach(t => { t.enabled = !V.muted; });
      V.emit();
    },

    // Called with every new game view: connect to players who are in voice, drop those who left.
    sync(view) {
      if (!V.on || !view || view.local) return;
      const me = view.players[view.me];
      if (!me) return;
      V.myId = view.myId;
      if (!me.voice && V.open()) V.session.send({ t: 'voice', on: true });   // heals after a reconnect
      const want = new Set(view.players.filter(p => p.id !== view.myId && !p.isBot && p.connected && p.voice).map(p => p.id));
      [...V.peers.keys()].forEach(id => { if (!want.has(id)) V.closePeer(id); });
      // The player with the smaller id always makes the offer, so two players never offer at once.
      want.forEach(id => { if (!V.peers.has(id) && view.myId < id) V.connect(id, true); });
      V.emit();
    },

    connect(id, offerer) {
      const pc = new RTCPeerConnection({ iceServers: V.iceServers() });
      const peer = { pc, pending: [], audio: null, offerer, timer: null, stop: null };
      V.peers.set(id, peer);
      V.stream.getAudioTracks().forEach(t => pc.addTrack(t, V.stream));
      pc.onicecandidate = e => { if (e.candidate) V.sig(id, { c: e.candidate }); };
      pc.ontrack = e => V.attach(id, e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]));
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        clearTimeout(peer.timer);
        if (st === 'failed') V.retry(id);
        else if (st === 'disconnected') peer.timer = setTimeout(() => { if (pc.connectionState !== 'connected') V.retry(id); }, 6000);
        V.emit();
      };
      if (offerer) {
        pc.createOffer().then(o => pc.setLocalDescription(o))
          .then(() => V.sig(id, { d: pc.localDescription }))
          .catch(() => {});
      }
      return peer;
    },

    retry(id) {
      const offerer = V.myId && V.myId < id;
      V.closePeer(id);
      if (!V.on) return;
      if (offerer) setTimeout(() => { if (V.on && !V.peers.has(id)) V.connect(id, true); }, 1000);
      else V.sig(id, { retry: true });              // ask the other side to start over
    },

    closePeer(id) {
      const peer = V.peers.get(id);
      if (!peer) return;
      V.peers.delete(id);
      clearTimeout(peer.timer);
      try { peer.pc.onconnectionstatechange = null; peer.pc.close(); } catch (e) {}
      if (peer.audio) { peer.audio.srcObject = null; peer.audio.remove(); }
      if (peer.stop) peer.stop();
      V.speaking.delete(id);
    },

    async signal(from, data) {
      if (!V.on || !data) return;
      try {
        if (data.retry) {
          if (V.myId && V.myId < from) { V.closePeer(from); V.connect(from, true); }
          return;
        }
        if (data.d && data.d.type === 'offer') {
          V.closePeer(from);                         // a new offer always means a fresh start
          const peer = V.connect(from, false);
          await peer.pc.setRemoteDescription(data.d);
          await V.flush(peer);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          V.sig(from, { d: peer.pc.localDescription });
        } else if (data.d && data.d.type === 'answer') {
          const peer = V.peers.get(from);
          if (!peer) return;
          await peer.pc.setRemoteDescription(data.d);
          await V.flush(peer);
        } else if (data.c) {
          const peer = V.peers.get(from);
          if (!peer) return;
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.c).catch(() => {});
          else peer.pending.push(data.c);
        }
      } catch (e) { console.warn('voice signal failed', e); }
    },

    async flush(peer) {
      const list = peer.pending.splice(0);
      for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
    },

    // ---- playback and "who is talking" ----
    attach(id, stream) {
      const peer = V.peers.get(id);
      if (!peer) return;
      let box = document.getElementById('voice-audio');
      if (!box) { box = document.createElement('div'); box.id = 'voice-audio'; box.hidden = true; document.body.appendChild(box); }
      const a = document.createElement('audio');
      a.autoplay = true; a.setAttribute('playsinline', ''); a.srcObject = stream;
      box.appendChild(a);
      a.play().catch(() => {});
      peer.audio = a;
      peer.stop = V.watch(stream, id);
    },

    // Measures loudness of a stream so the speaker's avatar can light up.
    watch(stream, key) {
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        V.ctx = V.ctx || new AC();
        const src = V.ctx.createMediaStreamSource(stream);
        const an = V.ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        const probe = { key, level() {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          return Math.sqrt(sum / buf.length);
        } };
        V.probes = V.probes || new Set();
        V.probes.add(probe);
        return () => { V.probes.delete(probe); try { src.disconnect(); } catch (e) {} };
      } catch (e) { return null; }
    },

    startTick() {
      clearInterval(V.tick);
      V.tick = setInterval(() => {
        const now = new Set();
        (V.probes || []).forEach(p => {
          if (p.key === 'me') { if (!V.muted && p.level() > SPEAK_LEVEL) now.add(V.myId); }
          else if (p.level() > SPEAK_LEVEL) now.add(p.key);
        });
        V.speaking = now;
        V.paint();
      }, 140);
    },

    paint() {
      document.querySelectorAll('.av[data-pid]').forEach(el => el.classList.toggle('speaking', V.speaking.has(el.dataset.pid)));
    },

    connectedCount() {
      let n = 0; V.peers.forEach(p => { if (p.pc.connectionState === 'connected') n++; });
      return n;
    }
  };

  FC.Voice = V;
})(typeof window !== 'undefined' ? window : globalThis);
