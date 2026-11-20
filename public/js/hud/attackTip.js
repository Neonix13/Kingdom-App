// Attack tooltip content shared by the 3D view (gameUI.js) and the 2D view (battleHud.js).
export function attackTipHtml(att, tgt, types) {
  const ranged = (att.range || 1) > 1;
  const row = (label, a, b) => `<span>${a ?? '–'}</span><span>${label}</span><span>${b ?? '–'}</span>`;
  const R = window.KBRules;
  const abA = R && R.ability(att, types), abT = R && R.ability(tgt, types);
  const notes = [];
  const cav = R ? R.RULES.abilities.antiCavalryCategories : [];
  if (!ranged && abA && abA.type === 'anti_cavalry' && cav.includes(tgt.category)) notes.push(`Lanciers : +${abA.value} attaque`);
  if (!ranged && abT && abT.type === 'anti_cavalry' && cav.includes(att.category)) notes.push(`Lanciers en face : +${abT.value} défense`);
  if (!ranged && abA && abA.type === 'charge_bonus' && att.stance === 'charge') notes.push(`Charge lourde : +${abA.value} puissance`);
  if (abA && abA.type === 'ambush') notes.push('Assassin : avantage si premier coup du jour');
  if (ranged && abT && abT.type === 'defend_ranged') notes.push('Phalange : peut lever les boucliers');
  if (ranged && !(abT && abT.type === 'defend_ranged')) notes.push('Tir : pas de jet de défense');
  if (!ranged && abA && abA.type === 'trample') notes.push('Char : frappe aussi l\'unité derrière');
  return `<b>${ranged ? 'Tir' : 'Attaque'}</b> : ${att.name} → ${tgt.name}<div class="vs">
      ${row('Attaque / Défense', att.attack ?? att.force, tgt.defense ?? '–')}
      ${row('Puissance / Armure', att.power, tgt.armor)}
      ${row('Vitalité', att.vitality, tgt.vitality)}
      ${row('Moral', att.morale ?? '–', tgt.morale ?? '–')}</div>${notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
}
