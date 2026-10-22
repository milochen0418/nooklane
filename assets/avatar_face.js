/*
 * Cartoon avatars drawn on a <canvas> from ARKit face blendshapes.
 *
 *   AvatarFace.draw(ctx, width, height, face, {style, seed, mirror, voice, badge})
 *
 * face = {shapes, yaw, pitch, roll, x, y}:
 *   shapes  Float32Array of the 51 ARKit blendshapes in AvatarFace.SHAPES order (0..1),
 *           as MediaPipe Face Landmarker reports them (without its "_neutral")
 *   yaw     radians, + = the nose points to the right of the camera image
 *   pitch   radians, + = looking down
 *   roll    radians, + = head tilted clockwise in the camera image
 *   x, y    head offset in the camera image, -1..1 (+ = right, + = up)
 *
 * Without `mirror` the avatar is drawn as the camera sees the person: their
 * left eye (eyeBlinkLeft) is on the right. `mirror` draws the self view like
 * a mirror. The face sits on a sphere, so a turned head moves the features
 * across it (2.5D), with the far side foreshortened.
 *
 * Also: AvatarFace.emotion(face) -> 'happy' | 'laughing' | 'surprised' |
 * 'angry' | 'sad' | 'wink' | 'kiss' | '' (neutral).
 */
