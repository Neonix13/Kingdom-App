// End-of-battle screen, style D: replaces the legacy #overlay-gameover while the HUD is active.
// It wraps showRecap (game.js), which still fills the legacy overlay, and reuses its buttons' functions.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REASONS = { elimination: 'Général ennemi vaincu', points: 'Points de victoire atteints', max_turns: 'Limite de tours atteinte' };

export function createGameOver({ bridge }) {
  const root = document.createElement('div');
  root.id = 'hud-gameover';
  root.className = 'overlay';
  root.style.display = 'none';
  document.body.appendChild(root);
  const reopen = document.createElement('button');
  reopen.id = 'hud-gameover-reopen';
  reopen.type = 'button';
  reopen.hidden = true;
  reopen.innerHTML = '<span class="hud-brush">終</span> Bilan de la bataille';
  document.body.appendChild(reopen);
  const showBox = (on) => { root.style.display = on ? 'flex' : 'none'; reopen.hidden = on || !last; document.body.classList.toggle('hud-gameover-on', on); };
  reopen.addEventListener('click', () => showBox(true));

  let last = null;
  const generalPic = (gid) => {
    const map = window.img1Url && (() => { try { return new Function('return typeof GENERAL_IMAGE1_MAP !== "undefined" ? GENERAL_IMAGE1_MAP : null')(); } catch (e) { return null; } })();
    return map && gid ? window.img1Url(map, gid, 'GENERAL IMAGE 1-1') : null;
  };

  function render(data) {
    const recap = data.recap || null;
    const winnerId = data.winnerId ?? recap?.winnerId ?? null;
    const me = bridge.myId;
    const players = recap ? recap.players : [];
    const amPlayer = players.some((p) => p.id === me);
    const outcome = !winnerId ? 'draw' : !amPlayer ? 'watch' : winnerId === me ? 'win' : 'loss';
    const KJ = { win: '勝', loss: '敗', draw: '和', watch: '終' }[outcome];
    const title = { win: 'VICTOIRE', loss: 'DÉFAITE', draw: 'MATCH NUL', watch: 'FIN DE LA BATAILLE' }[outcome];
    const winnerName = data.winnerName || recap?.winnerName;
    const sub = winnerId ? `${esc(winnerName || '?')} remporte la bataille` : 'Aucun vainqueur';
    const reason = recap ? [REASONS[recap.endReason] || '', `${recap.turns} tours`].filter(Boolean).join(' · ') : '';

    const cards = players.slice().sort((a, b) => (b.id === winnerId) - (a.id === winnerId) || (b.points || 0) - (a.points || 0)).map((p) => {
      const pic = generalPic(p.generalId);
      const win = p.id === winnerId;
      return `<div class="go-player${win ? ' win' : ''}${p.isEliminated ? ' out' : ''}">
        <div class="go-pic" style="--pc:${esc(p.color)}">${pic ? `<img src="${esc(pic)}" alt="">` : '<span class="hud-brush">将</span>'}</div>
        <div class="go-pinfo">
          <div class="go-pname"><span class="hud-dela">${esc(p.name)}</span>${p.id === me ? '<i>vous</i>' : ''}${win ? '<b class="go-crown">勝</b>' : ''}</div>
          <div class="go-stats">
            <span><b class="hud-dela">${p.damageDealt ?? 0}</b>dégâts infligés</span>
            <span><b class="hud-dela">${p.damageTaken ?? 0}</b>dégâts subis</span>
            <span><b class="hud-dela">${p.kills ?? 0}</b>victimes</span>
            <span><b class="hud-dela">${p.losses ?? 0}</b>pertes</span>
            <span><b class="hud-dela">${p.captures ?? 0}</b>captures</span>
            <span><b class="hud-dela">${p.points ?? 0}</b>points</span>
            <span><b class="hud-dela">${p.unitsAlive ?? 0}/${p.unitsTotal ?? 0}</b>unités debout</span>
          </div>
        </div></div>`;
    }).join('');

    const units = recap ? recap.units.slice().sort((a, b) => b.damageDealt - a.damageDealt).map((u) => {
      const pl = players.find((p) => p.id === u.playerId);
      const state = u.alive ? 'debout' : u.fled ? 'en fuite' : 'détruite';
      return `<tr class="${u.alive ? '' : 'dead'}"><td><i style="background:${esc(pl?.color || '#888')}"></i>${u.isGeneral ? '将 ' : ''}${esc(u.name)}</td><td>${u.damageDealt}</td><td>${u.damageTaken}</td><td>${u.kills}</td><td>${state}</td></tr>`;
    }).join('') : '';
    const replay = recap && recap.replayAvailable;

    root.innerHTML = `<div class="go-box ${outcome}">
      <div class="go-speed"></div>
      <div class="go-head">
        <div class="go-kanji hud-brush">${KJ}</div>
        <div class="go-title">
          <div class="go-big hud-dela">${title}</div>
          <div class="go-sub">${sub}</div>
          ${reason ? `<div class="go-reason">${esc(reason)}</div>` : ''}
        </div>
      </div>
      <div class="go-players">${cards}</div>
      ${units ? `<details class="go-units"><summary>Détail par unité</summary><table><tr><th>Unité</th><th>Infligés</th><th>Subis</th><th>Victimes</th><th>État</th></tr>${units}</table></details>` : ''}
      <div class="go-actions">
        ${replay ? '<button type="button" data-go="view">Voir le replay</button><button type="button" data-go="download">Télécharger le replay</button>' : ''}
        <button type="button" data-go="map">Voir la carte</button>
        <button type="button" class="go-menu" data-go="menu">Retour au menu</button>
      </div></div>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const a = b.dataset.go;
    if (a === 'view' || a === 'download') window.requestReplay && window.requestReplay(a);
    else if (a === 'map') showBox(false);
    else if (a === 'menu') window.leaveGame && window.leaveGame();
  });

  const orig = window.showRecap;
  if (typeof orig === 'function') {
    window.showRecap = function (data) {
      const r = orig.apply(this, arguments);
      last = data;
      if (document.body.classList.contains('hud-d')) {
        render(data);
        const legacy = document.getElementById('overlay-gameover');
        if (legacy) legacy.style.display = 'none';
        showBox(true);
      }
      return r;
    };
  }

  return {
    hide() { root.style.display = 'none'; reopen.hidden = true; document.body.classList.remove('hud-gameover-on'); },
    get last() { return last; },
  };
}
