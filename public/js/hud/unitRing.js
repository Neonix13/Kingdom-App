// On-unit controls (2D and 3D): around the selected unit of mine, the 6 facing arrows (1 speed) and the stance chips
// (pictogram + colour). In simultaneous planning they set the order's final facing / stance. Positions follow the camera
// every frame through bridge.hexScreen(q, r) (viewport pixels), so the arrows always point at the real neighbouring hexes.
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function createUnitRing(bridge, root) {
  const el = document.createElement('div');
  el.className = 'hud-ring';
  el.hidden = true;
  root.appendChild(el);
  let sig = '';
  let raf = 0;
  let current = null;

  function state() {
    const u = bridge.selectedUnit;
    const st = bridge.state;
    if (!u || u.q == null || !(u.isMine || u.playerId === bridge.myId) || u.isFleeing || !st || st.phase !== 'battle' || bridge.mode === 'deploy') return null;
    if (document.body.classList.contains('v3-photo')) return null;
    const sim = !!bridge.simultaneous;
    if (sim) {
      const pl = bridge.planning;
      if (!pl || !pl.canPlan) return null;
    } else if (st.currentPlayerId !== bridge.myId) return null;
    const order = sim && bridge.simOrderOf ? bridge.simOrderOf(u) : null;
    const facing = order && order.facing != null ? order.facing : u.facing;
    const stance = order && order.stance ? order.stance : u.stance;
    const costs = bridge.orientCosts ? bridge.orientCosts() : { facing: 1, stance: 2 };
    const speed = u.speedRemaining || 0;
    return { u, sim, facing, stance, costs, speed };
  }

  function build(s) {
    const { u, sim, facing, stance, costs, speed } = s;
    const arrows = DIRS.map((_, i) => {
      const on = facing === i;
      const off = !sim && !on && speed < costs.facing;
      return `<button class="hud-ring-arrow${on ? ' on' : ''}" data-face="${i}" ${off ? 'disabled' : ''} title="${on ? 'Orientation actuelle' : `Orienter vers cette case (−${costs.facing} vitesse)`}${off ? ' — plus assez de vitesse' : ''}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12h12M11 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>`;
    }).join('');
    let chips = '';
    if (!u.isGeneral && bridge.stanceChoices) {
      chips = bridge.stanceChoices().map((c) => {
        const on = c.id === stance;
        const off = !sim && !on && speed < costs.stance;
        return `<button class="hud-ring-stance${on ? ' on' : ''}" data-stance="${c.id}" style="--st:${c.color}" ${off ? 'disabled' : ''} title="${c.name}${on ? ' (actuelle)' : ` — −${costs.stance} vitesse${sim ? ', au début de la résolution' : ''}`}${off ? ' — plus assez de vitesse' : ''}">${c.svg || ''}</button>`;
      }).join('');
      chips = `<div class="hud-ring-stances">${chips}</div>`;
    }
    el.innerHTML = `${arrows}${chips}`;
  }

  function place(s) {
    const c = bridge.hexScreen(s.u.q, s.u.r);
    if (!c || !c.visible) { el.style.visibility = 'hidden'; return; }
    el.style.visibility = '';
    let reach = 0;
    const btns = el.querySelectorAll('.hud-ring-arrow');
    const pts = DIRS.map(([dq, dr]) => bridge.hexScreen(s.u.q + dq, s.u.r + dr));
    for (const p of pts) if (p) reach = Math.max(reach, Math.hypot(p.x - c.x, p.y - c.y));
    const R = Math.max(40, Math.min(96, reach * 0.72));
    pts.forEach((p, i) => {
      const b = btns[i];
      if (!b) return;
      const ang = p ? Math.atan2(p.y - c.y, p.x - c.x) : (-i * Math.PI) / 3;
      b.style.transform = `translate(${(c.x + Math.cos(ang) * R).toFixed(1)}px, ${(c.y + Math.sin(ang) * R).toFixed(1)}px) translate(-50%, -50%) rotate(${ang.toFixed(3)}rad)`;
    });
    const row = el.querySelector('.hud-ring-stances');
    if (row) row.style.transform = `translate(${c.x.toFixed(1)}px, ${(c.y - R - 34).toFixed(1)}px) translate(-50%, -100%)`;
  }

  function loop() {
    raf = 0;
    const s = state();
    if (!s) { el.hidden = true; current = null; sig = ''; return; }
    el.hidden = false;
    const nsig = [s.u.id, s.sim, s.facing, s.stance, s.speed, s.u.isGeneral].join('|');
    if (nsig !== sig) { sig = nsig; build(s); }
    current = s;
    place(s);
    raf = requestAnimationFrame(loop);
  }

  function refresh() { if (!raf) raf = requestAnimationFrame(loop); }

  el.addEventListener('click', (e) => {
    const s = current;
    if (!s) return;
    const f = e.target.closest('[data-face]');
    if (f && !f.disabled) {
      const i = Number(f.dataset.face);
      if (i !== s.facing || s.sim) bridge.setUnitFacing(s.u, i);
      e.stopPropagation();
      return;
    }
    const st = e.target.closest('[data-stance]');
    if (st && !st.disabled) {
      bridge.setUnitStance(s.u, st.dataset.stance);
      e.stopPropagation();
    }
  });
  for (const ev of ['mousedown', 'pointerdown', 'contextmenu', 'wheel']) el.addEventListener(ev, (e) => { if (e.target.closest('button')) e.stopPropagation(); });

  return { refresh, el };
}
