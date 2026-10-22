/*
 * The map on screen: tiles, things on them and the people walking around.
 *
 *   const world = new NookWorld();
 *   world.mount(containerElement);       // adds its <canvas> (again after React re-renders)
 *   world.setMap(map);                    // map JSON (nooklane/maps/builder.py)
 *   world.render(now, people, me, opts);  // every animation frame
 *   world.isFree(x, y), world.areaAt(x, y), world.path(from, to), world.usableNear(x, y, dir)
 *
 * Positions are tiles; "art" pixels are 16 per tile and the canvas shows each
 * art pixel as `zoom` CSS pixels, without smoothing (crisp pixel art). A
 * person is drawn from {x, y, fromX, fromY, t0, dur, dir} so a step glides
 * from one tile to the next in `dur` ms.
 *
 * The floor, walls and flat things (rugs, flowers, paintings) are painted once
 * per map into an offscreen canvas; standing things and people are sorted by
 * their bottom edge every frame, so walking behind a plant hides your legs.
 */
(function () {
  if (window.NookWorld) return;
  const A = window.NookArt;
  const TILE = A.TILE;
  const ZOOMS = [1.25, 1.5, 2, 2.5, 3, 4];

  const MOODS = { happy: '😊', laughing: '😆', surprised: '😮', angry: '😠', sad: '😢', wink: '😉', kiss: '😘' };
  const STATUS_COLORS = { available: '#3ccf6e', busy: '#ef4d4d', away: '#f2b632' };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  class NookWorld {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'nook-canvas';
      this.canvas.tabIndex = 0;
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;cursor:pointer;touch-action:none;';
      this.ctx = this.canvas.getContext('2d');
      this.map = null;
      this.zoom = 2;
      this.cam = null;
      this.cssW = 0;
      this.cssH = 0;
      this.dpr = 1;
      this.marker = null;      // {x, y, until}: where a click sends us
      this.flash = null;       // {identity, until}: "locate" pulse
      this.hoverTile = null;
      this.listeners = [];
      this.onTile = null;      // (x, y, event) when the map is clicked
      this.onPerson = null;    // (identity) when a person is double-clicked
      this.personAt = null;    // set by the client: (x, y) -> identity | null
      this.editor = null;      // NookEditor while building
      this._bind();
    }

    // --- DOM ---------------------------------------------------------------------

    mount(container) {
      if (!container) return;
      if (this.canvas.parentElement !== container) container.appendChild(this.canvas);
    }

    _bind() {
      const c = this.canvas;
      const tileOf = (e) => this.screenToTile(e.clientX, e.clientY);
      c.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        c.focus({ preventScroll: true });
        const t = tileOf(e);
        if (!t) return;
        if (this.editor && this.editor.active) {
          this.editor.pointer('down', t, e);
          c.setPointerCapture(e.pointerId);
          return;
        }
        if (this.onTile) this.onTile(t.x, t.y, e);
      });
      c.addEventListener('pointermove', (e) => {
        const t = tileOf(e);
        this.hoverTile = t;
        if (this.editor && this.editor.active && t) this.editor.pointer(e.buttons ? 'drag' : 'move', t, e);
      });
      c.addEventListener('pointerup', (e) => {
        const t = tileOf(e);
        if (this.editor && this.editor.active && t) this.editor.pointer('up', t, e);
      });
      c.addEventListener('pointerleave', () => { this.hoverTile = null; });
      c.addEventListener('dblclick', (e) => {
        const t = tileOf(e);
        if (!t || !this.personAt || !this.onPerson || (this.editor && this.editor.active)) return;
        const who = this.personAt(t.x, t.y) || this.personAt(t.x, t.y + 1);
        if (who) this.onPerson(who);
      });
      c.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    zoomBy(step) {
      let i = ZOOMS.findIndex((z) => z >= this.zoom - 1e-6);
      if (i < 0) i = ZOOMS.length - 1;
      this.zoom = ZOOMS[clamp(i + step, 0, ZOOMS.length - 1)];
    }

    fitZoom() {
      // About 22 tiles across, whatever the window.
      const w = this.canvas.clientWidth || window.innerWidth;
      const ideal = w / (22 * TILE);
      this.zoom = ZOOMS.reduce((best, z) => (Math.abs(z - ideal) < Math.abs(best - ideal) ? z : best), ZOOMS[0]);
    }

    _resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (!w || !h) return false;
      if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
        this.cssW = w;
        this.cssH = h;
        this.dpr = dpr;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      return true;
    }

    // --- map ------------------------------------------------------------------------

    setMap(map) {
      const w = map.w;
      const h = map.h;
      const objects = (map.objects || []).map((o, index) => {
        const def = A.OBJECTS[o.t] || { w: 1, h: 1 };
        const size = A.objectSize(o);
        return Object.assign({}, o, { index, w: size.w, h: size.h, def });
      });
      const solid = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const f = map.floor[y][x];
          if (f === ' ' || f === '~' || map.walls[y][x] !== ' ') solid[y * w + x] = 1;
        }
      }
      const objectAt = new Int32Array(w * h).fill(-1);
      objects.forEach((o) => {
        for (let yy = o.y; yy < o.y + o.h; yy++) {
          for (let xx = o.x; xx < o.x + o.w; xx++) {
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (o.def.solid) solid[yy * w + xx] = 1;
            if (!o.def.flat && !o.def.wall) objectAt[yy * w + xx] = o.index;
          }
        }
      });
      const areaIdx = new Int16Array(w * h).fill(-1);
      (map.areas || []).forEach((a, i) => {
        (a.rects || []).forEach(([rx, ry, rw, rh]) => {
          for (let yy = ry; yy < ry + rh; yy++) {
            for (let xx = rx; xx < rx + rw; xx++) {
              if (xx >= 0 && yy >= 0 && xx < w && yy < h) areaIdx[yy * w + xx] = i;
            }
          }
        });
      });
      this.map = map;
      this.w = w;
      this.h = h;
      this.objects = objects;
      this.solid = solid;
      this.objectAt = objectAt;
      this.areaIdx = areaIdx;
      this.areas = map.areas || [];
      this.standing = objects.filter((o) => !o.def.flat && !o.def.wall)
        .sort((a, b) => (a.y + a.h) - (b.y + b.h) || a.x - b.x);
      this.usable = objects.filter((o) => o.def.use);
      this.staticLayer = this._paintStatic();
      if (!this.cam) this.cam = { x: (w * TILE) / 2, y: (h * TILE) / 2 };
    }

    _paintStatic() {
      const map = this.map;
      const [c, ctx] = A.canvas(this.w * TILE, this.h * TILE);
      const [tile, tctx] = A.canvas(TILE, TILE);
      const floorAt = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? null : map.floor[y][x]);
      const wallAt = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? ' ' : map.walls[y][x]);
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const f = map.floor[y][x];
          const kind = A.FLOOR_KINDS[f] || 'void';
          tctx.clearRect(0, 0, TILE, TILE);
          A.floor(tctx, kind, x, y, {
            up: floorAt(x, y - 1) === f, down: floorAt(x, y + 1) === f,
            left: floorAt(x - 1, y) === f, right: floorAt(x + 1, y) === f,
          });
          ctx.drawImage(tile, x * TILE, y * TILE);
          const wch = map.walls[y][x];
          if (wch !== ' ') {
            const kindW = A.WALL_KINDS[wch] || 'wall';
            const same = (ch) => ch !== ' ' && (A.WALL_KINDS[ch] === 'fence') === (kindW === 'fence') && (A.WALL_KINDS[ch] === 'hedge') === (kindW === 'hedge');
            tctx.clearRect(0, 0, TILE, TILE);
            A.wall(tctx, kindW, {
              up: same(wallAt(x, y - 1)), down: same(wallAt(x, y + 1)),
              left: same(wallAt(x - 1, y)), right: same(wallAt(x + 1, y)),
            });
            ctx.drawImage(tile, x * TILE, y * TILE);
          }
        }
      }
      this.objects.filter((o) => o.def.flat || o.def.wall).forEach((o) => {
        const s = A.object(o);
        ctx.drawImage(s.canvas, o.x * TILE + s.dx, o.y * TILE + s.dy);
      });
      return c;
    }

    inside(x, y) { return this.map && x >= 0 && y >= 0 && x < this.w && y < this.h; }
    isFree(x, y) { return this.inside(x, y) && !this.solid[y * this.w + x]; }

    areaAt(x, y) {
      if (!this.inside(x, y)) return null;
      const i = this.areaIdx[y * this.w + x];
      return i >= 0 ? this.areas[i] : null;
    }

    objectOn(x, y) {
      if (!this.inside(x, y)) return null;
      const i = this.objectAt[y * this.w + x];
      return i >= 0 ? this.objects[i] : null;
    }

    // A free tile to stand on: one of the spawn points, or near (x, y).
    freeNear(x, y, taken) {
      const ok = (tx, ty) => this.isFree(tx, ty) && !(taken && taken.has(tx + ',' + ty));
      if (x != null && ok(x, y)) return { x, y };
      if (x == null) {
        const spawns = (this.map.spawns || []).slice().sort(() => Math.random() - 0.5);
        for (const [sx, sy] of spawns) if (ok(sx, sy)) return { x: sx, y: sy };
        const s = (this.map.spawns || [[1, 1]])[0];
        x = s[0];
        y = s[1];
      }
      for (let r = 1; r < Math.max(this.w, this.h); r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ok(x + dx, y + dy)) return { x: x + dx, y: y + dy };
          }
        }
      }
      return { x, y };
    }

    // Shortest walk (4 directions) from (fx, fy) to (tx, ty) as a list of tiles,
    // not including the start. A blocked goal walks to the nearest free tile
    // next to it instead. Empty when there is no way.
    path(fx, fy, tx, ty) {
      if (!this.map) return [];
      if (!this.isFree(tx, ty)) {
        let best = null;
        for (let r = 1; r <= 3 && !best; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = tx + dx;
              const ny = ty + dy;
              if (!this.isFree(nx, ny)) continue;
              const d = Math.abs(nx - fx) + Math.abs(ny - fy) + (Math.abs(dx) + Math.abs(dy)) * 2;
              if (!best || d < best.d) best = { x: nx, y: ny, d };
            }
          }
        }
        if (!best) return [];
        tx = best.x;
        ty = best.y;
      }
      if (fx === tx && fy === ty) return [];
      const w = this.w;
      const start = fy * w + fx;
      const goal = ty * w + tx;
      const came = new Int32Array(w * this.h).fill(-1);
      const cost = new Float32Array(w * this.h).fill(Infinity);
      cost[start] = 0;
      // A tiny binary heap of [priority, index].
      const heap = [[0, start]];
      const push = (p, i) => {
        heap.push([p, i]);
        let k = heap.length - 1;
        while (k > 0) {
          const parent = (k - 1) >> 1;
          if (heap[parent][0] <= heap[k][0]) break;
          [heap[parent], heap[k]] = [heap[k], heap[parent]];
          k = parent;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let k = 0;
          for (;;) {
            const l = k * 2 + 1;
            const r = l + 1;
            let m = k;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === k) break;
            [heap[m], heap[k]] = [heap[k], heap[m]];
            k = m;
          }
        }
        return top;
      };
      let found = false;
      let guard = 0;
      while (heap.length && guard++ < w * this.h * 4) {
        const [, cur] = pop();
        if (cur === goal) { found = true; break; }
        const cx = cur % w;
        const cy = (cur / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.isFree(nx, ny)) continue;
          const ni = ny * w + nx;
          const c = cost[cur] + 1;
          if (c < cost[ni]) {
            cost[ni] = c;
            came[ni] = cur;
            push(c + Math.abs(nx - tx) + Math.abs(ny - ty), ni);
          }
        }
      }
      if (!found) return [];
      const out = [];
      for (let i = goal; i !== start && i >= 0; i = came[i]) out.push({ x: i % w, y: (i / w) | 0 });
      return out.reverse();
    }

    // The thing one can use from (x, y): the one faced first, then any
    // neighbour, then the tile one stands on (portals).
    usableNear(x, y, dir) {
      if (!this.map) return null;
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir] || [0, 1];
      const covers = (o, tx, ty) => tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h;
      const at = (tx, ty) => this.usable.find((o) => covers(o, tx, ty)) || null;
      return at(x + d[0], y + d[1])
        || [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => at(x + dx, y + dy)).find(Boolean)
        || at(x, y);
    }

    // --- coordinates ---------------------------------------------------------------

    _scale() { return this.zoom * this.dpr; }

    toScreen(ax, ay) {
      const s = this._scale();
      return {
        x: Math.round((ax - this.cam.x) * s + this.canvas.width / 2),
        y: Math.round((ay - this.cam.y) * s + this.canvas.height / 2),
      };
    }

    screenToTile(clientX, clientY) {
      if (!this.map || !this.cam) return null;
      const r = this.canvas.getBoundingClientRect();
      const s = this.zoom;
      const ax = (clientX - r.left - r.width / 2) / s + this.cam.x;
      const ay = (clientY - r.top - r.height / 2) / s + this.cam.y;
      const x = Math.floor(ax / TILE);
      const y = Math.floor(ay / TILE);
      return this.inside(x, y) ? { x, y } : null;
    }

    // Where someone is drawn now (tiles, fractional while stepping).
    static place(p, now) {
      if (p.dur && now < p.t0 + p.dur) {
        const k = clamp((now - p.t0) / p.dur, 0, 1);
        return { x: p.fromX + (p.x - p.fromX) * k, y: p.fromY + (p.y - p.fromY) * k, moving: true };
      }
      return { x: p.x, y: p.y, moving: false };
    }

    // --- drawing ---------------------------------------------------------------------

    render(now, people, me, opts = {}) {
      if (!this.map || !this._resize()) return;
      const ctx = this.ctx;
      const s = this._scale();
      const W = this.canvas.width;
      const H = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = A.FLOOR_COLORS.void;
      ctx.fillRect(0, 0, W, H);

      // Camera: follow me smoothly; center a map smaller than the window.
      const mapW = this.w * TILE;
      const mapH = this.h * TILE;
      let goal = this.cam || { x: mapW / 2, y: mapH / 2 };
      if (opts.focus) goal = opts.focus;
      else if (me) {
        const p = NookWorld.place(me, now);
        goal = { x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 - 4 };
      }
      const halfW = W / 2 / s;
      const halfH = H / 2 / s;
      const gx = mapW <= halfW * 2 ? mapW / 2 : clamp(goal.x, halfW, mapW - halfW);
      const gy = mapH <= halfH * 2 ? mapH / 2 : clamp(goal.y, halfH - TILE, mapH - halfH + TILE);
      const k = opts.snap || !this.cam ? 1 : 0.18;
      const from = this.cam || { x: gx, y: gy };
      this.cam = { x: from.x + (gx - from.x) * k, y: from.y + (gy - from.y) * k };

      // Floor and walls.
      const o = this.toScreen(0, 0);
      ctx.drawImage(this.staticLayer, o.x, o.y, Math.round(mapW * s), Math.round(mapH * s));

      this._drawAreas(ctx, s, me, now);

      // Things and people, back to front.
      const view = {
        x0: this.cam.x - halfW - TILE * 3, x1: this.cam.x + halfW + TILE * 3,
        y0: this.cam.y - halfH - TILE * 3, y1: this.cam.y + halfH + TILE * 4,
      };
      const items = [];
      for (const ob of this.standing) {
        const bx = (ob.x + ob.w) * TILE;
        const by = (ob.y + ob.h) * TILE;
        if (bx < view.x0 || ob.x * TILE > view.x1 || by < view.y0 || (ob.y - 2) * TILE > view.y1) continue;
        items.push({ key: by - 0.5, ob });
      }
      const placed = [];
      for (const p of people) {
        const at = NookWorld.place(p, now);
        if (at.x * TILE < view.x0 - TILE || at.x * TILE > view.x1 || at.y * TILE < view.y0 - TILE || at.y * TILE > view.y1) continue;
        const entry = { p, at };
        placed.push(entry);
        items.push({ key: (at.y + 1) * TILE, person: entry });
      }
      items.sort((a, b) => a.key - b.key);
      if (this.marker && now < this.marker.until) this._drawMarker(ctx, s, this.marker, now);
      for (const it of items) {
        if (it.ob) this._drawObject(ctx, s, it.ob, now);
        else this._drawPerson(ctx, s, it.person.p, it.person.at, now);
      }

      if (opts.ring && me) this._drawRing(ctx, s, me, now, opts.ring);
      if (this.editor && this.editor.active) this.editor.draw(ctx, s, this);

      // Labels on top of everything; name tags that would overlap are stacked.
      if (this.areas.length) this._drawAreaNames(ctx, me);
      for (const box of this._layoutLabels(ctx, placed)) this._drawLabel(ctx, box, now, opts);
      if (opts.hint) this._drawHint(ctx, s, opts.hint);
      if (this.flash && now < this.flash.until) {
        const entry = placed.find((e) => e.p.identity === this.flash.identity);
        if (entry) this._drawFlash(ctx, s, entry.at, now);
        else {
          const target = people.find((p) => p.identity === this.flash.identity);
          if (target) this._drawArrow(ctx, s, target, now);
        }
      }
    }

    _drawAreas(ctx, s, me, now) {
      if (!this.areas.length) return;
      const mine = me ? this.areaAt(me.x, me.y) : null;
      const dpr = this.dpr;
      this.areas.forEach((a) => {
        const spot = a.kind === 'spotlight';
        const active = mine === a;
        ctx.fillStyle = spot ? `rgba(255, 196, 60, ${active ? 0.22 : 0.12})` : `rgba(32, 178, 170, ${active ? 0.16 : 0.07})`;
        ctx.strokeStyle = spot ? 'rgba(214, 150, 20, 0.85)' : `rgba(16, 140, 132, ${active ? 0.95 : 0.55})`;
        ctx.lineWidth = Math.max(1, (active ? 2 : 1.25) * dpr);
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.lineDashOffset = active ? -now / 60 : 0;
        a.rects.forEach(([x, y, w, h]) => {
          const p = this.toScreen(x * TILE, y * TILE);
          const q = this.toScreen((x + w) * TILE, (y + h) * TILE);
          ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
          ctx.strokeRect(p.x + 0.5, p.y + 0.5, q.x - p.x - 1, q.y - p.y - 1);
        });
        ctx.setLineDash([]);
      });
    }

    // Area names, above the things in them.
    _drawAreaNames(ctx, me) {
      const mine = me ? this.areaAt(me.x, me.y) : null;
      const dpr = this.dpr;
      this.areas.forEach((a) => {
        const spot = a.kind === 'spotlight';
        const [x, y] = a.rects[0];
        const near = me && Math.abs(me.x - x) < 14 && Math.abs(me.y - y) < 10;
        if (mine !== a && !near) return;
        const p = this.toScreen(x * TILE, y * TILE);
        const label = (spot ? '★ ' : '🔒 ') + a.name;
        ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = spot ? 'rgba(120, 80, 0, 0.8)' : 'rgba(8, 80, 76, 0.8)';
        roundRect(ctx, p.x + 3 * dpr, p.y + 3 * dpr, tw + 10 * dpr, 16 * dpr, 4 * dpr);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.x + 8 * dpr, p.y + 11 * dpr);
      });
    }

    _drawObject(ctx, s, ob, now) {
      const sprite = A.object(ob);
      const p = this.toScreen(ob.x * TILE + sprite.dx, ob.y * TILE + sprite.dy);
      ctx.drawImage(sprite.canvas, p.x, p.y, Math.round(sprite.canvas.width * s), Math.round(sprite.canvas.height * s));
      if (ob.def.anim) {
        ctx.save();
        const q = this.toScreen(ob.x * TILE, ob.y * TILE);
        ctx.translate(q.x, q.y);
        ctx.scale(s, s);
        A.animated(ctx, ob, 0, 0, now);
        ctx.restore();
      }
    }

    _drawPerson(ctx, s, p, at, now) {
      const dpr = this.dpr;
      const base = this.toScreen(at.x * TILE + TILE / 2, at.y * TILE + TILE - 1);
      // Speaking: a soft green ring at the feet.
      if (p.speaking) {
        const pulse = 1 + Math.sin(now / 160) * 0.08;
        ctx.strokeStyle = 'rgba(60, 207, 110, 0.9)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.ellipse(base.x, base.y, 8 * s * pulse, 3.4 * s * pulse, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, 5.5 * s, 2.2 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      let frame = 0;
      if (at.moving) frame = Math.floor(now / Math.max(60, (p.dur || 160) / 2)) % 4;
      const blink = (now + (p.blinkSeed || 0)) % 4200 < 140;
      const talk = p.speaking && Math.floor(now / 120) % 2 === 0;
      const sprite = A.character(p.look, p.dir || 'down', frame, { blink, talk });
      const tl = this.toScreen(at.x * TILE, at.y * TILE - 8);
      ctx.globalAlpha = p.ghost ? 0.4 : p.status === 'away' ? 0.6 : 1;
      ctx.drawImage(sprite, tl.x, tl.y, Math.round(16 * s), Math.round(24 * s));
      ctx.globalAlpha = 1;
    }

    // Where each name tag goes: above the head, moved up while it would
    // cover a tag already placed (people standing side by side).
    _layoutLabels(ctx, placed) {
      const dpr = this.dpr;
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      const boxes = placed.map((entry) => {
        const p = entry.p;
        const head = this.toScreen(entry.at.x * TILE + TILE / 2, entry.at.y * TILE - 9);
        const tw = ctx.measureText(p.name || '?').width;
        const icons = (p.muted ? 13 * dpr : 0) + (p.hand ? 15 * dpr : 0) + (p.mood ? 15 * dpr : 0);
        const w = tw + 12 * dpr + 7 * dpr + 4 * dpr + icons;
        const h = 17 * dpr;
        // A speech bubble sits on top of the tag and takes room too.
        const above = p.bubble && performance.now() < p.bubbleUntil ? 30 * dpr : 0;
        return { p, at: entry.at, head, tw, w, h, above, x: head.x - w / 2, y: head.y - h - 2 * dpr };
      });
      // Lower tags (people further down) keep their place; higher ones give way.
      boxes.sort((a, b) => b.y - a.y || a.x - b.x);
      const done = [];
      const reach = (b) => (b.above ? Math.max(b.w, 200 * dpr) : b.w);
      for (const box of boxes) {
        for (let tries = 0; tries < 6; tries++) {
          const bw = reach(box);
          const hit = done.find((o) => {
            const ow = reach(o);
            const ox = o.x + o.w / 2 - ow / 2;
            const bx = box.x + box.w / 2 - bw / 2;
            return bx < ox + ow + 2 * dpr && ox < bx + bw + 2 * dpr
              && box.y - box.above < o.y + o.h + 1 * dpr && o.y - o.above < box.y + box.h + 1 * dpr;
          });
          if (!hit) break;
          box.y = hit.y - hit.above - box.h - 2 * dpr;
        }
        done.push(box);
      }
      return done;
    }

    _drawLabel(ctx, box, now, opts) {
      const dpr = this.dpr;
      const { p, head, tw, w, h, x, y } = box;
      const name = p.name || '?';
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      const pad = 6 * dpr;
      const dot = 7 * dpr;
      if (y < head.y - h - 3 * dpr) {
        // A stacked tag: a thin line down to its person.
        ctx.strokeStyle = 'rgba(25, 28, 36, 0.5)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(head.x, y + h);
        ctx.lineTo(head.x, head.y - 2 * dpr);
        ctx.stroke();
      }
      const faded = opts.fade && opts.fade.get ? opts.fade.get(p.identity) : null;
      ctx.globalAlpha = faded == null ? 1 : 0.55 + 0.45 * faded;
      ctx.fillStyle = p.local ? 'rgba(13, 110, 104, 0.92)' : 'rgba(25, 28, 36, 0.78)';
      roundRect(ctx, x, y, w, h, 8 * dpr);
      ctx.fill();
      if (p.speaking) {
        ctx.strokeStyle = '#3ccf6e';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
      ctx.fillStyle = STATUS_COLORS[p.status] || STATUS_COLORS.available;
      ctx.beginPath();
      ctx.arc(x + pad + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, x + pad + dot + 4 * dpr, y + h / 2 + 0.5 * dpr);
      let ix = x + pad + dot + 4 * dpr + tw + 3 * dpr;
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      if (p.muted) {
        drawMutedMic(ctx, ix + 5 * dpr, y + h / 2, dpr);
        ix += 13 * dpr;
      }
      if (p.mood && MOODS[p.mood]) {
        ctx.fillText(MOODS[p.mood], ix, y + h / 2 + dpr);
        ix += 15 * dpr;
      }
      if (p.hand) ctx.fillText('✋', ix, y + h / 2 + dpr);
      ctx.globalAlpha = 1;
      // A reaction floats up and fades.
      if (p.emote && now < p.emoteUntil) {
        const age = 1 - (p.emoteUntil - now) / 2600;
        const rise = age * 26 * dpr;
        ctx.globalAlpha = age > 0.75 ? (1 - age) * 4 : 1;
        ctx.font = `${26 * dpr}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.emote, head.x, y - 12 * dpr - rise);
        ctx.textAlign = 'start';
        ctx.globalAlpha = 1;
      }
      if (p.bubble && now < p.bubbleUntil) {
        ctx.font = `${12 * dpr}px system-ui, sans-serif`;
        const text = p.bubble.length > 60 ? p.bubble.slice(0, 57) + '…' : p.bubble;
        const bw = Math.min(ctx.measureText(text).width + 14 * dpr, 260 * dpr);
        const bx = head.x - bw / 2;
        const byy = y - 30 * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        roundRect(ctx, bx, byy, bw, 22 * dpr, 9 * dpr);
        ctx.fill();
        ctx.fillStyle = '#20242c';
        ctx.fillText(text, bx + 7 * dpr, byy + 11 * dpr, bw - 14 * dpr);
      }
    }

    _drawRing(ctx, s, me, now, ring) {
      const at = NookWorld.place(me, now);
      const c = this.toScreen(at.x * TILE + TILE / 2, at.y * TILE + TILE / 2);
      ctx.save();
      ctx.setLineDash([3 * this.dpr, 6 * this.dpr]);
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, ring.hear * TILE * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(60, 207, 110, 0.35)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, ring.full * TILE * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    _drawMarker(ctx, s, m, now) {
      const c = this.toScreen(m.x * TILE + TILE / 2, m.y * TILE + TILE / 2);
      const k = 1 + Math.sin(now / 120) * 0.12;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2 * this.dpr;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 3 * s, 6 * s * k, 2.6 * s * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    _drawHint(ctx, s, hint) {
      const dpr = this.dpr;
      const c = this.toScreen((hint.x + hint.w / 2) * TILE, hint.y * TILE - 18);
      const text = hint.text;
      ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
      const tw = ctx.measureText(text).width;
      const w = tw + 34 * dpr;
      const h = 24 * dpr;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      roundRect(ctx, c.x - w / 2, c.y - h, w, h, 7 * dpr);
      ctx.fill();
      ctx.fillStyle = '#1b1f27';
      roundRect(ctx, c.x - w / 2 + 5 * dpr, c.y - h + 4 * dpr, 17 * dpr, 16 * dpr, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', c.x - w / 2 + 9.5 * dpr, c.y - h / 2 + 0.5 * dpr);
      ctx.fillStyle = '#1b1f27';
      ctx.fillText(text, c.x - w / 2 + 27 * dpr, c.y - h / 2 + 0.5 * dpr);
    }

    _drawFlash(ctx, s, at, now) {
      const c = this.toScreen(at.x * TILE + TILE / 2, at.y * TILE + TILE / 2);
      for (let i = 0; i < 2; i++) {
        const k = ((now / 900) + i / 2) % 1;
        ctx.strokeStyle = `rgba(255, 216, 74, ${1 - k})`;
        ctx.lineWidth = 3 * this.dpr;
        ctx.beginPath();
        ctx.arc(c.x, c.y, (10 + k * 40) * s * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    _drawArrow(ctx, s, target, now) {
      // Someone off screen: an arrow at the edge pointing their way.
      const c = this.toScreen(target.x * TILE + TILE / 2, target.y * TILE + TILE / 2);
      const W = this.canvas.width;
      const H = this.canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const ang = Math.atan2(c.y - cy, c.x - cx);
      const m = 40 * this.dpr;
      const r = Math.min((W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = `rgba(255, 216, 74, ${0.75 + Math.sin(now / 150) * 0.25})`;
      ctx.beginPath();
      ctx.moveTo(16 * this.dpr, 0);
      ctx.lineTo(-10 * this.dpr, -11 * this.dpr);
      ctx.lineTo(-4 * this.dpr, 0);
      ctx.lineTo(-10 * this.dpr, 11 * this.dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawMutedMic(ctx, x, y, dpr) {
    ctx.save();
    ctx.strokeStyle = '#ff8a8a';
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - 2.5 * dpr, y - 5 * dpr, 5 * dpr, 7 * dpr, 2.5 * dpr) : ctx.rect(x - 2.5 * dpr, y - 5 * dpr, 5 * dpr, 7 * dpr);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5 * dpr, y - 5 * dpr);
    ctx.lineTo(x + 5 * dpr, y + 5 * dpr);
    ctx.stroke();
    ctx.restore();
  }

  NookWorld.MOODS = MOODS;
  NookWorld.ZOOMS = ZOOMS;
  window.NookWorld = NookWorld;
})();
