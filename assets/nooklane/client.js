/*
 * Nooklane in the browser: walking around a space with other people, and
 * hearing / seeing them more clearly the closer they are.
 *
 * Reflex drives it with rx.call_script(...):
 *   nooklane.configure({bridge, strings, space})   once the page is up
 *   nooklane.setMap(map, version)                  the space's map (again after edits)
 *   nooklane.preview({look, mode, style, name})    the pre-join preview
 *   nooklane.connect(url, token, {look, mode, style, mic, name, status})
 *   nooklane.setMic(on) / setMode(m) / setStyle(s) / setLook(l) / setStatus(s) / shareScreen(on)
 *   nooklane.emote(i) / toggleHand() / sendChat(text, scope) / locate(id) / walkTo(id) / follow(id) / wave(id)
 *   nooklane.setMeetingView(on)
 *   nooklane.notifyMap(version) / disconnect()
 * and gets news back as JSON through a hidden <input> (handle_js_message).
 *
 * What travels, all through the space's own LiveKit server:
 *   - microphone, and the camera track in 'face' / 'full' mode (media.js)
 *   - "pos"   10-byte position packets, to everyone (lossy, on each step + 1/s)
 *   - "face"  60-byte expression packets in 'avatar' mode, only to the people
 *             who can see you (lossy, up to 25/s; same format as avatar-chat)
 *   - "emote", "chat", "ping", "map": small JSON messages (reliable)
 *   - participant attributes: look, mode, style, status, hand, ghost
 *
 * Proximity (every frame, for each other person; d = distance in tiles):
 *   - either of you in ghost mode (G held) -> nothing
 *   - both in the same private area      -> full voice and picture
 *   - one of you in a private area        -> nothing
 *   - they stand in a spotlight area      -> full voice and picture for everyone
 *   - else by distance: full within R_FULL, fading to silence at R_HEAR, with
 *     the voice panned left / right and muffled (low-pass) as it fades, the
 *     picture fading and blurring, and a lower video layer for far people.
 *   Tracks are subscribed only within R_SUB (released beyond R_UNSUB), so
 *   far-away people cost no bandwidth.
 */
