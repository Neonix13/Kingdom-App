// Deployment inside the bot's own zone: front line toward the presumed enemy, shooters behind,
// cavalry on the flanks, general at the rear.
const { hexDistance } = require('../HexUtils');
const { guessEnemyCenter } = require('./world');

// The general is placed first (mandatory, and zones can be smaller than the army), at the rear
function order(u) {
  if (u.isGeneral) return -1;
  return role(u);
}

function role(u) {
  if (u.isGeneral) return 3;
  if (u.category === 'Tireurs') return 1;
  if (u.category === 'Chevaux' || u.category === 'Chars') return 2;
  return 0;
}

// Next { unitId, q, r } to place, or null when every unit is on the board
function nextPlacement(room, player, rng) {
  const zone = player.startingZone;
  if (!zone || !zone.tiles || !zone.tiles.length) return null;
  const todo = player.units.filter(u => u.q === null).sort((a, b) => order(a) - order(b));
  if (!todo.length) return null;
  const used = new Set(player.units.filter(u => u.q !== null).map(u => `${u.q},${u.r}`));
  const free = zone.tiles.filter(t => !used.has(`${t.q},${t.r}`) && room.hexMap[`${t.q},${t.r}`] && room.hexMap[`${t.q},${t.r}`].terrain !== 'river');
  if (!free.length) return null;
  const foe = guessEnemyCenter(room, player);
  const zq = zone.q, zr = zone.r;
  const ax = foe.q - zq, ar = foe.r - zr;
  const len = Math.sqrt(ax * ax + ar * ar) || 1;
  const lateral = (t) => Math.abs((t.q - zq) * ar - (t.r - zr) * ax) / len;
  const front = (t) => hexDistance(t.q, t.r, foe.q, foe.r);
  const jitter = () => rng() * 0.5;
  const u = todo[0];
  let score;
  switch (role(u)) {
    case 0: score = (t) => front(t) + lateral(t) * 0.3 + jitter(); break;            // front, centre
    case 1: score = (t) => Math.abs(front(t) - (Math.min(...free.map(front)) + 2)) + lateral(t) * 0.2 + jitter(); break; // second line
    case 2: score = (t) => front(t) * 0.5 - lateral(t) + jitter(); break;            // flanks
    default: score = (t) => -front(t) + lateral(t) * 0.3; break;                     // rear
  }
  const best = free.slice().sort((a, b) => score(a) - score(b))[0];
  return { unitId: u.id, q: best.q, r: best.r };
}

module.exports = { nextPlacement };