(function () {
  if (window.AvatarFace) return;

  const SHAPES = [
    'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
    'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight',
    'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
    'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
    'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
    'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose',
    'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
    'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
    'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
    'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
    'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight',
    'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight',
  ];
  const INDEX = Object.fromEntries(SHAPES.map((name, i) => [name, i]));
  const STYLES = ['human', 'cat', 'panda', 'robot'];
  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ramp = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);

  function neutral() {
    return { shapes: new Float32Array(SHAPES.length), yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
  }

  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
    return h >>> 0;
  }

  // ---------------------------------------------------------------------------
  // Blendshapes -> drawing parameters
  // ---------------------------------------------------------------------------

  // `l` / `r` are the left / right side of the drawing (screen space).
  function features(face, mirror) {
    const s = face.shapes;
    const v = (name) => s[INDEX[name]] || 0;
    const m = mirror ? -1 : 1;
    // The person's left is on screen right, unless mirrored.
    const pair = (left, right) => (mirror ? { l: v(left), r: v(right) } : { l: v(right), r: v(left) });
    const smile = pair('mouthSmileLeft', 'mouthSmileRight');
    const frown = pair('mouthFrownLeft', 'mouthFrownRight');
    const blink = pair('eyeBlinkLeft', 'eyeBlinkRight');
    const squint = pair('eyeSquintLeft', 'eyeSquintRight');
    const cheek = pair('cheekSquintLeft', 'cheekSquintRight');
    return {
      yaw: clamp(face.yaw || 0, -0.7, 0.7) * m,
      pitch: clamp(face.pitch || 0, -0.5, 0.5),
      roll: clamp(face.roll || 0, -0.6, 0.6) * m,
      x: clamp(face.x || 0, -1, 1) * m,
      y: clamp(face.y || 0, -1, 1),
      // Eyes: a smile pushes the lower lids up, as on a real face.
      close: { l: ramp(blink.l, 0.3, 0.72), r: ramp(blink.r, 0.3, 0.72) },
      squint: {
        l: clamp(squint.l * 0.8 + cheek.l * 0.5 + smile.l * 0.25, 0, 1),
        r: clamp(squint.r * 0.8 + cheek.r * 0.5 + smile.r * 0.25, 0, 1),
      },
      wide: pair('eyeWideLeft', 'eyeWideRight'),
      // Gaze, + = screen right / down.
      gx: clamp(((v('eyeLookOutLeft') + v('eyeLookInRight')) - (v('eyeLookInLeft') + v('eyeLookOutRight'))) * 0.75 * m, -1, 1),
      gy: clamp(((v('eyeLookDownLeft') + v('eyeLookDownRight')) - (v('eyeLookUpLeft') + v('eyeLookUpRight'))) * 0.6, -1, 1),
      browDown: pair('browDownLeft', 'browDownRight'),
      browOuter: pair('browOuterUpLeft', 'browOuterUpRight'),
      browInner: v('browInnerUp'),
      smile,
      frown,
      stretch: pair('mouthStretchLeft', 'mouthStretchRight'),
      upperUp: (v('mouthUpperUpLeft') + v('mouthUpperUpRight')) / 2,
      lowerDown: (v('mouthLowerDownLeft') + v('mouthLowerDownRight')) / 2,
      press: (v('mouthPressLeft') + v('mouthPressRight')) / 2,
      open: clamp(v('jawOpen') * 1.25 + (v('mouthLowerDownLeft') + v('mouthLowerDownRight')) * 0.12 - v('mouthClose') * 0.6, 0, 1),
      pucker: v('mouthPucker'),
      funnel: v('mouthFunnel'),
      // Mouth moved sideways, + = screen right.
      shift: clamp((v('mouthLeft') - v('mouthRight') + 0.6 * (v('jawLeft') - v('jawRight'))) * m, -1, 1),
      puff: v('cheekPuff'),
      blush: clamp(Math.max((smile.l + smile.r) / 2, (cheek.l + cheek.r) / 2), 0, 1),
      sneer: (v('noseSneerLeft') + v('noseSneerRight')) / 2,
    };
  }

  function emotion(face) {
    if (!face) return '';
    const v = (name) => face.shapes[INDEX[name]] || 0;
    const smile = (v('mouthSmileLeft') + v('mouthSmileRight')) / 2;
    const frown = (v('mouthFrownLeft') + v('mouthFrownRight')) / 2;
    const browDown = (v('browDownLeft') + v('browDownRight')) / 2;
    const browUp = Math.max(v('browInnerUp'), (v('browOuterUpLeft') + v('browOuterUpRight')) / 2);
    const wide = (v('eyeWideLeft') + v('eyeWideRight')) / 2;
    const jaw = v('jawOpen');
    const bl = v('eyeBlinkLeft');
    const br = v('eyeBlinkRight');
    if (Math.abs(bl - br) > 0.45 && Math.min(bl, br) < 0.35 && smile < 0.6) return 'wink';
    if (smile > 0.45) return jaw > 0.3 ? 'laughing' : 'happy';
    if (jaw > 0.4 && (wide > 0.25 || browUp > 0.4)) return 'surprised';
    if (browDown > 0.4 && smile < 0.2) return 'angry';
    if (frown > 0.3 || (v('browInnerUp') > 0.5 && frown > 0.15)) return 'sad';
    if (v('mouthPucker') > 0.65 && jaw < 0.25) return 'kiss';
    return '';
  }

  // ---------------------------------------------------------------------------
  // Looks
  // ---------------------------------------------------------------------------

  const SKIN = ['#f6d3ba', '#eebc98', '#d9a077', '#b07650', '#7d4c31'];
  const HAIR = ['#2b1d16', '#4b3022', '#7b4a2a', '#b77b3e', '#e2bd72', '#3d3d42', '#a8452c'];
  const IRIS = ['#5b3a24', '#3a6e9e', '#4f7d4a', '#6b4b2e'];
  const FUR = ['#f2a65a', '#9aa5ae', '#7a5a49', '#f0dfbd', '#4a4a52'];
  const CAT_IRIS = ['#9cc64a', '#e3b23c', '#5fb3c9'];

  function palette(seed, style) {
    const h = hash(seed);
    const hue = h % 360;
    const pick = (list, salt) => list[(h >>> salt) % list.length];
    const base = {
      bg1: `hsl(${hue} 70% 94%)`,
      bg2: `hsl(${hue} 55% 84%)`,
      shirt: `hsl(${hue} 50% 52%)`,
      shirtDark: `hsl(${hue} 50% 42%)`,
      line: '#3b2b2b',
      mouth: '#6b2433',
      tongue: '#e9798a',
      blush: '#ff7a8a',
    };
    if (style === 'cat') {
      const fur = pick(FUR, 3);
      return { ...base, skin: fur, lid: fur, iris: pick(CAT_IRIS, 7), accent: '#f6a5b5', hair: fur };
    }
    if (style === 'panda') {
      return { ...base, skin: '#fbfaf6', lid: '#26262b', iris: '#3a2a20', accent: '#26262b', hair: '#26262b' };
    }
    if (style === 'robot') {
      return { ...base, skin: '#d5dde2', lid: '#20323d', iris: `hsl(${(hue + 180) % 360} 85% 62%)`, accent: `hsl(${hue} 80% 58%)`, hair: '#90a4ae', led: '#4fe3f0' };
    }
    const skin = pick(SKIN, 5);
    return { ...base, skin, lid: skin, iris: pick(IRIS, 9), hair: pick(HAIR, 13), accent: skin };
  }

  function shade(hex, amount) {
    // amount < 0 darkens, > 0 lightens (hex colors only).
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Projects a point (X, Y) of the face, in head radii, onto the screen.
  // Returns [x, y, facing] where facing (0..1) foreshortens the far side.
  function projector(f, R) {
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
    return (X, Y, depth = 0.92) => {
      const Z = Math.sqrt(Math.max(0.05, 1 - X * X - Y * Y)) * depth;
      const x1 = X * cy + Z * sy;
      const z1 = -X * sy + Z * cy;
      const y2 = Y * cp + z1 * sp;
      const z2 = -Y * sp + z1 * cp;
      return [x1 * R, y2 * R, clamp(z2 / Math.max(Z, 0.2), 0.25, 1)];
    };
  }

  function ellipse(ctx, x, y, rx, ry, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  }

  // --- shared parts ----------------------------------------------------------

  function drawBody(ctx, W, H, R, f, pal, style) {
    const x = f.x * R * 0.25;
    const top = R * 0.86;
    ctx.save();
    ctx.translate(x, 0);
    ctx.rotate(-f.roll * 0.6);  // the body tilts less than the head
    const fill = style === 'robot' ? '#b4c2c9' : style === 'panda' ? '#26262b' : pal.shirt;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-R * 1.45, H);
    ctx.bezierCurveTo(-R * 1.45, top + R * 0.35, -R * 0.9, top, 0, top);
    ctx.bezierCurveTo(R * 0.9, top, R * 1.45, top + R * 0.35, R * 1.45, H);
    ctx.closePath();
    ctx.fill();
    if (style === 'human') {
      ctx.fillStyle = pal.skin;  // neck
      roundRect(ctx, -R * 0.24, R * 0.62, R * 0.48, R * 0.42, R * 0.18);
      ctx.fill();
      ctx.fillStyle = pal.shirtDark;  // collar
      ctx.beginPath();
      ctx.moveTo(-R * 0.36, top + R * 0.02);
      ctx.quadraticCurveTo(0, top + R * 0.34, R * 0.36, top + R * 0.02);
      ctx.quadraticCurveTo(0, top + R * 0.16, -R * 0.36, top + R * 0.02);
      ctx.fill();
    } else if (style === 'robot') {
      ctx.fillStyle = '#8fa1aa';
      roundRect(ctx, -R * 0.22, R * 0.72, R * 0.44, R * 0.3, R * 0.06);
      ctx.fill();
      ctx.fillStyle = pal.accent;
      ellipse(ctx, 0, top + R * 0.42, R * 0.13, R * 0.13);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEye(ctx, x, y, rx, ry, p, pal, R, style) {
    const lineW = R * 0.03;
    if (p.close > 0.82) {
      // Closed: an arc, bent up into "^" while smiling.
      ctx.strokeStyle = style === 'panda' ? '#f4f4f0' : pal.line;
      ctx.lineWidth = lineW * 1.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - rx, y);
      ctx.quadraticCurveTo(x, y + (p.happy ? -ry * 1.1 : ry * 0.6), x + rx, y);
      ctx.stroke();
      return;
    }
    const ryOpen = ry * (1 + p.wide * 0.35);
    ctx.save();
    ellipse(ctx, x, y, rx, ryOpen);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();
    // Iris and pupil follow the gaze.
    const ix = x + p.gx * rx * 0.42;
    const iy = y + p.gy * ryOpen * 0.32;
    const ir = Math.min(rx, ryOpen) * (style === 'cat' ? 0.78 : 0.66);
    ctx.fillStyle = pal.iris;
    ellipse(ctx, ix, iy, ir, ir);
    ctx.fill();
    ctx.fillStyle = '#16100c';
    if (style === 'cat') ellipse(ctx, ix, iy, ir * (0.22 + p.wide * 0.4), ir * 0.86);
    else ellipse(ctx, ix, iy, ir * 0.5, ir * 0.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ellipse(ctx, ix - ir * 0.32, iy - ir * 0.36, ir * 0.24, ir * 0.24);
    ctx.fill();
    // Lids: the upper one comes down to blink, the lower one rises to squint.
    ctx.fillStyle = pal.lid;
    const upper = y - ryOpen + 2 * ryOpen * p.close * 0.98;
    ctx.fillRect(x - rx * 1.3, y - ryOpen * 1.3, rx * 2.6, upper - (y - ryOpen * 1.3));
    const lower = y + ryOpen - 2 * ryOpen * p.squint * 0.38;
    ctx.fillRect(x - rx * 1.3, lower, rx * 2.6, ryOpen * 1.6);
    ctx.restore();
    // Outline and lash line along the upper lid.
    ctx.strokeStyle = style === 'panda' ? 'rgba(0,0,0,0.6)' : pal.line;
    ctx.lineWidth = lineW * 0.7;
    ellipse(ctx, x, y, rx, ryOpen);
    ctx.stroke();
    const t = clamp((upper - y) / ryOpen, -0.98, 0.98);
    const half = rx * Math.sqrt(1 - t * t);
    ctx.lineWidth = lineW * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - half, upper);
    ctx.lineTo(x + half, upper);
    ctx.stroke();
  }

  function drawBrow(ctx, x, y, w, side, f, R, color, thick) {
    // side: -1 screen left, +1 screen right. The inner end is toward the nose.
    const key = side < 0 ? 'l' : 'r';
    const down = f.browDown[key];
    const innerY = y - f.browInner * R * 0.13 + down * R * 0.1;
    const outerY = y - f.browOuter[key] * R * 0.11 + down * R * 0.02 + f.browInner * R * 0.02;
    const innerX = x - side * w * 0.5;
    const outerX = x + side * w * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = thick;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(innerX, innerY);
    ctx.quadraticCurveTo(x, Math.min(innerY, outerY) - R * 0.05, outerX, outerY);
    ctx.stroke();
  }

  function drawMouth(ctx, P, f, R, pal, style) {
    const [mx, my, facing] = P(f.shift * 0.12, 0.44);
    const smile = (f.smile.l + f.smile.r) / 2;
    const stretch = (f.stretch.l + f.stretch.r) / 2;
    const round = clamp(f.funnel * 1.2 + f.pucker * 0.6, 0, 1);
    const w = R * 0.42 * (1 + smile * 0.5 + stretch * 0.3 - f.pucker * 0.5 - round * 0.25 - f.puff * 0.3) * facing;
    const h = f.open * R * 0.46 * (1 + round * 0.25);
    const left = [mx - w / 2, my - f.smile.l * R * 0.12 + f.frown.l * R * 0.11];
    const right = [mx + w / 2, my - f.smile.r * R * 0.12 + f.frown.r * R * 0.11];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const outline = style === 'panda' ? '#26262b' : pal.line;

    if (f.pucker > 0.5 && f.open < 0.25) {
      // Kiss: a small round mouth.
      ellipse(ctx, mx, my, R * 0.065, R * 0.07);
      ctx.fillStyle = shade('#d9536b', -0.1);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = R * 0.025;
      ctx.stroke();
      return;
    }
    if (h < R * 0.025) {
      // Closed: one line, curved by smile / frown; pressed lips make it straight.
      const bend = (smile - (f.frown.l + f.frown.r) / 2) * R * 0.12 * (1 - f.press * 0.7);
      ctx.strokeStyle = outline;
      ctx.lineWidth = R * 0.03;
      ctx.beginPath();
      ctx.moveTo(left[0], left[1]);
      ctx.quadraticCurveTo(mx, my + bend, right[0], right[1]);
      ctx.stroke();
      return;
    }
    // Open: the top lip runs (nearly straight) between the corners and the
    // jaw drops below them, so a big smile becomes a "D" laugh.
    // (A quadratic curve's middle lies halfway between its ends and its control point.)
    const cornerY = (left[1] + right[1]) / 2;
    const top = cornerY - 2 * (R * 0.012 + f.upperUp * R * 0.03 + smile * R * 0.012);
    const bottom = cornerY + 2 * (h + smile * R * 0.06);
    const lips = new Path2D();
    if (round > 0.45) {
      // "O": surprise, or the lips of an "oo".
      const rx = Math.max(w / 2, R * 0.13);
      lips.ellipse(mx, my + h * 0.3, rx, clamp(h * 0.45 + R * 0.02, rx * 0.8, rx * 1.15), 0, 0, TAU);
    } else {
      lips.moveTo(left[0], left[1]);
      lips.quadraticCurveTo(mx, top, right[0], right[1]);
      lips.quadraticCurveTo(mx, bottom, left[0], left[1]);
      lips.closePath();
    }
    ctx.fillStyle = pal.mouth;
    ctx.fill(lips);
    ctx.save();
    ctx.clip(lips);
    if (h > R * 0.08) {
      ctx.fillStyle = pal.tongue;
      ellipse(ctx, mx, cornerY + h * 1.05, w * 0.3, h * 0.42);
      ctx.fill();
    }
    if (smile > 0.25 || f.upperUp > 0.3) {
      ctx.fillStyle = '#fbfbf7';
      ctx.fillRect(mx - w / 2, cornerY - R * 0.1, w, R * 0.1 + Math.min(h * 0.3, R * 0.07));
    }
    ctx.restore();
    ctx.strokeStyle = outline;
    ctx.lineWidth = R * 0.028;
    ctx.stroke(lips);
  }

  function drawCheeks(ctx, P, f, R, pal) {
    for (const side of [-1, 1]) {
      const [x, y, facing] = P(side * 0.52, 0.27, 0.85);
      if (f.puff > 0.12) {
        ctx.fillStyle = pal.skin;
        ellipse(ctx, x - side * R * 0.02, y + R * 0.04, R * (0.12 + 0.16 * f.puff) * facing, R * (0.12 + 0.14 * f.puff));
        ctx.fill();
        ctx.strokeStyle = 'rgba(80, 40, 30, 0.25)';
        ctx.lineWidth = R * 0.015;
        ctx.stroke();
      }
      ctx.fillStyle = pal.blush;
      ctx.globalAlpha = 0.12 + f.blush * 0.42;
      ellipse(ctx, x, y, R * 0.13 * facing, R * 0.075);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawEyesAndBrows(ctx, P, f, R, pal, style, opts) {
    const rx = R * (style === 'human' ? 0.155 : 0.15);
    const ry = R * (style === 'human' ? 0.18 : 0.16);
    const happy = (f.smile.l + f.smile.r) / 2 > 0.35;
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'l' : 'r';
      const [x, y, facing] = P(side * 0.36, -0.04);
      if (style === 'panda') {
        ctx.fillStyle = '#26262b';
        ellipse(ctx, x + side * R * 0.02, y + R * 0.04, R * 0.2 * facing, R * 0.25, side * 0.5);
        ctx.fill();
      }
      drawEye(ctx, x, y, rx * facing, ry, {
        close: f.close[key], squint: f.squint[key], wide: f.wide[key], gx: f.gx, gy: f.gy, happy,
      }, pal, R, style);
      const browColor = style === 'human' ? pal.hair : style === 'cat' ? shade(pal.skin, -0.45) : '#26262b';
      const [bx, by] = P(side * 0.36, -0.33);
      drawBrow(ctx, bx, by, R * 0.3 * facing, side, f, R, browColor, R * (style === 'human' ? 0.055 : 0.04));
    }
  }

  // --- styles ----------------------------------------------------------------

  function headFill(ctx, R, color) {
    const g = ctx.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.15, 0, 0, R * 1.1);
    g.addColorStop(0, shade(color, 0.18));
    g.addColorStop(1, shade(color.startsWith('#') ? color : '#cccccc', -0.08));
    return g;
  }

  const LOOKS = {
    human(ctx, R, f, P, pal, opts) {
      // Ears behind the head.
      for (const side of [-1, 1]) {
        const [x, y] = P(side * 0.98, 0.05, 0.3);
        ctx.fillStyle = shade(pal.skin, -0.06);
        ellipse(ctx, x, y, R * 0.16, R * 0.2);
        ctx.fill();
      }
      ellipse(ctx, 0, 0, R, R * 1.02);
      ctx.fillStyle = headFill(ctx, R, pal.skin);
      ctx.fill();
      drawCheeks(ctx, P, f, R, pal);
      drawEyesAndBrows(ctx, P, f, R, pal, 'human', opts);
      const [nx, ny, nf] = P(0, 0.17, 1);
      ctx.fillStyle = shade(pal.skin, -0.16);
      ellipse(ctx, nx, ny - f.sneer * R * 0.02, R * 0.06 * nf, R * 0.045);
      ctx.fill();
      drawMouth(ctx, P, f, R, pal, 'human');
      // Hair: over the top, with a fringe that follows the head's turn.
      const part = Math.sin(f.yaw) * R * 0.35;
      ctx.save();
      ellipse(ctx, 0, 0, R * 1.06, R * 1.08);
      ctx.clip();
      ctx.fillStyle = pal.hair;
      ctx.beginPath();
      ctx.moveTo(-R * 1.1, R * 0.05);
      ctx.lineTo(-R * 1.1, -R * 1.2);
      ctx.lineTo(R * 1.1, -R * 1.2);
      ctx.lineTo(R * 1.1, R * 0.05);
      ctx.quadraticCurveTo(R * 0.95, -R * 0.45, R * 0.55 + part * 0.5, -R * 0.52);
      ctx.quadraticCurveTo(R * 0.3 + part, -R * 0.3, part * 0.6 - R * 0.05, -R * 0.55);
      ctx.quadraticCurveTo(-R * 0.35 + part * 0.5, -R * 0.36, -R * 0.75 + part * 0.3, -R * 0.45);
      ctx.quadraticCurveTo(-R * 1.0, -R * 0.3, -R * 1.1, R * 0.05);
      ctx.fill();
      ctx.restore();
    },

    cat(ctx, R, f, P, pal, opts) {
      const ear = (side) => {
        const tipX = side * R * 0.78 + Math.sin(f.yaw) * R * 0.2;
        ctx.fillStyle = pal.skin;
        ctx.beginPath();
        ctx.moveTo(side * R * 0.25, -R * 0.82);
        ctx.lineTo(tipX, -R * 1.32);
        ctx.lineTo(side * R * 0.95, -R * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.moveTo(side * R * 0.38, -R * 0.78);
        ctx.lineTo(tipX * 0.94, -R * 1.18);
        ctx.lineTo(side * R * 0.84, -R * 0.45);
        ctx.closePath();
        ctx.fill();
      };
      ear(-1);
      ear(1);
      ellipse(ctx, 0, 0, R * 1.06, R);
      ctx.fillStyle = headFill(ctx, R, pal.skin);
      ctx.fill();
      // Tabby stripes on the forehead.
      ctx.strokeStyle = shade(pal.skin, -0.22);
      ctx.lineWidth = R * 0.05;
      ctx.lineCap = 'round';
      for (const dx of [-0.18, 0, 0.18]) {
        const [x, y] = P(dx, -0.72);
        ctx.beginPath();
        ctx.moveTo(x, y - R * 0.12);
        ctx.lineTo(x, y + R * 0.08);
        ctx.stroke();
      }
      drawCheeks(ctx, P, f, R, pal);
      drawEyesAndBrows(ctx, P, f, R, pal, 'cat', opts);
      // Muzzle, nose, whiskers.
      for (const side of [-1, 1]) {
        const [x, y, facing] = P(side * 0.12, 0.3, 1);
        ctx.fillStyle = '#fbf6ee';
        ellipse(ctx, x, y, R * 0.16 * facing, R * 0.13);
        ctx.fill();
      }
      const [nx, ny, nf] = P(0, 0.18, 1);
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.moveTo(nx - R * 0.08 * nf, ny - R * 0.04);
      ctx.lineTo(nx + R * 0.08 * nf, ny - R * 0.04);
      ctx.lineTo(nx, ny + R * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(60, 40, 30, 0.55)';
      ctx.lineWidth = R * 0.018;
      for (const side of [-1, 1]) {
        const [x, y] = P(side * 0.3, 0.3, 1);
        for (const k of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, y + k * R * 0.05);
          ctx.lineTo(x + side * R * 0.55, y + k * R * 0.12 - R * 0.04);
          ctx.stroke();
        }
      }
      drawMouth(ctx, P, f, R, pal, 'cat');
    },

    panda(ctx, R, f, P, pal, opts) {
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#26262b';
        ellipse(ctx, side * R * 0.74 + Math.sin(f.yaw) * R * 0.12, -R * 0.74, R * 0.3, R * 0.28);
        ctx.fill();
      }
      ellipse(ctx, 0, 0, R * 1.04, R);
      ctx.fillStyle = headFill(ctx, R, pal.skin);
      ctx.fill();
      drawCheeks(ctx, P, f, R, pal);
      drawEyesAndBrows(ctx, P, f, R, pal, 'panda', opts);
      const [nx, ny, nf] = P(0, 0.2, 1);
      ctx.fillStyle = '#26262b';
      ellipse(ctx, nx, ny, R * 0.09 * nf, R * 0.06);
      ctx.fill();
      drawMouth(ctx, P, f, R, pal, 'panda');
    },

    robot(ctx, R, f, P, pal, opts) {
      const glow = clamp(opts.voice || 0, 0, 1);
      // Antenna, its light glows with the voice.
      const tilt = Math.sin(f.yaw) * R * 0.15;
      ctx.strokeStyle = '#8fa1aa';
      ctx.lineWidth = R * 0.05;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.9);
      ctx.lineTo(tilt, -R * 1.22);
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = pal.accent;
      ctx.shadowBlur = R * (0.1 + glow * 0.5);
      ctx.fillStyle = pal.accent;
      ellipse(ctx, tilt, -R * 1.26, R * (0.09 + glow * 0.03), R * (0.09 + glow * 0.03));
      ctx.fill();
      ctx.restore();
      for (const side of [-1, 1]) {
        ctx.fillStyle = pal.accent;
        roundRect(ctx, side * R * 1.02 - R * 0.09, -R * 0.2, R * 0.18, R * 0.4, R * 0.06);
        ctx.fill();
      }
      roundRect(ctx, -R * 0.98, -R * 0.92, R * 1.96, R * 1.84, R * 0.36);
      const g = ctx.createLinearGradient(0, -R, 0, R);
      g.addColorStop(0, '#eef3f5');
      g.addColorStop(1, '#a9b8bf');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#7d8f98';
      ctx.lineWidth = R * 0.03;
      ctx.stroke();
      // Face screen, shifted by the head's turn.
      const [sx, sy] = P(0, 0.08, 0.5);
      roundRect(ctx, sx - R * 0.78, sy - R * 0.62, R * 1.56, R * 1.16, R * 0.24);
      ctx.fillStyle = '#20323d';
      ctx.fill();
      ctx.save();
      ctx.shadowColor = pal.led;
      ctx.shadowBlur = R * 0.12;
      ctx.fillStyle = pal.led;
      ctx.strokeStyle = pal.led;
      ctx.lineCap = 'round';
      const happy = (f.smile.l + f.smile.r) / 2 > 0.35;
      for (const side of [-1, 1]) {
        const key = side < 0 ? 'l' : 'r';
        const [x, y, facing] = P(side * 0.34, -0.06);
        const w = R * 0.26 * facing;
        const h = R * 0.22 * (1 + f.wide[key] * 0.4) * (1 - f.squint[key] * 0.35) * (1 - f.close[key]);
        if (f.close[key] > 0.82) {
          ctx.lineWidth = R * 0.05;
          ctx.beginPath();
          ctx.moveTo(x - w / 2, y);
          ctx.quadraticCurveTo(x, y + (happy ? -R * 0.12 : R * 0.06), x + w / 2, y);
          ctx.stroke();
        } else {
          roundRect(ctx, x - w / 2, y - h / 2, w, Math.max(h, R * 0.03), R * 0.05);
          ctx.fill();
          ctx.fillStyle = '#20323d';
          roundRect(ctx, x - w * 0.15 + f.gx * w * 0.25, y - h * 0.18 + f.gy * h * 0.2, w * 0.3, h * 0.36, R * 0.03);
          ctx.fill();
          ctx.fillStyle = pal.led;
        }
        const [bx, by] = P(side * 0.34, -0.36);
        const down = f.browDown[key];
        const inner = by - f.browInner * R * 0.1 + down * R * 0.09;
        const outer = by - f.browOuter[key] * R * 0.09;
        ctx.lineWidth = R * 0.05;
        ctx.beginPath();
        ctx.moveTo(bx - side * R * 0.13 * facing, inner);
        ctx.lineTo(bx + side * R * 0.13 * facing, outer);
        ctx.stroke();
      }
      // Mouth: a light bar that bends with a smile and opens into an equalizer.
      const [mx, my, mf] = P(f.shift * 0.1, 0.36);
      const smile = (f.smile.l + f.smile.r) / 2 - (f.frown.l + f.frown.r) / 2;
      const w = R * 0.5 * (1 + smile * 0.25 - f.pucker * 0.45) * mf;
      const h = f.open * R * 0.3;
      if (h < R * 0.03) {
        ctx.lineWidth = R * 0.045;
        ctx.beginPath();
        ctx.moveTo(mx - w / 2, my - smile * R * 0.08);
        ctx.quadraticCurveTo(mx, my + smile * R * 0.12, mx + w / 2, my - smile * R * 0.08);
        ctx.stroke();
      } else {
        const bars = 7;
        for (let i = 0; i < bars; i++) {
          const t = (i + 0.5) / bars - 0.5;
          const bh = Math.max(R * 0.03, h * (1 - Math.abs(t) * 1.3) * (0.75 + 0.25 * Math.sin(i * 1.7 + h)));
          roundRect(ctx, mx + t * w - w / bars * 0.35, my - bh / 2, w / bars * 0.7, bh, R * 0.02);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.fillStyle = pal.blush;
      ctx.globalAlpha = f.blush * 0.5;
      for (const side of [-1, 1]) {
        const [x, y] = P(side * 0.55, 0.26);
        ellipse(ctx, x, y, R * 0.1, R * 0.05);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  // A small drawn emoji of the detected mood (emoji fonts are not everywhere).
  function drawBadge(ctx, W, H, face) {
    const mood = emotion(face);
    if (!mood) return;
    const r = Math.min(W, H) * 0.075;
    const x = W - r * 1.5;
    const y = r * 1.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ellipse(ctx, 0, 0, r * 1.14, r * 1.14);
    ctx.fill();
    ctx.fillStyle = mood === 'angry' ? '#ff9a5c' : '#ffd34d';
    ellipse(ctx, 0, 0, r, r);
    ctx.fill();
    const ink = '#5a3a14';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = 'round';
    const dot = (ex) => { ellipse(ctx, ex, -r * 0.22, r * 0.11, r * 0.15); ctx.fill(); };
    const arcEye = (ex) => {
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.16, -r * 0.16);
      ctx.quadraticCurveTo(ex, -r * 0.42, ex + r * 0.16, -r * 0.16);
      ctx.stroke();
    };
    const curve = (y0, bend, half = 0.38) => {
      ctx.beginPath();
      ctx.moveTo(-r * half, r * y0);
      ctx.quadraticCurveTo(0, r * (y0 + bend), r * half, r * y0);
      ctx.stroke();
    };
    if (mood === 'happy') { dot(-r * 0.32); dot(r * 0.32); curve(0.22, 0.4); }
    if (mood === 'laughing') {
      arcEye(-r * 0.32); arcEye(r * 0.32);
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, r * 0.12);
      ctx.lineTo(r * 0.45, r * 0.12);
      ctx.quadraticCurveTo(0, r * 0.95, -r * 0.45, r * 0.12);
      ctx.fill();
    }
    if (mood === 'surprised') {
      dot(-r * 0.32); dot(r * 0.32);
      ellipse(ctx, 0, r * 0.38, r * 0.17, r * 0.22);
      ctx.fill();
    }
    if (mood === 'angry') {
      dot(-r * 0.32); dot(r * 0.32);
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.55); ctx.lineTo(-r * 0.12, -r * 0.36);
      ctx.moveTo(r * 0.55, -r * 0.55); ctx.lineTo(r * 0.12, -r * 0.36);
      ctx.stroke();
      curve(0.45, -0.25, 0.3);
    }
    if (mood === 'sad') {
      dot(-r * 0.32); dot(r * 0.32);
      curve(0.48, -0.35, 0.32);
      ctx.fillStyle = '#4aa8ff';
      ellipse(ctx, -r * 0.36, r * 0.12, r * 0.09, r * 0.15);
      ctx.fill();
    }
    if (mood === 'wink') { dot(-r * 0.32); arcEye(r * 0.32); curve(0.22, 0.4); }
    if (mood === 'kiss') {
      arcEye(-r * 0.32); arcEye(r * 0.32);
      ctx.beginPath();
      ctx.arc(r * 0.02, r * 0.3, r * 0.1, -Math.PI / 2, Math.PI / 2);
      ctx.arc(r * 0.02, r * 0.5, r * 0.1, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(ctx, W, H, face, opts) {
    opts = opts || {};
    face = face || neutral();
    const style = STYLES.includes(opts.style) ? opts.style : 'human';
    const pal = palette(opts.seed || '', style);
    const f = features(face, !!opts.mirror);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.bg1);
    g.addColorStop(1, pal.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const R = Math.min(H * 0.3, W * 0.3);
    ctx.save();
    ctx.translate(W / 2 + f.x * W * 0.08, H * 0.5 - f.y * H * 0.05);
    drawBody(ctx, W, H, R, f, pal, style);
    ctx.rotate(f.roll);
    LOOKS[style](ctx, R, f, projector(f, R), pal, opts);
    ctx.restore();
    if (opts.badge !== false) drawBadge(ctx, W, H, face);
  }

  window.AvatarFace = { SHAPES, INDEX, STYLES, neutral, features, emotion, draw, hash };
})();