(function () {
  if (window.nooklane) return;

  const LK = () => window.LivekitClient;
  const STEP_MS = 150;
  const R_FULL = 2;
  const R_HEAR = 6;
  const R_SUB = 7.5;
  const R_UNSUB = 9;
  const MAX_TILES = 8;
  const FACE_INTERVAL_MS = 40;
  const FACE_KEEPALIVE_MS = 1000;
  const POS_KEEPALIVE_MS = 1000;
  const AWAY_AFTER_MS = 10 * 60 * 1000;
  const DIRS = ['down', 'up', 'left', 'right'];
  const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };
  // Reactions on keys 1-7, as in Gather; H raises a hand, holding G is ghost mode.
  const EMOTES = ['👋', '❤️', '🎉', '👍', '🤣', '👏', '💯'];
  const POS_VERSION = 0xb1;
  const FACE_VERSION = 0xa1;
  const SHAPE_COUNT = 51;
  const FACE_SIZE = 4 + SHAPE_COUNT + 5;
  const DEG = 180 / Math.PI;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const errorText = (e) => (e && e.message) || String(e);

  function signalUrl(url) {
    const u = new URL(url, window.location.href);
    if (u.protocol === 'http:') u.protocol = 'ws:';
    if (u.protocol === 'https:') u.protocol = 'wss:';
    if (window.location.protocol === 'https:' && u.protocol === 'ws:') u.protocol = 'wss:';
    return u.toString().replace(/\/$/, '');
  }

  function typing(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  // --- packets ---------------------------------------------------------------------

  function encodePos(me, seq, teleport) {
    const out = new Uint8Array(10);
    const v = new DataView(out.buffer);
    out[0] = POS_VERSION;
    out[1] = (teleport ? 1 : 0);
    v.setUint16(2, me.x, true);
    v.setUint16(4, me.y, true);
    out[6] = Math.max(0, DIRS.indexOf(me.dir));
    out[7] = seq & 0xff;
    v.setUint16(8, STEP_MS, true);
    return out;
  }

  function decodePos(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 10 || bytes[0] !== POS_VERSION) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { teleport: !!(bytes[1] & 1), x: v.getUint16(2, true), y: v.getUint16(4, true), dir: DIRS[bytes[6]] || 'down', seq: bytes[7], step: v.getUint16(8, true) };
  }

  const STYLES = () => window.AvatarFace.STYLES;

  function encodeFace(face, flags, style, seq) {
    const out = new Uint8Array(FACE_SIZE);
    const view = new DataView(out.buffer);
    out[0] = FACE_VERSION;
    out[1] = flags;
    out[2] = Math.max(0, STYLES().indexOf(style));
    out[3] = seq & 0xff;
    for (let i = 0; i < SHAPE_COUNT; i++) out[4 + i] = Math.round(clamp(face.shapes[i] || 0, 0, 1) * 255);
    const at = 4 + SHAPE_COUNT;
    view.setInt8(at, Math.round(clamp(face.yaw * DEG, -90, 90)));
    view.setInt8(at + 1, Math.round(clamp(face.pitch * DEG, -90, 90)));
    view.setInt8(at + 2, Math.round(clamp(face.roll * DEG, -90, 90)));
    view.setInt8(at + 3, Math.round(clamp(face.x, -1, 1) * 100));
    view.setInt8(at + 4, Math.round(clamp(face.y, -1, 1) * 100));
    return out;
  }

  function decodeFace(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < FACE_SIZE || bytes[0] !== FACE_VERSION) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const shapes = new Float32Array(SHAPE_COUNT);
    for (let i = 0; i < SHAPE_COUNT; i++) shapes[i] = bytes[4 + i] / 255;
    const at = 4 + SHAPE_COUNT;
    return {
      flags: bytes[1], style: STYLES()[bytes[2]] || 'human', seq: bytes[3],
      face: {
        shapes, yaw: view.getInt8(at) / DEG, pitch: view.getInt8(at + 1) / DEG, roll: view.getInt8(at + 2) / DEG,
        x: view.getInt8(at + 3) / 100, y: view.getInt8(at + 4) / 100,
      },
    };
  }

  function samePacket(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (i !== 3 && a[i] !== b[i]) return false;
    return true;
  }

  function makeFaceState(style) {
    return {
      style: style || 'human', target: window.AvatarFace.neutral(), current: window.AvatarFace.neutral(),
      found: false, at: 0, seq: -1, packets: 0, bytes: 0,
      nextBlink: performance.now() + 1000 + Math.random() * 3000, blinkUntil: 0,
    };
  }

  // Eases the drawn face toward the latest packet; idles (blinks, talks with
  // the voice) without a fresh face.
  function animateFace(av, now, dt, voice) {
    const A = window.AvatarFace;
    const fresh = now - av.at < 1500;
    const tracked = fresh && av.found;
    const cur = av.current;
    const goal = av.target;
    const k = 1 - Math.exp(-dt / 0.05);
    for (let i = 0; i < SHAPE_COUNT; i++) cur.shapes[i] += ((tracked ? goal.shapes[i] : 0) - cur.shapes[i]) * k;
    if (!tracked) {
      const jaw = A.INDEX.jawOpen;
      const voiceJaw = fresh ? goal.shapes[jaw] : voice * 0.7;
      cur.shapes[jaw] += (voiceJaw - cur.shapes[jaw]) * (1 - Math.exp(-dt / 0.04));
      if (now > av.nextBlink) {
        av.blinkUntil = now + 150;
        av.nextBlink = now + 2500 + Math.random() * 3500;
      }
      if (now < av.blinkUntil) {
        cur.shapes[A.INDEX.eyeBlinkLeft] = 1;
        cur.shapes[A.INDEX.eyeBlinkRight] = 1;
      }
    }
    const kp = 1 - Math.exp(-dt / 0.08);
    for (const key of ['yaw', 'pitch', 'roll', 'x', 'y']) {
      let g = tracked ? goal[key] : 0;
      if (!tracked && key === 'y') g = Math.sin(now / 900) * 0.03;
      cur[key] += (g - cur[key]) * kp;
    }
  }

  // --- styles for the tiles (owned by this script, not by Reflex) -----------------------

  const CSS = `
  .nook-strip{position:absolute;left:50%;top:12px;transform:translateX(-50%);display:flex;gap:10px;align-items:flex-start;justify-content:center;pointer-events:none;max-width:calc(100% - 24px);flex-wrap:nowrap;z-index:5}
  .nook-tile{position:relative;width:176px;height:132px;border-radius:14px;overflow:hidden;background:#202634;box-shadow:0 6px 18px rgba(0,0,0,.28);pointer-events:auto;cursor:pointer;transition:opacity .3s,filter .3s,box-shadow .2s,width .25s,height .25s;flex:none}
  .nook-tile.screen{width:236px}
  .nook-tile video,.nook-tile canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
  .nook-tile.screen video{object-fit:contain;background:#000}
  .nook-tile.speaking{box-shadow:0 0 0 3px #3ccf6e,0 6px 18px rgba(0,0,0,.28)}
  .nook-tile-name{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);display:flex;gap:4px;align-items:center;font:600 11px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.58);padding:2px 7px;border-radius:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nook-tile-badge{position:absolute;right:6px;top:6px;font:600 10px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.5);padding:2px 6px;border-radius:6px;display:none}
  .nook-tile.focused{position:fixed;left:50%;top:50%;width:min(86vw,1100px);height:min(74vh,700px);transform:translate(-50%,-50%);z-index:60;filter:none!important;opacity:1!important}
  .nook-tile.focused video{object-fit:contain;background:#000}
  .nook-focus-shade{position:fixed;inset:0;background:rgba(10,12,18,.6);z-index:59;display:none}
  .nook-strip.meeting{position:fixed;left:16px;right:16px;top:64px;bottom:108px;transform:none;max-width:none;display:grid;gap:12px;align-content:center;justify-content:center;padding:16px;border-radius:18px;background:rgba(15,18,26,.84);backdrop-filter:blur(6px);pointer-events:auto;z-index:28}
  .nook-strip.meeting .nook-tile{width:100%;height:auto;aspect-ratio:4/3}
  .nook-strip.meeting .nook-tile video{object-fit:contain;background:#11141b}
  .nook-strip.meeting .nook-tile-name{font-size:13px;padding:3px 9px}
  .nook-meeting-empty{grid-column:1/-1;align-self:center;justify-self:center;color:rgba(255,255,255,.8);font:600 15px system-ui,sans-serif;text-align:center;max-width:28rem}
  .nook-minimap{position:absolute;right:12px;bottom:12px;border-radius:12px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.85);background:#262a33;cursor:pointer;z-index:25}
  .nook-minimap canvas{display:block}
  `;

  function injectCss() {
    if (document.getElementById('nook-css')) return;
    const style = document.createElement('style');
    style.id = 'nook-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // --- the client --------------------------------------------------------------------------

  const nook = {
    world: null,
    media: null,
    room: null,
    me: null,
    people: new Map(),
    tiles: new Map(),
    audioNodes: new Map(),
    bridgeId: null,
    strings: {},
    space: '',
    mapVersion: 0,
    held: [],
    path: [],
    followId: null,
    followAt: 0,
    posSeq: 0,
    lastPosSent: 0,
    faceSeq: 0,
    lastFacePacket: null,
    lastFaceSent: 0,
    myFace: null,
    lastActivity: performance.now(),
    autoAway: false,
    lastReport: '',
    lastReportAt: 0,
    lastFrame: 0,
    focusId: null,
    meetingView: false,
    ringOn: true,
    minimapOn: true,
    connected: false,
    mic: null,
    audioCtx: null,

    // --- setup ---------------------------------------------------------------------------

    configure(opts) {
      injectCss();
      this.bridgeId = opts.bridge || this.bridgeId;
      this.strings = Object.assign({}, this.strings, opts.strings || {});
      if (opts.space && opts.space !== this.space) {
        this.space = opts.space;
      }
      if (!this.world) this._init();
    },

    _init() {
      this.world = new window.NookWorld();
      this.media = new window.NookMedia();
      this.media.onStatus = (message) => this._send({ face_status: message });
      this.world.onTile = (x, y) => this._clickTile(x, y);
      this.world.onPerson = (id) => this.walkTo(id);
      this.world.personAt = (x, y) => {
        for (const p of this.people.values()) if (p.x === x && p.y === y) return p.identity;
        return null;
      };
      this.strip = document.createElement('div');
      this.strip.className = 'nook-strip';
      this.shade = document.createElement('div');
      this.shade.className = 'nook-focus-shade';
      this.shade.addEventListener('click', () => this.toggleFocus(null));
      document.body.appendChild(this.shade);
      this.minimap = document.createElement('div');
      this.minimap.className = 'nook-minimap';
      this.minimapCanvas = document.createElement('canvas');
      this.minimap.appendChild(this.minimapCanvas);
      this.minimap.addEventListener('pointerdown', (e) => this._minimapClick(e));
      this.audioHolder = document.createElement('div');
      this.audioHolder.style.display = 'none';
      document.body.appendChild(this.audioHolder);
      document.addEventListener('keydown', (e) => this._keyDown(e));
      document.addEventListener('keyup', (e) => this._keyUp(e));
      window.addEventListener('blur', () => { this.held = []; this.setGhost(false); });
      ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => this._active(), true));
      window.addEventListener('pagehide', () => this._savePos(true));
      requestAnimationFrame((t) => this._frame(t));
    },

    setMap(map, version) {
      if (!this.world) this._init();
      this.mapVersion = version || 0;
      const ed = window.nookEditor;
      if (ed && ed.active) {
        // Someone else changed the map while we build: keep our unsaved draft.
        ed.baseChanged(map);
        if (ed.dirty) return;
      }
      this.world.setMap(map);
      if (this.me && !this.world.isFree(this.me.x, this.me.y)) {
        const spot = this.world.freeNear(this.me.x, this.me.y);
        this._place(spot.x, spot.y, true);
      }
      if (!this.me) {
        const s = (map.spawns || [[1, 1]])[0];
        this.world.cam = { x: s[0] * 16 + 8, y: s[1] * 16 };
        this.previewAt = { x: s[0] * 16 + 8, y: s[1] * 16 };
      }
    },

    // Before joining: camera preview in the chosen mode.
    async preview(opts) {
      if (!this.world) this._init();
      const m = this.media;
      if (opts.look) m.look = opts.look;
      if (opts.style) m.style = opts.style;
      if (opts.name != null) m.name = opts.name;
      if (opts.mode && opts.mode !== m.mode) {
        try {
          await m.setMode(opts.mode);
        } catch (e) {
          this._send({ type: 'warning', message: errorText(e) });
        }
        this._send({ mode: m.mode });
      }
    },

    stopPreview() {
      if (!this.connected && this.media) this.media.stop();
      this.previewFace = null;
    },

    // --- joining ---------------------------------------------------------------------------

    async connect(url, token, opts) {
      if (!this.world) this._init();
      const L = LK();
      if (!L || !window.AvatarFace || !window.FaceTracker) {
        this._send({ type: 'error', message: 'The space scripts failed to load' });
        return;
      }
      if (this.room) await this.disconnect();
      try {
        this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioCtx.state !== 'running') this.audioCtx.resume().catch(() => {});
      } catch (e) {
        this.audioCtx = null;
      }
      const room = new L.Room({
        adaptiveStream: false,
        dynacast: true,
        webAudioMix: this.audioCtx ? { audioContext: this.audioCtx } : false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        publishDefaults: { audioPreset: L.AudioPresets.speech, simulcast: true },
      });
      this.room = room;
      const E = L.RoomEvent;
      room
        .on(E.ParticipantConnected, (p) => this._addPerson(p))
        .on(E.ParticipantDisconnected, (p) => this._removePerson(p.identity))
        .on(E.TrackSubscribed, (track, pub, p) => this._subscribed(track, pub, p))
        .on(E.TrackUnsubscribed, (track, pub, p) => this._unsubscribed(track, pub, p))
        .on(E.TrackPublished, (pub, p) => { const person = this.people.get(p.identity); if (person) person.subs = {}; this._refreshMuted(); })
        .on(E.TrackUnpublished, () => this._refreshMuted())
        .on(E.TrackMuted, () => this._refreshMuted())
        .on(E.TrackUnmuted, () => this._refreshMuted())
        .on(E.LocalTrackPublished, (pub) => { if (pub.kind === 'audio') this._watchMic(pub.track); this._refreshMuted(); })
        .on(E.LocalTrackUnpublished, (pub) => { if (pub.source === L.Track.Source.ScreenShare) this._send({ sharing: false }); })
        .on(E.ActiveSpeakersChanged, (speakers) => {
          const ids = new Set(speakers.map((s) => s.identity));
          this.people.forEach((p) => { p.speaking = ids.has(p.identity); });
          if (this.me) this.me.speaking = ids.has(room.localParticipant.identity);
        })
        .on(E.ParticipantAttributesChanged, (changed, p) => {
          if (p === room.localParticipant) return;
          const person = this.people.get(p.identity);
          if (person) this._readAttributes(person, p);
        })
        .on(E.DataReceived, (payload, p, kind, topic) => this._data(payload, p, topic))
        .on(E.AudioPlaybackStatusChanged, () => this._send({ audio_blocked: !room.canPlaybackAudio }))
        .on(E.MediaDevicesError, (e) => this._send({ type: 'warning', message: errorText(e) }))
        .on(E.Reconnecting, () => this._send({ status: 'Reconnecting...' }))
        .on(E.Reconnected, () => { this._send({ status: 'Connected' }); this._sendPos(true); })
        .on(E.Disconnected, () => {
          if (this.room !== room || this.leaving) return;
          this._cleanup();
          this._send({ status: 'Disconnected' });
        });
      this.leaving = false;
      window.addEventListener('beforeunload', () => { this.leaving = true; }, { once: true });
      try {
        await room.connect(signalUrl(url), token, { autoSubscribe: false });
      } catch (error) {
        console.error('LiveKit connection error:', error);
        if (this.room === room) this.room = null;
        this._send({ type: 'error', message: errorText(error) });
        return;
      }
      this.connected = true;
      const local = room.localParticipant;
      const saved = this._loadPos();
      const spot = this.world.map ? this.world.freeNear(saved ? saved.x : null, saved ? saved.y : null) : { x: 1, y: 1 };
      this.me = {
        identity: local.identity, name: opts.name || local.name || local.identity, local: true,
        look: opts.look, mode: opts.mode, style: opts.style || 'human', status: opts.status || 'available',
        hand: false, x: spot.x, y: spot.y, fromX: spot.x, fromY: spot.y, t0: 0, dur: 0, dir: 'down',
        speaking: false, muted: !opts.mic, blinkSeed: Math.random() * 4000,
      };
      this.media.look = opts.look;
      this.media.style = this.me.style;
      this.media.name = this.me.name;
      this.myFace = makeFaceState(this.me.style);
      this.world.cam = null;
      room.remoteParticipants.forEach((p) => this._addPerson(p));
      this._sendPos(true);
      this.posTimer = setInterval(() => this._sendPos(false), POS_KEEPALIVE_MS / 2);
      this.faceTimer = setInterval(() => this._sendFace(), FACE_INTERVAL_MS);
      this._send({ status: 'Connected', audio_blocked: !room.canPlaybackAudio, area: this._areaName() });
      try {
        if (opts.mic) await local.setMicrophoneEnabled(true);
      } catch (error) {
        this._send({ type: 'warning', message: 'Microphone: ' + errorText(error) });
      }
      if (this.room !== room) return;
      this.media.room = room;
      try {
        await this.media.setMode(opts.mode || 'off');
      } catch (error) {
        this._send({ type: 'warning', message: errorText(error) });
      }
      await this.media.publish(room);
      this.me.mode = this.media.mode;
      this._pushAttributes();
      this._refreshMuted();
      this._send({ mode: this.media.mode });
    },

    async disconnect() {
      const room = this.room;
      this.leaving = true;
      this._savePos(true);
      this._cleanup();
      if (room) await room.disconnect();
      this.leaving = false;
    },

    _cleanup() {
      clearInterval(this.posTimer);
      clearInterval(this.faceTimer);
      this.posTimer = null;
      this.faceTimer = null;
      if (this.media) this.media.detach();
      this.room = null;
      this.connected = false;
      this.me = null;
      this.people.clear();
      this.tiles.forEach((t) => t.el.remove());
      this.tiles.clear();
      this.audioNodes.clear();
      this.audioHolder && this.audioHolder.replaceChildren();
      this.path = [];
      this.followId = null;
      this.focusId = null;
      this.meetingView = false;
      if (this.strip) this.strip.classList.remove('meeting');
      if (this.shade) this.shade.style.display = 'none';
      this._unwatchMic();
      this.lastReport = '';
    },

    // --- other people ------------------------------------------------------------------------

    _addPerson(p) {
      if (this.people.has(p.identity)) return;
      const person = {
        identity: p.identity, name: p.name || p.identity, look: '0-0-0-0-0-0', mode: 'off', style: 'human',
        status: 'available', hand: false, x: null, y: null, fromX: 0, fromY: 0, t0: 0, dur: 0, dir: 'down',
        speaking: false, muted: !p.isMicrophoneEnabled, seq: -1, emote: null, emoteUntil: 0,
        bubble: null, bubbleUntil: 0, mood: null, face: makeFaceState('human'), link: null, subs: {},
        heard: false, blinkSeed: Math.random() * 4000,
      };
      this._readAttributes(person, p);
      this.people.set(p.identity, person);
    },

    _readAttributes(person, p) {
      const a = p.attributes || {};
      if (a.look) person.look = a.look;
      if (a.mode) person.mode = a.mode;
      if (a.style) { person.style = a.style; person.face.style = a.style; }
      if (a.status) person.status = a.status;
      person.hand = a.hand === '1';
      person.ghost = a.ghost === '1';
      person.name = p.name || person.name;
      person.subs = {};
    },

    _removePerson(identity) {
      this.people.delete(identity);
      [identity, identity + '#screen'].forEach((id) => {
        const t = this.tiles.get(id);
        if (t) t.el.remove();
        this.tiles.delete(id);
      });
      if (this.followId === identity) this.followId = null;
    },

    _refreshMuted() {
      const room = this.room;
      if (!room) return;
      room.remoteParticipants.forEach((p) => {
        const person = this.people.get(p.identity);
        if (person) person.muted = !p.isMicrophoneEnabled;
      });
      if (this.me) this.me.muted = !room.localParticipant.isMicrophoneEnabled;
      this._send({ mic: room.localParticipant.isMicrophoneEnabled });
    },

    _subscribed(track, pub, participant) {
      if (track.kind === 'audio') {
        const el = track.attach();
        this.audioHolder.appendChild(el);
        if (this.audioCtx && track.setWebAudioPlugins) {
          const lp = this.audioCtx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 18000;
          lp.Q.value = 0.4;
          const pan = this.audioCtx.createStereoPanner();
          track.setWebAudioPlugins([lp, pan]);
          this.audioNodes.set(track.sid, { lp, pan, gain: -1, panValue: 0, freq: 18000 });
        }
        const person = this.people.get(participant.identity);
        const gain = person && person.link ? person.link.gain : 0;
        track.setVolume(gain);
      }
    },

    _unsubscribed(track) {
      track.detach().forEach((el) => { if (el.tagName === 'AUDIO') el.remove(); });
      this.audioNodes.delete(track.sid);
    },

    // --- proximity ------------------------------------------------------------------------

    // How well I hear and see `p` now.
    _linkFor(p, now, mePlace, myArea) {
      const none = { kind: 'none', gain: 0, opacity: 0, blur: 0, pan: 0, quality: 0, d: Infinity, t: 1 };
      if (p.x == null || !this.world.map) return none;
      if (p.ghost || (this.me && this.me.ghost)) return none;
      const at = window.NookWorld.place(p, now);
      const dx = at.x - mePlace.x;
      const dy = at.y - mePlace.y;
      const d = Math.hypot(dx, dy);
      const theirArea = this.world.areaAt(p.x, p.y);
      const L = LK();
      const HIGH = L ? L.VideoQuality.HIGH : 2;
      const MED = L ? L.VideoQuality.MEDIUM : 1;
      const LOW = L ? L.VideoQuality.LOW : 0;
      if (theirArea && theirArea.kind === 'spotlight') {
        return { kind: 'spotlight', gain: 1, opacity: 1, blur: 0, pan: 0, quality: HIGH, d, t: 0, area: theirArea.name };
      }
      if (myArea && myArea.kind === 'private') {
        if (theirArea === myArea) {
          return { kind: 'area', gain: 1, opacity: 1, blur: 0, pan: clamp(dx / 10, -0.3, 0.3), quality: HIGH, d, t: 0, area: myArea.name };
        }
        return Object.assign({}, none, { d });
      }
      if (theirArea && theirArea.kind === 'private') return Object.assign({}, none, { d });
      if ((this.me && this.me.status === 'busy') || p.status === 'busy') return Object.assign({}, none, { d });
      const t = clamp((d - R_FULL) / (R_HEAR - R_FULL), 0, 1);
      if (d >= R_HEAR) {
        // Out of earshot: the picture lingers faintly a little further.
        const fade = clamp(1 - (d - R_HEAR) / (R_SUB - R_HEAR), 0, 1);
        return { kind: 'far', gain: 0, opacity: 0.12 * fade, blur: 6, pan: 0, quality: LOW, d, t: 1 };
      }
      return {
        kind: 'near',
        gain: Math.pow(1 - t, 1.6),
        opacity: 1 - 0.82 * t,
        blur: 6 * Math.pow(t, 1.3),
        pan: clamp(dx / 6, -0.65, 0.65),
        quality: d <= 3 ? HIGH : d <= 4.5 ? MED : LOW,
        d, t,
      };
    },

    _updateLinks(now) {
      const me = this.me;
      const room = this.room;
      if (!me || !room || !this.world.map) return;
      const mePlace = window.NookWorld.place(me, now);
      const myArea = this.world.areaAt(me.x, me.y);
      const L = LK();
      this.people.forEach((p) => {
        const link = this._linkFor(p, now, mePlace, myArea);
        // Subscribe a little before someone becomes audible; let go a little after.
        let sub;
        if (link.kind === 'none') sub = false;
        else if (link.kind === 'area' || link.kind === 'spotlight') sub = true;
        else sub = p.link && p.link.sub ? link.d < R_UNSUB : link.d < R_SUB;
        link.sub = sub;
        p.link = link;
        p.heard = link.gain > 0.001;
        const rp = room.remoteParticipants.get(p.identity);
        if (!rp) return;
        rp.trackPublications.forEach((pub) => {
          let want = sub;
          if (pub.source === L.Track.Source.Camera) want = sub && (p.mode === 'face' || p.mode === 'full');
          if (p.subs[pub.trackSid] !== want) {
            p.subs[pub.trackSid] = want;
            try { pub.setSubscribed(want); } catch (e) { /* not ready yet */ }
          }
          if (want && pub.kind === 'video' && pub.isSubscribed && pub.source === L.Track.Source.Camera) {
            const quality = this.meetingView && link.gain > 0.2 ? L.VideoQuality.HIGH : link.quality;
            if (p.quality !== quality) {
              p.quality = quality;
              try { pub.setVideoQuality(quality); } catch (e) { /* ignore */ }
            }
          }
          if (pub.kind === 'audio' && pub.track) this._applyAudio(pub.track, link);
        });
      });
    },

    _applyAudio(track, link) {
      const nodes = this.audioNodes.get(track.sid);
      const gain = Math.round(link.gain * 1000) / 1000;
      if (!nodes) {
        if (track._nookGain !== gain) { track._nookGain = gain; track.setVolume(gain); }
        return;
      }
      const ctx = this.audioCtx;
      if (Math.abs(nodes.gain - gain) > 0.004) {
        nodes.gain = gain;
        track.setVolume(gain);
      }
      if (Math.abs(nodes.panValue - link.pan) > 0.01) {
        nodes.panValue = link.pan;
        nodes.pan.pan.setTargetAtTime(link.pan, ctx.currentTime, 0.08);
      }
      // Far voices sound muffled: the low-pass closes from 18 kHz to ~2 kHz.
      const freq = Math.round(18000 * Math.pow(0.12, link.t || 0));
      if (Math.abs(nodes.freq - freq) > 50) {
        nodes.freq = freq;
        nodes.lp.frequency.setTargetAtTime(freq, ctx.currentTime, 0.12);
      }
    },

    // People I can hear (chat "nearby", face packets).
    _linkedIds(minOpacity) {
      const ids = [];
      this.people.forEach((p) => { if (p.link && (p.link.gain > 0.001 || p.link.opacity > (minOpacity || 0.05))) ids.push(p.identity); });
      return ids;
    },

    _areaName() {
      if (!this.me || !this.world.map) return '';
      const a = this.world.areaAt(this.me.x, this.me.y);
      return a ? a.name : '';
    },

    // --- moving ------------------------------------------------------------------------

    _keyDown(e) {
      if (!this.me || typing(e.target)) return;
      if (window.nookEditor && window.nookEditor.key(e)) { e.preventDefault(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        if (!this.held.includes(dir)) this.held.push(dir);
        this.path = [];
        this.followId = null;
        return;
      }
      if (e.repeat) return;
      if (e.key === 'x' || e.key === 'X') { this.interact(); e.preventDefault(); }
      else if (e.key >= '1' && e.key <= '7') this.emote(Number(e.key) - 1);
      else if (e.key === 'h' || e.key === 'H') this.toggleHand();
      else if (e.key === 'g' || e.key === 'G') this.setGhost(true);
      else if (e.key === 'Escape') {
        this.path = [];
        this.followId = null;
        this.toggleFocus(null);
        if (this.meetingView) this.setMeetingView(false);
        this._send({ follow: '' });
      }
      else if (e.key === 'Enter') { this._send({ open_chat: true }); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') this.world.zoomBy(1);
      else if (e.key === '-' || e.key === '_') this.world.zoomBy(-1);
    },

    _keyUp(e) {
      if (e.key === 'g' || e.key === 'G') this.setGhost(false);
      const dir = KEYS[e.key];
      if (dir) this.held = this.held.filter((d) => d !== dir);
      // Shift + letter arrives as uppercase on keydown and lowercase on keyup.
      if (dir && e.key.length === 1) this.held = this.held.filter((d) => d !== KEYS[e.key.toLowerCase()]);
    },

    _active() {
      this.lastActivity = performance.now();
      if (this.autoAway && this.me) {
        this.autoAway = false;
        this.setStatus('available');
        this._send({ status_changed: 'available' });
      }
    },

    _clickTile(x, y) {
      if (!this.me) return;
      this.followId = null;
      this.held = [];
      const route = this.world.path(this.me.x, this.me.y, x, y);
      this.path = route;
      if (route.length) {
        const end = route[route.length - 1];
        this.world.marker = { x: end.x, y: end.y, until: performance.now() + 1200 };
      }
      this._send({ follow: '' });
    },

    _place(x, y, teleport) {
      const me = this.me;
      me.fromX = x;
      me.fromY = y;
      me.x = x;
      me.y = y;
      me.dur = 0;
      this.path = [];
      this._sendPos(true, teleport);
      this._arrived();
    },

    teleport(x, y) {
      if (!this.me) return;
      const spot = this.world.freeNear(x, y);
      this._place(spot.x, spot.y, true);
    },

    // Back to one of the start points (lost, or stuck in a corner).
    respawn() {
      if (!this.me || !this.world.map) return;
      const spot = this.world.freeNear();
      this._place(spot.x, spot.y, true);
    },

    _step(dir, now) {
      const me = this.me;
      const [dx, dy] = DELTA[dir];
      const turned = me.dir !== dir;
      me.dir = dir;
      const nx = me.x + dx;
      const ny = me.y + dy;
      if (this.world.isFree(nx, ny)) {
        me.fromX = me.x;
        me.fromY = me.y;
        me.x = nx;
        me.y = ny;
        me.t0 = now;
        me.dur = STEP_MS;
        this._sendPos(true);
        return true;
      }
      if (turned) this._sendPos(true);
      return false;
    },

    _tickMove(now) {
      const me = this.me;
      if (!me || !this.world.map) return;
      const moving = me.dur && now < me.t0 + me.dur;
      if (moving) return;
      if (me.dur) {
        me.dur = 0;
        this._arrived();
      }
      const dir = this.held[this.held.length - 1];
      if (dir) {
        this._step(dir, now);
        return;
      }
      if (this.followId && now - this.followAt > 400) {
        this.followAt = now;
        const target = this.people.get(this.followId);
        if (!target || target.x == null) {
          this.followId = null;
        } else if (Math.abs(target.x - me.x) + Math.abs(target.y - me.y) > 1) {
          this.path = this._pathNextTo(target);
        }
      }
      if (this.path.length) {
        const next = this.path[0];
        const dx = next.x - me.x;
        const dy = next.y - me.y;
        const step = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : dy === -1 ? 'up' : null;
        this.path.shift();
        if (!step || Math.abs(dx) + Math.abs(dy) !== 1 || !this._step(step, now)) {
          // Blocked (the map changed): find a new way to the same place.
          const end = this.path[this.path.length - 1] || next;
          this.path = this.world.path(me.x, me.y, end.x, end.y);
        }
      }
    },

    _pathNextTo(target) {
      const me = this.me;
      let best = null;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = target.x + dx;
        const y = target.y + dy;
        if (!this.world.isFree(x, y)) continue;
        const route = this.world.path(me.x, me.y, x, y);
        if ((route.length || (x === me.x && y === me.y)) && (!best || route.length < best.length)) best = route;
      }
      return best || [];
    },

    _arrived() {
      const me = this.me;
      if (!me) return;
      const ob = this.world.usable.find((o) => o.t === 'portal' && o.x === me.x && o.y === me.y);
      if (ob && Array.isArray(ob.to) && ob.to.length === 2 && !this.portalLock) {
        this.portalLock = true;
        setTimeout(() => { this.portalLock = false; }, 600);
        const spot = this.world.freeNear(ob.to[0], ob.to[1]);
        this._place(spot.x, spot.y, true);
        return;
      }
      const area = this._areaName();
      if (area !== this.lastArea) {
        this.lastArea = area;
        this._send({ area });
      }
      this._savePos(false);
    },

    _savePos(force) {
      if (!this.me || !this.space) return;
      const now = performance.now();
      if (!force && now - (this.savedAt || 0) < 2000) return;
      this.savedAt = now;
      try { localStorage.setItem('nooklane:pos:' + this.space, this.me.x + ',' + this.me.y); } catch (e) { /* private mode */ }
    },

    _loadPos() {
      try {
        const v = localStorage.getItem('nooklane:pos:' + this.space);
        if (!v) return null;
        const [x, y] = v.split(',').map(Number);
        return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
      } catch (e) {
        return null;
      }
    },

    walkTo(identity) {
      const target = this.people.get(identity);
      if (!this.me || !target || target.x == null) return;
      this.followId = null;
      this.held = [];
      this.path = this._pathNextTo(target);
    },

    follow(identity) {
      if (!this.me) return;
      this.followId = identity || null;
      this.followAt = 0;
      this._send({ follow: this.followId || '' });
    },

    locate(identity) {
      this.world.flash = { identity, until: performance.now() + 6000 };
    },

    // --- sending -------------------------------------------------------------------------------

    _sendPos(now, teleport) {
      const room = this.room;
      const me = this.me;
      if (!room || !me) return;
      const t = performance.now();
      if (!now && t - this.lastPosSent < POS_KEEPALIVE_MS) return;
      this.lastPosSent = t;
      this.posSeq = (this.posSeq + 1) & 0xff;
      room.localParticipant.publishData(encodePos(me, this.posSeq, teleport), { reliable: false, topic: 'pos' }).catch(() => {});
    },

    _sendFace() {
      const room = this.room;
      const me = this.me;
      if (!room || !me) return;
      const A = window.AvatarFace;
      const now = performance.now();
      const voice = this._micLevel();
      const tracked = this.media.face();
      const camera = this.media.mode === 'avatar' && !!this.media.stream;
      let face = tracked;
      let flags = camera ? 2 : 0;
      if (face) flags |= 1;
      else {
        face = A.neutral();
        face.shapes[A.INDEX.jawOpen] = voice;
      }
      const mine = this.myFace;
      Object.assign(mine, { target: face, found: !!tracked, style: me.style, at: now });
      mine.voice = voice;
      if (me.mode !== 'avatar') return;
      const packet = encodeFace(face, flags, me.style, this.faceSeq);
      if (now - this.lastFaceSent < FACE_KEEPALIVE_MS && samePacket(packet, this.lastFacePacket)) return;
      const to = this._linkedIds(0.02);
      if (!to.length) return;
      this.faceSeq = (this.faceSeq + 1) & 0xff;
      packet[3] = this.faceSeq;
      this.lastFacePacket = packet;
      this.lastFaceSent = now;
      room.localParticipant.publishData(packet, { reliable: false, topic: 'face', destinationIdentities: to }).catch(() => {});
    },

    _sendJson(topic, data, to) {
      const room = this.room;
      if (!room) return;
      const opts = { reliable: true, topic };
      if (to) opts.destinationIdentities = to;
      room.localParticipant.publishData(enc.encode(JSON.stringify(data)), opts).catch(() => {});
    },

    _pushAttributes() {
      const room = this.room;
      const me = this.me;
      if (!room || !me) return;
      room.localParticipant.setAttributes({
        look: me.look, mode: me.mode, style: me.style, status: me.status, hand: me.hand ? '1' : '0',
        ghost: me.ghost ? '1' : '0',
      }).catch((e) => console.warn('attributes', e));
    },

    // --- receiving -----------------------------------------------------------------------------

    _data(payload, participant, topic) {
      if (!participant) return;
      const person = this.people.get(participant.identity);
      if (!person) return;
      const now = performance.now();
      if (topic === 'pos') {
        const msg = decodePos(payload);
        if (!msg) return;
        if (person.seq >= 0 && ((msg.seq - person.seq) & 0xff) >= 128 && person.x != null) return;
        person.seq = msg.seq;
        const known = person.x != null;
        const at = known ? window.NookWorld.place(person, now) : { x: msg.x, y: msg.y };
        const jump = Math.hypot(msg.x - at.x, msg.y - at.y);
        person.fromX = at.x;
        person.fromY = at.y;
        person.x = msg.x;
        person.y = msg.y;
        person.dir = msg.dir;
        person.t0 = now;
        person.dur = !known || msg.teleport || jump > 6 ? 0 : clamp(msg.step * Math.max(1, jump), 60, 900);
        return;
      }
      if (topic === 'face') {
        const msg = decodeFace(payload);
        if (!msg) return;
        const av = person.face;
        if (av.seq >= 0 && ((msg.seq - av.seq) & 0xff) >= 128) return;
        Object.assign(av, { seq: msg.seq, target: msg.face, found: !!(msg.flags & 1), style: msg.style, at: now, packets: av.packets + 1, bytes: av.bytes + payload.length });
        return;
      }
      let data;
      try { data = JSON.parse(dec.decode(payload)); } catch (e) { return; }
      if (topic === 'emote' && typeof data.e === 'string') {
        person.emote = data.e.slice(0, 8);
        person.emoteUntil = now + 2600;
      } else if (topic === 'chat' && typeof data.text === 'string') {
        const text = data.text.slice(0, 2000);
        person.bubble = text;
        person.bubbleUntil = now + 6000;
        this._send({ chat: { id: String(data.id || now), from: person.identity, name: person.name, text, scope: data.scope === 'nearby' ? 'nearby' : 'all', ts: Date.now() } });
      } else if (topic === 'ping') {
        person.emote = '👋';
        person.emoteUntil = now + 2600;
        this._chime();
        this._send({ waved: person.name, from: person.identity });
      } else if (topic === 'map' && Number.isInteger(data.v)) {
        if (data.v > this.mapVersion) this._send({ map_changed: data.v });
      }
    },

    // --- actions from the page -------------------------------------------------------------------

    async setMic(on) {
      if (!this.room) return;
      try {
        await this.room.localParticipant.setMicrophoneEnabled(!!on);
      } catch (error) {
        this._send({ type: 'warning', message: 'Microphone: ' + errorText(error) });
      }
      this._refreshMuted();
    },

    async setMode(mode) {
      if (!this.media) return;
      try {
        await this.media.setMode(mode);
      } catch (error) {
        this._send({ type: 'warning', message: errorText(error) });
      }
      if (this.room) await this.media.publish(this.room);
      if (this.me) {
        this.me.mode = this.media.mode;
        this._pushAttributes();
      }
      this._send({ mode: this.media.mode });
    },

    setStyle(style) {
      if (!STYLES().includes(style)) return;
      this.media.style = style;
      if (this.me) {
        this.me.style = style;
        this.lastFacePacket = null;
        this._pushAttributes();
      }
    },

    setLook(look) {
      this.media.look = look;
      if (this.me) {
        this.me.look = look;
        this._pushAttributes();
      }
    },

    setName(name) {
      this.media.name = name;
    },

    setStatus(status) {
      if (!['available', 'busy', 'away'].includes(status) || !this.me) return;
      this.me.status = status;
      if (status !== 'away') this.autoAway = false;
      this._pushAttributes();
    },

    setRing(on) { this.ringOn = !!on; },

    // Everyone you are connected to in a big grid over the map (up to 25).
    setMeetingView(on) {
      this.meetingView = !!on;
      if (this.strip) this.strip.classList.toggle('meeting', this.meetingView);
      if (this.focusId) this.toggleFocus(null);
      this.people.forEach((p) => { p.quality = null; });
      this._send({ meeting_view: this.meetingView });
    },
    setMinimap(on) { this.minimapOn = !!on; },
    zoom(step) { this.world && this.world.zoomBy(step); },

    async shareScreen(on) {
      if (!this.room) return;
      try {
        await this.room.localParticipant.setScreenShareEnabled(!!on, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 15 } });
        this._send({ sharing: !!on && this.room.localParticipant.isScreenShareEnabled });
      } catch (error) {
        this._send({ sharing: false });
        if (!/denied|cancel|abort/i.test(errorText(error))) this._send({ type: 'warning', message: 'Screen share: ' + errorText(error) });
      }
    },

    toggleHand() {
      const me = this.me;
      if (!me) return;
      me.hand = !me.hand;
      this._pushAttributes();
      this._send({ hand: me.hand });
    },

    // While G is held: nobody hears or sees you, and you hear and see nobody.
    setGhost(on) {
      const me = this.me;
      if (!me || !!me.ghost === !!on) return;
      me.ghost = !!on;
      this._pushAttributes();
      this._send({ ghost: me.ghost });
    },

    emote(i) {
      const me = this.me;
      if (!me || i < 0 || i >= EMOTES.length) return;
      me.emote = EMOTES[i];
      me.emoteUntil = performance.now() + 2600;
      this._sendJson('emote', { e: EMOTES[i] });
    },

    sendChat(text, scope) {
      const me = this.me;
      text = String(text || '').trim().slice(0, 2000);
      if (!me || !text) return;
      const id = Math.random().toString(36).slice(2, 10);
      const to = scope === 'nearby' ? this._linkedIds() : null;
      if (scope !== 'nearby' || to.length) this._sendJson('chat', { id, text, scope }, to);
      me.bubble = text;
      me.bubbleUntil = performance.now() + 6000;
      this._send({ chat: { id, from: me.identity, name: me.name, text, scope: scope === 'nearby' ? 'nearby' : 'all', ts: Date.now(), mine: true, heard_by: to ? to.length : -1 } });
    },

    wave(identity) {
      if (!this.people.has(identity)) return;
      this._sendJson('ping', { w: 1 }, [identity]);
      if (this.me) {
        this.me.emote = '👋';
        this.me.emoteUntil = performance.now() + 2600;
      }
    },

    notifyMap(version) {
      this.mapVersion = Math.max(this.mapVersion, version | 0);
      this._sendJson('map', { v: version | 0 });
    },

    interact() {
      const me = this.me;
      if (!me || (window.nookEditor && window.nookEditor.active)) return;
      const ob = this.world.usableNear(me.x, me.y, me.dir);
      if (!ob) return;
      if (ob.t === 'portal') {
        if (Array.isArray(ob.to) && ob.to.length === 2) {
          const spot = this.world.freeNear(ob.to[0], ob.to[1]);
          this._place(spot.x, spot.y, true);
        } else {
          this._send({ interact: { kind: 'portal', index: ob.index, label: ob.label || '' } });
        }
        return;
      }
      const kind = ob.def.use;
      this._send({ interact: { kind, index: ob.index, label: ob.label || '', text: ob.text || '', url: ob.url || '' } });
    },

    async startAudio() {
      if (this.audioCtx && this.audioCtx.state !== 'running') await this.audioCtx.resume().catch(() => {});
      if (this.room) {
        await this.room.startAudio();
        this._send({ audio_blocked: !this.room.canPlaybackAudio });
      }
    },

    toggleFocus(id) {
      if (this.focusId) {
        const t = this.tiles.get(this.focusId);
        if (t) t.el.classList.remove('focused');
      }
      this.focusId = id && id !== this.focusId ? id : null;
      if (this.focusId) {
        const t = this.tiles.get(this.focusId);
        if (t) t.el.classList.add('focused');
      }
      this.shade.style.display = this.focusId ? 'block' : 'none';
    },

    // --- the microphone level (avatar mouth without a face) ---------------------------------------

    _watchMic(track) {
      this._unwatchMic();
      try {
        const ctx = this.audioCtx || new AudioContext();
        const source = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        this.mic = { source, analyser, data: new Float32Array(analyser.fftSize), level: 0 };
      } catch (e) {
        console.warn('No microphone level:', e);
      }
    },

    _unwatchMic() {
      if (this.mic) try { this.mic.source.disconnect(); } catch (e) { /* gone */ }
      this.mic = null;
    },

    _micLevel() {
      const mic = this.mic;
      const room = this.room;
      if (!mic || !room || !room.localParticipant.isMicrophoneEnabled) return 0;
      mic.analyser.getFloatTimeDomainData(mic.data);
      let sum = 0;
      for (const v of mic.data) sum += v * v;
      const goal = clamp((Math.sqrt(sum / mic.data.length) - 0.01) * 9, 0, 0.8);
      mic.level += (goal - mic.level) * (goal > mic.level ? 0.6 : 0.3);
      return mic.level;
    },

    _chime() {
      const ctx = this.audioCtx;
      if (!ctx) return;
      const now = ctx.currentTime;
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
        o.connect(g).connect(ctx.destination);
        o.start(now + i * 0.12);
        o.stop(now + i * 0.12 + 0.4);
      });
    },

    // --- tiles ---------------------------------------------------------------------------------

    _tile(id, screen) {
      let t = this.tiles.get(id);
      if (t) return t;
      const el = document.createElement('div');
      el.className = 'nook-tile' + (screen ? ' screen' : '');
      el.dataset.identity = id;
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      const canvas = document.createElement('canvas');
      const name = document.createElement('div');
      name.className = 'nook-tile-name';
      const badge = document.createElement('div');
      badge.className = 'nook-tile-badge';
      el.append(video, canvas, name, badge);
      el.addEventListener('click', () => this.toggleFocus(id));
      t = { id, el, video, canvas, name, badge, track: null, screen: !!screen, drawn: '', label: '' };
      this.tiles.set(id, t);
      return t;
    },

    _updateTiles(now, dt) {
      const host = document.getElementById('nook-strip-host');
      if (!host) return;
      if (this.strip.parentElement !== host) host.appendChild(this.strip);
      const L = LK();
      const room = this.room;
      const wanted = [];
      if (room) {
        this.people.forEach((p) => {
          const link = p.link;
          if (!link || link.opacity <= 0.02) return;
          const rp = room.remoteParticipants.get(p.identity);
          const rank = (link.kind === 'spotlight' ? -100 : 0) + link.d;
          wanted.push({ id: p.identity, p, link, rank, screen: false });
          const sp = rp && rp.getTrackPublication(L.Track.Source.ScreenShare);
          if (sp && sp.track) wanted.push({ id: p.identity + '#screen', p, link, rank: rank - 0.5, screen: true, pub: sp });
        });
      }
      wanted.sort((a, b) => a.rank - b.rank);
      const shown = wanted.slice(0, this.meetingView ? 25 : MAX_TILES);
      // Meeting view with nobody to show: say how to get someone there.
      if (!this.emptyNote) {
        this.emptyNote = document.createElement('div');
        this.emptyNote.className = 'nook-meeting-empty';
      }
      if (this.meetingView && !shown.length) {
        this.emptyNote.textContent = this.strings.meeting_empty || 'Nobody close enough.';
        if (this.emptyNote.parentElement !== this.strip) this.strip.appendChild(this.emptyNote);
      } else if (this.emptyNote.parentElement) {
        this.emptyNote.remove();
      }
      // Meeting view: the biggest 4:3 tiles that fit, in a centered grid.
      if (this.meetingView && shown.length) {
        const n = shown.length;
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const gap = 12;
        const W = this.strip.clientWidth - 32 - gap * (cols - 1);
        const H = this.strip.clientHeight - 32 - gap * (rows - 1);
        const w = Math.max(120, Math.floor(Math.min(W / cols, (H / rows) * 4 / 3)));
        const layout = cols + 'x' + w;
        if (this.stripLayout !== layout) {
          this.stripLayout = layout;
          this.strip.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
        }
      } else if (this.stripLayout) {
        this.stripLayout = '';
        this.strip.style.gridTemplateColumns = '';
      }
      const ids = new Set(shown.map((w) => w.id));
      this.tiles.forEach((t, id) => {
        if (!ids.has(id)) {
          if (t.el.parentElement) t.el.remove();
          if (t.track) { try { t.track.detach(t.video); } catch (e) { /* gone */ } t.track = null; }
          if (this.focusId === id) this.toggleFocus(null);
        }
      });
      shown.forEach((w, i) => {
        const t = this._tile(w.id, w.screen);
        if (this.strip.children[i] !== t.el) this.strip.insertBefore(t.el, this.strip.children[i] || null);
        t.el.classList.toggle('in-meeting', this.meetingView);
        const focused = this.focusId === w.id;
        t.el.style.opacity = focused ? '1' : String(Math.round(clamp(w.link.opacity, 0, 1) * 100) / 100);
        t.el.style.filter = focused || w.link.blur < 0.2 ? 'none' : `blur(${w.link.blur.toFixed(1)}px)`;
        t.el.classList.toggle('speaking', !!w.p.speaking && w.link.gain > 0.01 && !w.screen);
        const label = (w.p.status === 'busy' ? '🔴 ' : '') + (w.screen ? '🖥 ' : '') + w.p.name + (w.p.muted && !w.screen ? ' 🔇' : '') + (w.p.hand ? ' ✋' : '');
        if (t.label !== label) { t.label = label; t.name.textContent = label; }
        const badge = w.link.kind === 'spotlight' ? '★' : '';
        if (t.badge.textContent !== badge) { t.badge.textContent = badge; t.badge.style.display = badge ? 'block' : 'none'; }
        // What to show: their video, their avatar, or their character.
        let track = null;
        if (w.screen) track = w.pub.track;
        else if (room && (w.p.mode === 'face' || w.p.mode === 'full')) {
          const rp = room.remoteParticipants.get(w.p.identity);
          const cam = rp && rp.getTrackPublication(L.Track.Source.Camera);
          if (cam && cam.track && !cam.isMuted) track = cam.track;
        }
        if (track) {
          if (t.track !== track) {
            if (t.track) { try { t.track.detach(t.video); } catch (e) { /* gone */ } }
            track.attach(t.video);
            t.track = track;
          }
          t.video.style.display = 'block';
          t.canvas.style.display = 'none';
          return;
        }
        if (t.track) { try { t.track.detach(t.video); } catch (e) { /* gone */ } t.track = null; }
        t.video.style.display = 'none';
        t.canvas.style.display = 'block';
        const cw = t.el.clientWidth;
        const ch = t.el.clientHeight;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (t.canvas.width !== Math.round(cw * dpr)) { t.canvas.width = Math.round(cw * dpr); t.canvas.height = Math.round(ch * dpr); t.drawn = ''; }
        const ctx = t.canvas.getContext('2d');
        if (w.p.mode === 'avatar') {
          animateFace(w.p.face, now, dt, w.p.speaking ? 0.4 : 0);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          window.AvatarFace.draw(ctx, cw, ch, w.p.face.current, { style: w.p.face.style || w.p.style, seed: w.p.name, mirror: false, voice: 0 });
          t.drawn = '';
          const mood = window.AvatarFace.emotion(w.p.face.target);
          w.p.mood = now - w.p.face.at < 1500 ? mood || null : null;
        } else if (t.drawn !== w.p.look) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          window.NookArt.portrait(ctx, w.p.look, t.canvas.width, t.canvas.height, '#2b3346');
          t.drawn = w.p.look;
        }
      });
    },

    // --- the minimap ----------------------------------------------------------------------------

    // The whole map, small, with everyone on it; a click walks there.
    _updateMinimap(now) {
      const host = document.getElementById('nook-minimap-host');
      const show = host && this.me && this.minimapOn && this.world.map;
      if (!show) {
        if (this.minimap.parentElement) this.minimap.remove();
        return;
      }
      if (this.minimap.parentElement !== host) host.appendChild(this.minimap);
      const world = this.world;
      if (this.minimapFor !== world.staticLayer) {
        // Cached picture of the map (floor, walls and things) for this map version.
        const [art, ctx] = window.NookArt.canvas(world.w * 16, world.h * 16);
        ctx.drawImage(world.staticLayer, 0, 0);
        for (const ob of world.standing) {
          const sp = window.NookArt.object(ob);
          ctx.drawImage(sp.canvas, ob.x * 16 + sp.dx, ob.y * 16 + sp.dy);
        }
        this.minimapArt = art;
        this.minimapFor = world.staticLayer;
      }
      const maxW = 200;
      const maxH = 140;
      const scale = Math.min(maxW / (world.w * 16), maxH / (world.h * 16));
      const cw = Math.round(world.w * 16 * scale);
      const ch = Math.round(world.h * 16 * scale);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = this.minimapCanvas;
      if (c.width !== cw * dpr || c.height !== ch * dpr) {
        c.width = cw * dpr;
        c.height = ch * dpr;
        c.style.width = cw + 'px';
        c.style.height = ch + 'px';
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.minimapArt, 0, 0, c.width, c.height);
      const k = scale * dpr * 16;  // device px per tile
      // What the main view shows.
      if (world.cam && world.canvas.clientWidth) {
        const vw = world.canvas.clientWidth / world.zoom / 16;
        const vh = world.canvas.clientHeight / world.zoom / 16;
        const cx = world.cam.x / 16;
        const cy = world.cam.y / 16;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect((cx - vw / 2) * k, (cy - vh / 2) * k, vw * k, vh * k);
      }
      const dot = (x, y, color, r) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc((x + 0.5) * k, (y + 0.5) * k, r * dpr, 0, Math.PI * 2);
        ctx.fill();
      };
      this.people.forEach((p) => {
        if (p.x == null) return;
        const at = window.NookWorld.place(p, now);
        dot(at.x, at.y, '#1b1f27', 3.6);
        dot(at.x, at.y, p.heard ? '#3ccf6e' : '#ffffff', 2.6);
      });
      const at = window.NookWorld.place(this.me, now);
      dot(at.x, at.y, '#1b1f27', 4.4);
      dot(at.x, at.y, '#20c0b2', 3.4);
    },

    _minimapClick(e) {
      if (!this.me || !this.world.map) return;
      e.preventDefault();
      e.stopPropagation();
      const r = this.minimapCanvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * this.world.w);
      const y = Math.floor(((e.clientY - r.top) / r.height) * this.world.h);
      this._clickTile(Math.max(0, Math.min(this.world.w - 1, x)), Math.max(0, Math.min(this.world.h - 1, y)));
    },

    // --- every frame ---------------------------------------------------------------------------

    _frame(now) {
      requestAnimationFrame((t) => this._frame(t));
      const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016;
      this.lastFrame = now;
      if (!this.world) return;
      try {
        const host = document.getElementById('nook-map-host');
        // The space page went away (a link to the front page): leave the room.
        if (host) this.hostSeenAt = now;
        else if (this.room && now - (this.hostSeenAt || now) > 1000) this.disconnect();
        this.world.mount(host);
        this.media.mountView(document.getElementById('nook-self-host') || document.getElementById('nook-preview-host'));
        this._tickMove(now);
        this._updateLinks(now);
        if (this.me) {
          animateFace(this.myFace, now, dt, this.myFace.voice || 0);
          this.media.avatar.current = this.myFace.current;
          this.me.mood = this.me.mode === 'avatar' ? (window.AvatarFace.emotion(this.myFace.target) || null) : null;
        } else if (this.media.mode === 'avatar') {
          // The pre-join preview: our face without a room.
          const face = this.media.face();
          this.previewFace = this.previewFace || makeFaceState(this.media.style);
          Object.assign(this.previewFace, { target: face || window.AvatarFace.neutral(), found: !!face, at: now });
          animateFace(this.previewFace, now, dt, 0);
          this.media.avatar.current = this.previewFace.current;
        }
        if (this.world.map) {
          const list = [];
          if (this.me) list.push(this.me);
          this.people.forEach((p) => { if (p.x != null) list.push(p); });
          let hint = null;
          if (this.me && !(this.me.dur && now < this.me.t0 + this.me.dur) && !(window.nookEditor && window.nookEditor.active)) {
            const ob = this.world.usableNear(this.me.x, this.me.y, this.me.dir);
            if (ob) hint = { x: ob.x, y: ob.y, w: ob.w, text: ob.label || this.strings['use_' + ob.def.use] || ob.t };
          }
          const fade = new Map();
          this.people.forEach((p) => fade.set(p.identity, p.link ? Math.max(p.link.opacity, p.link.gain) : 0));
          this.world.render(now, list, this.me, {
            ring: this.me && this.ringOn ? { hear: R_HEAR, full: R_FULL } : null,
            hint,
            fade,
            focus: this.me ? null : this.previewAt,
          });
        }
        this._updateTiles(now, dt);
        this._updateMinimap(now);
        this.media.drawView(now, this.myFace ? this.myFace.voice : 0);
        this._report(now);
        if (this.me && this.me.status === 'available' && now - this.lastActivity > AWAY_AFTER_MS) {
          this.autoAway = true;
          this.setStatus('away');
          this._send({ status_changed: 'away' });
        }
      } catch (e) {
        if (!this.frameError) console.error('nooklane frame', e);
        this.frameError = e;
      }
    },

    // The people list for the page (only when something changed).
    _report(now) {
      if (!this.me || now - this.lastReportAt < 400) return;
      this.lastReportAt = now;
      const where = (p) => {
        const a = p.x == null ? null : this.world.areaAt(p.x, p.y);
        return a ? a.name : '';
      };
      const people = [{
        identity: this.me.identity, name: this.me.name, status: this.me.status, mode: this.me.mode,
        muted: !!this.me.muted, local: true, near: true, where: where(this.me), hand: !!this.me.hand, look: this.me.look,
      }];
      const others = [];
      this.people.forEach((p) => others.push({
        identity: p.identity, name: p.name, status: p.status, mode: p.mode, muted: !!p.muted, local: false,
        near: !!p.heard, where: where(p), hand: !!p.hand, look: p.look,
      }));
      others.sort((a, b) => (b.near - a.near) || a.name.localeCompare(b.name));
      const text = JSON.stringify(people.concat(others));
      if (text === this.lastReport) return;
      this.lastReport = text;
      this._send({ people: JSON.parse(text), area: this._areaName() });
    },

    _send(data) {
      const input = document.getElementById(this.bridgeId);
      if (!input) return;
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setValue.call(input, JSON.stringify(data));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },

    // --- for tests and debugging ----------------------------------------------------------------

    debug() {
      const out = { me: this.me && { x: this.me.x, y: this.me.y, mode: this.me.mode, area: this._areaName() }, people: [] };
      const room = this.room;
      this.people.forEach((p) => {
        const rp = room && room.remoteParticipants.get(p.identity);
        const subs = {};
        let volume = null;
        if (rp) {
          rp.trackPublications.forEach((pub) => {
            subs[pub.source] = !!pub.isSubscribed;
            if (pub.kind === 'audio' && pub.track) {
              const n = this.audioNodes.get(pub.track.sid);
              volume = n ? n.gain : pub.track._nookGain;
            }
          });
        }
        const tile = this.tiles.get(p.identity);
        out.people.push({
          identity: p.identity, name: p.name, x: p.x, y: p.y, mode: p.mode, status: p.status,
          link: p.link && { kind: p.link.kind, gain: +p.link.gain.toFixed(3), opacity: +p.link.opacity.toFixed(3), blur: +p.link.blur.toFixed(2), pan: +p.link.pan.toFixed(2), d: +p.link.d.toFixed(2), quality: p.link.quality },
          subs, volume,
          tile: tile && tile.el.isConnected ? { opacity: tile.el.style.opacity, filter: tile.el.style.filter, video: tile.video.style.display === 'block', width: tile.video.videoWidth, height: tile.video.videoHeight } : null,
          face: { packets: p.face.packets, found: p.face.found, emotion: window.AvatarFace.emotion(p.face.target) },
          emote: p.emote && performance.now() < p.emoteUntil ? p.emote : null,
          hand: p.hand,
        });
      });
      return out;
    },

    injectFace(values, ms) { this.media.injectFace(values, ms); },
  };

  window.nooklane = nook;
})();
