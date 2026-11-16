/* =====================================================================
   Projectile Motion Simulator
   ---------------------------------------------------------------------
   Pure vanilla JavaScript. No libraries, no backend.

   Structure:
     1. Element lookups & constants
     2. Physics (the actual equations)
     3. State & launch / reset logic
     4. Canvas sizing
     5. Drawing (background, grid, trails, ball, markers, vectors)
     6. Animation loop
     7. Event wiring
   ===================================================================== */

(function () {
  'use strict';

  /* ===================================================================
     1. ELEMENT LOOKUPS & CONSTANTS
     =================================================================== */

  const $ = (id) => document.getElementById(id);

  /* ===================================================================
     CREDIT — the only place the name is written
     -------------------------------------------------------------------
     Change CREDIT and it updates the watermark in the bottom-right
     corner of the screen. The name is also present as plain text in
     index.html (#watermark) so it shows even before this script runs;
     the line below simply keeps the two in step.
     The look of the watermark lives in one section of style.css
     (search for "WATERMARK").
     =================================================================== */
  const CREDIT = 'Abhinibesh-fresher';

  // Push the credit into the watermark
  (function paintCredit() {
    const mark = $('watermark');
    if (mark) mark.textContent = CREDIT;
  })();

  const canvas = $('scene');
  const ctx = canvas.getContext('2d');

  const els = {
    angle: $('angle'),
    velocity: $('velocity'),
    height: $('height'),
    gravity: $('gravity'),
    angleOut: $('angleOut'),
    velocityOut: $('velocityOut'),
    heightOut: $('heightOut'),
    gravityOut: $('gravityOut'),
    launch: $('launch'),
    reset: $('reset'),
    clear: $('clear'),
    vectors: $('vectors'),
    legend: $('legend'),
    compareWrap: $('compareWrap'),
    compareBody: $('compareBody'),
    speedNote: $('speedNote'),
    rTf: $('r-tf'),
    rMaxh: $('r-maxh'),
    rRange: $('r-range'),
    rX: $('r-x'),
    rY: $('r-y'),
    rT: $('r-t'),
  };

  // Slider defaults (used by the Reset button)
  const DEFAULTS = { angle: 45, velocity: 30, height: 0, gravity: 9.8 };

  // Bright trail colours, reused in order for each launch
  const PALETTE = [
    '#38bdf8', // sky
    '#a78bfa', // violet
    '#34d399', // green
    '#fbbf24', // amber
    '#fb7185', // rose
    '#22d3ee', // cyan
    '#f472b6', // pink
    '#c084fc', // purple
  ];

  const TRAIL_SAMPLES = 260;   // points per analytic path
  const MAX_WALL_SECONDS = 9;  // longest wall-clock playing time for one shot
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // Padding inside the canvas (room for axis labels)
  const PAD = { left: 56, right: 26, top: 30, bottom: 60 };

  // Canvas size in CSS pixels + device pixel ratio
  const view = { w: 0, h: 0, dpr: 1 };

  // All simulation state lives here
  const state = {
    trails: [],     // finished launches: { p, pts, color }
    shot: null,     // launch in progress or just finished
    colorIndex: 0,  // next palette slot
  };

  /* ===================================================================
     2. PHYSICS
     -------------------------------------------------------------------
     Standard constant-acceleration projectile equations, no air drag.

       x(t) = v·cosθ·t
       y(t) = h + v·sinθ·t − ½·g·t²
       vy(t) = v·sinθ − g·t
     =================================================================== */

  // Read the current control values
  function readParams() {
    return {
      angle: Number(els.angle.value),
      v: Number(els.velocity.value),
      h: Number(els.height.value),
      g: Number(els.gravity.value),
    };
  }

  // Given inputs, return every derived quantity the UI needs
  function physics({ angle, v, h, g }) {
    const th = (angle * Math.PI) / 180;
    const vx = v * Math.cos(th);       // horizontal velocity (constant)
    const vy0 = v * Math.sin(th);      // initial vertical velocity

    // Solve y(t) = 0 for t:  t = (vy0 + √(vy0² + 2gh)) / g
    const tf = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h)) / g;
    const flight = tf > 1e-9 ? tf : 0; // guard: 0 m high, 0° launch → no flight

    // Apex is where vy = 0 → t = vy0 / g
    const apexT = Math.min(vy0 > 0 ? vy0 / g : 0, flight);
    const apexY = h + (vy0 > 0 ? (vy0 * vy0) / (2 * g) : 0);

    return {
      angle, v, h, g, vx, vy0,
      tf: flight,
      maxH: Math.max(h, apexY),
      apexT,
      apexX: vx * apexT,
      range: vx * flight,
    };
  }

  // Position at time t (y clamped at 0 to hide floating-point fuzz)
  function posAt(p, t) {
    return {
      x: p.vx * t,
      y: Math.max(0, p.h + p.vy0 * t - 0.5 * p.g * t * t),
      t,
    };
  }

  // Pre-compute the whole path for drawing / trail storage
  function samplePath(p) {
    const pts = [];
    for (let i = 0; i <= TRAIL_SAMPLES; i++) {
      pts.push(posAt(p, (p.tf * i) / TRAIL_SAMPLES));
    }
    return pts;
  }

  /* ===================================================================
     3. STATE, LAUNCH, RESET
     =================================================================== */

  function launch() {
    // If a previous shot is still flying, snap it to its end first
    if (state.shot && !state.shot.done) finishShot();

    const p = physics(readParams());
    const color = PALETTE[state.colorIndex % PALETTE.length];
    state.colorIndex += 1;

    const willAnimate = p.tf > 0;

    state.shot = {
      p,
      color,
      pts: samplePath(p),
      t: 0,
      start: null,       // timestamp of the first animation frame
      done: false,
      // Very long flights are played back faster so they stay watchable
      speed: p.tf > MAX_WALL_SECONDS ? p.tf / MAX_WALL_SECONDS : 1,
    };

    showSpeedNote(p, state.shot.speed);
    renderStats(p, 0);

    if (!willAnimate) finishShot(); // 0 m high, 0° → instant
  }

  // Turn the current shot into a permanent trail
  function finishShot() {
    const shot = state.shot;
    if (!shot || shot.done) return;

    shot.done = true;
    shot.t = shot.p.tf;

    // Keep the launch number with the trail so the legend, table and
    // colours all refer to the same shot
    const index = state.trails.length + 1;
    state.trails.push({ p: shot.p, pts: shot.pts, color: shot.color, index });

    addChip(shot.p, shot.color, index);
    renderTable();

    renderStats(shot.p, shot.p.tf);
    els.speedNote.hidden = true;
  }

  // Reset sliders to defaults and wipe everything
  function resetAll() {
    els.angle.value = DEFAULTS.angle;
    els.velocity.value = DEFAULTS.velocity;
    els.height.value = DEFAULTS.height;
    els.gravity.value = String(DEFAULTS.gravity);
    els.vectors.checked = false;

    clearTrails();
    syncAll();
  }

  // Remove every stored path (keep the current slider settings)
  function clearTrails() {
    state.trails = [];
    state.shot = null;
    state.colorIndex = 0;
    els.legend.innerHTML = '';
    els.speedNote.hidden = true;
    clearStats();
    renderTable();
  }

  /* ---------- Small UI helpers ---------- */

  function renderStats(p, t) {
    const pos = posAt(p, t);
    els.rTf.textContent = p.tf.toFixed(2) + ' s';
    els.rMaxh.textContent = p.maxH.toFixed(1) + ' m';
    els.rRange.textContent = p.range.toFixed(1) + ' m';
    els.rX.textContent = pos.x.toFixed(1) + ' m';
    els.rY.textContent = pos.y.toFixed(1) + ' m';
    els.rT.textContent = t.toFixed(2) + ' s';
  }

  function clearStats() {
    [els.rTf, els.rMaxh, els.rRange, els.rX, els.rY, els.rT].forEach((el) => {
      el.textContent = '—';
    });
  }

  function showSpeedNote(p, speed) {
    if (speed > 1.001) {
      els.speedNote.hidden = false;
      els.speedNote.textContent =
        'Playback sped up ×' + speed.toFixed(1) +
        ' — the real flight time is ' + p.tf.toFixed(1) + ' s.';
    } else {
      els.speedNote.hidden = true;
    }
  }

  /* ---------- Launch comparison table ---------- */

  // Rebuild the table: furthest range first, best shot highlighted.
  function renderTable() {
    const rows = state.trails.slice().sort((a, b) => b.p.range - a.p.range);

    els.compareWrap.hidden = rows.length === 0;
    els.compareBody.textContent = '';

    rows.forEach((trail, i) => {
      const p = trail.p;
      const tr = document.createElement('tr');
      if (i === 0) tr.className = 'best'; // furthest shot

      // Launch number + colour dot (matches the trail on the canvas)
      const first = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = 'launch-tag';
      const dot = document.createElement('i');
      dot.style.setProperty('--c', trail.color);
      tag.append(dot, document.createTextNode('#' + trail.index));
      first.append(tag);
      tr.append(first);

      const values = [
        p.angle + '\u00b0',
        p.v + ' m/s',
        p.g.toFixed(1) + ' m/s\u00b2',
        p.tf.toFixed(2) + ' s',
        p.maxH.toFixed(1) + ' m',
        p.range.toFixed(1) + ' m',
      ];

      values.forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      });

      els.compareBody.append(tr);
    });
  }

  function addChip(p, color, index) {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const dot = document.createElement('i');
    dot.style.setProperty('--c', color);

    const num = document.createElement('b');
    num.textContent = '#' + index;

    const info = document.createTextNode(' ' + p.angle + '° · ' + p.v + ' m/s · ');

    const range = document.createElement('em');
    range.textContent = p.range.toFixed(0) + ' m';

    chip.append(dot, num, info, range);
    els.legend.append(chip);
  }

  /* ===================================================================
     4. CANVAS SIZING
     =================================================================== */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = rect.width;
    view.h = rect.height;
    view.dpr = dpr;

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    // Work in CSS pixels; the transform handles the retina scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ===================================================================
     5. DRAWING
     =================================================================== */

  // World-space bounds that must fit on screen: every trail + the live inputs
  function computeBounds() {
    let maxX = 0;
    let maxY = 0;

    const live = physics(readParams());
    maxX = Math.max(maxX, live.range);
    maxY = Math.max(maxY, live.maxH);

    for (const trail of state.trails) {
      maxX = Math.max(maxX, trail.p.range);
      maxY = Math.max(maxY, trail.p.maxH);
    }
    if (state.shot) {
      maxX = Math.max(maxX, state.shot.p.range);
      maxY = Math.max(maxY, state.shot.p.maxH);
    }

    maxX = Math.max(maxX, 2);         // never divide by zero
    maxY = Math.max(maxY, maxX * 0.2, 1);
    return { maxX, maxY };
  }

  // Map world metres → canvas pixels (equal scale on both axes so shapes are true)
  function makeGeometry(b) {
    const plotW = Math.max(50, view.w - PAD.left - PAD.right);
    const plotH = Math.max(50, view.h - PAD.top - PAD.bottom);
    const scale = Math.min(plotW / (b.maxX * 1.06), plotH / (b.maxY * 1.15));

    return {
      scale,
      originX: PAD.left,
      groundY: view.h - PAD.bottom,
      plotW,
      plotH,
      b,
    };
  }

  function toPx(geo, x, y) {
    return {
      X: geo.originX + x * geo.scale,
      Y: geo.groundY - y * geo.scale,
    };
  }

  // Pick a "nice" grid step (1, 2, 5, 10, 20, 50 …) for roughly `target` ticks
  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    let mult;
    if (n <= 1) mult = 1;
    else if (n <= 2) mult = 2;
    else if (n <= 5) mult = 5;
    else mult = 10;
    return mult * pow;
  }

  function roundRect(x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    // Fallback for older browsers
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ---------- 5a. Background, grid, ground ---------- */

  function paintBackground() {
    const W = view.w;
    const H = view.h;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1220');
    bg.addColorStop(1, '#060a13');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Soft horizon glow
    const glow = ctx.createRadialGradient(
      W * 0.5, H * 0.62, 0,
      W * 0.5, H * 0.62, Math.max(W, H) * 0.7
    );
    glow.addColorStop(0, 'rgba(56,189,248,0.10)');
    glow.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function paintGrid(geo) {
    const { scale, originX, groundY, b } = geo;
    const right = view.w - PAD.right;
    const top = PAD.top;

    const xStep = niceStep(b.maxX, Math.max(3, Math.round(geo.plotW / 100)));
    const yStep = niceStep(b.maxY, Math.max(2, Math.round(geo.plotH / 80)));

    const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : v.toFixed(1));

    ctx.save();

    /* Vertical grid lines + distance labels */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.fillStyle = 'rgba(143,160,189,0.78)';
    ctx.font = '11px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let v = 0; ; v += xStep) {
      const X = originX + v * scale;
      if (X > right + 1) break;
      ctx.beginPath();
      ctx.moveTo(X, top);
      ctx.lineTo(X, groundY);
      ctx.stroke();
      ctx.fillText(fmt(v, xStep), X, groundY + 12);
    }

    /* Horizontal grid lines + height labels */
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let v = 0; ; v += yStep) {
      const Y = groundY - v * scale;
      if (Y < top - 1) break;
      if (v > 0) {
        ctx.beginPath();
        ctx.moveTo(originX, Y);
        ctx.lineTo(right, Y);
        ctx.stroke();
      }
      ctx.fillText(fmt(v, yStep), originX - 10, Y);
    }

    /* Axis titles */
    ctx.fillStyle = 'rgba(143,160,189,0.55)';
    ctx.font = '10px ' + MONO;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('distance (m)', right, view.h - 8);
    ctx.textAlign = 'left';
    ctx.fillText('height (m)', 10, PAD.top - 10);

    /* Ground band beneath the ground line */
    const band = ctx.createLinearGradient(0, groundY, 0, view.h);
    band.addColorStop(0, 'rgba(56,189,248,0.16)');
    band.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, groundY, view.w, view.h - groundY);

    /* The ground line itself */
    const line = ctx.createLinearGradient(originX, 0, right, 0);
    line.addColorStop(0, 'rgba(125,211,252,0.95)');
    line.addColorStop(1, 'rgba(167,139,250,0.35)');
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(56,189,248,0.55)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(originX, groundY);
    ctx.lineTo(right, groundY);
    ctx.stroke();

    ctx.restore();
  }

  /* ---------- 5b. Trails ---------- */

  function paintTrail(trail, geo, { dim = false, upto = Infinity } = {}) {
    const p = trail.p;
    const pts = trail.pts;
    if (!pts.length) return;

    const endT = Math.min(upto, p.tf);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = trail.color;
    ctx.globalAlpha = dim ? 0.42 : 1;
    ctx.lineWidth = dim ? 1.8 : 2.6;
    ctx.shadowColor = trail.color;
    ctx.shadowBlur = dim ? 5 : 14;

    ctx.beginPath();
    let first = toPx(geo, pts[0].x, pts[0].y);
    ctx.moveTo(first.X, first.Y);

    for (let i = 1; i < pts.length; i++) {
      if (pts[i].t > endT) break;
      const q = toPx(geo, pts[i].x, pts[i].y);
      ctx.lineTo(q.X, q.Y);
    }

    // Exact end point while the ball is still flying
    if (endT < p.tf) {
      const end = posAt(p, endT);
      const q = toPx(geo, end.x, end.y);
      ctx.lineTo(q.X, q.Y);
    }

    ctx.stroke();
    ctx.restore();
  }

  // Faint dashed preview of the current slider settings (only before the first launch)
  function paintGhost(p, geo) {
    const pts = samplePath(p);
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(143,160,189,0.55)';
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const q = toPx(geo, pt.x, pt.y);
      i === 0 ? ctx.moveTo(q.X, q.Y) : ctx.lineTo(q.X, q.Y);
    });
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 5c. Ball, markers, labels ---------- */

  function paintBall(pos, geo, color, faint) {
    const q = toPx(geo, pos.x, pos.y);

    ctx.save();
    if (faint) ctx.globalAlpha = 0.65;

    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(q.X, q.Y, 7.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(q.X, q.Y, 3.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function pill(text, x, y, color, align) {
    ctx.save();
    ctx.font = '600 11px ' + MONO;
    const w = ctx.measureText(text).width + 16;
    const h = 21;

    let left = x;
    if (align === 'right') left = x - w;
    else if (align === 'center') left = x - w / 2;

    // Keep labels inside the canvas
    left = Math.max(4, Math.min(left, view.w - w - 4));
    const top = Math.max(4, y - h);

    ctx.fillStyle = 'rgba(7,11,20,0.86)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    roundRect(left, top, w, h, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
    ctx.restore();
  }

  // Highest point + landing point of a trajectory
  function paintMarkers(p, geo, color, withLabels) {
    if (p.maxH <= 0 && p.range <= 0) return;

    const apex = toPx(geo, p.apexX, p.maxH);
    const land = toPx(geo, p.range, 0);

    ctx.save();

    /* Dashed drop line from the apex to the ground, to read the height */
    if (p.tf > 0) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(apex.X, apex.Y);
      ctx.lineTo(apex.X, geo.groundY);
      ctx.stroke();
      ctx.restore();
    }

    /* Apex: ringed dot */
    ctx.fillStyle = 'rgba(7,11,20,0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(apex.X, apex.Y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    /* Landing: small triangle sitting on the ground line */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(land.X, geo.groundY + 1);
    ctx.lineTo(land.X - 6, geo.groundY - 9);
    ctx.lineTo(land.X + 6, geo.groundY - 9);
    ctx.closePath();
    ctx.fill();

    if (withLabels) {
      pill('H ' + p.maxH.toFixed(1) + ' m', apex.X, apex.Y - 8, color, 'center');
      pill('R ' + p.range.toFixed(1) + ' m', land.X, geo.groundY - 14, color, 'center');
    }

    ctx.restore();
  }

  /* ---------- 5d. Velocity vectors ---------- */

  function arrow(x1, y1, x2, y2, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;

    const head = Math.min(11, len * 0.4);
    const ang = Math.atan2(dy, dx);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - Math.cos(ang - 0.42) * head,
      y2 - Math.sin(ang - 0.42) * head
    );
    ctx.lineTo(
      x2 - Math.cos(ang + 0.42) * head,
      y2 - Math.sin(ang + 0.42) * head
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function paintVectors(p, t, pos, geo) {
    const q = toPx(geo, pos.x, pos.y);
    const vy = p.vy0 - p.g * t;

    // pixels per (m/s), uniformly shrunk if an arrow would be too long
    const k = 1.15;
    const maxLen = Math.min(geo.plotW * 0.42, 160);
    let lx = p.vx * k;
    let ly = vy * k;

    const longest = Math.max(Math.abs(lx), Math.abs(ly), 1);
    if (longest > maxLen) {
      const s = maxLen / longest;
      lx *= s;
      ly *= s;
    }

    const COL_X = '#38bdf8';
    const COL_Y = '#f472b6';

    arrow(q.X, q.Y, q.X + lx, q.Y, COL_X);            // horizontal component
    arrow(q.X, q.Y, q.X, q.Y - ly, COL_Y);            // vertical component

    ctx.save();
    ctx.font = '600 10px ' + MONO;
    ctx.textBaseline = 'middle';

    if (Math.abs(lx) > 22) {
      ctx.fillStyle = COL_X;
      ctx.textAlign = lx > 0 ? 'left' : 'right';
      ctx.fillText('vx ' + p.vx.toFixed(1), q.X + lx + (lx > 0 ? 6 : -6), q.Y + 2);
    }
    if (Math.abs(ly) > 22) {
      ctx.fillStyle = COL_Y;
      ctx.textAlign = 'left';
      ctx.fillText('vy ' + vy.toFixed(1), q.X + 8, q.Y - ly + (ly > 0 ? 10 : -10));
    }
    ctx.restore();
  }

  /* ---------- 5e. Master draw ---------- */

  function draw() {
    if (view.w < 10 || view.h < 10) return;

    ctx.clearRect(0, 0, view.w, view.h);
    paintBackground();

    const geo = makeGeometry(computeBounds());
    paintGrid(geo);

    const shotLive = !!(state.shot && !state.shot.done);
    const last = state.trails.length - 1;

    // Finished trails (newest drawn last so it stays on top)
    state.trails.forEach((trail, i) => {
      const isNewest = i === last;
      paintTrail(trail, geo, { dim: !isNewest });
      if (!isNewest) paintMarkers(trail.p, geo, trail.color, false);
      else if (!state.shot) paintMarkers(trail.p, geo, trail.color, true);
    });

    if (state.shot) {
      const shot = state.shot;

      // Ball path: partial while flying, then the stored trail takes over
      if (shotLive) paintTrail(shot, geo, { upto: shot.t });

      paintMarkers(shot.p, geo, shot.color, true);
      paintBall(posAt(shot.p, shot.t), geo, shot.color, false);

      if (els.vectors.checked) {
        paintVectors(shot.p, shot.t, posAt(shot.p, shot.t), geo);
      }
    } else {
      // Nothing launched yet: show a ghost of what the sliders would do
      const p = physics(readParams());
      paintGhost(p, geo);
      paintBall(posAt(p, 0), geo, '#8fa0bd', true);
    }
  }

  /* ===================================================================
     6. ANIMATION LOOP
     =================================================================== */

  function tick(now) {
    const shot = state.shot;

    if (shot && !shot.done) {
      if (shot.start === null) shot.start = now;
      const wall = (now - shot.start) / 1000;      // real seconds since launch
      shot.t = Math.min(wall * shot.speed, shot.p.tf); // simulation seconds

      renderStats(shot.p, shot.t);

      if (shot.t >= shot.p.tf) finishShot();
    }

    draw();
    requestAnimationFrame(tick);
  }

  /* ===================================================================
     7. EVENT WIRING
     =================================================================== */

  const sliders = [els.angle, els.velocity, els.height];

  // Paint the slider's filled portion (uses the --p CSS variable)
  function syncFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--p', pct.toFixed(2));
  }

  function syncOutputs() {
    const p = readParams();
    els.angleOut.textContent = p.angle + '°';
    els.velocityOut.textContent = p.v + ' m/s';
    els.heightOut.textContent = p.h + ' m';
    // One decimal, but no trailing ".0" (e.g. 9.8, 24.8, 274, 0.62 → 0.6)
    els.gravityOut.textContent = Number(p.g.toFixed(1)) + ' m/s²';
  }

  function syncAll() {
    sliders.forEach(syncFill);
    syncOutputs();
  }

  sliders.forEach((input) => {
    input.addEventListener('input', () => {
      syncFill(input);
      syncOutputs();
    });
  });

  els.gravity.addEventListener('change', syncOutputs);

  els.launch.addEventListener('click', launch);

  els.clear.addEventListener('click', () => {
    clearTrails();
    draw();
  });

  els.reset.addEventListener('click', () => {
    resetAll();
    draw();
  });

  els.vectors.addEventListener('change', draw);

  // Resize handling
  if (window.ResizeObserver) {
    new ResizeObserver(() => resize()).observe(canvas.parentElement);
  } else {
    window.addEventListener('resize', resize);
  }
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  /* ---------- Boot ---------- */
  resize();
  syncAll();
  clearStats();
  requestAnimationFrame(tick);
})();
