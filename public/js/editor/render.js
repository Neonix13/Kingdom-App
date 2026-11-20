// Top-down 2D renderer: batched Path2D per style, rebuilt only when the data changes
import { center, parseKey, parseEdge, edgeEnds, addHexPath, DIRS, key, SQRT3, isAdjacent } from './hex.js';
import { TERRAIN_BY_ID, SEGMENTS, ZONE_COLORS, KEY_RE } from './constants.js';

const HEIGHT_STOPS = [
  [-2, [20, 40, 110]], [0, [40, 90, 125]], [1, [60, 120, 60]], [2, [130, 170, 60]], [3, [215, 200, 80]],
  [4, [225, 150, 60]], [5, [190, 90, 50]], [6, [150, 65, 70]], [8, [130, 120, 135]], [12, [205, 205, 205]], [20, [255, 255, 255]],
];

function heightRgb(h) {
  if (h <= HEIGHT_STOPS[0][0]) return HEIGHT_STOPS[0][1];
  for (let i = 1; i < HEIGHT_STOPS.length; i++) {
    const [h1, c1] = HEIGHT_STOPS[i];
    if (h <= h1) {
      const [h0, c0] = HEIGHT_STOPS[i - 1];
      const t = (h - h0) / (h1 - h0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * t));
    }
  }
  return HEIGHT_STOPS[HEIGHT_STOPS.length - 1][1];
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const styleCache = new Map();
function hexStyle(mode, terrain, h) {
  const k = mode + terrain + '|' + h;
  let s = styleCache.get(k);
  if (s) return s;
  if (mode === 'height') {
    const c = heightRgb(h);
    s = `rgb(${c[0]},${c[1]},${c[2]})`;
  } else {
    const base = hexToRgb((TERRAIN_BY_ID[terrain] || { color: '#ff00ff' }).color);
    const f = Math.max(0.55, Math.min(1.45, 0.8 + 0.09 * (h - 1)));
    s = `rgb(${base.map((v) => Math.min(255, Math.round(v * f))).join(',')})`;
  }
  styleCache.set(k, s);
  return s;
}

// SVG path strings are parsed natively in one call: far faster than thousands of Path2D method calls
const H3 = Math.sqrt(3) / 2;
const hexD = (s) => `l${-0.5 * s},${H3 * s}l${-s},0l${-0.5 * s},${-H3 * s}l${0.5 * s},${-H3 * s}l${s},0z`;
const HEX_D1 = hexD(1);
const hexStr = (x, y, s = 1, tail = s === 1 ? HEX_D1 : hexD(s)) => `M${x + s},${y}${tail}`;
const lineStr = (e) => `M${e[0]},${e[1]}L${e[2]},${e[3]}`;

