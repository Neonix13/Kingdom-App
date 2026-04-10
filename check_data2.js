const h = require("./public/data/height.json");
const t = require("./public/data/terrain.json");

const MAP_HEX_SIZE = 101.5;
const MAP_ORIG_X = 137;
const MAP_ORIG_Y = 190;
const MAP_IMG_W = 8800;
const MAP_IMG_H = 7200;
const S = Math.sqrt(3);

const qMin = Math.floor(-MAP_ORIG_X / (MAP_HEX_SIZE * 1.5)) - 1;
const qMax = Math.ceil((MAP_IMG_W - MAP_ORIG_X) / (MAP_HEX_SIZE * 1.5)) + 1;

let total = 0, withHeight = 0, withoutHeight = 0;
for (let q = qMin; q <= qMax; q++) {
  const rMin = Math.floor((-MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) - 1;
  const rMax = Math.ceil((MAP_IMG_H - MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) + 1;
  for (let r = rMin; r <= rMax; r++) {
    const imgX = MAP_HEX_SIZE * 1.5 * q + MAP_ORIG_X;
    const imgY = MAP_HEX_SIZE * (S / 2 * q + S * r) + MAP_ORIG_Y;
    if (imgX < 0 || imgX > MAP_IMG_W || imgY < 0 || imgY > MAP_IMG_H) continue;
    const key = `${q},${r}`;
    total++;
    if (h[key] !== undefined) withHeight++;
    else withoutHeight++;
  }
}
console.log("total hexes in map bounds:", total);
console.log("with height data:", withHeight);
console.log("without height (will be 0):", withoutHeight);
