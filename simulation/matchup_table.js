// Simulation de matchup 1v1 — formule déterministe avec PV décroissants
// Chaque demi-tour : l'attaquant attaque (atk), le défenseur contre-attaque (def)
// Les archers n'ont pas de contre quand ils attaquent (ranged_no_defense)
// Deux initiatives simulées : A initie puis B initie

const units = [
  { id: 'pietaille',      name: 'Piétaille',    vit: 300, atk: 6,  pwr: 5,  def: 8,  armor: 5,  ranged: false },
  { id: 'soldats',        name: 'Soldats',      vit: 240, atk: 10, pwr: 10, def: 10, armor: 10, ranged: false },
  { id: 'phalange',       name: 'Phalange',     vit: 250, atk: 9,  pwr: 8,  def: 18, armor: 22, ranged: false },
  { id: 'lancier',        name: 'Lancier',      vit: 240, atk: 9,  pwr: 10, def: 14, armor: 11, ranged: false },
  { id: 'espion',         name: 'Espion',       vit: 270, atk: 7,  pwr: 6,  def: 9,  armor: 7,  ranged: false },
  { id: 'assassin',       name: 'Assassin',     vit: 100, atk: 16, pwr: 22, def: 10, armor: 18, ranged: false },
  { id: 'cavalier_leger', name: 'Cav. Léger',  vit: 170, atk: 12, pwr: 14, def: 6,  armor: 8,  ranged: false },
  { id: 'cavalier_lourd', name: 'Cav. Lourd',  vit: 120, atk: 16, pwr: 24, def: 6,  armor: 18, ranged: false },
  { id: 'archer',         name: 'Archer',       vit: 240, atk: 7,  pwr: 6,  def: 4,  armor: 4,  ranged: true  },
  { id: 'archer_elite',   name: 'A.Élite',     vit: 200, atk: 8,  pwr: 8,  def: 6,  armor: 7,  ranged: true  },
  { id: 'batisseurs',     name: 'Bâtisseurs',  vit: 150, atk: 4,  pwr: 5,  def: 4,  armor: 8,  ranged: false },
  { id: 'char',           name: 'Char',         vit: 100, atk: 18, pwr: 32, def: 6,  armor: 22, ranged: false },
];

// Calcule les dégâts d'une attaque (valeur attendue déterministe)
function calcDmg(attacker, defenderArmor) {
  const nGo = Math.max(1, Math.floor(attacker.vit / 5));
  return (nGo * (attacker.atkStat / 20) * attacker.pwr * (1 - defenderArmor / (defenderArmor + 100))) / 10;
}

// Simule un duel complet avec alternance de tours et PV décroissants
// initiator = 'A' ou 'B' : qui attaque en premier
function simulateDuel(a, b, initiator) {
  let vitA = a.vit;
  let vitB = b.vit;
  let halfTurn = 0;
  const MAX = 2000;

  // Ordre des demi-tours selon l'initiateur
  const order = initiator === 'A'
    ? [{ att: 'A', def: 'B' }, { att: 'B', def: 'A' }]
    : [{ att: 'B', def: 'A' }, { att: 'A', def: 'B' }];

  while (vitA > 0 && vitB > 0 && halfTurn < MAX) {
    const step = order[halfTurn % 2];
    halfTurn++;

    const attUnit  = step.att === 'A' ? { ...a, vit: vitA, atkStat: a.atk } : { ...b, vit: vitB, atkStat: b.atk };
    const defUnit  = step.def === 'A' ? { ...a, vit: vitA, atkStat: a.def } : { ...b, vit: vitB, atkStat: b.def };
    const attIsA   = step.att === 'A';

    // Attaquant frappe le défenseur
    const dmgToDefender = calcDmg(attUnit, step.def === 'A' ? a.armor : b.armor);

    // Défenseur contre-attaque (avec sa stat de défense) — sauf si attaquant est ranged
    const attacker_ranged = attIsA ? a.ranged : b.ranged;
    const dmgToAttacker = attacker_ranged ? 0 : calcDmg(defUnit, step.att === 'A' ? a.armor : b.armor);

    // Application simultanée
    if (attIsA) {
      vitA -= dmgToAttacker;
      vitB -= dmgToDefender;
    } else {
      vitB -= dmgToAttacker;
      vitA -= dmgToDefender;
    }

    if (vitA <= 0 && vitB <= 0) return { winner: 'draw', halfTurns: halfTurn, hp: 0 };
    if (vitA <= 0) return { winner: 'B', halfTurns: halfTurn, hp: Math.max(0, Math.round(vitB)) };
    if (vitB <= 0) return { winner: 'A', halfTurns: halfTurn, hp: Math.max(0, Math.round(vitA)) };
  }

  // Timeout
  return { winner: vitA >= vitB ? 'A' : 'B', halfTurns: halfTurn, hp: Math.round(Math.max(vitA, vitB)), timeout: true };
}

