/*
 * Nooklane pixel art, drawn in code (no image files).
 *
 * Everything is painted at "art" resolution, 16 x 16 art pixels per tile,
 * into small offscreen canvases that the world scales up without smoothing:
 *
 *   NookArt.floor(ctx, kind, tx, ty, neighbours)  one floor tile at (0, 0)
 *   NookArt.wall(ctx, kind, sides)                one wall tile at (0, 0)
 *   NookArt.object(obj) -> {canvas, dx, dy}       a cached sprite of a placed
 *                                                 object; dx, dy (art px) from
 *                                                 its top left tile
 *   NookArt.animated(ctx, obj, t)                 the moving part of portals,
 *                                                 campfires and fountains
 *   NookArt.character(look, dir, frame, opts)     a cached 16 x 24 sprite
 *   NookArt.parseLook(text) / NookArt.LOOK_PARTS  the character's look
 *
 * OBJECTS lists every object type: size in tiles, whether it blocks walking,
 * whether it lies flat on the floor (drawn under people), and what X does.
 * nooklane/maps/builder.py has the same table.
 */
(function () {
  if (window.NookArt) return;

  const TILE = 16;

  // type -> {w, h, solid, flat, use}
  const OBJECTS = {
    desk: { w: 2, h: 1, solid: true },
    chair: { w: 1, h: 1 },
    office_chair: { w: 1, h: 1 },
    armchair: { w: 1, h: 1 },
    sofa: { w: 2, h: 1 },
    table_round: { w: 2, h: 2, solid: true },
    table_long: { w: 3, h: 2, solid: true },
    coffee_table: { w: 2, h: 1, solid: true },
    cafe_table: { w: 1, h: 1, solid: true },
    bookshelf: { w: 2, h: 1, solid: true },
    counter: { w: 1, h: 1, solid: true },
    fridge: { w: 1, h: 1, solid: true },
    coffee_machine: { w: 1, h: 1, solid: true },
    water_cooler: { w: 1, h: 1, solid: true },
    vending: { w: 1, h: 1, solid: true },
    printer: { w: 1, h: 1, solid: true },
    lamp: { w: 1, h: 1, solid: true },
    plant: { w: 1, h: 1, solid: true },
    big_plant: { w: 1, h: 1, solid: true },
    rug: { w: 1, h: 1, flat: true },
    podium: { w: 1, h: 1, solid: true },
    piano: { w: 2, h: 1, solid: true },
    arcade: { w: 1, h: 1, solid: true },
    trash: { w: 1, h: 1, solid: true },
    painting: { w: 1, h: 1, wall: true },
    seat_row: { w: 1, h: 1 },
    whiteboard: { w: 2, h: 1, solid: true, use: 'board' },
    tv: { w: 2, h: 1, solid: true, use: 'screen' },
    note: { w: 1, h: 1, solid: true, use: 'note' },
    portal: { w: 1, h: 1, use: 'portal', anim: true },
    tree: { w: 1, h: 1, solid: true },
    pine: { w: 1, h: 1, solid: true },
    bush: { w: 1, h: 1, solid: true },
    flowers: { w: 1, h: 1, flat: true },
    bench: { w: 2, h: 1 },
    fountain: { w: 3, h: 3, solid: true, anim: true },
    lamp_post: { w: 1, h: 1, solid: true },
    campfire: { w: 1, h: 1, solid: true, anim: true },
    log: { w: 1, h: 1 },
    umbrella: { w: 1, h: 1, solid: true },
    rock: { w: 1, h: 1, solid: true },
    picnic_table: { w: 2, h: 2, solid: true },
  };

  // The objects the map editor offers, in palette order.
  const PALETTE = [
    'desk', 'office_chair', 'chair', 'armchair', 'sofa', 'table_round', 'table_long', 'coffee_table',
    'cafe_table', 'umbrella', 'bookshelf', 'counter', 'fridge', 'coffee_machine', 'water_cooler',
    'vending', 'printer', 'lamp', 'plant', 'big_plant', 'rug', 'podium', 'piano', 'arcade', 'trash',
    'painting', 'whiteboard', 'tv', 'note', 'portal', 'tree', 'pine', 'bush', 'flowers', 'bench',
    'fountain', 'lamp_post', 'campfire', 'log', 'rock', 'picnic_table',
  ];

  const FLOOR_KINDS = {
    '.': 'wood', d: 'darkwood', ',': 'carpet', ';': 'rosecarpet', b: 'bluecarpet', _: 'tile',
    '-': 'stone', ':': 'path', '"': 'grass', s: 'sand', '~': 'water', '=': 'stage', ' ': 'void',
  };
  const WALL_KINDS = { '#': 'wall', w: 'window', f: 'fence', h: 'hedge' };

  // --- helpers -----------------------------------------------------------------

  function hash(...nums) {
    let h = 2166136261;
    for (const n of nums) h = Math.imul(h ^ (n | 0), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amount > 0 ? (255 - c) * amount : c * amount))));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return [c, ctx];
  }

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  // A filled disc / ellipse made of whole pixels.
  function disc(ctx, cx, cy, rx, ry, color) {
    ctx.fillStyle = color;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      const x0 = Math.round(cx - half);
      const x1 = Math.round(cx + half);
      if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
    }
  }

  function outlineRect(ctx, x, y, w, h, color) {
    px(ctx, x, y, w, 1, color);
    px(ctx, x, y + h - 1, w, 1, color);
    px(ctx, x, y, 1, h, color);
    px(ctx, x + w - 1, y, 1, h, color);
  }

  // --- floors -------------------------------------------------------------------

  const FLOOR_COLORS = {
    wood: '#c99a64', darkwood: '#8d5f3f', carpet: '#5ea79f', rosecarpet: '#c98d8f',
    bluecarpet: '#6e8bc5', tile: '#e9e5dd', stone: '#d9d0c1', path: '#cdb991', grass: '#82c15d',
    sand: '#e8d39c', water: '#4ea6d9', stage: '#7d5232', void: '#262a33',
  };

  function planks(ctx, tx, ty, base, rows) {
    const h = TILE / rows;
    px(ctx, 0, 0, TILE, TILE, base);
    for (let r = 0; r < rows; r++) {
      const y = r * h;
      px(ctx, 0, y, TILE, 1, shade(base, 0.12));
      px(ctx, 0, y + h - 1, TILE, 1, shade(base, -0.16));
      const joint = Math.floor(hash(tx, ty * 7 + r) * TILE);
      px(ctx, joint, y, 1, h - 1, shade(base, -0.2));
      if (hash(tx + 3, ty, r) > 0.8) px(ctx, (joint + 6) % TILE, y + 1, 2, 1, shade(base, -0.1));
    }
  }

  function speckle(ctx, tx, ty, base, count, amount) {
    px(ctx, 0, 0, TILE, TILE, base);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(hash(tx, ty, i) * TILE);
      const y = Math.floor(hash(ty, tx, i + 9) * TILE);
      px(ctx, x, y, 1, 1, shade(base, (hash(i, tx, ty) > 0.5 ? 1 : -1) * amount));
    }
  }

  // n = {up, down, left, right}: is the neighbouring tile the same floor?
  function floor(ctx, kind, tx, ty, n) {
    const base = FLOOR_COLORS[kind] || FLOOR_COLORS.void;
    switch (kind) {
      case 'wood':
      case 'darkwood':
        planks(ctx, tx, ty, base, 4);
        break;
      case 'stage':
        planks(ctx, tx, ty, base, 4);
        if (n && !n.down) {
          px(ctx, 0, TILE - 3, TILE, 3, shade(base, -0.35));
          px(ctx, 0, TILE - 3, TILE, 1, shade(base, 0.2));
        }
        break;
      case 'carpet':
      case 'rosecarpet':
      case 'bluecarpet':
        speckle(ctx, tx, ty, base, 10, 0.07);
        break;
      case 'tile': {
        px(ctx, 0, 0, TILE, TILE, base);
        const alt = shade(base, -0.05);
        px(ctx, 0, 0, 8, 8, alt);
        px(ctx, 8, 8, 8, 8, alt);
        const grout = shade(base, -0.13);
        px(ctx, 0, 0, TILE, 1, grout);
        px(ctx, 0, 0, 1, TILE, grout);
        px(ctx, 0, 8, TILE, 1, grout);
        px(ctx, 8, 0, 1, TILE, grout);
        break;
      }
      case 'stone': {
        speckle(ctx, tx, ty, base, 6, 0.06);
        const edge = shade(base, -0.12);
        px(ctx, 0, TILE - 1, TILE, 1, edge);
        px(ctx, TILE - 1, 0, 1, TILE, edge);
        px(ctx, 0, 0, TILE, 1, shade(base, 0.1));
        break;
      }
      case 'path': {
        px(ctx, 0, 0, TILE, TILE, shade(base, -0.2));
        const stones = [[1, 1, 6, 5], [8, 0, 7, 4], [9, 5, 6, 5], [1, 7, 7, 4], [0, 12, 5, 4], [6, 12, 4, 4], [11, 11, 5, 5]];
        stones.forEach(([x, y, w, h], i) => {
          const c = shade(base, (hash(tx, ty, i) - 0.5) * 0.14);
          px(ctx, x, y, w, h, c);
          px(ctx, x, y, w, 1, shade(c, 0.12));
        });
        break;
      }
      case 'grass': {
        speckle(ctx, tx, ty, base, 5, 0.06);
        for (let i = 0; i < 4; i++) {
          const x = Math.floor(hash(tx, ty, i, 3) * 15);
          const y = Math.floor(hash(ty, tx, i, 5) * 14) + 1;
          px(ctx, x, y, 1, 2, shade(base, -0.18));
          px(ctx, x + 1, y + 1, 1, 1, shade(base, -0.12));
        }
        if (hash(tx, ty, 77) > 0.93) {
          const x = 3 + Math.floor(hash(tx, ty, 78) * 10);
          const y = 3 + Math.floor(hash(tx, ty, 79) * 10);
          px(ctx, x, y, 1, 1, hash(tx, ty, 80) > 0.5 ? '#fff6d8' : '#ffd84a');
        }
        break;
      }
      case 'sand':
        speckle(ctx, tx, ty, base, 8, 0.08);
        break;
      case 'water': {
        px(ctx, 0, 0, TILE, TILE, base);
        const light = shade(base, 0.25);
        for (let i = 0; i < 3; i++) {
          const x = Math.floor(hash(tx, ty, i) * 11);
          const y = 2 + i * 5;
          px(ctx, x, y, 4, 1, light);
        }
        const foam = '#d9f0fa';
        if (n) {
          if (!n.up) px(ctx, 0, 0, TILE, 2, foam);
          if (!n.down) px(ctx, 0, TILE - 1, TILE, 1, shade(base, -0.2));
          if (!n.left) px(ctx, 0, 0, 1, TILE, foam);
          if (!n.right) px(ctx, TILE - 1, 0, 1, TILE, foam);
        }
        break;
      }
      default:
        px(ctx, 0, 0, TILE, TILE, base);
    }
  }

  // --- walls ---------------------------------------------------------------------

  const WALL = { cap: '#4b5166', capLight: '#5d6479', face: '#efe6d6', faceShade: '#e2d7c4', base: '#b39a7a' };

  // sides = {down: tile below is a wall too, up, left, right}
  function wall(ctx, kind, sides) {
    if (kind === 'hedge') {
      px(ctx, 0, 2, TILE, TILE - 2, '#3e7f3b');
      for (let x = 0; x < TILE; x += 4) disc(ctx, x + 2, 3, 3, 2.5, '#478f41');
      for (let i = 0; i < 6; i++) px(ctx, (i * 5) % 15, 6 + (i * 3) % 8, 2, 1, '#57a64f');
      px(ctx, 0, TILE - 2, TILE, 2, '#2e652d');
      return;
    }
    if (kind === 'fence') {
      const post = '#8a5d35';
      const rail = '#b07c4a';
      const vertical = sides.up || sides.down;
      if (vertical && !sides.left && !sides.right) {
        px(ctx, 6, 0, 4, TILE, rail);
        px(ctx, 6, 0, 1, TILE, shade(rail, 0.2));
        px(ctx, 5, 4, 6, 3, post);
        px(ctx, 5, 12, 6, 3, post);
      } else {
        px(ctx, 0, 5, TILE, 2, rail);
        px(ctx, 0, 10, TILE, 2, rail);
        px(ctx, 0, 5, TILE, 1, shade(rail, 0.25));
        px(ctx, 2, 2, 3, 12, post);
        px(ctx, 11, 2, 3, 12, post);
        px(ctx, 2, 2, 3, 1, shade(post, 0.25));
        px(ctx, 11, 2, 3, 1, shade(post, 0.25));
      }
      return;
    }
    if (sides.down) {
      // Seen from above: only the top of the wall.
      px(ctx, 0, 0, TILE, TILE, WALL.cap);
      if (!sides.left) px(ctx, 0, 0, 1, TILE, WALL.capLight);
      if (!sides.right) px(ctx, TILE - 1, 0, 1, TILE, shade(WALL.cap, -0.2));
      if (!sides.up) px(ctx, 0, 0, TILE, 1, WALL.capLight);
      if (kind === 'window') px(ctx, 6, 0, 4, TILE, '#a8dbf3');
      return;
    }
    // The wall's front face, with its top above.
    px(ctx, 0, 0, TILE, 5, WALL.cap);
    if (!sides.up) px(ctx, 0, 0, TILE, 1, WALL.capLight);
    px(ctx, 0, 5, TILE, 11, WALL.face);
    px(ctx, 0, 5, TILE, 1, WALL.faceShade);
    px(ctx, 0, TILE - 2, TILE, 2, WALL.base);
    if (!sides.left) px(ctx, 0, 5, 1, 11, WALL.faceShade);
    if (kind === 'window') {
      px(ctx, 2, 6, 12, 8, '#f7f3ea');
      px(ctx, 3, 7, 10, 6, '#a9dcf5');
      px(ctx, 4, 8, 2, 1, '#e3f5fd');
      px(ctx, 4, 9, 1, 2, '#e3f5fd');
      px(ctx, 8, 7, 1, 6, '#f7f3ea');
      px(ctx, 2, 13, 12, 1, '#c9b79c');
    }
  }

  // --- objects ---------------------------------------------------------------------

  const WOOD = '#b98a5a';
  const DARK = '#2c2f38';
  const RUGS = { rose: '#c46e72', teal: '#3f9c97', gold: '#d8a645', blue: '#5875b8' };

  // Each painter draws into ctx with the object's top left tile at (ox, oy) and
  // returns nothing. Sprites get `up` extra tiles above and `pad` on the sides.
  const PAINTERS = {
    desk(ctx, o, ox, oy, W) {
      px(ctx, ox, oy + 2, W, 7, WOOD);
      px(ctx, ox, oy + 2, W, 1, shade(WOOD, 0.2));
      px(ctx, ox, oy + 9, W, 5, shade(WOOD, -0.22));
      px(ctx, ox + 1, oy + 14, 2, 2, shade(WOOD, -0.4));
      px(ctx, ox + W - 3, oy + 14, 2, 2, shade(WOOD, -0.4));
      if (o.monitor) {
        px(ctx, ox + 10, oy - 4, 12, 8, DARK);
        px(ctx, ox + 11, oy - 3, 10, 6, '#5aa6d6');
        px(ctx, ox + 12, oy - 2, 4, 1, '#a9d8f2');
        px(ctx, ox + 15, oy + 4, 2, 2, DARK);
        px(ctx, ox + 4, oy + 5, 5, 2, '#e8e4dc');
      }
    },
    chair(ctx, o, ox, oy) { chairArt(ctx, o, ox, oy, '#b5835a', '#9a6c46'); },
    office_chair(ctx, o, ox, oy) { chairArt(ctx, o, ox, oy, '#3b4150', '#2a2e39'); },
    armchair(ctx, o, ox, oy) {
      const c = o.color === 'teal' ? '#3f9c97' : '#c0645a';
      px(ctx, ox + 1, oy + 3, 14, 12, shade(c, -0.25));
      px(ctx, ox + 3, oy + 6, 10, 8, c);
      px(ctx, ox + 1, oy + 3, 14, 4, shade(c, -0.1));
      px(ctx, ox + 1, oy + 3, 14, 1, shade(c, 0.2));
      px(ctx, ox + 1, oy + 7, 3, 7, shade(c, -0.15));
      px(ctx, ox + 12, oy + 7, 3, 7, shade(c, -0.15));
    },
    sofa(ctx, o, ox, oy, W) {
      const c = o.color === 'rose' ? '#c46e72' : '#5b8fb0';
      px(ctx, ox, oy + 2, W, 13, shade(c, -0.25));
      px(ctx, ox, oy + 2, W, 5, shade(c, -0.08));
      px(ctx, ox, oy + 2, W, 1, shade(c, 0.2));
      px(ctx, ox + 3, oy + 7, W - 6, 7, c);
      px(ctx, ox + W / 2, oy + 7, 1, 7, shade(c, -0.2));
      px(ctx, ox, oy + 6, 3, 9, shade(c, -0.15));
      px(ctx, ox + W - 3, oy + 6, 3, 9, shade(c, -0.15));
    },
    table_round(ctx, o, ox, oy, W, H) {
      disc(ctx, ox + W / 2, oy + H / 2 + 2, W / 2 - 1, H / 2 - 3, 'rgba(0,0,0,0.18)');
      disc(ctx, ox + W / 2, oy + H / 2, W / 2 - 1, H / 2 - 3, shade('#c8a070', -0.2));
      disc(ctx, ox + W / 2, oy + H / 2 - 1, W / 2 - 1, H / 2 - 4, '#c8a070');
      disc(ctx, ox + W / 2 - 3, oy + H / 2 - 4, 4, 2, shade('#c8a070', 0.18));
    },
    table_long(ctx, o, ox, oy, W, H) {
      px(ctx, ox + 1, oy + 3, W - 2, H - 4, 'rgba(0,0,0,0.15)');
      px(ctx, ox + 1, oy + 1, W - 2, H - 5, '#d1ab7c');
      px(ctx, ox + 1, oy + 1, W - 2, 1, shade('#d1ab7c', 0.2));
      px(ctx, ox + 1, oy + H - 4, W - 2, 3, shade('#d1ab7c', -0.25));
      px(ctx, ox + 3, oy + H - 1, 2, 1, shade('#d1ab7c', -0.45));
      px(ctx, ox + W - 5, oy + H - 1, 2, 1, shade('#d1ab7c', -0.45));
    },
    coffee_table(ctx, o, ox, oy, W) {
      px(ctx, ox + 1, oy + 5, W - 2, 6, '#8d5f3f');
      px(ctx, ox + 1, oy + 5, W - 2, 1, shade('#8d5f3f', 0.25));
      px(ctx, ox + 1, oy + 11, W - 2, 2, shade('#8d5f3f', -0.3));
      px(ctx, ox + 4, oy + 6, 3, 2, '#f2efe8');
    },
    cafe_table(ctx, o, ox, oy) {
      disc(ctx, 8 + ox, 13 + oy, 4, 1.5, 'rgba(0,0,0,0.2)');
      px(ctx, ox + 7, oy + 8, 2, 5, '#555b66');
      disc(ctx, 8 + ox, 7 + oy, 6, 3.5, shade('#e8e0d0', -0.15));
      disc(ctx, 8 + ox, 6 + oy, 6, 3, '#f1ebdf');
    },
    umbrella(ctx, o, ox, oy) {
      PAINTERS.cafe_table(ctx, o, ox, oy);
      px(ctx, ox + 7, oy - 14, 2, 20, '#d9d4cc');
      const c = o.color === 'blue' ? '#4b7fc4' : '#d9574b';
      for (let i = 0; i < 6; i++) {
        const y = oy - 18 + i;
        const half = 3 + i * 2;
        px(ctx, ox + 8 - half, y, half * 2, 1, i % 2 ? '#f5efe4' : c);
      }
      for (let x = -11; x < 11; x += 4) px(ctx, ox + 8 + x, oy - 12, 2, 2, c);
    },
    bookshelf(ctx, o, ox, oy, W) {
      const wood = '#8a5a36';
      px(ctx, ox, oy - 12, W, 26, wood);
      px(ctx, ox, oy - 12, W, 1, shade(wood, 0.25));
      const colors = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2', '#4bacc6', '#e07b39'];
      for (let shelf = 0; shelf < 3; shelf++) {
        const y = oy - 10 + shelf * 8;
        px(ctx, ox + 1, y, W - 2, 6, shade(wood, -0.4));
        for (let x = ox + 2; x < ox + W - 2; x += 2) {
          const c = colors[Math.floor(hash(o.x, o.y, x, shelf) * colors.length)];
          const h = 4 + Math.floor(hash(x, shelf, o.x) * 2);
          px(ctx, x, y + 6 - h, 2, h, c);
        }
        px(ctx, ox, y + 6, W, 2, wood);
      }
    },
    counter(ctx, o, ox, oy) {
      px(ctx, ox, oy + 1, 16, 6, '#dad5cd');
      px(ctx, ox, oy + 1, 16, 1, '#f1eee8');
      px(ctx, ox, oy + 7, 16, 8, '#9fb0bf');
      px(ctx, ox + 7, oy + 8, 1, 6, shade('#9fb0bf', -0.2));
      px(ctx, ox + 5, oy + 10, 1, 2, '#e8e8e8');
      px(ctx, ox + 9, oy + 10, 1, 2, '#e8e8e8');
    },
    fridge(ctx, o, ox, oy) {
      px(ctx, ox + 1, oy - 12, 14, 27, '#eef1f4');
      px(ctx, ox + 1, oy - 12, 14, 1, '#ffffff');
      px(ctx, ox + 1, oy - 3, 14, 1, '#c9cfd6');
      px(ctx, ox + 12, oy - 10, 1, 5, '#9aa3ad');
      px(ctx, ox + 12, oy, 1, 7, '#9aa3ad');
      px(ctx, ox + 14, oy - 12, 1, 27, '#c9cfd6');
    },
    coffee_machine(ctx, o, ox, oy) {
      PAINTERS.counter(ctx, o, ox, oy);
      px(ctx, ox + 3, oy - 7, 10, 10, '#3a3a40');
      px(ctx, ox + 3, oy - 7, 10, 1, '#55555c');
      px(ctx, ox + 6, oy - 2, 4, 3, '#1f1f24');
      px(ctx, ox + 11, oy - 5, 1, 1, '#ff5a4f');
      px(ctx, ox + 7, oy + 1, 2, 2, '#f5f0e6');
    },
    water_cooler(ctx, o, ox, oy) {
      px(ctx, ox + 4, oy - 2, 8, 16, '#e9edf1');
      px(ctx, ox + 4, oy - 2, 8, 1, '#ffffff');
      px(ctx, ox + 5, oy - 11, 6, 9, '#8fd0f2');
      px(ctx, ox + 6, oy - 10, 2, 6, '#c9ebfa');
      px(ctx, ox + 6, oy + 2, 2, 2, '#4c86c6');
      px(ctx, ox + 9, oy + 2, 2, 2, '#d9574b');
    },
    vending(ctx, o, ox, oy) {
      px(ctx, ox + 1, oy - 12, 14, 27, '#c9443d');
      px(ctx, ox + 1, oy - 12, 14, 1, shade('#c9443d', 0.3));
      px(ctx, ox + 3, oy - 10, 7, 16, '#1d2733');
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) px(ctx, ox + 4 + c * 2, oy - 9 + r * 4, 1, 2, ['#f2c14e', '#7cc4f2', '#9be27c'][(r + c) % 3]);
      }
      px(ctx, ox + 11, oy - 8, 3, 2, '#f1eee8');
      px(ctx, ox + 3, oy + 9, 10, 3, '#1d2733');
    },
    printer(ctx, o, ox, oy) {
      px(ctx, ox + 1, oy + 5, 14, 10, '#8b939e');
      px(ctx, ox + 2, oy, 12, 7, '#d6dbe1');
      px(ctx, ox + 2, oy, 12, 1, '#f1f3f6');
      px(ctx, ox + 4, oy - 2, 8, 3, '#ffffff');
      px(ctx, ox + 11, oy + 2, 2, 1, '#5ad17a');
    },
    lamp(ctx, o, ox, oy) {
      disc(ctx, ox + 8, oy + 14, 4, 1.5, 'rgba(0,0,0,0.2)');
      px(ctx, ox + 7, oy - 4, 2, 18, '#4a4a52');
      px(ctx, ox + 5, oy + 13, 6, 2, '#4a4a52');
      px(ctx, ox + 3, oy - 12, 10, 8, '#f3e2b3');
      px(ctx, ox + 3, oy - 12, 10, 1, '#fff5d8');
      px(ctx, ox + 3, oy - 5, 10, 1, shade('#f3e2b3', -0.2));
    },
    plant(ctx, o, ox, oy) { plantArt(ctx, ox, oy, 1); },
    big_plant(ctx, o, ox, oy) { plantArt(ctx, ox, oy, 1.6); },
    rug(ctx, o, ox, oy, W, H) {
      const c = RUGS[o.color] || RUGS.rose;
      px(ctx, ox + 1, oy + 1, W - 2, H - 2, c);
      outlineRect(ctx, ox + 2, oy + 2, W - 4, H - 4, shade(c, 0.35));
      outlineRect(ctx, ox + 4, oy + 4, W - 8, H - 8, shade(c, -0.2));
      for (let x = ox + 1; x < ox + W - 1; x += 2) {
        px(ctx, x, oy, 1, 1, shade(c, 0.4));
        px(ctx, x, oy + H - 1, 1, 1, shade(c, 0.4));
      }
    },
    podium(ctx, o, ox, oy) {
      px(ctx, ox + 3, oy - 2, 10, 16, '#8d5f3f');
      px(ctx, ox + 2, oy - 4, 12, 4, '#a8754f');
      px(ctx, ox + 2, oy - 4, 12, 1, shade('#a8754f', 0.25));
      px(ctx, ox + 6, oy + 3, 4, 4, '#f2c14e');
      px(ctx, ox + 10, oy - 9, 1, 5, '#3a3a40');
      px(ctx, ox + 9, oy - 10, 3, 2, '#3a3a40');
    },
    piano(ctx, o, ox, oy, W) {
      px(ctx, ox + 1, oy - 8, W - 2, 22, '#1d1d22');
      px(ctx, ox + 1, oy - 8, W - 2, 1, '#3a3a42');
      px(ctx, ox + 2, oy + 3, W - 4, 4, '#f6f4ee');
      for (let x = ox + 3; x < ox + W - 3; x += 3) px(ctx, x, oy + 3, 1, 2, '#1d1d22');
      px(ctx, ox + 3, oy - 5, 8, 5, '#f6f4ee');
      px(ctx, ox + 4, oy - 4, 6, 1, '#9aa3ad');
      px(ctx, ox + 4, oy - 2, 5, 1, '#9aa3ad');
    },
    arcade(ctx, o, ox, oy) {
      px(ctx, ox + 2, oy - 12, 12, 26, '#5b3fa8');
      px(ctx, ox + 2, oy - 12, 12, 3, '#f2c14e');
      px(ctx, ox + 4, oy - 8, 8, 7, '#1d1d22');
      px(ctx, ox + 5, oy - 7, 3, 2, '#4ef2c0');
      px(ctx, ox + 8, oy - 5, 3, 2, '#f25c8a');
      px(ctx, ox + 3, oy, 10, 3, '#3a2a75');
      px(ctx, ox + 5, oy, 1, 2, '#ff5a4f');
      px(ctx, ox + 9, oy + 1, 2, 1, '#4ec1f2');
    },
    trash(ctx, o, ox, oy) {
      px(ctx, ox + 5, oy + 6, 6, 8, '#7d8590');
      px(ctx, ox + 4, oy + 5, 8, 2, '#9aa3ad');
      px(ctx, ox + 6, oy + 8, 1, 5, '#6a717b');
      px(ctx, ox + 9, oy + 8, 1, 5, '#6a717b');
    },
    painting(ctx, o, ox, oy) {
      px(ctx, ox + 3, oy + 6, 10, 7, '#8d5f3f');
      px(ctx, ox + 4, oy + 7, 8, 5, '#9fd2ee');
      px(ctx, ox + 4, oy + 10, 8, 2, '#6fb35a');
      px(ctx, ox + 9, oy + 8, 2, 2, '#ffd84a');
    },
    whiteboard(ctx, o, ox, oy, W) {
      px(ctx, ox + 1, oy - 12, W - 2, 18, '#b9c0c9');
      px(ctx, ox + 2, oy - 11, W - 4, 15, '#fbfcfd');
      const marks = ['#3d7fd9', '#e0533d', '#3fa66b'];
      for (let i = 0; i < 4; i++) {
        const len = 6 + Math.floor(hash(o.x, o.y, i) * (W - 14));
        px(ctx, ox + 4, oy - 9 + i * 3, len, 1, marks[i % 3]);
      }
      px(ctx, ox + 2, oy + 4, W - 4, 2, '#9aa3ad');
      px(ctx, ox + 4, oy + 6, 1, 8, '#7d8590');
      px(ctx, ox + W - 5, oy + 6, 1, 8, '#7d8590');
    },
    tv(ctx, o, ox, oy, W) {
      px(ctx, ox + 1, oy - 12, W - 2, 16, '#1d1d22');
      px(ctx, ox + 2, oy - 11, W - 4, 13, '#22385a');
      px(ctx, ox + 3, oy - 10, 6, 1, '#5f86c0');
      px(ctx, ox + 3, oy - 9, 3, 1, '#5f86c0');
      px(ctx, ox + W / 2 - 1, oy + 4, 2, 6, '#3a3a40');
      px(ctx, ox + W / 2 - 6, oy + 10, 12, 3, '#3a3a40');
    },
    note(ctx, o, ox, oy) {
      px(ctx, ox + 7, oy + 2, 2, 12, '#7a5233');
      px(ctx, ox + 1, oy - 9, 14, 12, '#7a5233');
      px(ctx, ox + 2, oy - 8, 12, 10, '#d9b27a');
      px(ctx, ox + 3, oy - 7, 5, 4, '#fffbe6');
      px(ctx, ox + 9, oy - 6, 4, 5, '#ffe68a');
      px(ctx, ox + 4, oy - 2, 4, 3, '#cdeffd');
      px(ctx, ox + 5, oy - 7, 1, 1, '#e0533d');
      px(ctx, ox + 10, oy - 6, 1, 1, '#3d7fd9');
    },
    portal() {},
    tree(ctx, o, ox, oy) {
      disc(ctx, ox + 8, oy + 14, 7, 2, 'rgba(0,0,0,0.2)');
      px(ctx, ox + 6, oy + 4, 4, 11, '#7a5233');
      px(ctx, ox + 6, oy + 4, 1, 11, '#94683f');
      const c = hash(o.x, o.y) > 0.5 ? '#4f9e45' : '#5aa84a';
      disc(ctx, ox + 8, oy - 6, 11, 10, shade(c, -0.25));
      disc(ctx, ox + 8, oy - 8, 10, 9, c);
      disc(ctx, ox + 4, oy - 11, 5, 4, shade(c, 0.15));
      disc(ctx, ox + 12, oy - 5, 4, 3, shade(c, 0.08));
      if (hash(o.y, o.x) > 0.6) {
        px(ctx, ox + 2, oy - 6, 2, 2, '#e84f4f');
        px(ctx, ox + 12, oy - 12, 2, 2, '#e84f4f');
      }
    },
    pine(ctx, o, ox, oy) {
      disc(ctx, ox + 8, oy + 14, 6, 2, 'rgba(0,0,0,0.2)');
      px(ctx, ox + 7, oy + 8, 3, 7, '#6b4529');
      const c = '#2f7a4f';
      for (let i = 0; i < 4; i++) {
        const y = oy - 20 + i * 7;
        for (let r = 0; r < 9; r++) {
          const half = 2 + r * (0.5 + i * 0.25);
          px(ctx, ox + 8 - half, y + r, half * 2, 1, r < 2 ? shade(c, 0.2) : shade(c, -r * 0.02));
        }
      }
    },
    bush(ctx, o, ox, oy) {
      disc(ctx, ox + 8, oy + 13, 7, 2, 'rgba(0,0,0,0.18)');
      disc(ctx, ox + 8, oy + 8, 8, 6, '#3f8a3a');
      disc(ctx, ox + 6, oy + 6, 5, 4, '#4d9f46');
      disc(ctx, ox + 11, oy + 7, 3, 3, '#58aa50');
    },
    flowers(ctx, o, ox, oy) {
      const colors = ['#ff6b8b', '#ffd84a', '#ffffff', '#b78cff', '#ff8f4a'];
      for (let i = 0; i < 7; i++) {
        const x = ox + 2 + Math.floor(hash(o.x, o.y, i) * 12);
        const y = oy + 2 + Math.floor(hash(o.y, o.x, i + 5) * 12);
        px(ctx, x, y + 1, 1, 2, '#3f8a3a');
        px(ctx, x - 1, y, 3, 1, colors[i % colors.length]);
        px(ctx, x, y - 1, 1, 3, colors[i % colors.length]);
        px(ctx, x, y, 1, 1, '#ffe68a');
      }
    },
    bench(ctx, o, ox, oy, W) {
      const wood = '#a8754f';
      const backTop = o.dir === 'n' ? 9 : 1;
      px(ctx, ox + 1, oy + 5, W - 2, 5, wood);
      px(ctx, ox + 1, oy + 5, W - 2, 1, shade(wood, 0.25));
      px(ctx, ox + 1, oy + backTop, W - 2, 3, shade(wood, -0.15));
      px(ctx, ox + 2, oy + 10, 2, 4, '#4a4a52');
      px(ctx, ox + W - 4, oy + 10, 2, 4, '#4a4a52');
    },
    fountain(ctx, o, ox, oy, W, H) {
      disc(ctx, ox + W / 2, oy + H / 2 + 2, W / 2 - 1, H / 2 - 3, '#8f939b');
      disc(ctx, ox + W / 2, oy + H / 2, W / 2 - 1, H / 2 - 4, '#b7bcc4');
      disc(ctx, ox + W / 2, oy + H / 2, W / 2 - 4, H / 2 - 7, '#4ea6d9');
      px(ctx, ox + W / 2 - 3, oy + H / 2 - 10, 6, 12, '#b7bcc4');
      disc(ctx, ox + W / 2, oy + H / 2 - 10, 7, 3, '#c9cdd4');
    },
    lamp_post(ctx, o, ox, oy) {
      disc(ctx, ox + 8, oy + 14, 4, 1.5, 'rgba(0,0,0,0.2)');
      px(ctx, ox + 7, oy - 14, 2, 28, '#33363d');
      px(ctx, ox + 5, oy + 12, 6, 3, '#33363d');
      px(ctx, ox + 4, oy - 20, 8, 7, '#33363d');
      px(ctx, ox + 5, oy - 19, 6, 5, '#ffe9a8');
      px(ctx, ox + 6, oy - 22, 4, 2, '#33363d');
    },
    campfire(ctx, o, ox, oy) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        px(ctx, Math.round(ox + 7 + Math.cos(a) * 6), Math.round(oy + 9 + Math.sin(a) * 4), 2, 2, '#8f939b');
      }
      px(ctx, ox + 3, oy + 9, 10, 2, '#7a5233');
      px(ctx, ox + 6, oy + 7, 2, 6, '#6b4529');
    },
    log(ctx, o, ox, oy) {
      px(ctx, ox + 2, oy + 6, 12, 8, '#8d5f3f');
      disc(ctx, ox + 8, oy + 6, 6, 2.5, '#d6ad7a');
      disc(ctx, ox + 8, oy + 6, 3, 1.2, '#b98a5a');
    },
    rock(ctx, o, ox, oy) {
      disc(ctx, ox + 8, oy + 12, 7, 2, 'rgba(0,0,0,0.18)');
      disc(ctx, ox + 8, oy + 9, 7, 5, '#8f939b');
      disc(ctx, ox + 6, oy + 7, 4, 3, '#a9adb5');
    },
    picnic_table(ctx, o, ox, oy, W, H) {
      const wood = '#b07c4a';
      px(ctx, ox + 1, oy + 2, W - 2, 3, shade(wood, -0.1));
      px(ctx, ox + 3, oy + 8, W - 6, 14, wood);
      px(ctx, ox + 3, oy + 8, W - 6, 1, shade(wood, 0.25));
      for (let x = ox + 3; x < ox + W - 3; x += 5) px(ctx, x, oy + 8, 1, 14, shade(wood, -0.15));
      px(ctx, ox + 1, oy + H - 6, W - 2, 3, shade(wood, -0.1));
    },
  };

  function chairArt(ctx, o, ox, oy, seat, back) {
    const dir = o.dir || 's';
    if (dir === 's') {
      px(ctx, ox + 3, oy + 1, 10, 6, back);
      px(ctx, ox + 3, oy + 1, 10, 1, shade(back, 0.25));
      px(ctx, ox + 3, oy + 7, 10, 6, seat);
      px(ctx, ox + 4, oy + 13, 1, 2, back);
      px(ctx, ox + 11, oy + 13, 1, 2, back);
    } else if (dir === 'n') {
      px(ctx, ox + 3, oy + 4, 10, 6, seat);
      px(ctx, ox + 3, oy + 4, 10, 1, shade(seat, 0.2));
      px(ctx, ox + 3, oy + 10, 10, 4, back);
      px(ctx, ox + 3, oy + 10, 10, 1, shade(back, 0.25));
    } else {
      const backX = dir === 'e' ? ox + 2 : ox + 11;
      px(ctx, ox + 4, oy + 6, 8, 6, seat);
      px(ctx, ox + 4, oy + 6, 8, 1, shade(seat, 0.2));
      px(ctx, backX, oy + 1, 3, 11, back);
      px(ctx, ox + 5, oy + 12, 1, 3, back);
      px(ctx, ox + 10, oy + 12, 1, 3, back);
    }
  }

  function plantArt(ctx, ox, oy, size) {
    disc(ctx, ox + 8, oy + 14, 5, 1.5, 'rgba(0,0,0,0.2)');
    px(ctx, ox + 4, oy + 8, 8, 6, '#c8673f');
    px(ctx, ox + 3, oy + 7, 10, 2, '#d97b51');
    const leaf = '#4f9e45';
    const r = 5 * size;
    disc(ctx, ox + 8, oy + 7 - r, r, r * 0.9, shade(leaf, -0.2));
    disc(ctx, ox + 5, oy + 6 - r * 1.2, r * 0.6, r * 0.55, leaf);
    disc(ctx, ox + 11, oy + 5 - r, r * 0.55, r * 0.5, shade(leaf, 0.12));
    disc(ctx, ox + 8, oy + 3 - r * 1.5, r * 0.5, r * 0.45, shade(leaf, 0.2));
  }

  // How far a sprite reaches beyond its tiles (in tiles): [up, pad left/right].
  const REACH = {
    desk: [0.5, 0], bookshelf: [1, 0], fridge: [1, 0], coffee_machine: [0.5, 0], water_cooler: [1, 0],
    vending: [1, 0], printer: [0.25, 0], lamp: [1, 0], plant: [1, 0], big_plant: [1.5, 0.25], podium: [0.75, 0],
    piano: [0.75, 0], arcade: [1, 0], whiteboard: [1, 0], tv: [1, 0], note: [0.75, 0], tree: [1.5, 0.5],
    pine: [1.5, 0.25], umbrella: [1.25, 0.5], lamp_post: [1.5, 0], fountain: [0.75, 0],
  };

  const spriteCache = new Map();

  function objectSize(o) {
    const def = OBJECTS[o.t] || { w: 1, h: 1 };
    return { w: Math.max(1, o.w | 0 || def.w), h: Math.max(1, o.h | 0 || def.h) };
  }

  function object(o) {
    const { w, h } = objectSize(o);
    const key = [o.t, w, h, o.dir || '', o.color || '', o.monitor ? 1 : 0, o.x % 7, o.y % 5].join('|');
    let sprite = spriteCache.get(key);
    if (sprite) return sprite;
    const [up, pad] = REACH[o.t] || [0, 0];
    const W = w * TILE;
    const H = h * TILE;
    const upPx = Math.ceil(up * TILE);
    const padPx = Math.ceil(pad * TILE);
    const [c, ctx] = canvas(W + padPx * 2, H + upPx);
    const painter = PAINTERS[o.t];
    if (painter) painter(ctx, o, padPx, upPx, W, H);
    sprite = { canvas: c, dx: -padPx, dy: -upPx };
    spriteCache.set(key, sprite);
    return sprite;
  }

  // Moving parts, drawn every frame at (ox, oy) in art px; t in ms.
  function animated(ctx, o, ox, oy, t) {
    if (o.t === 'portal') {
      const spin = t / 400;
      disc(ctx, ox + 8, oy + 9, 7, 4, 'rgba(120, 70, 220, 0.35)');
      for (let i = 0; i < 6; i++) {
        const a = spin + (i / 6) * Math.PI * 2;
        const x = ox + 8 + Math.cos(a) * 5;
        const y = oy + 9 + Math.sin(a) * 2.6;
        px(ctx, Math.round(x), Math.round(y), 2, 1, i % 2 ? '#c9a7ff' : '#7f4fe0');
      }
      const lift = (t / 30) % 12;
      px(ctx, ox + 5, Math.round(oy + 8 - lift), 1, 1, '#e7d9ff');
      px(ctx, ox + 11, Math.round(oy + 6 - ((lift + 6) % 12)), 1, 1, '#e7d9ff');
    } else if (o.t === 'campfire') {
      const f = Math.floor(t / 120) % 3;
      const flame = [[5, 3, 6, 6], [6, 2, 4, 7], [5, 4, 6, 5]][f];
      px(ctx, ox + flame[0], oy + flame[1], flame[2], flame[3], '#ff8a2a');
      px(ctx, ox + flame[0] + 1, oy + flame[1] + 2, flame[2] - 2, flame[3] - 3, '#ffd84a');
      px(ctx, ox + 7 + (f - 1), oy + flame[1] - 2, 2, 2, '#ffb347');
    } else if (o.t === 'fountain') {
      const { w, h } = objectSize(o);
      const cx = ox + (w * TILE) / 2;
      const top = oy + (h * TILE) / 2 - 18;
      const f = Math.floor(t / 150) % 4;
      for (let i = 0; i < 4; i++) {
        const y = top + ((i * 3 + f) % 12);
        px(ctx, cx - 4 + (i % 2) * 7, y, 1, 2, '#d9f0fa');
      }
      px(ctx, cx - 1, top - 2, 2, 4, '#d9f0fa');
    }
  }

  // --- characters -------------------------------------------------------------------

  const LOOK_PARTS = {
    skin: ['#f6d3ba', '#eebc98', '#d9a077', '#b07650', '#7d4c31'],
    hair: ['short', 'long', 'bun', 'spiky', 'bob', 'buzz'],
    hairColor: ['#2b1d16', '#5a3825', '#8b5a2b', '#c88b3a', '#ecc977', '#55555e', '#b4452c', '#7a5ad6', '#e86f9a'],
    shirt: ['#3d7fd9', '#e0533d', '#3fa66b', '#f2b632', '#8e5bd9', '#30363f', '#f07fa8', '#1fb5b0', '#f2f2f2', '#a8613a'],
    pants: ['#2f3a55', '#4a4a4a', '#6b4f3a', '#2e5e4e', '#8a8f99', '#c8b28a'],
    extra: ['none', 'glasses', 'cap', 'headphones', 'bow'],
  };
  const LOOK_ORDER = ['skin', 'hair', 'hairColor', 'shirt', 'pants', 'extra'];

  // "2-1-3-4-0-1" -> {skin: 2, hair: 1, ...}; anything missing or out of range is 0.
  function parseLook(text) {
    const parts = String(text || '').split('-').map((v) => parseInt(v, 10));
    const look = {};
    LOOK_ORDER.forEach((name, i) => {
      const n = parts[i];
      look[name] = Number.isInteger(n) && n >= 0 && n < LOOK_PARTS[name].length ? n : 0;
    });
    return look;
  }

  function lookText(look) {
    return LOOK_ORDER.map((name) => look[name] | 0).join('-');
  }

  function randomLook(seed) {
    const look = {};
    LOOK_ORDER.forEach((name, i) => {
      look[name] = Math.floor(hash(seed, i) * LOOK_PARTS[name].length);
    });
    if (look.extra > 2) look.extra = 0;
    return lookText(look);
  }

  const charCache = new Map();

  // dir: 'down' | 'up' | 'left' | 'right'; frame 0 (standing) .. 3 (walk cycle).
  function character(lookStr, dir, frame, opts = {}) {
    const blink = opts.blink ? 1 : 0;
    const talk = opts.talk ? 1 : 0;
    const key = lookStr + '|' + dir + '|' + frame + '|' + blink + '|' + talk;
    let c = charCache.get(key);
    if (c) return c;
    const look = parseLook(lookStr);
    const [cv, ctx] = canvas(16, 24);
    drawCharacter(ctx, look, dir === 'left' ? 'right' : dir, frame, blink, talk);
    if (dir === 'left') {
      const [m, mctx] = canvas(16, 24);
      mctx.translate(16, 0);
      mctx.scale(-1, 1);
      mctx.drawImage(cv, 0, 0);
      c = m;
    } else {
      c = cv;
    }
    if (charCache.size > 600) charCache.clear();
    charCache.set(key, c);
    return c;
  }

  function drawCharacter(ctx, look, dir, frame, blink, talk) {
    const skin = LOOK_PARTS.skin[look.skin];
    const hair = LOOK_PARTS.hairColor[look.hairColor];
    const style = LOOK_PARTS.hair[look.hair];
    const shirt = LOOK_PARTS.shirt[look.shirt];
    const pants = LOOK_PARTS.pants[look.pants];
    const extra = LOOK_PARTS.extra[look.extra];
    const shoe = '#2a2a30';
    const eye = '#1f1a1a';
    const step = frame % 2 === 1;  // frames 1 and 3: mid-step
    const bob = step ? 1 : 0;      // the body dips mid-step
    const legA = frame === 1;      // which leg is forward
    const outline = shade(shirt, -0.35);

    // Legs and shoes.
    if (dir === 'right') {
      const front = legA ? 1 : -1;
      if (step) {
        px(ctx, 6 + front, 18, 3, 3, shade(pants, -0.15));
        px(ctx, 6 - front, 18, 3, 3, pants);
        px(ctx, 6 + front, 21, 4, 2, shoe);
        px(ctx, 6 - front, 21, 3, 2, shoe);
      } else {
        px(ctx, 6, 18, 4, 3, pants);
        px(ctx, 6, 21, 5, 2, shoe);
      }
    } else {
      const lOff = step && legA ? -1 : 0;
      const rOff = step && !legA ? -1 : 0;
      px(ctx, 5, 18, 3, 3 + lOff, pants);
      px(ctx, 8, 18, 3, 3 + rOff, pants);
      px(ctx, 5, 21 + lOff, 3, 2, shoe);
      px(ctx, 8, 21 + rOff, 3, 2, shoe);
    }

    // Body.
    const by = 11 + bob;
    if (dir === 'right') {
      px(ctx, 5, by, 6, 7, shirt);
      px(ctx, 5, by, 6, 1, shade(shirt, 0.15));
      px(ctx, 10, by + 1, 1, 6, outline);
      // the arm swings
      const swing = step ? (legA ? -1 : 1) : 0;
      px(ctx, 7 + swing, by + 1, 2, 5, shade(shirt, -0.12));
      px(ctx, 7 + swing, by + 6, 2, 1, skin);
      px(ctx, 5, by + 7, 6, 1, shade(pants, -0.2));
    } else {
      px(ctx, 4, by, 8, 7, shirt);
      px(ctx, 4, by, 8, 1, shade(shirt, 0.15));
      px(ctx, 4, by + 6, 8, 1, shade(pants, -0.2));
      const la = step && legA ? -1 : 0;
      const ra = step && !legA ? -1 : 0;
      px(ctx, 3, by + 1 + la, 1, 5, shade(shirt, -0.12));
      px(ctx, 12, by + 1 + ra, 1, 5, shade(shirt, -0.12));
      px(ctx, 3, by + 6 + la, 1, 1, skin);
      px(ctx, 12, by + 6 + ra, 1, 1, skin);
      if (dir === 'down') {
        px(ctx, 7, by, 2, 1, skin);
        px(ctx, 6, by, 1, 1, shade(shirt, -0.2));
        px(ctx, 9, by, 1, 1, shade(shirt, -0.2));
      }
    }

    // Head.
    const hy = 2 + bob;
    px(ctx, 4, hy + 1, 8, 8, skin);
    px(ctx, 5, hy, 6, 1, skin);
    px(ctx, 4, hy + 8, 8, 1, shade(skin, -0.12));
    if (dir === 'down') {
      if (blink) {
        px(ctx, 5, hy + 5, 2, 1, eye);
        px(ctx, 9, hy + 5, 2, 1, eye);
      } else {
        px(ctx, 6, hy + 4, 1, 2, eye);
        px(ctx, 9, hy + 4, 1, 2, eye);
      }
      px(ctx, 5, hy + 6, 1, 1, shade(skin, -0.08));
      px(ctx, 10, hy + 6, 1, 1, shade(skin, -0.08));
      if (talk) px(ctx, 7, hy + 7, 2, 1, '#8c3b3b');
      else px(ctx, 7, hy + 7, 2, 1, shade(skin, -0.25));
    } else if (dir === 'right') {
      px(ctx, 11, hy + 3, 1, 4, skin);
      if (!blink) px(ctx, 9, hy + 4, 1, 2, eye);
      else px(ctx, 9, hy + 5, 2, 1, eye);
      if (talk) px(ctx, 10, hy + 7, 1, 1, '#8c3b3b');
    }

    // Hair.
    drawHair(ctx, style, hair, dir, hy);

    // Extras.
    if (extra === 'glasses') {
      if (dir === 'down') {
        outlineRect(ctx, 5, hy + 3, 3, 3, '#222');
        outlineRect(ctx, 8, hy + 3, 3, 3, '#222');
      } else if (dir === 'right') {
        outlineRect(ctx, 8, hy + 3, 3, 3, '#222');
        px(ctx, 9, hy + 4, 1, 1, '#cfe9f7');
        px(ctx, 6, hy + 4, 2, 1, '#444');
      }
    } else if (extra === 'cap') {
      const cap = '#d9483b';
      px(ctx, 4, hy - 1, 8, 3, cap);
      px(ctx, 4, hy - 1, 8, 1, shade(cap, 0.25));
      if (dir === 'down') px(ctx, 4, hy + 2, 8, 1, shade(cap, -0.25));
      if (dir === 'right') px(ctx, 10, hy + 2, 4, 1, shade(cap, -0.25));
      if (dir === 'up') px(ctx, 4, hy + 2, 8, 1, cap);
    } else if (extra === 'headphones') {
      const hp = '#30363f';
      px(ctx, 4, hy - 1, 8, 1, hp);
      if (dir !== 'right') {
        px(ctx, 2, hy + 3, 2, 4, hp);
        px(ctx, 12, hy + 3, 2, 4, hp);
        px(ctx, 3, hy, 1, 3, hp);
        px(ctx, 12, hy, 1, 3, hp);
      } else {
        px(ctx, 6, hy + 3, 2, 3, hp);
        px(ctx, 6, hy + 3, 1, 1, shade(hp, 0.3));
        px(ctx, 6, hy, 1, 3, hp);
      }
    } else if (extra === 'bow') {
      const bow = '#ff6b9a';
      const bx = dir === 'right' ? 4 : 10;
      px(ctx, bx, hy - 1, 2, 2, bow);
      px(ctx, bx + 3, hy - 1, 2, 2, bow);
      px(ctx, bx + 2, hy, 1, 1, shade(bow, -0.3));
    }
  }

  function drawHair(ctx, style, color, dir, hy) {
    const dark = shade(color, -0.25);
    const light = shade(color, 0.18);
    const top = (y0) => {
      px(ctx, 4, hy + y0, 8, 2 - y0 + 1, color);
      px(ctx, 5, hy + y0 - 1, 6, 1, color);
      px(ctx, 6, hy + y0 - 1, 3, 1, light);
    };
    if (style === 'buzz') {
      px(ctx, 4, hy, 8, 2, dark);
      px(ctx, 5, hy - 1, 6, 1, dark);
      if (dir === 'up') px(ctx, 4, hy, 8, 6, dark);
      if (dir === 'right') px(ctx, 4, hy, 3, 4, dark);
      return;
    }
    if (dir === 'up') {
      px(ctx, 4, hy - 1, 8, 9, color);
      px(ctx, 5, hy - 2, 6, 1, color);
      px(ctx, 6, hy - 1, 4, 1, light);
      if (style === 'long') px(ctx, 3, hy + 3, 10, 9, color);
      if (style === 'bob') px(ctx, 3, hy + 2, 10, 6, color);
      if (style === 'bun') disc(ctx, 8, hy - 2, 2.6, 2.2, dark);
      if (style === 'spiky') for (let x = 4; x < 12; x += 2) px(ctx, x, hy - 3, 1, 2, color);
      px(ctx, 4, hy + 7, 8, 1, dark);
      return;
    }
    if (dir === 'right') {
      top(0);
      px(ctx, 4, hy, 4, 6, color);
      px(ctx, 4, hy + 6, 2, 1, dark);
      px(ctx, 9, hy + 1, 3, 1, color);
      if (style === 'long') px(ctx, 3, hy + 2, 4, 10, color);
      if (style === 'bob') px(ctx, 3, hy + 2, 5, 6, color);
      if (style === 'bun') disc(ctx, 5, hy - 1, 2.4, 2.2, dark);
      if (style === 'spiky') for (let x = 4; x < 12; x += 2) px(ctx, x, hy - 2, 1, 2, color);
      return;
    }
    // down
    top(0);
    px(ctx, 3, hy + 1, 1, 4, color);
    px(ctx, 12, hy + 1, 1, 4, color);
    if (style === 'short' || style === 'spiky') {
      px(ctx, 4, hy + 2, 3, 1, color);
      px(ctx, 9, hy + 2, 3, 1, color);
    }
    if (style === 'spiky') for (let x = 4; x < 12; x += 2) px(ctx, x, hy - 2, 1, 2, color);
    if (style === 'long') {
      px(ctx, 4, hy + 2, 2, 1, color);
      px(ctx, 10, hy + 2, 2, 1, color);
      px(ctx, 3, hy + 3, 1, 9, color);
      px(ctx, 12, hy + 3, 1, 9, color);
      px(ctx, 2, hy + 6, 1, 5, dark);
      px(ctx, 13, hy + 6, 1, 5, dark);
    }
    if (style === 'bob') {
      px(ctx, 4, hy + 2, 8, 1, color);
      px(ctx, 3, hy + 3, 1, 5, color);
      px(ctx, 12, hy + 3, 1, 5, color);
      px(ctx, 3, hy + 8, 2, 1, dark);
      px(ctx, 11, hy + 8, 2, 1, dark);
    }
    if (style === 'bun') {
      px(ctx, 4, hy + 2, 2, 1, color);
      px(ctx, 10, hy + 2, 2, 1, color);
      disc(ctx, 8, hy - 2, 2.6, 2.2, color);
      px(ctx, 7, hy - 3, 2, 1, light);
    }
  }

  // Head and shoulders, for a tile without video.
  function portrait(ctx, lookStr, w, h, bg) {
    ctx.fillStyle = bg || '#2f3a4f';
    ctx.fillRect(0, 0, w, h);
    const sprite = character(lookStr, 'down', 0);
    const scale = Math.floor(Math.min(w / 12, h / 16)) || 1;
    ctx.imageSmoothingEnabled = false;
    const sw = 16 * scale;
    ctx.drawImage(sprite, 0, 0, 16, 18, Math.round((w - sw) / 2), Math.round(h - 18 * scale + scale * 2), sw, 18 * scale);
  }

  window.NookArt = {
    TILE, OBJECTS, PALETTE, FLOOR_KINDS, WALL_KINDS, FLOOR_COLORS, LOOK_PARTS, LOOK_ORDER,
    floor, wall, object, objectSize, animated, character, portrait, parseLook, lookText, randomLook,
    hash, shade, canvas, px,
  };
})();
