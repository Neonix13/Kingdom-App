const { createServer } = require('./server/createServer');

if (require.main === module) {
  const instance = createServer({ livereload: true });
  const PORT = process.env.PORT || 3000;
  instance.listen(PORT).then(() => console.log(`Serveur démarré sur http://localhost:${PORT}`));
}

module.exports = { createServer };