export class Renderer {
  constructor(canvas, model, view) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.model = model;
    this.view = view;
    this.cam = { zoom: 12, x: 0, y: 0 };
    this.dpr = window.devicePixelRatio || 1;
    this.dirty = { hexes: true, segs: true, fields: true, zones: true };
    this.overlays = [];
    this.bg = { url: null, img: null, small: null, smallScale: 1, loading: false, error: null };
    this.highlight = null;
    this.frameRequested = false;
    this.lastDrawMs = 0;
    this.resize();
    model.on((ch) => this.onModel(ch));
  }

  onModel(ch) {
    if (ch.all) { for (const k in this.dirty) this.dirty[k] = true; this.syncBackground(); }
    if (ch.layers) {
      for (const l of ch.layers) {
        if (l === 'height') { this.dirty.hexes = true; this.dirty.zones = true; }
        else if (l === 'terrain') this.dirty.hexes = true;
        else if (l === 'seg') this.dirty.segs = true;
        else if (l === 'field') this.dirty.fields = true;
        else if (l === 'rampart' || l === 'props') this.request();
        else if (l === 'zone' || l === 'zoneCount') this.dirty.zones = true;
        else if (l === 'meta') this.syncBackground();
      }
    }
    this.request();
  }

  invalidateAll() { for (const k in this.dirty) this.dirty[k] = true; this.request(); }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.request();
  }

  request() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => { this.frameRequested = false; this.draw(); });
  }

  // ---------- camera ----------
  toWorld(sx, sy) { return { x: (sx - this.cam.x) / this.cam.zoom, y: (sy - this.cam.y) / this.cam.zoom }; }
  toScreen(wx, wy) { return { x: wx * this.cam.zoom + this.cam.x, y: wy * this.cam.zoom + this.cam.y }; }

  zoomAt(sx, sy, factor) {
    const z = Math.max(0.6, Math.min(160, this.cam.zoom * factor));
    const w = this.toWorld(sx, sy);
    this.cam.zoom = z;
    this.cam.x = sx - w.x * z;
    this.cam.y = sy - w.y * z;
    this.request();
  }

  pan(dx, dy) { this.cam.x += dx; this.cam.y += dy; this.request(); }

  fit(b) {
    b = b || this.model.bounds() || { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    const z = Math.min(this.w / (b.maxX - b.minX), this.h / (b.maxY - b.minY)) * 0.95;
    this.cam.zoom = Math.max(0.6, Math.min(160, z));
    this.cam.x = this.w / 2 - (b.minX + b.maxX) / 2 * this.cam.zoom;
    this.cam.y = this.h / 2 - (b.minY + b.maxY) / 2 * this.cam.zoom;
    this.request();
  }

  focus(wx, wy, zoom) {
    if (zoom) this.cam.zoom = zoom;
    this.cam.x = this.w / 2 - wx * this.cam.zoom;
    this.cam.y = this.h / 2 - wy * this.cam.zoom;
    this.request();
  }

  // ---------- background ----------
  syncBackground() {
    const bg = this.model.meta.background;
    const url = bg && bg.image ? bg.image : null;
    if (url === this.bg.url) return;
    this.bg = { url, img: null, small: null, smallScale: 1, tiles: null, loading: !!url, error: null };
    if (!url) { this.request(); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      if (this.bg.url !== url) return;
      this.bg.img = img;
      this.bg.loading = false;
      if (this.onBackgroundLoaded) this.onBackgroundLoaded(img);
      this.request();
      try {
        const maxSide = 2048;
        const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        if (s < 1 && window.createImageBitmap) {
          const small = await createImageBitmap(img, { resizeWidth: Math.round(img.naturalWidth * s), resizeHeight: Math.round(img.naturalHeight * s), resizeQuality: 'high' });
          if (this.bg.url !== url) return;
          this.bg.small = small; this.bg.smallScale = s; this.request();
          // full resolution as 2048px tiles, decoded off the main thread and uploaded one at a time
          const T = 2048, tiles = [];
          for (let ty = 0; ty < img.naturalHeight; ty += T) for (let tx = 0; tx < img.naturalWidth; tx += T) {
            tiles.push({ x: tx, y: ty, w: Math.min(T, img.naturalWidth - tx), h: Math.min(T, img.naturalHeight - ty), bmp: null });
          }
          this.bg.tiles = tiles;
          for (const t of tiles) {
            t.bmp = await createImageBitmap(img, t.x, t.y, t.w, t.h);
            if (this.bg.url !== url) return;
            this.request();
          }
        }
      } catch (e) { /* full-res fallback */ }
    };
    img.onerror = () => { if (this.bg.url === url) { this.bg.loading = false; this.bg.error = 'Image introuvable'; this.request(); if (this.onBackgroundLoaded) this.onBackgroundLoaded(null); } };
    img.src = url;
  }

  drawBackground(ctx, vis) {
    const bg = this.model.meta.background;
    const { img } = this.bg;
    if (!bg || !img || !this.view.bgVisible || !(bg.hexSize > 0)) return;
    const hs = bg.hexSize, ox = bg.origX || 0, oy = bg.origY || 0;
    const W = img.naturalWidth, H = img.naturalHeight;
    let sx0 = Math.max(0, vis.minX * hs + ox), sy0 = Math.max(0, vis.minY * hs + oy);
    let sx1 = Math.min(W, vis.maxX * hs + ox), sy1 = Math.min(H, vis.maxY * hs + oy);
    if (sx1 <= sx0 || sy1 <= sy0) return;
    const screenPerImgPx = this.cam.zoom * this.dpr / hs;
    ctx.globalAlpha = this.view.bgOpacity;
    ctx.imageSmoothingEnabled = true;
    const small = this.bg.small, sc = this.bg.smallScale;
    const drawPart = (src, scale, x0, y0, x1, y1, offX = 0, offY = 0) => ctx.drawImage(src,
      (x0 - offX) * scale, (y0 - offY) * scale, (x1 - x0) * scale, (y1 - y0) * scale,
      (x0 - ox) / hs, (y0 - oy) / hs, (x1 - x0) / hs, (y1 - y0) / hs);
    if (small && screenPerImgPx <= sc * 1.25) drawPart(small, sc, sx0, sy0, sx1, sy1);
    else if (this.bg.tiles) {
      for (const t of this.bg.tiles) {
        const x0 = Math.max(sx0, t.x), y0 = Math.max(sy0, t.y), x1 = Math.min(sx1, t.x + t.w), y1 = Math.min(sy1, t.y + t.h);
        if (x1 <= x0 || y1 <= y0) continue;
        if (t.bmp) drawPart(t.bmp, 1, x0, y0, x1, y1, t.x, t.y);
        else drawPart(small, sc, x0, y0, x1, y1);
      }
    } else if (small) drawPart(small, sc, sx0, sy0, sx1, sy1);
    else drawPart(img, 1, sx0, sy0, sx1, sy1);
    ctx.globalAlpha = 1;
  }

  // ---------- caches ----------
  rebuildHexes() {
    const m = this.model;
    const mode = this.view.display;
    const groups = new Map();
    const grid = [];
    const contours = [[], [], []];
    for (const [k, h] of m.height) {
      const i = k.indexOf(',');
      const q = +k.slice(0, i), r = +k.slice(i + 1);
      if (!Number.isInteger(q) || !Number.isInteger(r)) continue;
      const x = 1.5 * q, y = SQRT3 * (q / 2 + r);
      const hs = hexStr(x, y);
      grid.push(hs);
      if (mode !== 'none') {
        const st = hexStyle(mode, m.terrainAt(k), h);
        let p = groups.get(st);
        if (!p) groups.set(st, (p = []));
        p.push(hs);
      }
      for (let d = 0; d < 3; d++) {
        const nh = m.height.get((q + DIRS[d][0]) + ',' + (r + DIRS[d][1]));
        if (nh === undefined || nh === h) continue;
        contours[Math.min(2, Math.abs(nh - h) - 1)].push(lineStr(edgeEnds(q, r, q + DIRS[d][0], r + DIRS[d][1])));
      }
    }
    this.hexGroups = new Map([...groups].map(([st, arr]) => [st, new Path2D(arr.join(''))]));
    this.gridPath = new Path2D(grid.join(''));
    this.contours = contours.map((a) => new Path2D(a.join('')));
    this.dirty.hexes = false;
  }

  rebuildSegs() {
    const groups = new Map();
    for (const [k, t] of this.model.segments) {
      const e = parseEdge(k);
      if (!e || !isAdjacent(e.q1, e.r1, e.q2, e.r2)) continue;
      let p = groups.get(t);
      if (!p) groups.set(t, (p = []));
      p.push(lineStr(edgeEnds(e.q1, e.r1, e.q2, e.r2)));
    }
    this.segPaths = new Map([...groups].map(([t, a]) => [t, new Path2D(a.join(''))]));
    this.dirty.segs = false;
  }

  rebuildFields() {
    const tail = hexD(0.86);
    const a = [];
    for (const k of this.model.fields) {
      if (!KEY_RE.test(k)) continue;
      const c = center(...parseKey(k));
      a.push(hexStr(c.x, c.y, 0.86, tail));
    }
    this.fieldPath = new Path2D(a.join(''));
    this.dirty.fields = false;
  }

  rebuildZones() {
    const m = this.model;
    const n = Math.max(m.zoneCount, 1);
    const fills = Array.from({ length: n }, () => []), borders = Array.from({ length: n }, () => []);
    for (const [k, z] of m.zoneOf) {
      if (!fills[z] || !KEY_RE.test(k)) continue;
      const [q, r] = parseKey(k);
      const c = center(q, r);
      fills[z].push(hexStr(c.x, c.y));
      for (const [dq, dr] of DIRS) {
        if (m.zoneOf.get(key(q + dq, r + dr)) === z) continue;
        borders[z].push(lineStr(edgeEnds(q, r, q + dq, r + dr)));
      }
    }
    this.zoneFills = fills.map((a) => new Path2D(a.join('')));
    this.zoneBorders = borders.map((a) => new Path2D(a.join('')));
    this.dirty.zones = false;
  }

  // ---------- draw ----------
  visibleRect() {
    const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
    return { minX: a.x - 1, minY: a.y - 1, maxX: b.x + 1, maxY: b.y + 1 };
  }

  setWorld(ctx) {
    const z = this.cam.zoom * this.dpr;
    ctx.setTransform(z, 0, 0, z, this.cam.x * this.dpr, this.cam.y * this.dpr);
  }

  draw() {
    const t0 = performance.now();
    const ctx = this.ctx, v = this.view;
    if (this.dirty.hexes) this.rebuildHexes();
    if (this.dirty.segs) this.rebuildSegs();
    if (this.dirty.fields) this.rebuildFields();
    if (this.dirty.zones) this.rebuildZones();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#120b05';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const vis = this.visibleRect();
    const px = 1 / this.cam.zoom;
    this.setWorld(ctx);

    this.drawBackground(ctx, vis);

    if (v.display !== 'none') {
      ctx.globalAlpha = v.fillAlpha;
      for (const [st, p] of this.hexGroups) { ctx.fillStyle = st; ctx.fill(p); }
      ctx.globalAlpha = 1;
    }
    if (v.display === 'height' || v.contours) {
      ctx.strokeStyle = 'rgba(20,10,0,0.75)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { ctx.lineWidth = Math.max(px, 0.05 * (i + 1)); ctx.stroke(this.contours[i]); }
    }
    if (v.showGrid && this.cam.zoom > 5) {
      ctx.strokeStyle = v.display === 'none' ? 'rgba(120,255,120,0.55)' : 'rgba(0,0,0,0.28)';
      ctx.lineWidth = px;
      ctx.stroke(this.gridPath);
    }
    if (v.showFields) {
      ctx.fillStyle = 'rgba(240,200,70,0.55)';
      ctx.fill(this.fieldPath);
      if (this.cam.zoom > 10) { ctx.strokeStyle = 'rgba(120,90,10,0.8)'; ctx.lineWidth = px; ctx.stroke(this.fieldPath); }
    }
    if (v.showFields && window.KBMapProps && (this.model.ramparts.size || this.model.props.length)) {
      KBMapProps.drawDecor2D(ctx, { ramparts: [...this.model.ramparts], props: this.model.props }, center, 1, { lineWidth: Math.max(1.5 * px, 0.05) });
      const sel = this.view.selectedProp;
      if (sel != null && this.model.props[sel]) {
        const c = center(this.model.props[sel].q, this.model.props[sel].r);
        const p = new Path2D(); addHexPath(p, c.x, c.y, 0.9);
        ctx.strokeStyle = '#ff3030'; ctx.lineWidth = Math.max(3 * px, 0.1); ctx.stroke(p);
      }
    }
    if (v.showZones) {
      for (let i = 0; i < this.zoneFills.length; i++) {
        const c = ZONE_COLORS[i % ZONE_COLORS.length];
        ctx.globalAlpha = 0.35; ctx.fillStyle = c; ctx.fill(this.zoneFills[i]);
        ctx.globalAlpha = 1; ctx.strokeStyle = c; ctx.lineWidth = Math.max(2 * px, 0.08); ctx.stroke(this.zoneBorders[i]);
      }
    }
    if (v.showSegments) {
      ctx.lineCap = 'round';
      const lw = Math.max(2.5 * px, 0.16);
      for (const s of SEGMENTS) {
        const p = this.segPaths.get(s.id);
        if (!p) continue;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = lw + 2 * px; ctx.stroke(p);
        ctx.strokeStyle = s.color; ctx.lineWidth = lw; ctx.stroke(p);
      }
      for (const [t, p] of this.segPaths) {
        if (SEGMENTS.some((s) => s.id === t)) continue;
        ctx.strokeStyle = '#ff00ff'; ctx.lineWidth = lw; ctx.stroke(p);
      }
    }
    if (v.showObjectives) this.drawObjectives(ctx, px);
    if (this.highlight) this.drawHighlight(ctx, px);
    for (const fn of this.overlays) fn(ctx, px, this);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (v.showLabels && this.cam.zoom >= 26) this.drawLabels(ctx, vis);
    if (this.bg.loading && v.bgVisible) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(8, this.h - 30, 190, 22);
      ctx.fillStyle = '#e8d5a0'; ctx.font = '12px sans-serif'; ctx.fillText('Chargement du fond…', 14, this.h - 15);
    }
    this.lastDrawMs = performance.now() - t0;
  }

  drawObjectives(ctx, px) {
    const sel = this.view.selectedObjective;
    this.model.objectives.forEach((o, i) => {
      const c = center(o.q, o.r);
      const R = 0.55;
      ctx.beginPath();
      for (let j = 0; j < 10; j++) {
        const a = -Math.PI / 2 + j * Math.PI / 5;
        const rr = j % 2 ? R * 0.45 : R;
        ctx.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = i === sel ? '#fff3b0' : '#f0c020';
      ctx.fill();
      ctx.strokeStyle = i === sel ? '#ff3030' : '#3a2000';
      ctx.lineWidth = Math.max(px * (i === sel ? 3 : 1.5), 0.04);
      ctx.stroke();
      if (this.cam.zoom > 9) {
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const s = this.toScreen(c.x, c.y + 0.7);
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        const label = `${o.name || o.type || '?'} (${o.points ?? 0})`;
        ctx.strokeText(label, s.x, s.y + 10);
        ctx.fillStyle = '#ffe9a0'; ctx.fillText(label, s.x, s.y + 10);
        ctx.restore();
      }
    });
  }

  drawHighlight(ctx, px) {
    const hl = this.highlight;
    ctx.strokeStyle = '#ff2fd0';
    ctx.lineWidth = Math.max(3 * px, 0.12);
    if (hl.hex) {
      const [q, r] = parseKey(hl.hex);
      const c = center(q, r);
      const p = new Path2D(); addHexPath(p, c.x, c.y, 1.05);
      ctx.stroke(p);
      ctx.beginPath(); ctx.arc(c.x, c.y, 2.2, 0, Math.PI * 2); ctx.stroke();
    }
    if (hl.edge) {
      const e = parseEdge(hl.edge);
      if (e && isAdjacent(e.q1, e.r1, e.q2, e.r2)) {
        const ends = edgeEnds(e.q1, e.r1, e.q2, e.r2);
        ctx.lineWidth = Math.max(5 * px, 0.25);
        ctx.beginPath(); ctx.moveTo(ends[0], ends[1]); ctx.lineTo(ends[2], ends[3]); ctx.stroke();
        ctx.lineWidth = Math.max(3 * px, 0.12);
        ctx.beginPath(); ctx.arc((ends[0] + ends[2]) / 2, (ends[1] + ends[3]) / 2, 2.2, 0, Math.PI * 2); ctx.stroke();
      } else if (e) {
        const c = center(e.q1, e.r1);
        ctx.beginPath(); ctx.arc(c.x, c.y, 2.2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  drawLabels(ctx, vis) {
    const m = this.model;
    const showCoords = this.cam.zoom >= 48;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.min(14, this.cam.zoom * 0.32)}px sans-serif`;
    const small = `${Math.min(11, this.cam.zoom * 0.22)}px sans-serif`;
    for (const [k, h] of m.height) {
      const i = k.indexOf(',');
      const q = +k.slice(0, i), r = +k.slice(i + 1);
      const x = 1.5 * q, y = SQRT3 * (q / 2 + r);
      if (x < vis.minX || x > vis.maxX || y < vis.minY || y > vis.maxY) continue;
      const s = this.toScreen(x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(String(h), s.x + 1, s.y + 1);
      ctx.fillStyle = '#fff8e0';
      ctx.fillText(String(h), s.x, s.y);
      if (showCoords) {
        ctx.font = small;
        ctx.fillStyle = 'rgba(255,248,224,0.75)';
        ctx.fillText(k, s.x, s.y + this.cam.zoom * 0.45);
        ctx.font = `bold ${Math.min(14, this.cam.zoom * 0.32)}px sans-serif`;
      }
    }
  }
}
