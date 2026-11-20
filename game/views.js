// What a recipient may know about a combat (shared by the sequential flow in protocol.js and the simultaneous timeline)
const UNKNOWN = 'Unité inconnue';

// Sides the recipient cannot see are anonymised; the roll breakdown only goes to the two camps
function combatView(log, { seeAttacker, seeTarget, details }) {
  const out = { ...log };
  if (!details) delete out.breakdown;
  if (!seeAttacker) Object.assign(out, { attackerId: null, attackerName: UNKNOWN, attackerVitalityLeft: null, attackerHidden: true });
  if (!seeTarget) Object.assign(out, { targetId: null, targetName: UNKNOWN, targetVitalityLeft: null, targetMoraleLeft: null, targetHidden: true });
  if (log.duel) {
    const hide = (id) => ((id === log.attackerId && !seeAttacker) || (id === log.targetId && !seeTarget) ? null : id);
    out.duel = { ...log.duel, attackerId: hide(log.duel.attackerId), defenderId: hide(log.duel.defenderId), winnerId: hide(log.duel.winnerId), loserId: hide(log.duel.loserId), rounds: log.duel.rounds.map(rd => ({ ...rd, attacker: hide(rd.attacker) })) };
  }
  return out;
}

// Combat log as sent to one recipient: null when it saw neither side
function combatFor(log, { attackerPlayerId, targetPlayerId, seeAttacker, seeTarget, viewerId }) {
  if (viewerId === attackerPlayerId) return log;
  if (viewerId === targetPlayerId) return combatView(log, { seeAttacker, seeTarget: true, details: seeAttacker });
  if (!seeAttacker && !seeTarget) return null;
  return combatView(log, { seeAttacker, seeTarget, details: false });
}

module.exports = { UNKNOWN, combatView, combatFor };
