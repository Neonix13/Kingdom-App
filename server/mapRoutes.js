const maps = require('../game/maps');
const { requireAdmin } = require('./admin');

function mountMapRoutes(app) {
  app.get('/api/maps', (req, res) => res.json(maps.listMaps()));
  app.get('/api/maps/:id', (req, res) => {
    try {
      res.json(maps.getMap(req.params.id));
    } catch (e) {
      res.status(404).json({ error: 'Carte introuvable.' });
    }
  });
  app.put('/api/maps/:id', requireAdmin, (req, res) => {
    try {
      const saved = maps.saveMap({ ...req.body, id: req.params.id });
      res.json(saved);
    } catch (e) {
      res.status(400).json({ error: e.message, details: e.validation || null });
    }
  });
  app.delete('/api/maps/:id', requireAdmin, (req, res) => {
    try {
      maps.deleteMap(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}

module.exports = { mountMapRoutes };