// Encode le résultat d'un matchup (deux initiatives)
function verdict(rA, rB) {
  const wA = rA.winner; // quand A initie
  const wB = rB.winner; // quand B initie
  if (wA === 'A' && wB === 'A') return 'A';       // A gagne toujours
  if (wA === 'B' && wB === 'B') return 'B';       // B gagne toujours
  if (wA === 'A' && wB === 'B') return 'ini';     // l'initiateur gagne
  if (wA === 'B' && wB === 'A') return 'def';     // le défenseur gagne (rare)
  return '=';
}

const W = 10;
function p(s, w) { return String(s).slice(0, w - 1).padEnd(w); }
function pL(s, w) { return String(s).slice(0, w).padStart(w); }

// ── Tableau principal ──────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  TABLEAU DE MATCHUP 1v1 — PV décroissants, défenses actives ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('\nColonne = défenseur. Ligne = attaquant (initie le combat).');
console.log('Chaque cellule : [Résultat si ligne initie | Résultat si colonne initie]');
console.log('Format cellule : GAGNANT Tours/PV   (ex: "A T8/112" = ligne gagne en 8 demi-tours avec 112 PV)');
console.log('Verdict global : A=ligne gagne toujours | B=colonne gagne toujours | ini=initiative décide | def=défenseur gagne\n');

const COL = 16;
process.stdout.write(''.padEnd(12));
for (const b of units) process.stdout.write(b.name.slice(0, COL - 1).padEnd(COL));
console.log();
process.stdout.write(''.padEnd(12));
for (const b of units) process.stdout.write('─'.repeat(COL - 1).padEnd(COL));
console.log();

for (const a of units) {
  process.stdout.write(a.name.slice(0, 11).padEnd(12));
  for (const b of units) {
    if (a.id === b.id) { process.stdout.write('—'.padEnd(COL)); continue; }
    const rA = simulateDuel(a, b, 'A'); // A initie
    const rB = simulateDuel(a, b, 'B'); // B initie
    const v = verdict(rA, rB);
    // Affiche résultat quand A initie
    const cell = `${v} T${rA.halfTurns}/${rA.hp}`;
    process.stdout.write(cell.slice(0, COL - 1).padEnd(COL));
  }
  console.log();
}

// ── Tableau des verdicts seuls (plus lisible) ────────────────────────────
console.log('\n\n╔══════════════════════════════════╗');
console.log('║  VERDICTS — QUI GAGNE (et comment) ║');
console.log('╚══════════════════════════════════╝');
console.log('A=ligne gagne toujours | B=colonne gagne tjrs | ini=initiative décide | def=défenseur gagne | =égalité\n');

const V = 10;
process.stdout.write(''.padEnd(12));
for (const b of units) process.stdout.write(b.name.slice(0, V - 1).padEnd(V));
console.log();
process.stdout.write(''.padEnd(12));
for (const b of units) process.stdout.write('─'.repeat(V - 1).padEnd(V));
console.log();

for (const a of units) {
  process.stdout.write(a.name.slice(0, 11).padEnd(12));
  for (const b of units) {
    if (a.id === b.id) { process.stdout.write('—'.padEnd(V)); continue; }
    const rA = simulateDuel(a, b, 'A');
    const rB = simulateDuel(a, b, 'B');
    process.stdout.write(verdict(rA, rB).padEnd(V));
  }
  console.log();
}

// ── Résumé par unité ────────────────────────────────────────────────────
console.log('\n\n╔══════════════════════════════════════════════════════╗');
console.log('║  RÉSUMÉ — score toutes initiatives confondues (22 matchups) ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(
  'Unité'.padEnd(14) +
  'Gagne tj'.padStart(9) +
  'Gagne ini'.padStart(11) +
  'Perd ini'.padStart(10) +
  'Perd tj'.padStart(9) +
  'Score/22'.padStart(10)
);
console.log('─'.repeat(63));

for (const a of units) {
  let wAlways = 0, wInit = 0, lInit = 0, lAlways = 0;
  for (const b of units) {
    if (a.id === b.id) continue;
    const rA = simulateDuel(a, b, 'A');
    const rB = simulateDuel(a, b, 'B');
    const v = verdict(rA, rB);
    if (v === 'A')   wAlways++;
    if (v === 'ini') wInit++;
    if (v === 'def') lInit++;
    if (v === 'B')   lAlways++;
  }
  const score = wAlways * 2 + wInit;
  console.log(
    a.name.padEnd(14) +
    String(wAlways).padStart(9) +
    String(wInit).padStart(11) +
    String(lInit).padStart(10) +
    String(lAlways).padStart(9) +
    String(score).padStart(10)
  );
}
