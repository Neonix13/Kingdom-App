// Active abilities of the generals, used when game/data/generals.js does not define `activeAbility`.
// target: 'none' | 'enemy_army' (the client sends targetId = an enemy player id).
// Only the effects handled by GameRoom.useGeneralAbility have a mechanical effect.
module.exports = {
  ou_ki: { name: 'Sourire du Monstre', cooldown: 3, target: 'none', description: 'Puissance de l\'armée +2 pendant 2 tours. Si l\'armée ennemie est en infériorité numérique, son moral baisse.' },
  mou_bu: { name: 'Poing du Titan', cooldown: 3, target: 'enemy_army', description: 'Réduit l\'armure d\'une armée ennemie de 1 pendant 2 tours.' },
  ri_boku: { name: 'Vision du Sage', cooldown: 2, target: 'none', description: 'Révèle les unités ennemies en embuscade (forêts, bâtiments) dans votre vision jusqu\'au prochain tour.' },
};
