// Long-range movement cost to a goal hex over the whole map (Dijkstra on the shared movement rules, units ignored).
// Lets bots walk around cliffs, walls and rivers instead of greedily reducing the hex distance.
const rules = require('../rules');
const { hexKey, segmentEdgeKey } = require('../HexUtils');

const CACHE_MAX = 64;
const cache = new Map();

function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

// Map hexKey -> cost of walking from that hex to the goal
function distanceField(room, goalQ, goalR, mounted) {
  const key = `${room.roomCode}|${room.mapId}|${goalQ},${goalR}|${mounted ? 1 : 0}`;
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const table = room.moveTable();
  const dist = new Map();
  const start = hexKey(goalQ, goalR);
  if (room.hexMap[start]) {
    dist.set(start, 0);
    const heap = [[0, goalQ, goalR]];
    while (heap.length) {
      const [d, q, r] = heapPop(heap);
      const k = hexKey(q, r);
      if (d > dist.get(k)) continue;
      const here = room.hexMap[k];
      for (const [dq, dr] of rules.DIRS) {
        const nq = q + dq, nr = r + dr;
        const nk = hexKey(nq, nr);
        const there = room.hexMap[nk];
        if (!there) continue;
        // cost of the step neighbour -> current (walking toward the goal)
        const c = rules.stepCost(table, there, here, room.segmentData[segmentEdgeKey(nq, nr, q, r)] || null, mounted);
        if (!isFinite(c)) continue;
        const nd = d + c;
        if (!dist.has(nk) || nd < dist.get(nk) - 1e-9) {
          dist.set(nk, nd);
          heapPush(heap, [nd, nq, nr]);
        }
      }
    }
  }
  cache.set(key, dist);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return dist;
}

// Goal actually reachable from `from`: the goal itself, or the hex of from's area closest to it
// (a goal on the other side of cliffs or walls would otherwise freeze the unit)
const substitutes = new Map();
function reachableGoal(room, goal, from, mounted) {
  const field = distanceField(room, goal.q, goal.r, mounted);
  if (field.has(hexKey(from.q, from.r))) return { goal, field };
  const key = `${room.roomCode}|${goal.q},${goal.r}|${from.q},${from.r}|${mounted ? 1 : 0}`;
  let sub = substitutes.get(key);
  if (!sub) {
    const area = distanceField(room, from.q, from.r, mounted);
    let best = null, bd = Infinity;
    for (const k of area.keys()) {
      const [q, r] = k.split(',').map(Number);
      const d = Math.max(Math.abs(q - goal.q), Math.abs(r - goal.r), Math.abs(q + r - goal.q - goal.r));
      if (d < bd) { bd = d; best = { q, r }; }
    }
    sub = best || from;
    substitutes.set(key, sub);
    if (substitutes.size > CACHE_MAX * 4) substitutes.delete(substitutes.keys().next().value);
  }
  return { goal: sub, field: distanceField(room, sub.q, sub.r, mounted) };
}

module.exports = { distanceField, reachableGoal };
