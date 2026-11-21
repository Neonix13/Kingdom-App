// Combat result card, style D (ink panels): shown in the 3D view after the hit animation, auto-dismissed.
// Mode from the 3D settings (localStorage kb_view3d_settings.combatCard): 'full' | 'small' | 'off'. Playback combats always use 'small'.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEF_LABEL = { counter: 'Contre-attaque', absorb: 'Encaissement', rien: 'Aucune réponse' };

export function createCombatSplash({ bridge, portrait, kanji, isActive }) {
  const root = document.createElement('div');
  root.id = 'hud-splash';
  document.body.appendChild(root);
  let hideTimer = null, showTimer = null, shown = false;

  const mode = () => {
    try { return JSON.parse(localStorage.getItem('kb_view3d_settings') || '{}').combatCard || 'full'; } catch (e) { return 'full'; }
  };

  function hide() {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    shown = false;
    root.className = '';
    root.innerHTML = '';
    document.body.classList.remove('hud-splash-on');
  }
  root.addEventListener('click', hide);
  const editable = (n) => n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
  window.addEventListener('keydown', (e) => {
    if (!shown || e.code !== 'Space' || editable(document.activeElement)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    hide();
  }, true);

  function unit(id, name, hidden) {
    const st = bridge.state || {};
    const u = id != null ? ((st.units || []).find((x) => x.id === id) || (st.myUnits || []).find((x) => x.id === id)) : null;
    const color = u && u.playerId ? bridge.getPlayerColor(u.playerId) : '#555';
    return { name: hidden ? 'Unité inconnue' : (name || u?.name || '?'), u, color, pic: u && !hidden ? portrait(u) : null, kj: u ? kanji(u) : '?' };
  }

  const stanceOf = (id) => (id && window.stanceStyle ? window.stanceStyle(id) : null);
  function side(info, cls, label, stance) {
    const pic = info.pic ? `<img src="${esc(info.pic)}" alt="">` : `<span class="ph hud-hatch"><b class="hud-brush">${esc(info.kj)}</b></span>`;
    const ss = stanceOf(stance);
    const st = ss ? `<span class="sp-st"><i class="st-chip" style="background:${esc(ss.c)}">${ss.svg || ''}</i>${esc(ss.name)}</span>` : '';
    return `<div class="sp-side ${cls}"><div class="sp-pic">${pic}</div>
      <div class="sp-tag" style="background:${esc(info.color)}"><span>${esc(label)}</span><b class="hud-dela">${esc(info.name)}</b>${st}</div></div>`;
  }
  // "Charge (+3 attaque mêlée, …) contre Repos (−2 défense mêlée, …)": what each stance brought to this combat
  function stancesRow(log) {
    const a = stanceOf(log.attackerStance), t = stanceOf(log.targetStance);
    if ((!a && !t) || !window.stanceEffects) return null;
    const kind = log.ranged ? 'tir' : 'cac';
    const part = (ss, id, keys) => {
      if (!ss) return 'général';
      const fx = window.stanceEffects(id, kind).filter((e) => keys.test(e.key)).slice(0, 3);
      return `<b>${esc(ss.name)}</b>${fx.length ? ` (${fx.map((e) => `${e.v > 0 ? '+' : '−'}${Math.abs(e.v)} ${esc(e.label)}`).join(', ')})` : ''}`;
    };
    return ['Postures', `${part(a, log.attackerStance, /^(attack|puissance|intimidation)_/)} contre ${part(t, log.targetStance, /^(defense|courage)_|^armure$/)}`];
  }

  function normalBody(log, A, T) {
    const verdict = log.targetKilled ? 'DÉTRUIT' : log.hit ? 'TOUCHÉ' : 'RATÉ';
    const rows = [];
    const b = log.breakdown || {};
    if (b.generalD20 != null) rows.push(['Jet du général', `Force ${b.attackBase} − dé <b>${b.generalD20}</b> + 80 = <b>${b.generalAttValue}</b>`]);
    else if (b.NGOAtt != null) rows.push(['Jet d\'attaque', `<b>${b.attReussite}</b> réussites sur ${b.NGOAtt} dés (d20 ≤ ${b.attackEff})${b.angleName ? ` · attaque ${b.angleName === 'dos' ? 'de dos' : 'de flanc'}` : ''}`]);
    if (log.hit && b.ratARDef != null) rows.push(['Dégâts', `puissance ${b.effectivePowerAtt ?? b.basePowerAtt} · armure ${b.effectiveArmorDef} (ratio ${Math.round(b.ratARDef * 100)} %)`]);
    if (b.defReussite != null && b.NGODef != null) rows.push(['Défense', `<b>${b.defReussite}</b> réussites sur ${b.NGODef} dés (d20 ≤ ${b.defEff})`]);
    else if (b.generalD20Def != null) rows.push(['Riposte du général', `Force ${b.defBase} − dé <b>${b.generalD20Def}</b> + 80 = <b>${b.generalAttValueDef}</b>`]);
    const lines = [];
    if (log.hit) {
      const parts = [`−${log.dmgReceived ?? 0} vitalité`];
      if (log.moralDmg) parts.push(`−${log.moralDmg} moral`);
      lines.push(`<span class="big">${parts.join(' · ')}</span>`);
      const max = T.u && T.u.maxVitality;
      if (log.targetVitalityLeft != null && !log.targetKilled) lines.push(`${esc(T.name)} : ${log.targetVitalityLeft}${max ? ` / ${max}` : ''} vitalité`);
    } else lines.push(`<span class="big">Aucun dégât</span>`);
    let foot = '';
    const dc = log.defenseChoice;
    if (dc === 'counter') foot = log.defenseSuccess ? `${DEF_LABEL.counter} réussie : <b>−${log.counterDmgReceived ?? 0}</b> pour ${esc(A.name)}${log.counterMoralDmg ? ` · −${log.counterMoralDmg} moral` : ''}` : `${DEF_LABEL.counter} ratée`;
    else if (dc === 'absorb') foot = `${DEF_LABEL.absorb} : <b>${log.counterDmgReceived ?? 0}</b> PV absorbés`;
    else if (dc) foot = DEF_LABEL[dc] || esc(dc);
    const sr = stancesRow(log);
    if (sr) rows.push(sr);
    for (const bn of log.bonuses || []) rows.push(['Capacité', esc(bn.text)]);
    if (log.attackerKilled) foot += `${foot ? ' · ' : ''}<b>${esc(A.name)} détruit</b>`;
    if (log.generalKilled && log.eliminatedPlayer) foot += `${foot ? ' · ' : ''}<b>${esc(log.eliminatedPlayer)} perd son général</b>`;
    return { verdict, rows, lines, foot };
  }

  function duelBody(log, A, T) {
    const d = log.duel;
    const nm = (id) => (id === log.attackerId ? A.name : id === log.targetId ? T.name : 'Unité inconnue');
    const rows = (d.rounds || []).map((r, i) => [`Passe ${i + 1}`, `<b>${r.attackerRoll}</b> contre <b>${r.defenderRoll}</b> → ${r.attacker ? `${esc(nm(r.attacker))} frappe (−${r.dmg})` : 'parade'}`]);
    const verdict = d.winnerId ? 'VICTOIRE' : 'INDÉCIS';
    const lines = [d.winnerId ? `<span class="big">${esc(nm(d.winnerId))} remporte le duel</span>` : '<span class="big">Personne ne l\'emporte</span>'];
    let foot = '';
    if (log.generalKilled) foot = `<b>${esc(log.eliminatedPlayer || '')} perd son général</b>`;
    else if (d.stunned) foot = 'Le vaincu est sonné, son armée vacille.';
    return { verdict, rows, lines, foot };
  }

  function render(log, m) {
    const A = unit(log.attackerId, log.attackerName, log.attackerHidden);
    const T = unit(log.targetId, log.targetName, log.targetHidden);
    const duel = !!log.duel;
    const body = duel ? duelBody(log, A, T) : normalBody(log, A, T);
    const kj = duel ? '闘' : log.ranged ? '射' : '撃';
    const verdictCls = body.verdict === 'RATÉ' || body.verdict === 'INDÉCIS' ? 'miss' : '';
    const rows = body.rows.map(([k, v]) => `<div class="sp-row"><span>${esc(k)}</span><span>${v}</span></div>`).join('');
    const result = `<div class="sp-result">
        <div class="sp-head"><span class="sp-verdict hud-dela ${verdictCls}">${body.verdict}</span><div class="sp-lines">${body.lines.map((l) => `<div>${l}</div>`).join('')}</div></div>
        ${rows ? `<div class="sp-rows">${rows}</div>` : ''}
        <div class="sp-foot"><span>${body.foot || '&nbsp;'}</span><span class="sp-skip">Continuer <span class="hud-kbd">Espace</span></span></div>
      </div>`;
    if (m === 'small') {
      return `<div class="sp-small"><div class="sp-title hud-dela">${duel ? 'DUEL · ' : ''}${esc(A.name)} <i>→</i> ${esc(T.name)}</div>${result}</div>`;
    }
    return `<div class="sp-speed"></div>
      <div class="sp-stage">
        <div class="sp-comic">${side(A, 'att', duel ? 'Général' : 'Attaquant', log.attackerStance)}${side(T, 'def', duel ? 'Général' : 'Défenseur', log.targetStance)}</div>
        <div class="sp-kanji hud-brush">${kj}</div>
        ${duel ? '<div class="sp-shout hud-dela">DUEL !</div>' : log.trample ? '<div class="sp-shout hud-dela">PIÉTINEMENT !</div>' : log.ranged ? '<div class="sp-shout hud-dela">TIR !</div>' : ''}
        ${result}
      </div>`;
  }

  function show(log, { playback = false } = {}) {
    if (!log || log.abilityUsed || !isActive()) return;
    if (log.attackerName == null && log.targetName == null) return;
    const m = playback ? 'small' : mode();
    if (m === 'off') return;
    const rounds = log.duel ? (log.duel.rounds || []).length : 0;
    const delay = playback ? 0 : log.duel ? 1100 + rounds * 1150 + 300 : log.ranged ? 1000 : 650;
    const dur = playback ? 2200 : m === 'small' ? 4500 : log.duel ? Math.min(6000, 3000 + rounds * 500) : (log.targetKilled || log.attackerKilled ? 4200 : 3400);
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => {
      if (!isActive() || document.body.classList.contains('v3-photo')) return;
      const modal = [...document.querySelectorAll('.overlay')].some((o) => o.style.display && o.style.display !== 'none');
      const mm = modal ? 'small' : m;
      root.innerHTML = render(log, mm);
      root.className = `on ${mm}${log.duel ? ' duel' : ''}`;
      shown = true;
      document.body.classList.add('hud-splash-on');
      hideTimer = setTimeout(hide, dur);
    }, delay);
  }

  return { show, hide, get shown() { return shown; } };
}
