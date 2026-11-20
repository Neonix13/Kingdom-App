// Deterministic pseudo-random numbers: the same (room, turn, unit...) always gives the same draw, so a bot that
// re-plans after every action keeps its decisions (mistakes included) stable within a turn.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rngFor(...parts) {
  let a = hash(parts.join('|'));
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list.length ? list[Math.floor(rng() * list.length)] : undefined;
}

module.exports = { rngFor, pick, hash };
