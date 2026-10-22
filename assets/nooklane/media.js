/*
 * What your camera shows others, in one of four modes:
 *
 *   'avatar'  your face moves a cartoon avatar: the camera only feeds the face
 *             tracker on this device, and only the expression values travel
 *             (client.js sends them as 60-byte "face" data packets)
 *   'face'    the real face, close up: a square cut of the camera picture that
 *             follows your face (published as the camera track)
 *   'full'    the whole camera picture (published as the camera track)
 *   'off'     nothing; others see your character
 *
 *   const media = new NookMedia();
 *   await media.setMode('face');         // starts / stops the camera and tracker
 *   await media.publish(room);           // publishes or unpublishes video for the mode
 *   media.view                           // the element showing your own picture
 *   media.face()                         // your latest tracked face (avatar mode)
 *
 * One camera stream feeds everything (tracker, close-up, full picture), and
 * published tracks are clones, so unpublishing never turns the camera off.
 */
(function () {
  if (window.NookMedia) return;

  const CROP_SIZE = 360;
  const CROP_FPS = 24;
  // How much of the picture around the face the close-up keeps.
  const CROP_MARGIN = 2.1;

  function errorText(error) {
    return (error && error.message) || String(error);
  }

  class NookMedia {
    constructor() {
      this.mode = 'off';
      this.style = 'human';
      this.look = '0-0-0-0-0-0';
      this.name = '';
      this.stream = null;          // the camera
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.tracker = null;
      this.lastFace = null;
      this.lastFaceAt = 0;
      this.injected = null;
      this.injectedUntil = 0;
      this.status = '';            // what the tracker / camera is doing
      this.onStatus = null;        // (message) for the page
      this.crop = { canvas: null, ctx: null, timer: null, box: null, stream: null };
      this.published = null;       // {track, mode}
      this.room = null;
      this.busy = Promise.resolve();
      this.avatar = { current: null, voice: 0 };
      this._buildView();
    }

    // --- your own picture (pre-join preview and your tile) -------------------------

    _buildView() {
      const view = document.createElement('div');
      view.className = 'nook-self-view';
      view.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#1d2230;';
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:none;';
      const pic = document.createElement('canvas');
      pic.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);display:none;';
      const status = document.createElement('div');
      status.className = 'nook-self-status';
      status.style.cssText = 'position:absolute;left:6px;top:6px;max-width:80%;font:600 11px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:6px;display:none;';
      view.append(video, pic, status);
      this.view = view;
      this.viewVideo = video;
      this.viewCanvas = pic;
      this.viewStatus = status;
    }

    mountView(container) {
      if (container && this.view.parentElement !== container) container.appendChild(this.view);
    }

    // Draws your own picture; called every animation frame.
    drawView(now, voice) {
      const mode = this.mode;
      const video = this.viewVideo;
      const pic = this.viewCanvas;
      const showVideo = mode === 'full' && this.stream;
      if (showVideo) {
        if (video.srcObject !== this.stream) video.srcObject = this.stream;
        video.style.display = '';
        pic.style.display = 'none';
      } else {
        if (video.srcObject) video.srcObject = null;
        video.style.display = 'none';
        pic.style.display = '';
        const w = pic.clientWidth;
        const h = pic.clientHeight;
        if (w && h) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          if (pic.width !== Math.round(w * dpr)) { pic.width = Math.round(w * dpr); pic.height = Math.round(h * dpr); }
          const ctx = pic.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (mode === 'face' && this.crop.canvas) {
            ctx.fillStyle = '#1d2230';
            ctx.fillRect(0, 0, pic.width, pic.height);
            const s = Math.max(pic.width, pic.height);
            ctx.drawImage(this.crop.canvas, (pic.width - s) / 2, (pic.height - s) / 2, s, s);
          } else if (mode === 'avatar') {
            const face = this.avatar.current;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // Mirrored by CSS already: draw as the camera sees it.
            window.AvatarFace.draw(ctx, w, h, face, { style: this.style, seed: this.name, mirror: false, voice: voice || 0 });
          } else {
            window.NookArt.portrait(ctx, this.look, pic.width, pic.height, '#2b3346');
          }
        }
      }
      const msg = this.status;
      this.viewStatus.textContent = msg;
      this.viewStatus.style.display = msg ? '' : 'none';
    }

    // --- camera ------------------------------------------------------------------------

    async _camera() {
      if (this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live')) return this.stream;
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      return this.stream;
    }

    _stopCamera() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video.srcObject = null;
    }

    _setStatus(message) {
      if (message === this.status) return;
      this.status = message;
      if (this.onStatus) this.onStatus(message);
    }

    async _startTracker() {
      if (this.tracker) return;
      const tracker = new window.FaceTracker({
        onFrame: (face) => {
          if (this.tracker !== tracker) return;
          if (face) {
            this.lastFace = face;
            this.lastFaceAt = performance.now();
          }
        },
        onStatus: (status, message) => {
          if (this.tracker !== tracker) return;
          // The close-up and full picture work without a found face: say nothing.
          this._setStatus(this.mode === 'avatar' || status === 'loading' || status === 'error' ? message : '');
        },
      });
      this.tracker = tracker;
      await tracker.start(this.stream);
    }

    _stopTracker() {
      if (this.tracker) this.tracker.stop();
      this.tracker = null;
      this.lastFace = null;
    }

    // --- the close-up ------------------------------------------------------------------

    _startCrop() {
      if (this.crop.canvas) return;
      const canvas = document.createElement('canvas');
      canvas.width = CROP_SIZE;
      canvas.height = CROP_SIZE;
      const ctx = canvas.getContext('2d');
      this.crop = { canvas, ctx, timer: null, box: null, stream: canvas.captureStream(CROP_FPS), last: 0 };
      this.crop.timer = setInterval(() => this._drawCrop(), 1000 / CROP_FPS);
    }

    _stopCrop() {
      clearInterval(this.crop.timer);
      if (this.crop.stream) this.crop.stream.getTracks().forEach((t) => t.stop());
      this.crop = { canvas: null, ctx: null, timer: null, box: null, stream: null };
    }

    // Follows the face: a square around it, eased so the picture does not jump.
    _drawCrop() {
      const { ctx } = this.crop;
      const video = this.video;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!ctx || !vw || !vh) return;
      const now = performance.now();
      const dt = this.crop.last ? Math.min(0.5, (now - this.crop.last) / 1000) : 0.04;
      this.crop.last = now;
      const face = this.lastFace && now - this.lastFaceAt < 1500 ? this.lastFace : null;
      let goal;
      if (face && face.box) {
        const b = face.box;
        const cx = ((b.x0 + b.x1) / 2) * vw;
        const cy = ((b.y0 + b.y1) / 2) * vh - (b.y1 - b.y0) * vh * 0.06;
        const size = Math.min(Math.min(vw, vh), Math.max((b.x1 - b.x0) * vw, (b.y1 - b.y0) * vh) * CROP_MARGIN);
        goal = { cx, cy, size };
      } else {
        goal = { cx: vw / 2, cy: vh / 2, size: Math.min(vw, vh) };
      }
      const cur = this.crop.box || goal;
      const k = 1 - Math.exp(-dt / 0.28);
      const box = {
        cx: cur.cx + (goal.cx - cur.cx) * k,
        cy: cur.cy + (goal.cy - cur.cy) * k,
        size: cur.size + (goal.size - cur.size) * k,
      };
      this.crop.box = box;
      const half = box.size / 2;
      const sx = Math.max(0, Math.min(vw - box.size, box.cx - half));
      const sy = Math.max(0, Math.min(vh - box.size, box.cy - half));
      ctx.drawImage(video, sx, sy, box.size, box.size, 0, 0, CROP_SIZE, CROP_SIZE);
    }

    // --- modes ---------------------------------------------------------------------------

    // Serialized: a quick double click on the mode buttons must not interleave.
    setMode(mode) {
      this.busy = this.busy.then(() => this._setMode(mode)).catch((e) => console.warn('media mode', e));
      return this.busy;
    }

    async _setMode(mode) {
      if (!['avatar', 'face', 'full', 'off'].includes(mode)) mode = 'off';
      this.mode = mode;
      if (mode === 'off') {
        this._stopCrop();
        this._stopTracker();
        this._stopCamera();
        this._setStatus('');
        await this._publish();
        return;
      }
      try {
        await this._camera();
      } catch (error) {
        this.mode = 'off';
        this._setStatus('');
        this._stopTracker();
        this._stopCrop();
        await this._publish();
        throw new Error('Camera unavailable: ' + errorText(error));
      }
      if (mode === 'full') {
        this._stopTracker();
        this._stopCrop();
        this._setStatus('');
      } else {
        try {
          await this._startTracker();
        } catch (error) {
          console.warn('face tracker', error);
        }
        if (mode === 'face') this._startCrop();
        else this._stopCrop();
      }
      await this._publish();
    }

    async publish(room) {
      this.room = room;
      this.busy = this.busy.then(() => this._publish()).catch((e) => console.warn('publish', e));
      return this.busy;
    }

    // The camera track others get for the mode: none, the close-up or the picture.
    async _publish() {
      const room = this.room;
      const LK = window.LivekitClient;
      const want = this.mode === 'face' || this.mode === 'full' ? this.mode : null;
      if (!room || !room.localParticipant) return;
      if (this.published && this.published.mode === want) return;
      if (this.published) {
        const old = this.published.track;
        this.published = null;
        try { await room.localParticipant.unpublishTrack(old, true); } catch (e) { /* already gone */ }
      }
      if (!want) return;
      let source;
      let options;
      if (want === 'face') {
        source = this.crop.stream && this.crop.stream.getVideoTracks()[0];
        options = {
          source: LK.Track.Source.Camera,
          simulcast: true,
          videoEncoding: { maxBitrate: 450000, maxFramerate: CROP_FPS },
          videoSimulcastLayers: [new LK.VideoPreset(120, 120, 80000, 12), new LK.VideoPreset(240, 240, 200000, 20)],
        };
      } else {
        source = this.stream && this.stream.getVideoTracks()[0];
        options = {
          source: LK.Track.Source.Camera,
          simulcast: true,
          videoEncoding: { maxBitrate: 800000, maxFramerate: 24 },
          videoSimulcastLayers: [LK.VideoPresets43.h120, LK.VideoPresets43.h240],
        };
      }
      if (!source) return;
      const track = new LK.LocalVideoTrack(source.clone(), undefined, true);
      this.published = { track, mode: want };
      try {
        await room.localParticipant.publishTrack(track, options);
      } catch (error) {
        this.published = null;
        track.stop();
        throw error;
      }
    }

    detach() {
      // Leaving the room: the track goes with it, the camera stays for the preview.
      if (this.published) this.published.track.stop();
      this.published = null;
      this.room = null;
    }

    stop() {
      this.detach();
      this._stopCrop();
      this._stopTracker();
      this._stopCamera();
      this.mode = 'off';
      this._setStatus('');
    }

    // --- your face (avatar mode) ---------------------------------------------------------

    // The face to send now: injected (tests), tracked, or null (none found).
    face() {
      const now = performance.now();
      if (this.injected && now < this.injectedUntil) return this.injected;
      if (this.lastFace && now - this.lastFaceAt < 500) return this.lastFace;
      return null;
    }

    injectFace(values, ms = 2000) {
      const A = window.AvatarFace;
      const face = A.neutral();
      for (const [key, value] of Object.entries(values || {})) {
        if (key in A.INDEX) face.shapes[A.INDEX[key]] = value;
        else if (key in face) face[key] = value;
      }
      this.injected = face;
      this.injectedUntil = performance.now() + ms;
    }
  }

  window.NookMedia = NookMedia;
})();
