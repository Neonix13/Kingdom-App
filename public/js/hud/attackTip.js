// Attack tooltip content shared by the 3D view (gameUI.js) and the 2D view (battleHud.js).
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Direction (0-5) from hex 1 toward hex 2, same rule as HexUtils.hexFacing
function facingToward(q1, r1, q2, r2) {
  const dq = q2 - q1, dr = r2 - r1;
  if (!dq && !dr) return 5;
  const px = 1.5 * dq, py = Math.sqrt(3) * dr + Math.sqrt(3) / 2 * dq;
  let best = 5, bestDot = -Infinity;
  DIRS.forEach(([a, b], i) => {
    const dot = px * (1.5 * a) + py * (Math.sqrt(3) * b + Math.sqrt(3) / 2 * a);
    if (dot > bestDot) { bestDot = dot; best = i; }
  });
  return best;
}

// Angle of attack on tgt from (fromQ, fromR), as GameRoom._resolveCombat computes it: { mod, name } | null
export function attackAngle(tgt, fromQ, fromR) {
  const R = window.KBRules;
  if (!R || !R.RULES.combat || !R.RULES.combat.angleMods || tgt.isGeneral || tgt.facing == null || fromQ == null) return null;
  const dir = facingToward(tgt.q, tgt.r, fromQ, fromR);
  const offset = (dir - tgt.facing + 6) % 6;
  const table = R.RULES.combat.angleMods[tgt.stance] || R.RULES.combat.angleMods.combat;
  const mod = table[offset] || 0;
  return mod ? { mod, name: mod >= 4 ? 'de dos' : 'de flanc' } : null;
}

export function attackTipHtml(att, tgt, types, from = null) {
  const ranged = (att.range || 1) > 1;
  const row = (label, a, b) => `<span>${a ?? '–'}</span><span>${label}</span><span>${b ?? '–'}</span>`;
  const R = window.KBRules;
  const abA = R && R.ability(att, types), abT = R && R.ability(tgt, types);
  const notes = [];
  const cav = R ? R.RULES.abilities.antiCavalryCategories : [];
  const angle = attackAngle(tgt, from ? from.q : att.q, from ? from.r : att.r);
  if (angle) notes.push(`Attaque ${angle.name} : +${angle.mod} (attaque, puissance, intimidation ; armure adverse −${angle.mod})`);
  if (abA && abA.type === 'anti_cavalry' && cav.includes(tgt.category)) notes.push(`Lanciers : +${abA.value} puissance`);
  if (!ranged && abT && abT.type === 'anti_cavalry' && cav.includes(att.category)) notes.push(`Lanciers en face : +${abT.value} puissance en riposte`);
  if (ranged && abT && abT.type === 'anti_cavalry') notes.push(`Lanciers : +${R.RULES.abilities.anti_cavalry.rangedArmor} armure contre les tirs`);
  if (!ranged && abA && abA.type === 'charge_bonus') notes.push(`Cavalier lourd : ${abA.value} % du moral infligé touche aussi les voisins de la cible`);
  if (!ranged && abA && abA.type === 'execute_low_hp') notes.push(`Soldats : exécute sous ${abA.value} % de vitalité`);
  if (abA && abA.type === 'speed_free') notes.push(`Cavalier léger : l'attaque coûte ${R.RULES.abilities.speed_free.attackCost} de vitesse, il peut encore bouger`);
  if (ranged && abT && abT.type === 'defend_ranged') notes.push(`Phalange : +${abT.value} armure contre les tirs`);
  if (ranged) notes.push('Tir : pas de jet de défense');
  const dice = (u) => (u.isGeneral ? 'd20' : `${Math.max(1, Math.floor((u.vitality || 0) / ((R && R.RULES.combat.diceDivisor) || 5)))} dés`);
  return `<b>${ranged ? 'Tir' : 'Attaque'}</b> : ${att.name} → ${tgt.name}<div class="vs">
      ${row('Attaque / Défense', att.attack ?? att.force, tgt.defense ?? tgt.force ?? '–')}
      ${row('Dés', dice(att), dice(tgt))}
      ${row('Puissance / Armure', att.power, tgt.armor)}
      ${row('Vitalité', att.vitality, tgt.vitality)}
      ${row('Moral', att.morale ?? '–', tgt.morale ?? '–')}</div>${notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
}
