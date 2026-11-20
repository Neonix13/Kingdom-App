// Simulation de matchup 1v1 — formule exacte du GameRoom.js remote
// ratARDef = 1 - (NGODef × armor) / (NGODef × armor + 100)
// dmg = attReussite × power × ratARDef  (pas de /10)
// Lancier : +6 power vs Chevaux/Chars
// Archers : pas de contre-attaque quand ils attaquent (ranged_no_defense)
// PV décroissants → NGO décroissant → armure effective décroissante

const UNITS_RAW = require('../game/data/units');
const units = Object.values(UNITS_RAW);

function calcDamage(att, defVit, defArmor, isLancierVsCav) {
  const nGoAtt = Math.max(1, Math.floor(att.vit / 5));
  const attReussite = nGoAtt * (att.atkStat / 20);
  const nGoDef = Math.max(1, Math.floor(defVit / 5));
  const AR = nGoDef * defArmor;
  const ratAR = 1 - AR / (AR + 100);
  const power = att.power + (isLancierVsCav ? 6 : 0);
  return attReussite * power * ratAR;
}

// Simule un duel complet avec PV décroissants et alternance de tours
// initiator = 'A' ou 'B'
function simulateDuel(a, b, initiator) {
  let vitA = a.vitality;
  let vitB = b.vitality;
  const isLancierA = a.id === 'lancier' && (b.category === 'Chevaux' || b.category === 'Chars');
  const isLancierB = b.id === 'lancier' && (a.category === 'Chevaux' || a.category === 'Chars');
  let halfTurn = 0;
  const MAX = 4000;

  // Ordre : chaque demi-tour, un camp attaque avec atk, l'autre contre avec def
  const seq = initiator === 'A'
    ? [{ att: 'A', def: 'B' }, { att: 'B', def: 'A' }]
    : [{ att: 'B', def: 'A' }, { att: 'A', def: 'B' }];

  while (vitA > 0 && vitB > 0 && halfTurn < MAX) {
    const step = seq[halfTurn % 2];
    halfTurn++;

    const attIsA = step.att === 'A';
    const attacker = attIsA ? a : b;
    const isLancierAtt = attIsA ? isLancierA : isLancierB;
    const isRanged = attacker.bonusType === 'ranged_no_defense';

    // L'attaquant frappe avec son atk
    const dmgToDefender = calcDamage(
      { ...attacker, vit: attIsA ? vitA : vitB, atkStat: attacker.attack },
      attIsA ? vitB : vitA,
      attIsA ? b.armor : a.armor,
      isLancierAtt
    );

    // Le défenseur contre avec sa def (sauf si l'attaquant est ranged)
    let dmgToAttacker = 0;
    if (!isRanged) {
      const defender = attIsA ? b : a;
      const isLancierDef = attIsA ? isLancierB : isLancierA;
      dmgToAttacker = calcDamage(
        { ...defender, vit: attIsA ? vitB : vitA, atkStat: defender.defense },
        attIsA ? vitA : vitB,
        attIsA ? a.armor : b.armor,
        isLancierDef
      );
    }

    // Application simultanée
    if (attIsA) { vitA -= dmgToAttacker; vitB -= dmgToDefender; }
    else        { vitB -= dmgToAttacker; vitA -= dmgToDefender; }

    if (vitA <= 0 && vitB <= 0) return { winner: 'draw', ht: halfTurn, hp: 0 };
    if (vitA <= 0) return { winner: 'B', ht: halfTurn, hp: Math.max(0, Math.round(vitB)) };
    if (vitB <= 0) return { winner: 'A', ht: halfTurn, hp: Math.max(0, Math.round(vitA)) };
  }

  return { winner: vitA >= vitB ? 'A' : 'B', ht: halfTurn, hp: Math.round(Math.max(vitA, vitB)), timeout: true };
}

