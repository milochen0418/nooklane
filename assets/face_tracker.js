/*
 * Face tracking on this device: camera -> MediaPipe Face Landmarker -> the 51
 * ARKit blendshapes + head pose, about 25 times a second. The camera picture
 * never leaves the browser; livekit_bridge.js sends only these numbers.
 *
 *   const tracker = new FaceTracker({onFrame, onStatus});
 *   await tracker.start();         // asks for the camera
 *   await tracker.start(stream);   // or reads a camera stream the caller owns
 *   tracker.stop();                // releases its own camera (its light goes off)
 *
 * onFrame(face) with face = {shapes, yaw, pitch, roll, x, y, box} (see
 * avatar_face.js; box = {x0, y0, x1, y1}, where the face is in the camera
 * picture, 0..1) while a face is found, onFrame(null) once it is lost.
 * onStatus(status, message): 'starting' | 'loading' | 'searching' |
 * 'tracking' | 'off' | 'error'.
 *
 * A relaxed face does not score zero everywhere (eyeSquint is often 0.5 at
 * rest), so each blendshape is measured from a rest value: it settles on the
 * lower values within a second and creeps up only slowly (a held smile stays
 * a smile for minutes). The head pose is measured from a slow average, i.e.
 * from where the camera is.
 *
 * MediaPipe (assets/mediapipe/, see NOTICE.md) loads on the first start.
 */
