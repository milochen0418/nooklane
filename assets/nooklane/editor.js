/*
 * Build mode: rearranging a space's map in place.
 *
 *   nookEditor.open() / close()              start / stop (the panel's Build button)
 *   nookEditor.setTool(tool, option)         'floor' (floor char), 'wall' (wall char),
 *                                            'object' (type), 'area' ('private' | 'spotlight'),
 *                                            'spawn', 'erase', 'select'
 *   nookEditor.undo() / discard() / mapJson() / saved(version)
 *   nookEditor.renameArea(name) / setAreaKind(kind) / deleteSelected() / rotateSelected()
 *   nookEditor.pickPortalTarget()             the next click sets the selected portal's destination
 *
 * The draft map is shown live (the world draws it, and you walk on it); Save
 * sends mapJson() to the server, which checks and stores it. The editor tells
 * the page what is selected through the client's bridge ({editor: {...}}).
 */
(function () {
  if (window.nookEditor) return;
  const A = () => window.NookArt;
  const TILE = 16;
  const ROTATE = { s: 'w', w: 'n', n: 'e', e: 's' };
  const TURNS = new Set(['chair', 'office_chair', 'armchair', 'sofa', 'bench']);

  const copy = (v) => JSON.parse(JSON.stringify(v));

  const editor = {
    active: false,
    draft: null,
    base: null,
    tool: 'object',
    option: 'plant',
    undoStack: [],
    dirty: false,
    selected: null,        // {kind: 'object' | 'area', index}
    dragStart: null,
    hover: null,
    portalPick: false,
    painting: false,

    client() { return window.nooklane; },
    world() { return this.client() && this.client().world; },

    open() {
      const world = this.world();
      if (!world || !world.map) return;
      this.active = true;
      this.base = copy(world.map);
      this.draft = copy(world.map);
      this.undoStack = [];
      this.dirty = false;
      this.selected = null;
      world.editor = this;
      this._report();
    },

    close() {
      const world = this.world();
      if (!this.active) return;
      this.active = false;
      if (world) {
        world.editor = null;
        if (this.dirty && this.base) world.setMap(this.base);
      }
      this.dirty = false;
      this.selected = null;
      this.portalPick = false;
      this._report();
    },

    // A newer map arrived (someone edited a board): keep a dirty draft.
    baseChanged(map) {
      this.base = copy(map);
      if (!this.dirty) this.draft = copy(map);
    },

    setTool(tool, option) {
      this.tool = tool;
      if (option != null) this.option = option;
      this.portalPick = false;
      if (tool !== 'select') this.selected = null;
      this._report();
    },

    // --- changes ---------------------------------------------------------------------

    _snapshot() {
      this.undoStack.push(JSON.stringify(this.draft));
      if (this.undoStack.length > 60) this.undoStack.shift();
    },

    _apply() {
      this.dirty = true;
      const world = this.world();
      // Re-draw on the next frame only, so a drag repaints once per frame.
      if (!this.pending) {
        this.pending = true;
        requestAnimationFrame(() => {
          this.pending = false;
          if (this.active) world.setMap(this.draft);
        });
      }
      this._report();
    },

    undo() {
      if (!this.undoStack.length) return;
      this.draft = JSON.parse(this.undoStack.pop());
      this.selected = null;
      this._apply();
      this.dirty = this.undoStack.length > 0;
      this._report();
    },

    discard() {
      this.draft = copy(this.base);
      this.undoStack = [];
      this.selected = null;
      this.dirty = false;
      this.world().setMap(this.draft);
      this._report();
    },

    mapJson() {
      return JSON.stringify(this.draft);
    },

    saved() {
      this.base = copy(this.draft);
      this.undoStack = [];
      this.dirty = false;
      this._report();
    },

    _setRow(layer, x, y, ch) {
      const row = this.draft[layer][y];
      if (row[x] === ch) return false;
      this.draft[layer][y] = row.slice(0, x) + ch + row.slice(x + 1);
      return true;
    },

    _objectAt(x, y) {
      const objs = this.draft.objects;
      // Top-most first: the last drawn wins.
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        const size = A().objectSize(o);
        if (x >= o.x && x < o.x + size.w && y >= o.y && y < o.y + size.h) return i;
      }
      return -1;
    },

    _areaAt(x, y) {
      const areas = this.draft.areas;
      for (let i = areas.length - 1; i >= 0; i--) {
        if (areas[i].rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh)) return i;
      }
      return -1;
    },

    _paint(x, y) {
      const d = this.draft;
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
      if (this.tool === 'floor') {
        const changed = this._setRow('floor', x, y, this.option);
        // A floor painted where a wall stood replaces the wall.
        return this._setRow('walls', x, y, ' ') || changed;
      }
      if (this.tool === 'wall') {
        if (d.floor[y][x] === ' ') this._setRow('floor', x, y, '.');
        return this._setRow('walls', x, y, this.option);
      }
      if (this.tool === 'erase') {
        const i = this._objectAt(x, y);
        if (i >= 0) {
          d.objects.splice(i, 1);
          return true;
        }
        if (d.walls[y][x] !== ' ') return this._setRow('walls', x, y, ' ');
        const s = d.spawns.findIndex(([sx, sy]) => sx === x && sy === y);
        if (s >= 0 && d.spawns.length > 1) {
          d.spawns.splice(s, 1);
          return true;
        }
        return false;
      }
      return false;
    },

    _place(x, y) {
      const d = this.draft;
      const def = A().OBJECTS[this.option];
      if (!def) return;
      const i = this._objectAt(x, y);
      if (i >= 0 && this.option !== 'rug') {
        // Clicking a thing selects it instead of stacking another one.
        this.selected = { kind: 'object', index: i };
        this._report();
        return;
      }
      if (x + def.w > d.w || y + def.h > d.h) return;
      this._snapshot();
      const o = { t: this.option, x, y };
      if (TURNS.has(this.option)) o.dir = 's';
      if (this.option === 'desk') o.monitor = 1;
      if (this.option === 'rug') { o.w = 3; o.h = 2; o.color = 'teal'; }
      if (d.walls[y][x] !== ' ' && this.option !== 'painting') this._setRow('walls', x, y, ' ');
      d.objects.push(o);
      this.selected = { kind: 'object', index: d.objects.length - 1 };
      this._apply();
    },

    _toggleSpawn(x, y) {
      const d = this.draft;
      const world = this.world();
      const i = d.spawns.findIndex(([sx, sy]) => sx === x && sy === y);
      if (i >= 0) {
        if (d.spawns.length <= 1) return;
        this._snapshot();
        d.spawns.splice(i, 1);
      } else {
        if (!world.isFree(x, y)) return;
        this._snapshot();
        d.spawns.push([x, y]);
      }
      this._apply();
    },

    _addArea(x0, y0, x1, y1) {
      const d = this.draft;
      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0) + 1;
      const h = Math.abs(y1 - y0) + 1;
      const kind = this.option === 'spotlight' ? 'spotlight' : 'private';
      this._snapshot();
      const n = d.areas.filter((a) => a.kind === kind).length + 1;
      const words = (this.client() && this.client().strings) || {};
      const name = (kind === 'spotlight' ? words.new_stage || 'Stage' : words.new_nook || 'Nook') + ' ' + n;
      let id = d.areas.length + 1;
      while (d.areas.some((a) => a.id === 'a' + id)) id++;
      d.areas.push({ id: 'a' + id, name, kind, rects: [[x, y, w, h]] });
      this.selected = { kind: 'area', index: d.areas.length - 1 };
      this._apply();
    },

    renameArea(name) {
      const sel = this.selected;
      name = String(name || '').trim().slice(0, 40);
      if (!sel || sel.kind !== 'area' || !name) return;
      this._snapshot();
      this.draft.areas[sel.index].name = name;
      this._apply();
    },

    setAreaKind(kind) {
      const sel = this.selected;
      if (!sel || sel.kind !== 'area' || !['private', 'spotlight'].includes(kind)) return;
      this._snapshot();
      this.draft.areas[sel.index].kind = kind;
      this._apply();
    },

    deleteSelected() {
      const sel = this.selected;
      if (!sel) return;
      this._snapshot();
      if (sel.kind === 'object') this.draft.objects.splice(sel.index, 1);
      else this.draft.areas.splice(sel.index, 1);
      this.selected = null;
      this._apply();
    },

    rotateSelected() {
      const sel = this.selected;
      if (!sel || sel.kind !== 'object') return;
      const o = this.draft.objects[sel.index];
      if (!TURNS.has(o.t)) return;
      this._snapshot();
      o.dir = ROTATE[o.dir || 's'];
      this._apply();
    },

    pickPortalTarget() {
      const sel = this.selected;
      if (!sel || sel.kind !== 'object' || this.draft.objects[sel.index].t !== 'portal') return;
      this.portalPick = true;
      this._report();
    },

    // --- pointer (from the world's canvas) ------------------------------------------------

    pointer(kind, t) {
      this.hover = t;
      if (kind === 'move') return;
      if (this.portalPick && kind === 'down') {
        const o = this.draft.objects[this.selected.index];
        this._snapshot();
        o.to = [t.x, t.y];
        this.portalPick = false;
        this._apply();
        return;
      }
      const tool = this.tool;
      if (tool === 'floor' || tool === 'wall' || tool === 'erase') {
        if (kind === 'down') {
          this._snapshot();
          this.painting = true;
          if (this._paint(t.x, t.y)) this._apply();
          else this.undoStack.pop();
        } else if (kind === 'drag' && this.painting) {
          if (this._paint(t.x, t.y)) this._apply();
        } else if (kind === 'up') {
          this.painting = false;
        }
        return;
      }
      if (tool === 'area') {
        if (kind === 'down') {
          this.dragStart = { x: t.x, y: t.y, area: this._areaAt(t.x, t.y) };
        } else if (kind === 'up' && this.dragStart) {
          const s = this.dragStart;
          this.dragStart = null;
          if (s.x === t.x && s.y === t.y && s.area >= 0) {
            this.selected = { kind: 'area', index: s.area };
            this._report();
          } else {
            this._addArea(s.x, s.y, t.x, t.y);
          }
        }
        return;
      }
      if (kind !== 'down') return;
      if (tool === 'object') this._place(t.x, t.y);
      else if (tool === 'spawn') this._toggleSpawn(t.x, t.y);
      else if (tool === 'select') {
        const i = this._objectAt(t.x, t.y);
        if (i >= 0) this.selected = { kind: 'object', index: i };
        else {
          const a = this._areaAt(t.x, t.y);
          this.selected = a >= 0 ? { kind: 'area', index: a } : null;
        }
        this._report();
      }
    },

    key(e) {
      if (!this.active) return false;
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { this.deleteSelected(); return true; }
      if ((e.key === 'r' || e.key === 'R') && this.selected) { this.rotateSelected(); return true; }
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) { this.undo(); return true; }
      return false;
    },

    // --- drawing (called by the world, inside its render) ------------------------------------

    draw(ctx, s, world) {
      const d = this.draft;
      if (!d) return;
      const dpr = world.dpr;
      // Grid.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= d.w; x++) {
        const a = world.toScreen(x * TILE, 0);
        const b = world.toScreen(x * TILE, d.h * TILE);
        ctx.moveTo(a.x + 0.5, a.y);
        ctx.lineTo(b.x + 0.5, b.y);
      }
      for (let y = 0; y <= d.h; y++) {
        const a = world.toScreen(0, y * TILE);
        const b = world.toScreen(d.w * TILE, y * TILE);
        ctx.moveTo(a.x, a.y + 0.5);
        ctx.lineTo(b.x, b.y + 0.5);
      }
      ctx.stroke();
      // Start points.
      ctx.font = `700 ${10 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      d.spawns.forEach(([x, y]) => {
        const c = world.toScreen(x * TILE + TILE / 2, y * TILE + TILE / 2);
        ctx.fillStyle = 'rgba(60, 207, 110, 0.75)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText('S', c.x, c.y);
      });
      // Portals and where they lead.
      d.objects.forEach((o) => {
        if (o.t !== 'portal' || !Array.isArray(o.to)) return;
        const a = world.toScreen(o.x * TILE + TILE / 2, o.y * TILE + TILE / 2);
        const b = world.toScreen(o.to[0] * TILE + TILE / 2, o.to[1] * TILE + TILE / 2);
        ctx.strokeStyle = 'rgba(160, 110, 255, 0.85)';
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4 * s, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.textAlign = 'start';
      // Selection.
      const sel = this.selected;
      if (sel && sel.kind === 'object' && d.objects[sel.index]) {
        const o = d.objects[sel.index];
        const size = A().objectSize(o);
        this._box(ctx, world, o.x, o.y, size.w, size.h, '#ffd84a');
      } else if (sel && sel.kind === 'area' && d.areas[sel.index]) {
        d.areas[sel.index].rects.forEach(([x, y, w, h]) => this._box(ctx, world, x, y, w, h, '#ffd84a'));
      }
      // What the tool would do at the pointer.
      const t = this.hover;
      if (!t) return;
      if (this.tool === 'area' && this.dragStart) {
        const s0 = this.dragStart;
        this._box(ctx, world, Math.min(s0.x, t.x), Math.min(s0.y, t.y), Math.abs(t.x - s0.x) + 1, Math.abs(t.y - s0.y) + 1,
          this.option === 'spotlight' ? '#ffc43c' : '#20b2aa');
        return;
      }
      if (this.tool === 'object' && A().OBJECTS[this.option]) {
        const o = { t: this.option, x: t.x, y: t.y, dir: 's', monitor: 1 };
        if (this.option === 'rug') { o.w = 3; o.h = 2; o.color = 'teal'; }
        const sprite = A().object(o);
        const p = world.toScreen(t.x * TILE + sprite.dx, t.y * TILE + sprite.dy);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sprite.canvas, p.x, p.y, Math.round(sprite.canvas.width * s), Math.round(sprite.canvas.height * s));
        ctx.globalAlpha = 1;
      }
      this._box(ctx, world, t.x, t.y, 1, 1, this.portalPick ? '#b48cff' : 'rgba(255,255,255,0.9)');
    },

    _box(ctx, world, x, y, w, h, color) {
      const a = world.toScreen(x * TILE, y * TILE);
      const b = world.toScreen((x + w) * TILE, (y + h) * TILE);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * world.dpr;
      ctx.strokeRect(a.x + 1, a.y + 1, b.x - a.x - 2, b.y - a.y - 2);
    },

    // --- the page ------------------------------------------------------------------------------

    _report() {
      const c = this.client();
      if (!c) return;
      const sel = this.selected;
      let info = { kind: '' };
      if (sel && sel.kind === 'object' && this.draft && this.draft.objects[sel.index]) {
        const o = this.draft.objects[sel.index];
        info = { kind: 'object', type: o.t, turns: TURNS.has(o.t), portal: o.t === 'portal', to: Array.isArray(o.to) ? o.to.join(', ') : '' };
      } else if (sel && sel.kind === 'area' && this.draft && this.draft.areas[sel.index]) {
        const a = this.draft.areas[sel.index];
        info = { kind: 'area', name: a.name, area_kind: a.kind };
      }
      c._send({ editor: { active: this.active, dirty: this.dirty, undo: this.undoStack.length, tool: this.tool, option: String(this.option), picking: this.portalPick, selected: info } });
    },
  };

  window.nookEditor = editor;
})();
