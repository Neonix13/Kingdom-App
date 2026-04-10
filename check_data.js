const h = require("./public/data/height.json");
const t = require("./public/data/terrain.json");
console.log("height entries:", Object.keys(h).length);
console.log("terrain entries:", Object.keys(t).length);
console.log("terrain types:", [...new Set(Object.values(t))].sort());

let missing = 0;
for (const k of Object.keys(t)) {
  if (h[k] === undefined) missing++;
}
console.log("terrain hexes without height:", missing);

// Show height distribution per terrain
const byTerrain = {};
for (const [k, v] of Object.entries(h)) {
  const ter = t[k] || "unknown";
  if (byTerrain[ter] === undefined) byTerrain[ter] = {};
  byTerrain[ter][v] = (byTerrain[ter][v] || 0) + 1;
}
for (const [ter, dist] of Object.entries(byTerrain)) {
  console.log(`  ${ter}:`, JSON.stringify(dist));
}