(function () {
  if (window.FaceTracker) return;

  const ASSETS = '/mediapipe/';
  const ASSETS_VERSION = '1.0.1';
  const DETECT_INTERVAL_MS = 40;
  // The face counts as lost after this long without a detection.
  const LOST_AFTER_MS = 400;
  // Per second: how fast a rest value follows lower values (smoothed, so one
  // odd frame does not move it much) and higher ones, and the pose baseline.
  const REST_FALL = 2;
  const REST_RISE = 0.01;
  const POSE_FOLLOW = 0.05;

  let landmarker = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(el);
    });
  }

  // Software WebGL (e.g. headless browsers) is slower than MediaPipe's CPU path.
  function hasHardwareGL() {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return false;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      return !/swiftshader|llvmpipe|software/i.test(renderer);
    } catch (error) {
      return false;
    }
  }

  async function createLandmarker() {
    if (!window.Vision) await loadScript(`${ASSETS}vision_bundle.js?v=${ASSETS_VERSION}`);
    const fileset = {
      wasmLoaderPath: `${ASSETS}vision_wasm_internal.js?v=${ASSETS_VERSION}`,
      wasmBinaryPath: `${ASSETS}vision_wasm_internal.wasm?v=${ASSETS_VERSION}`,
    };
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: `${ASSETS}face_landmarker.task?v=${ASSETS_VERSION}`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    if (hasHardwareGL()) {
      try {
        return await window.Vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch (error) {
        console.warn('Face tracking on the GPU failed, using the CPU:', error);
      }
    }
    return window.Vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }

  // MediaPipe's facial transformation matrix (column-major 4x4) -> head pose
  // in the camera image. Signs measured with rotated / mirrored test photos.
  function pose(m) {
    const distance = Math.max(10, -m[14]);
    return {
      yaw: Math.atan2(m[8], m[10]),
      pitch: Math.asin(Math.max(-1, Math.min(1, -m[9]))),
      roll: -Math.atan2(m[1], m[0]),
      x: m[12] / distance,
      y: m[13] / distance,
    };
  }

  // Bounding box of the face landmarks (0..1 in the camera picture).
  function box(points) {
    if (!points || !points.length) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of points) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  }

  class FaceTracker {
    constructor({ onFrame, onStatus }) {
      this.onFrame = onFrame || (() => {});
      this.onStatus = onStatus || (() => {});
      this.stream = null;
      this.video = null;
      this.timer = null;
      this.running = false;
      this.rest = null;
      this.base = null;
      this.lastSeen = 0;
      this.found = false;
      this.lastTick = 0;
    }

    status(name, message) {
      this.state = name;
      this.onStatus(name, message || '');
    }

    async start(external) {
      if (this.running) return;
      this.running = true;
      this.status('starting', 'Starting camera…');
      try {
        const stream = external || await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
          audio: false,
        });
        if (!this.running) {
          if (!external) stream.getTracks().forEach((t) => t.stop());
          return;
        }
        this.external = !!external;
        this.stream = stream;
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        this.video = video;
        if (!landmarker) {
          this.status('loading', 'Loading face tracker…');
          landmarker = await createLandmarker();
        }
        if (!this.running) return;
        this.found = false;
        this.status('searching', 'Looking for your face…');
        // A timer, not requestAnimationFrame: it keeps going while the call
        // dialog is minimized (and its frame is not painted).
        this.timer = setInterval(() => this.tick(), DETECT_INTERVAL_MS);
      } catch (error) {
        const message = (error && error.message) || String(error);
        this.stop();
        this.status('error', 'Camera unavailable: ' + message);
        throw error;
      }
    }

    stop() {
      const wasRunning = this.running;
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
      if (this.stream && !this.external) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (this.video) this.video.srcObject = null;
      this.video = null;
      if (this.found) this.onFrame(null);
      this.found = false;
      if (wasRunning) this.status('off', 'Camera off');
    }

    tick() {
      const video = this.video;
      if (!this.running || !video || video.readyState < 2) return;
      const now = performance.now();
      // MediaPipe needs increasing timestamps.
      const stamp = Math.max(now, this.lastTick + 1);
      this.lastTick = stamp;
      let result;
      try {
        result = landmarker.detectForVideo(video, stamp);
      } catch (error) {
        console.warn('Face tracking failed:', error);
        return;
      }
      const categories = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
      const matrix = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
      if (!categories || !matrix) {
        if (this.found && now - this.lastSeen > LOST_AFTER_MS) {
          this.found = false;
          this.onFrame(null);
          this.status('searching', 'Looking for your face…');
        }
        return;
      }
      const dt = this.lastSeen ? Math.min(1, (now - this.lastSeen) / 1000) : 0;
      this.lastSeen = now;
      const face = this.calibrate(categories, pose(matrix.data), dt);
      face.box = box(result.faceLandmarks && result.faceLandmarks[0]);
      this.onFrame(face);
      if (!this.found) {
        this.found = true;
        this.status('tracking', '');
      }
    }

    calibrate(categories, head, dt) {
      const A = window.AvatarFace;
      const shapes = new Float32Array(A.SHAPES.length);
      const first = !this.rest;
      if (first) this.rest = new Float32Array(A.SHAPES.length);
      for (const c of categories) {
        const i = A.INDEX[c.categoryName];
        if (i === undefined) continue;  // "_neutral"
        const raw = c.score;
        if (first) this.rest[i] = raw;
        const rate = raw < this.rest[i] ? REST_FALL : REST_RISE;
        const rest = this.rest[i] + (raw - this.rest[i]) * Math.min(1, rate * dt);
        this.rest[i] = rest;
        shapes[i] = Math.max(0, Math.min(1, (raw - rest) / Math.max(0.05, 1 - rest)));
      }
      if (!this.base) this.base = { ...head };
      const k = Math.min(1, POSE_FOLLOW * dt);
      for (const key of ['yaw', 'pitch', 'x', 'y']) this.base[key] += (head[key] - this.base[key]) * k;
      return {
        shapes,
        yaw: head.yaw - this.base.yaw,
        pitch: head.pitch - this.base.pitch,
        roll: head.roll,
        x: Math.max(-1, Math.min(1, (head.x - this.base.x) * 4)),
        y: Math.max(-1, Math.min(1, (head.y - this.base.y) * 4)),
      };
    }
  }

  window.FaceTracker = FaceTracker;
})();