function verdict(rA, rB) {
  if (rA.winner === 'A' && rB.winner === 'A') return 'A';
  if (rA.winner === 'B' && rB.winner === 'B') return 'B';
  if (rA.winner === 'A' && rB.winner === 'B') return 'ini';
  if (rA.winner === 'B' && rB.winner === 'A') return 'def';
  return '=';
}

const COL = 13;
const NAMEW = 13;
function p(s, w) { return String(s).slice(0, w - 1).padEnd(w); }

// ── Tableau verdicts ─────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║   VERDICTS MATCHUP — formule NGO×armor, PV décroissants     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('A=ligne gagne tjrs | B=colonne gagne tjrs | ini=initiative décide | def=défenseur gagne\n');

process.stdout.write(''.padEnd(NAMEW));
for (const b of units) process.stdout.write(p(b.name, COL));
console.log();
process.stdout.write(''.padEnd(NAMEW));
for (const b of units) process.stdout.write(p('─'.repeat(COL-1), COL));
console.log();

for (const a of units) {
  process.stdout.write(p(a.name, NAMEW));
  for (const b of units) {
    if (a.id === b.id) { process.stdout.write(p('—', COL)); continue; }
    const rA = simulateDuel(a, b, 'A');
    const rB = simulateDuel(a, b, 'B');
    process.stdout.write(p(verdict(rA, rB), COL));
  }
  console.log();
}

// ── Tableau détaillé (quand A initie) ────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║   DÉTAIL — ligne initie : Résultat Demi-tours/HP restants   ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('✓=ligne gagne  ✗=ligne perd  format: T(demi-tours)/HP\n');

process.stdout.write(''.padEnd(NAMEW));
for (const b of units) process.stdout.write(p(b.name, COL));
console.log();
process.stdout.write(''.padEnd(NAMEW));
for (const b of units) process.stdout.write(p('─'.repeat(COL-1), COL));
console.log();

for (const a of units) {
  process.stdout.write(p(a.name, NAMEW));
  for (const b of units) {
    if (a.id === b.id) { process.stdout.write(p('—', COL)); continue; }
    const r = simulateDuel(a, b, 'A');
    const sym = r.winner === 'A' ? '✓' : r.winner === 'draw' ? '≈' : '✗';
    process.stdout.write(p(`${sym}T${r.ht}/${r.hp}`, COL));
  }
  console.log();
}

// ── Résumé score ─────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  SCORE (sur 22 matchups, initiative confondues)      ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('Unité'.padEnd(NAMEW) + 'A tjrs'.padStart(7) + 'ini+'.padStart(6) + 'def+'.padStart(6) + 'B tjrs'.padStart(7) + 'Score'.padStart(7));
console.log('─'.repeat(49));

for (const a of units) {
  let wA=0, ini=0, def=0, wB=0;
  for (const b of units) {
    if (a.id === b.id) continue;
    const v = verdict(simulateDuel(a, b, 'A'), simulateDuel(a, b, 'B'));
    if (v==='A') wA++;
    else if (v==='ini') ini++;
    else if (v==='def') def++;
    else if (v==='B') wB++;
  }
  const score = wA*2 + ini;
  console.log(p(a.name,NAMEW) + String(wA).padStart(7) + String(ini).padStart(6) + String(def).padStart(6) + String(wB).padStart(7) + String(score).padStart(7));
}

// ── Comparaison avec cible ────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║  COMPARAISON AVEC CIBLE (simulation vs tableau de design)        ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');

