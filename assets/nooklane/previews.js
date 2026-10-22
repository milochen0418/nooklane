/*
 * Small pictures the pages show, drawn into canvases Reflex renders:
 *
 *   <canvas data-nook-thumb="/_nooklane/map/<id>?v=3">   a space's (or a
 *        template's: /_nooklane/template/<id>) whole map, fetched once
 *   <canvas data-nook-sprite="<look>" data-nook-walk="1"> a character; walking
 *        around in place with data-nook-walk
 *   <canvas data-nook-avatar-style="cat">                 an idle avatar (blinks)
 *
 * The map JSON comes from the backend, whose base URL the page head gives in
 * <meta name="nook-api">.
 */
(function () {
  if (window.NookPreviews) return;

  const maps = new Map();      // url -> {state: 'loading'|'ready'|'error', art}
  const idle = new Map();      // avatar style -> face state

  function apiUrl(path) {
    const meta = document.querySelector('meta[name="nook-api"]');
    const base = ((meta && meta.content) || window.NOOK_API || '').replace(/\/$/, '');
    return base + path;
  }

  // The whole map at art resolution (16 px a tile), with its things.
  function renderMap(map) {
    const world = new window.NookWorld();
    world.setMap(map);
    const [c, ctx] = window.NookArt.canvas(world.w * 16, world.h * 16);
    ctx.drawImage(world.staticLayer, 0, 0);
    for (const ob of world.standing) {
      const s = window.NookArt.object(ob);
      ctx.drawImage(s.canvas, ob.x * 16 + s.dx, ob.y * 16 + s.dy);
      if (ob.def.anim) window.NookArt.animated(ctx, ob, ob.x * 16, ob.y * 16, 0);
    }
    return c;
  }

  function fit(canvas) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.dataset.nookDrawn = '';
    }
    return { w, h, dpr, cw, ch };
  }

  function drawThumb(canvas) {
    const url = canvas.dataset.nookThumb;
    const size = fit(canvas);
    if (!url || !size) return;
    let entry = maps.get(url);
    if (!entry) {
      entry = { state: 'loading', art: null };
      maps.set(url, entry);
      fetch(apiUrl(url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
        .then((map) => { entry.art = renderMap(map); entry.state = 'ready'; })
        .catch(() => { entry.state = 'error'; });
    }
    if (entry.state !== 'ready' || canvas.dataset.nookDrawn === url) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#262a33';
    ctx.fillRect(0, 0, size.cw, size.ch);
    const art = entry.art;
    // Cover the box, centered.
    const scale = Math.max(size.cw / art.width, size.ch / art.height);
    const dw = art.width * scale;
    const dh = art.height * scale;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art, (size.cw - dw) / 2, (size.ch - dh) / 2, dw, dh);
    canvas.dataset.nookDrawn = url;
  }

  function drawSprite(canvas, now) {
    const size = fit(canvas);
    if (!size) return;
    const look = canvas.dataset.nookSprite || '0-0-0-0-0-0';
    const walk = canvas.dataset.nookWalk === '1';
    const dirs = ['down', 'right', 'up', 'left'];
    const dir = walk ? dirs[Math.floor(now / 1400) % 4] : 'down';
    const frame = walk ? Math.floor(now / 150) % 4 : 0;
    const key = look + dir + frame;
    if (canvas.dataset.nookDrawn === key) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.cw, size.ch);
    const sprite = window.NookArt.character(look, dir, frame);
    const scale = Math.max(1, Math.floor(Math.min(size.cw / 16, size.ch / 24)));
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(size.cw / 2, (size.ch + 24 * scale) / 2 - scale, 5.5 * scale, 2 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(sprite, Math.round((size.cw - 16 * scale) / 2), Math.round((size.ch - 24 * scale) / 2), 16 * scale, 24 * scale);
    canvas.dataset.nookDrawn = key;
  }

  function drawStyle(canvas, now, dt) {
    const size = fit(canvas);
    if (!size || !window.AvatarFace) return;
    const style = canvas.dataset.nookAvatarStyle;
    let av = idle.get(style);
    if (!av) {
      av = { face: window.AvatarFace.neutral(), next: now + 800 + Math.random() * 2000, until: 0 };
      idle.set(style, av);
    }
    const A = window.AvatarFace;
    const f = av.face;
    if (now > av.next) { av.until = now + 150; av.next = now + 2500 + Math.random() * 3000; }
    const blink = now < av.until ? 1 : 0;
    f.shapes[A.INDEX.eyeBlinkLeft] = blink;
    f.shapes[A.INDEX.eyeBlinkRight] = blink;
    f.y = Math.sin(now / 900) * 0.03;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    A.draw(ctx, size.w, size.h, f, { style, seed: style, badge: false });
  }

  // A thing of the build palette, fitted into its button.
  function drawObject(canvas) {
    const size = fit(canvas);
    const type = canvas.dataset.nookObject;
    if (!size || !type || canvas.dataset.nookDrawn === type) return;
    const o = { t: type, x: 3, y: 2, dir: 's', monitor: 1, color: 'teal' };
    if (type === 'rug') { o.w = 2; o.h = 2; }
    const s = window.NookArt.object(o);
    // Moving things (portal, campfire, fountain) get one frame of their animation.
    const [art, actx] = window.NookArt.canvas(s.canvas.width, s.canvas.height);
    actx.drawImage(s.canvas, 0, 0);
    if ((window.NookArt.OBJECTS[type] || {}).anim) window.NookArt.animated(actx, o, -s.dx, -s.dy, 700);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.cw, size.ch);
    const scale = Math.min(size.cw / art.width, size.ch / art.height) * 0.9;
    ctx.imageSmoothingEnabled = false;
    const w = art.width * scale;
    const h = art.height * scale;
    ctx.drawImage(art, (size.cw - w) / 2, (size.ch - h) / 2, w, h);
    canvas.dataset.nookDrawn = type;
  }

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    if (!window.NookArt || !window.NookWorld) return;
    document.querySelectorAll('canvas[data-nook-thumb]').forEach(drawThumb);
    document.querySelectorAll('canvas[data-nook-sprite]').forEach((c) => drawSprite(c, now));
    document.querySelectorAll('canvas[data-nook-avatar-style]').forEach((c) => drawStyle(c, now, dt));
    document.querySelectorAll('canvas[data-nook-object]').forEach(drawObject);
  }
  requestAnimationFrame(frame);

  window.NookPreviews = { renderMap, maps };
})();
