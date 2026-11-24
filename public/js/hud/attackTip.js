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

// Damage preview computed by the server for this exact configuration (cached per state; filled in when it arrives)
const previews = new Map();
function plannedStance(att) {
  const b = window.gameBridge;
  if (!b || !b.simultaneous) return null;
  const o = (b.plannedOrders || []).find((x) => String(x.unitId) === String(att.id));
  return o && o.stance ? o.stance : null;
}
function previewKey(att, tgt, from, stance) {
  const st = window.gameBridge && window.gameBridge.state;
  return [st ? st.turn : 0, att.id, att.vitality, att.morale, stance || att.stance, from ? `${from.q},${from.r}` : `${att.q},${att.r}`,
    tgt.id, tgt.q, tgt.r, tgt.vitality, tgt.morale, tgt.stance, tgt.facing].join('|');
}
const rng = (s) => (s.min === s.max ? `${s.max}` : `${s.min}–${s.max}`);
function previewHtml(p, att, tgt) {
  if (p === false) return '';
  if (!p) return '<span class="dp-wait">Dégâts possibles : calcul…</span>';
  if (p.kind === 'duel') return '<b>Dégâts possibles</b><div>Duel de généraux : D20 + Force à chaque passe.</div>';
  const absorb = p.choice === 'absorb';
  const lines = [`<div class="dp-row"><span>${esc(tgt.name)}</span><span class="dp-v">−${Math.round(p.dmg.avg)} vit.</span><span class="dp-r">(${rng(p.dmg)})</span></div>`];
  if (!tgt.isGeneral) lines.push(`<div class="dp-row"><span></span><span class="dp-v">−${Math.round(p.morale.avg)} moral</span><span class="dp-r">(${rng(p.morale)})</span></div>`);
  if (p.kind === 'melee' && (p.choice === 'counter' || absorb) && p.counter.max > 0) {
    lines.push(`<div class="dp-row dp-counter"><span>Riposte sur ${esc(att.name)}</span><span class="dp-v">−${Math.round(p.counter.avg)} vit.</span><span class="dp-r">(${rng(p.counter)})</span></div>`);
    if (!att.isGeneral) lines.push(`<div class="dp-row dp-counter"><span></span><span class="dp-v">−${Math.round(p.counterMorale.avg)} moral</span><span class="dp-r">(${rng(p.counterMorale)})</span></div>`);
  }
  const odds = [];
  if (p.kill) odds.push(`${p.kill} % de détruire la cible`);
  if (p.rout) odds.push(`${p.rout} % de la mettre en fuite`);
  const sim = window.gameBridge && window.gameBridge.simultaneous;
  const how = absorb ? (p.kind === 'ranged' ? 'si la cible encaisse' : 'la cible encaisse (dégâts ÷ 2)') : p.choice === 'counter' ? (sim ? 'la cible riposte' : 'si la cible riposte ; ÷ 2 si elle encaisse') : 'sans défense de la cible';
  return `<b>Dégâts possibles</b> <small>moyenne (min–max), ${how}</small>${lines.join('')}${odds.length ? `<div class="dp-odds">${odds.join(' · ')}</div>` : ''}`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function damagePreview(att, tgt, from) {
  const b = window.gameBridge;
  if (!b || !window.KBNet || !att.isMine || b.state?.phase !== 'battle' || b.playback) return '';
  const stance = plannedStance(att);
  const key = previewKey(att, tgt, from, stance);
  if (!previews.has(key)) {
    previews.set(key, null);
    if (previews.size > 300) previews.delete(previews.keys().next().value);
    window.KBNet.send('preview_attack', { key, attackerId: att.id, targetId: tgt.id, fromQ: from ? from.q : undefined, fromR: from ? from.r : undefined, stance: stance || undefined });
  }
  return `<div class="dmg-preview" data-key="${esc(key)}">${previewHtml(previews.get(key), att, tgt)}</div>`;
}
window.onAttackPreview = (data) => {
  if (!data || !data.key || !previews.has(data.key)) return;
  previews.set(data.key, data.preview || false);
  for (const el of document.querySelectorAll('.dmg-preview')) {
    if (el.dataset.key !== data.key) continue;
    const ids = data.key.split('|');
    const units = window.gameBridge?.state?.units || [];
    const att = units.find((u) => String(u.id) === ids[1]), tgt = units.find((u) => String(u.id) === ids[6]);
    if (att && tgt) el.innerHTML = previewHtml(data.preview || false, att, tgt);
  }
};

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
  // Stances of both sides and what they bring to this kind of attack
  const kind = ranged ? 'tir' : 'cac';
  const sty = (u) => (!u.isGeneral && u.stance && window.stanceStyle ? window.stanceStyle(u.stance) : null);
  const chip = (u) => { const ss = sty(u); return ss ? `<i class="st-chip" style="background:${ss.c}">${ss.svg || ''}</i> ${ss.short}` : 'général'; };
  const fx = (u, keys) => (window.stanceEffects && !u.isGeneral && u.stance ? window.stanceEffects(u.stance, kind).filter((e) => keys.test(e.key)) : []);
  const fmtFx = (list) => list.map((e) => `${e.v > 0 ? '+' : '−'}${Math.abs(e.v)} ${e.label}`).join(', ');
  const fa = fx(att, /^(attack|puissance|intimidation|precision)_/);
  const ft = fx(tgt, /^(defense|courage|esquive)_|^armure$/);
  if (sty(att)) notes.push(`<b>${att.name}</b> en ${sty(att).name} : ${fa.length ? fmtFx(fa) : 'pas de modificateur d\'attaque'}`);
  if (sty(tgt)) {
    const sim = window.gameBridge && window.gameBridge.simultaneous;
    const react = sim && window.stanceReactionText ? ` · ${window.stanceReactionText(tgt.stance)}` : '';
    notes.push(`<b>${tgt.name}</b> en ${sty(tgt).name} : ${ft.length ? fmtFx(ft) : 'pas de modificateur de défense'}${react}`);
  }
  const dice = (u) => (u.isGeneral ? 'd20' : `${Math.max(1, Math.floor((u.vitality || 0) / ((R && R.RULES.combat.diceDivisor) || 5)))} dés`);
  return `<b>${ranged ? 'Tir' : 'Attaque'}</b> : ${att.name} → ${tgt.name}<div class="vs">
      ${row('Posture', chip(att), chip(tgt))}
      ${row('Attaque / Défense', att.attack ?? att.force, tgt.defense ?? tgt.force ?? '–')}
      ${row('Dés', dice(att), dice(tgt))}
      ${row('Puissance / Armure', att.power, tgt.armor)}
      ${row('Vitalité', att.vitality, tgt.vitality)}
      ${row('Moral', att.morale ?? '–', tgt.morale ?? '–')}</div>${damagePreview(att, tgt, from)}${notes.map((n) => `<div class="note">${n}</div>`).join('')}`;
}
