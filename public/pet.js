// Negi: a hand-built pixel-art chibi with teal twintails, a headset, and a leek-highlighter.
// Drawn at 80x100 "real" pixels, then CSS-scaled with image-rendering: pixelated.
(function () {
  const W = 80, H = 100, OX = 8, OY = 6;

  const C = {
    outline: '#1f4a52', hair: '#8fd8d2', hairLt: '#c2f2ec', hairDk: '#5fb3b3',
    skin: '#fdeade', skinSh: '#f3c8b6', blush: '#f6a3b0', iris: '#33b7bd', irisLt: '#8fe3e3',
    eyeDk: '#1d3a44', white: '#ffffff', vest: '#aab3b1', vestSh: '#808c8b', tie: '#45c4c1',
    black: '#27333b', black2: '#3c4a53', pink: '#f08aa8', mouth: '#c65a6e',
    leek: '#57d685', leekDk: '#2f9a5c', leekWh: '#f3f8ec', sticker: '#ffffff', shadow: '#d5e3e3',
  };
  const PALETTE = Object.values(C).map(hex);
  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

  const GLYPHS = {
    heart: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
    spark: ['..X..', '..X..', 'XX.XX', '..X..', '..X..'],
    q: ['.XXX.', 'X...X', '...X.', '..X..', '..X..', '.....', '..X..'],
    z: ['XXXX', '..X.', '.X..', 'XXXX'],
    check: ['.....X', '....XX', 'X..XX.', 'XXXX..', '.XX...'],
    drop: ['.X.', 'XXX', 'XXX', '.X.'],
    note: ['..XX', '..X.', '..X.', 'XXX.', 'XX..'],
  };

  class Pet {
    constructor(canvas) {
      this.cv = canvas; canvas.width = W; canvas.height = H;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.state = 'idle'; this.since = performance.now();
      this.talkUntil = 0; this.particles = [];
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }
    setState(s) { if (s && s !== this.state) { this.state = s; this.since = performance.now(); } }
    talk(ms) { this.talkUntil = performance.now() + ms; }
    poke() {
      for (let i = 0; i < 4; i++) this.particles.push({ g: 'heart', col: C.pink, x: 30 + Math.random() * 20, y: 28, vy: -0.25 - Math.random() * 0.2, life: 90 });
      this.onPoke?.();
      this.bounce = performance.now();
    }
    emit(g, col, x, y) { this.particles.push({ g, col, x, y, vy: -0.2, life: 70 }); }

    loop(now) {
      requestAnimationFrame(this.loop);
      if (now - (this.last || 0) < 1000 / 12) return; // 12 fps for that crunchy pixel feel
      this.last = now;
      this.draw(now);
    }

    draw(t) {
      const ctx = this.ctx, s = this.state, el = t - this.since;
      ctx.clearRect(0, 0, W, H);
      let bob = Math.floor(t / 520) % 2;
      if (s === 'happy' && el < 2400) bob = -Math.round(Math.abs(Math.sin(el / 160)) * 4);
      if (this.bounce && t - this.bounce < 500) bob = -Math.round(Math.sin((t - this.bounce) / 500 * Math.PI) * 3);
      const sway = Math.sin(t / 650) * (s === 'cutting' ? 1.8 : 1);
      const blink = s === 'sleep' || (t % 4200) < 140;
      let leekA = -2.25 + Math.sin(t / 700) * 0.08;
      if (s === 'cutting') leekA = -2.25 + Math.sin(t / 90) * 0.55;
      if (s === 'verifying') leekA = -1.6;
      if (s === 'happy') leekA = -2.6 + Math.sin(t / 120) * 0.3;
      if (s === 'sad' || s === 'sleep') leekA = 2.6;
      const look = s === 'searching' || s === 'thinking' ? (Math.floor(t / 900) % 2 ? 1 : -1) : s === 'verifying' ? 1 : 0;

      ctx.save();
      ctx.translate(OX, OY + bob);
      this.drawBody(ctx, sway, leekA, t);
      ctx.restore();

      quantizeAndOutline(ctx);

      // face details drawn crisp after quantization (no outline)
      ctx.save();
      ctx.translate(OX, OY + bob);
      this.drawFace(ctx, { blink, look, s, t });
      ctx.restore();

      this.drawFx(ctx, t, s, el);
    }

    drawBody(ctx, sway, leekA, t) {
      const f = (c) => (ctx.fillStyle = c);
      const ell = (x, y, rx, ry, c) => { f(c); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
      const poly = (pts, c) => { f(c); ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); ctx.fill(); };
      const line = (x1, y1, x2, y2, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

      // twintails (behind everything)
      for (const side of [-1, 1]) {
        for (let k = 0; k <= 11; k++) {
          const d = k / 11;
          const x = 32 + side * (19 + Math.sin(d * 3.2) * 6 - d * 2) + sway * d * 2.2 * side;
          const y = 18 + k * 5.2;
          const rx = 7.5 - Math.max(0, d - 0.65) * 12;
          ell(x, y, Math.max(rx, 2), 4.6, C.hair);
        }
        // light strands
        for (let k = 2; k <= 9; k += 3) {
          const d = k / 11;
          const x = 32 + side * (19 + Math.sin(d * 3.2) * 6 - d * 2) + sway * d * 2.2 * side;
          line(x - 1.5 * side, 18 + k * 5.2 - 2, x + 1 * side, 18 + k * 5.2 + 3, 1, C.hairLt);
          line(x + 3 * side, 18 + k * 5.2, x + 2 * side, 18 + k * 5.2 + 6, 1, C.hairDk);
        }
      }
      // back hair of head
      ell(32, 25, 18.5, 17.5, C.hair);
      ell(32, 34, 16, 10, C.hairDk);

      // legs & boots
      f(C.skin); ctx.fillRect(27, 62, 3, 6); ctx.fillRect(34, 62, 3, 6);
      f(C.black); ctx.fillRect(26, 67, 5, 12); ctx.fillRect(33, 67, 5, 12);
      f(C.tie); ctx.fillRect(26, 67, 5, 1); ctx.fillRect(33, 67, 5, 1);
      f(C.black2); ctx.fillRect(27, 70, 1, 8); ctx.fillRect(34, 70, 1, 8);
      // skirt
      poly([25, 54, 39, 54, 43, 63, 21, 63], C.black);
      f(C.tie); ctx.fillRect(22, 62, 20, 1);
      f(C.black2); for (const x of [26, 30, 34, 38]) ctx.fillRect(x, 56, 1, 6);
      // torso / vest / tie
      poly([25, 44, 39, 44, 39, 55, 25, 55], C.vest);
      f(C.vestSh); ctx.fillRect(25, 52, 14, 3);
      f(C.skin); ctx.fillRect(30, 40, 4, 4);
      poly([29, 43, 35, 43, 32, 46], C.white);
      poly([31, 45, 33, 45, 34, 51, 32, 53, 30, 51], C.tie);

      // right arm (open palm) + detached sleeve
      line(38, 45, 44, 52, 3, C.skin);
      poly([41, 48, 46, 47, 51, 58, 43, 59], C.black);
      f(C.tie); ctx.fillRect(43, 58, 8, 1);
      ell(47, 55, 2, 1.6, C.skin);

      // left arm holding the leek-highlighter
      const hx = 19, hy = 53;
      ctx.save();
      ctx.translate(hx, hy); ctx.rotate(leekA);
      f(C.leekWh); ctx.fillRect(-3, -2, 12, 4);        // white stalk / pen body
      f(C.leekDk); ctx.fillRect(6, -2, 1.5, 4);        // band
      poly([9, -2.5, 22, -8, 19, -1], C.leek);         // leaves fanning out
      poly([9, -0.5, 25, 0, 21, 2.5], C.leek);
      poly([9, 2, 21, 8, 17, 1.5], C.leekDk);
      ctx.restore();
      line(26, 45, hx + 1, hy - 1, 3, C.skin);
      poly([24, 48, 20, 47, 13, 57, 21, 59], C.black);
      f(C.tie); ctx.fillRect(13, 57, 8, 1);
      ell(hx, hy, 2.2, 2, C.skin);

      // face
      ell(32, 30, 12.5, 11.5, C.skin);
      f(C.skinSh); ctx.fillRect(25, 39, 14, 1);
      // headset (right earpiece + mic), left earpiece peek
      ell(17.5, 31, 2.6, 3.4, C.black);
      ell(46.5, 31, 5, 5.4, C.black);
      ell(46.5, 31, 2.8, 3, C.pink);
      ell(46.5, 31, 1.4, 1.6, C.black2);
      line(44, 35, 40, 37, 1, C.black);
      // bangs
      poly([19, 22, 22, 12, 32, 9, 42, 12, 45, 22, 45, 25, 19, 25], C.hair);
      poly([20, 22, 23, 32, 26, 22], C.hair);
      poly([24, 21, 28, 28, 31, 21], C.hair);
      poly([29, 21, 32, 27.5, 35, 21], C.hair);
      poly([33, 21, 36.5, 28, 40, 21], C.hair);
      poly([38, 22, 42, 32, 44, 22], C.hair);
      line(20, 23, 19.5, 40, 2.5, C.hair);
      line(44, 23, 44.5, 40, 2.5, C.hair);
      line(27, 13, 25, 20, 1, C.hairLt);
      line(34, 11, 33, 18, 1, C.hairLt);
      line(31, 9, 33, 4, 1.2, C.hair); // ahoge
      // hair ties ("ears")
      ctx.save(); ctx.translate(15.5, 13); ctx.rotate(-0.35); f(C.black); ctx.fillRect(-2, -5, 4, 9); f(C.pink); ctx.fillRect(-2, 2, 4, 1); ctx.restore();
      ctx.save(); ctx.translate(48.5, 13); ctx.rotate(0.35); f(C.black); ctx.fillRect(-2, -5, 4, 9); f(C.pink); ctx.fillRect(-2, 2, 4, 1); ctx.restore();
    }

    drawFace(ctx, { blink, look, s, t }) {
      const px = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
      for (const ex of [24, 36]) {
        if (blink || s === 'sleep') { px(ex, 32, C.eyeDk, 5); px(ex - 1, 31, C.eyeDk); px(ex + 5, 31, C.eyeDk); continue; }
        if (s === 'happy') { px(ex + 1, 30, C.eyeDk, 3); px(ex, 31, C.eyeDk); px(ex + 4, 31, C.eyeDk); px(ex - 1, 32, C.eyeDk); px(ex + 5, 32, C.eyeDk); continue; }
        const lx = ex + (look > 0 ? 1 : look < 0 ? -1 : 0) * 0;
        px(lx, 28, C.eyeDk, 5);                    // lash
        px(lx + (ex < 30 ? -1 : 5), 29, C.eyeDk);  // outer flick
        px(lx, 29, C.iris, 5, 4);
        px(lx, 29, C.eyeDk, 5, 1);
        px(lx, 33, C.irisLt, 5, 1);
        px(lx + (look > 0 ? 2 : look < 0 ? 0 : 1), 30, C.eyeDk, 2, 2); // pupil follows look
        px(lx + (look > 0 ? 1 : 3), 30, C.white);  // sparkle
        px(lx + 1, 32, C.white);
      }
      // blush
      px(22, 35, C.blush, 2); px(40, 35, C.blush, 2);
      // mouth
      const talking = performance.now() < this.talkUntil && Math.floor(t / 110) % 2;
      if (s === 'happy' && !talking) { px(30, 36, C.mouth, 4); px(31, 37, C.mouth, 2); return void px(23, 35, C.blush); }
      if (s === 'sad') { px(31, 37, C.mouth, 2); px(30, 38, C.mouth); px(33, 38, C.mouth); }
      else if (talking) { px(31, 36, C.mouth, 2, 2); }
      else if (s === 'happy') { px(30, 36, C.mouth, 4); px(31, 37, C.mouth, 2); }
      else { px(30, 36, C.mouth); px(31, 37, C.mouth, 2); px(33, 36, C.mouth); }
      if (s === 'sad') px(23, 35, '#7cc8ee', 1, 2);
    }

    drawFx(ctx, t, s, el) {
      const glyph = (g, x, y, c) => { ctx.fillStyle = c; GLYPHS[g].forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'X') ctx.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1); }); };
      if ((s === 'searching' || s === 'thinking') && Math.floor(t / 400) % 2) glyph('q', 62, 8, C.outline);
      if (s === 'searching') { // magnifying glass orbiting
        const a = t / 500, x = 64 + Math.cos(a) * 3, y = 22 + Math.sin(a) * 2;
        ctx.strokeStyle = C.outline; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), 3, 0, 7); ctx.stroke();
        ctx.fillStyle = C.outline; ctx.fillRect(Math.round(x) + 2, Math.round(y) + 3, 2, 2); ctx.fillRect(Math.round(x) + 4, Math.round(y) + 5, 1, 1);
      }
      if (s === 'cutting' && Math.random() < 0.35) this.particles.push({ g: 'spark', col: Math.random() < 0.5 ? C.leek : '#e7ff3a', x: 6 + Math.random() * 18, y: 42 + Math.random() * 10, vy: -0.3, life: 30 });
      if (s === 'verifying') glyph('check', 64, 14 + (Math.floor(t / 300) % 2), C.leekDk);
      if (s === 'happy' && el < 3000 && Math.random() < 0.3) this.particles.push({ g: Math.random() < 0.5 ? 'spark' : 'note', col: Math.random() < 0.5 ? C.tie : C.pink, x: 8 + Math.random() * 60, y: 20 + Math.random() * 30, vy: -0.3, life: 40 });
      if (s === 'sleep' && Math.floor(t / 600) % 3) glyph('z', 58 + (Math.floor(t / 600) % 3) * 3, 10 - (Math.floor(t / 600) % 3) * 3, C.outline);
      if (s === 'worried') glyph('drop', 58, 18 + (Math.floor(t / 250) % 3), '#7cc8ee');
      this.particles = this.particles.filter((p) => p.life-- > 0);
      for (const p of this.particles) { p.y += p.vy * 3; glyph(p.g, p.x, p.y, p.col); }
    }
  }

  // Snap anti-aliased canvas shapes to the palette, then add a dark outline + white sticker border.
  function quantizeAndOutline(ctx) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const solid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (d[o + 3] < 110) { d[o + 3] = 0; continue; }
      let best = 0, bd = 1e9;
      for (let k = 0; k < PALETTE.length; k++) {
        const p = PALETTE[k], dd = (p[0] - d[o]) ** 2 + (p[1] - d[o + 1]) ** 2 + (p[2] - d[o + 2]) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      d[o] = PALETTE[best][0]; d[o + 1] = PALETTE[best][1]; d[o + 2] = PALETTE[best][2]; d[o + 3] = 255;
      solid[i] = 1;
    }
    const ring = (src, rgb, diag) => {
      const out = new Uint8Array(src);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (src[i]) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!diag && dx && dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && src[yy * W + xx]) { hit = true; break; }
        }
        if (hit) { out[i] = 1; const o = i * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255; }
      }
      return out;
    };
    let m = ring(solid, hex(C.outline), false);
    m = ring(m, hex(C.sticker), true);
    m = ring(m, hex(C.sticker), false);
    ring(m, hex(C.shadow), false);
    ctx.putImageData(img, 0, 0);
  }

  window.Pet = Pet;
  window.__setPetState = (s) => window.__pet && window.__pet.setState(s);
})();
