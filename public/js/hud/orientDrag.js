// Orienting a unit by dragging with the right button from the selected unit (or, in simultaneous mode, from the end of
// its path: the facing it takes on arrival): an arrow follows the cursor, snapped to the nearest of the 6 hex
// directions, and the facing is given on release. Used by the 2D canvas and the 3D view.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  let svg = null, line = null, head = null, label = null, drag = null;

  function ensure() {
    if (svg) return;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'kb-orient');
    svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:250;display:none;overflow:visible';
    svg.innerHTML = '<circle class="o-ring" r="22" fill="none" stroke="#F2E3A0" stroke-width="2" stroke-dasharray="4 4" opacity=".8"/>'
      + '<line class="o-line" stroke="#F2E3A0" stroke-width="5" stroke-linecap="round" opacity=".95"/>'
      + '<path class="o-head" d="M0 0L-18 -11L-13 0L-18 11Z" fill="#F2E3A0"/>';
    line = svg.querySelector('.o-line');
    head = svg.querySelector('.o-head');
    document.body.appendChild(svg);
    label = document.createElement('div');
    label.style.cssText = 'position:fixed;z-index:251;pointer-events:none;display:none;padding:3px 9px;border-radius:999px;background:rgba(14,13,12,.9);border:1px solid rgba(201,169,78,.6);color:#F2E3A0;font:700 12px "Zen Kaku Gothic New","Segoe UI",sans-serif;transform:translate(-50%,-150%);white-space:nowrap';
    document.body.appendChild(label);
  }

  // bridge: { hexScreen(q, r), facingToward(unit, hex), canOrient(unit), setUnitFacing(unit, f) }
  // moving: the unit has just been sent to anchor (left button held on a destination); the facing waits for the move
  // order to end there before it is given
  function start(bridge, unit, anchor = null, moving = false) {
    if (!unit || !bridge.canOrient(unit)) return false;
    ensure();
    const at = anchor || { q: unit.q, r: unit.r };
    drag = { bridge, unit, at, arrival: at.q !== unit.q || at.r !== unit.r, facing: null, moving };
    return true;
  }
  function move(hex, clientX, clientY) {
    if (!drag) return;
    const { bridge, unit, at } = drag;
    const c = bridge.hexScreen(at.q, at.r);
    if (!c) return;
    const f = hex ? bridge.facingToward({ ...unit, q: at.q, r: at.r }, hex) : null;
    drag.facing = f;
    svg.style.display = '';
    svg.querySelector('.o-ring').setAttribute('cx', c.x);
    svg.querySelector('.o-ring').setAttribute('cy', c.y);
    let tx = clientX, ty = clientY;
    if (f != null) {
      const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      const n = bridge.hexScreen(at.q + DIRS[f][0], at.r + DIRS[f][1]);
      if (n) {
        const a = Math.atan2(n.y - c.y, n.x - c.x), len = Math.max(48, Math.min(140, Math.hypot(clientX - c.x, clientY - c.y)));
        tx = c.x + Math.cos(a) * len; ty = c.y + Math.sin(a) * len;
      }
    }
    const a = Math.atan2(ty - c.y, tx - c.x);
    line.setAttribute('x1', c.x + Math.cos(a) * 22); line.setAttribute('y1', c.y + Math.sin(a) * 22);
    line.setAttribute('x2', tx - Math.cos(a) * 12); line.setAttribute('y2', ty - Math.sin(a) * 12);
    head.setAttribute('transform', `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${(a * 180 / Math.PI).toFixed(1)})`);
    head.style.display = f == null ? 'none' : '';
    label.style.display = '';
    label.style.left = `${tx}px`; label.style.top = `${ty}px`;
    label.textContent = f == null ? 'Relâcher sur une case pour orienter' : (drag.arrival ? "Orientation à l'arrivée" : f === unit.facing ? 'Orientation actuelle' : 'Orienter ici');
  }
  function end(apply = true) {
    if (!drag) return false;
    const { bridge, unit, facing, moving, at } = drag;
    drag = null;
    if (svg) svg.style.display = 'none';
    if (label) label.style.display = 'none';
    if (!apply || facing == null) return true;
    if (!moving) { bridge.setUnitFacing(unit, facing); return true; }
    let tries = 0;
    const tryApply = () => {
      const fresh = bridge.selectedUnit && bridge.selectedUnit.id === unit.id ? bridge.selectedUnit : unit;
      if (bridge.orientAnchor && bridge.orientAnchor(fresh, at)) bridge.setUnitFacing(fresh, facing);
      else if (++tries < 40) setTimeout(tryApply, 50);
    };
    tryApply();
    return true;
  }
  self.KBOrient = { start, move, end, active: () => !!drag };
})();