const TARGET = {
  pietaille:      { soldats:'perd', espion:'gagne', archer:'gagne', phalange:'perd', lancier:'perd', assassin:'perd', cavalier_leger:'perd', archer_elite:'close', batisseurs:'gagne', cavalier_lourd:'perd', char:'perd' },
  soldats:        { pietaille:'gagne', espion:'gagne', archer:'gagne', phalange:'close', lancier:'close', assassin:'gagne', cavalier_leger:'close', archer_elite:'gagne', batisseurs:'gagne', cavalier_lourd:'close', char:'perd' },
  espion:         { pietaille:'close', soldats:'perd', archer:'close', phalange:'perd', lancier:'perd', assassin:'perd', cavalier_leger:'perd', archer_elite:'perd', batisseurs:'close', cavalier_lourd:'perd', char:'perd' },
  archer:         { pietaille:'gagne', soldats:'close', espion:'gagne', phalange:'perd', lancier:'perd', assassin:'perd', cavalier_leger:'perd', archer_elite:'perd', batisseurs:'gagne', cavalier_lourd:'perd', char:'perd' },
  phalange:       { pietaille:'gagne', soldats:'close', espion:'gagne', archer:'gagne', lancier:'close', assassin:'gagne', cavalier_leger:'perd', archer_elite:'gagne', batisseurs:'gagne', cavalier_lourd:'close', char:'perd' },
  lancier:        { pietaille:'gagne', soldats:'gagne', espion:'gagne', archer:'gagne', phalange:'close', assassin:'close', cavalier_leger:'gagne', archer_elite:'gagne', batisseurs:'gagne', cavalier_lourd:'gagne', char:'gagne' },
  assassin:       { pietaille:'gagne', soldats:'gagne', espion:'gagne', archer:'gagne', phalange:'gagne', lancier:'gagne', cavalier_leger:'gagne', archer_elite:'gagne', batisseurs:'gagne', cavalier_lourd:'gagne', char:'close' },
  cavalier_leger: { pietaille:'gagne', soldats:'gagne', espion:'gagne', archer:'gagne', phalange:'close', lancier:'perd', assassin:'gagne', archer_elite:'gagne', batisseurs:'gagne', cavalier_lourd:'perd', char:'perd' },
  archer_elite:   { pietaille:'gagne', soldats:'gagne', espion:'gagne', archer:'gagne', phalange:'perd', lancier:'close', assassin:'perd', cavalier_leger:'perd', batisseurs:'gagne', cavalier_lourd:'perd', char:'perd' },
  batisseurs:     { pietaille:'perd', soldats:'perd', espion:'perd', archer:'perd', phalange:'perd', lancier:'perd', assassin:'perd', cavalier_leger:'perd', archer_elite:'perd', cavalier_lourd:'perd', char:'perd' },
  cavalier_lourd: { pietaille:'gagne', soldats:'gagne', espion:'gagne', archer:'gagne', phalange:'gagne', lancier:'perd', assassin:'gagne', cavalier_leger:'gagne', archer_elite:'gagne', batisseurs:'gagne', char:'close' },
  char:           { pietaille:'gagne', soldats:'gagne', espion:'gagne', archer:'gagne', phalange:'close', lancier:'close', assassin:'gagne', cavalier_leger:'gagne', archer_elite:'gagne', batisseurs:'gagne', cavalier_lourd:'gagne' },
};

// Mapping verdict → catégorie comparable
function toCategory(v) {
  if (v === 'A') return 'gagne';
  if (v === 'B') return 'perd';
  if (v === 'ini' || v === 'def') return 'close';
  return 'close';
}

let ok=0, off=0, total=0;
for (const a of units) {
  const tRow = TARGET[a.id];
  if (!tRow) continue;
  for (const b of units) {
    if (a.id === b.id || !tRow[b.id]) continue;
    total++;
    const sim = toCategory(verdict(simulateDuel(a, b, 'A'), simulateDuel(a, b, 'B')));
    const tgt = tRow[b.id];
    const match = sim === tgt || (tgt === 'close' && (sim === 'ini' || sim === 'close'));
    if (match) ok++;
    else {
      off++;
      console.log(`  ✗ ${a.name.padEnd(14)} vs ${b.name.padEnd(14)} : sim=${sim.padEnd(6)} cible=${tgt}`);
    }
  }
}
console.log(`\nRésultat : ${ok}/${total} matchups corrects (${Math.round(ok/total*100)}%)`);
