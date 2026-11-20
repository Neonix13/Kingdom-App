// Map editor helpers: background image upload and listing (admin only)
const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireAdmin } = require('./admin');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BG_DIR = path.join(PUBLIC_DIR, 'assets', 'maps');
const EXT_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

function slug(name) {
  return String(name || 'fond').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'fond';
}

function listBackgrounds() {
  const out = [];
  const legacy = path.join(PUBLIC_DIR, 'assets', 'img', 'map.webp');
  if (fs.existsSync(legacy)) out.push({ url: '/assets/img/map.webp', size: fs.statSync(legacy).size });
  if (fs.existsSync(BG_DIR)) {
    for (const f of fs.readdirSync(BG_DIR)) {
      const ext = f.split('.').pop().toLowerCase();
      if (!EXTS.has(ext)) continue;
      out.push({ url: `/assets/maps/${f}`, size: fs.statSync(path.join(BG_DIR, f)).size });
    }
  }
  return out;
}

function mountEditorRoutes(app) {
  app.get('/api/editor/backgrounds', requireAdmin, (req, res) => res.json(listBackgrounds()));

  app.post('/api/editor/background', requireAdmin,
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '60mb' }),
    (req, res) => {
      const ext = EXT_BY_TYPE[(req.headers['content-type'] || '').split(';')[0].trim()];
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'Image PNG, JPEG ou WebP attendue.' });
      }
      fs.mkdirSync(BG_DIR, { recursive: true });
      const base = slug(req.query.name);
      let file = `${base}.${ext}`;
      for (let i = 2; fs.existsSync(path.join(BG_DIR, file)); i++) file = `${base}-${i}.${ext}`;
      fs.writeFileSync(path.join(BG_DIR, file), req.body);
      res.json({ url: `/assets/maps/${file}` });
    });
}

module.exports = { mountEditorRoutes };
