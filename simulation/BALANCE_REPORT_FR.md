# Kingdom Battleground — Rapport de Simulation d'Equilibrage

**Date :** 2026-04-03 (nouveau système de combat N_Go D20 + stats unités refondues)
**Formule de combat :** N_Go = ⌊Vitalité/5⌋ dés D20 lancés, touche si ≤ attaque. Dégâts = Touches × Puissance × (1 − Armure/(Armure+100)) × (1+ΔH/10) / 10.

---

## SIMULATION A — Budget 2 500 (30 parties/matchup, 3 630 total)

Budget réaliste de partie. **Cavalier Lourd et Char jamais achetés** (trop chers, 1 200 et 1 600g).

### Taux de Victoire des Généraux

| # | General | Force | Strat | PV | Victoire | IC 95% | Verdict |
|---|---------|-------|-------|----|----------|--------|---------|
| 1 | **Gai Mou** | 18 | 12 | 130 | **73.8%** | ±3.4% | Trop fort |
| 2 | **Mou Bu** | 18 | 12 | 130 | **71.1%** | ±3.5% | Trop fort |
| 3 | **Shi Ba Shou** | 17 | 15 | 130 | **66.7%** | ±3.6% | Trop fort |
| 4 | **Ren Pa** | 17 | 16 | 120 | **62.7%** | ±3.7% | Fort |
| 5 | **Ou Ki** | 15 | 16 | 110 | **52.1%** | ±3.8% | Equilibre ✓ |
| 6 | **Kan Ki** | 14 | 16 | 100 | **44.4%** | ±3.8% | Legerement faible |
| 7 | **Ou Sen** | 13 | 17 | 110 | **43.0%** | ±3.8% | Legerement faible |
| 8 | **Kei Sha** | 13 | 16 | 100 | **39.7%** | ±3.7% | Faible |
| 9 | **Go Kei** | 14 | 17 | 90 | **37.6%** | ±3.7% | Faible |
| 10 | **Ri Boku** | 11 | 18 | 100 | **35.6%** | ±3.7% | Faible |
| 11 | **Go Hou Mei** | 10 | 18 | 80 | **23.3%** | ±3.2% | Injouable |

### Survie des Unités (budget 2 500)

| Unite | Survie | Dmg infliges | Dmg recus | Note |
|-------|--------|--------------|-----------|------|
| Archer | 98.9% | 29 | 9 | Trop fort |
| Archer d'Elite | 98.7% | 39 | 7 | Trop fort |
| Piétaille | 94.7% | 31 | 72 | Solide (masse) |
| Phalange | 94.2% | 65 | 54 | Tank solide |
| Soldats | 93.5% | 57 | 55 | Correct |
| Lancier | 87.4% | 87 | 83 | Correct |
| Espion | 84.0% | 40 | 109 | Fragile |
| Batisseurs | 72.1% | 9 | 79 | Utilitaire |
| Cavalier Leger | 68.2% | 51 | 88 | Correct |
| Assassin | 59.0% | 55 | 70 | Tres fragile |
| Cavalier Lourd | — | — | — | Non utilise |
| Char | — | — | — | Non utilise |

---

## SIMULATION B — Budget 100 000 (30 parties/matchup, 3 630 total)

Budget extrême. Toutes les unités sont achetées en grande quantité. Les grandes armées nivellent la variance. **Aucun flag de déséquilibre.**

### Taux de Victoire des Généraux

| # | General | Force | Strat | PV | Victoire | IC 95% | Verdict |
|---|---------|-------|-------|----|----------|--------|---------|
| 1 | **Mou Bu** | 18 | 12 | 130 | **56.5%** | ±3.8% | Legerement fort |
| 2 | **Ren Pa** | 17 | 16 | 120 | **52.4%** | ±3.8% | Equilibre ✓ |
| 3 | **Ou Ki** | 15 | 16 | 110 | **52.0%** | ±3.8% | Equilibre ✓ |
| 4 | **Gai Mou** | 18 | 12 | 130 | **52.0%** | ±3.8% | Equilibre ✓ |
| 5 | **Shi Ba Shou** | 17 | 15 | 130 | **51.7%** | ±3.8% | Equilibre ✓ |
| 6 | **Kan Ki** | 14 | 16 | 100 | **51.2%** | ±3.8% | Equilibre ✓ |
| 7 | **Ou Sen** | 13 | 17 | 110 | **48.9%** | ±3.8% | Equilibre ✓ |
| 8 | **Go Kei** | 14 | 17 | 90 | **47.6%** | ±3.8% | Equilibre ✓ |
| 9 | **Kei Sha** | 13 | 16 | 100 | **47.3%** | ±3.8% | Equilibre ✓ |
| 10 | **Go Hou Mei** | 10 | 18 | 80 | **46.7%** | ±3.8% | Equilibre ✓ |
| 11 | **Ri Boku** | 11 | 18 | 100 | **43.8%** | ±3.8% | Legerement faible |

**Écart max : 12.7 points** (Mou Bu 56.5% vs Ri Boku 43.8%). Aucun général hors norme.

### Survie des Unités (budget 100 000)

| Unite | Survie | Dmg infliges | Dmg recus | Note |
|-------|--------|--------------|-----------|------|
| Archer | **92.6%** | 52 | 34 | Trop fort |
| Archer d'Elite | **92.3%** | 79 | 28 | Trop fort |
| Piétaille | **78.9%** | 26 | 110 | Masse correcte |
| Batisseurs | **73.1%** | 6 | 61 | Utilitaire pur |
| Cavalier Leger | **70.3%** | 49 | 69 | Correct |
| Cavalier Lourd | **63.7%** | 52 | 51 | Equilibre ✓ |
| Phalange | **60.1%** | 37 | 107 | Fragile (surprenant) |
| Soldats | **57.7%** | 34 | 110 | Fragile |
| Espion | **57.6%** | 22 | 139 | Tres fragile |
| Char | **57.1%** | 50 | 42 | Correct |
| Lancier | **52.8%** | 39 | 122 | Tres fragile |
| Assassin | **34.9%** | 27 | 75 | Injouable |

### Matchup Matrix — Budget 100 000

```
          Ou Ki  Mou Bu  Ou Sen  Kan Ki  Ri Boku Kei Sha ShiBaSh  Ren Pa  Go Kei  GoHouM  Gai Mou
Ou Ki       43%    43%    37%    63%     60%     53%     53%     53%     47%     63%     47%
Mou Bu      57%    43%    70%    47%     57%     57%     43%     37%     50%     63%     60%
Ou Sen      30%    40%    57%    50%     53%     37%     43%     43%     50%     60%     47%
Kan Ki      60%    43%    50%    47%     53%     50%     47%     47%     63%     40%     43%
Ri Boku     37%    47%    30%    40%     27%     53%     57%     47%     30%     53%     57%
Kei Sha     40%    47%    47%    50%     47%     67%     57%     33%     50%     60%     40%
Shi Ba S    67%    30%    53%    60%     77%     43%     67%     43%     37%     47%     40%
Ren Pa      53%    37%    53%    30%     57%     60%     47%     47%     60%     67%     43%
Go Kei      30%    40%    50%    37%     67%     43%     33%     37%     60%     50%     50%
Go Hou M    50%    37%    37%    37%     57%     70%     37%     57%     47%     43%     53%
Gai Mou     53%    33%    50%    57%     60%     63%     43%     57%     57%     50%     57%
```

---

## Analyse Comparée A vs B

### Généraux — L'écart se resserre massivement avec le budget

| General | Victoire 2 500 | Victoire 100 000 | Delta |
|---------|---------------|-----------------|-------|
| Gai Mou | 73.8% | 52.0% | **-21.8%** |
| Mou Bu | 71.1% | 56.5% | **-14.6%** |
| Shi Ba Shou | 66.7% | 51.7% | **-15.0%** |
| Ren Pa | 62.7% | 52.4% | -10.3% |
| Ou Ki | 52.1% | 52.0% | stable |
| Go Hou Mei | 23.3% | 46.7% | **+23.4%** |
| Ri Boku | 35.6% | 43.8% | +8.2% |

**Constat : les généraux à Force élevée dominent à petit budget** (peu d'unités → chaque combat compte → le général fait la différence). A grand budget, les grandes armées gomment cet avantage. Ou Ki reste la référence stable dans les deux cas.

### Unités — Problèmes persistants

**Archers toujours trop forts dans les deux simulations** (98.9% → 92.6%). La mécanique `ranged_no_defense` reste le problème structurel indépendamment du budget.

**Assassin injouable à grand budget (34.9%)** : à 2500g il s'en sort mieux (59%) car les armées sont plus petites et son burst compte. A 100k il se fait submerger — 100 PV / armure 6 ne tient pas face à une masse d'unités.

**Phalange étonnamment faible à grand budget (60.1%)** : armure 15 / defense 18 semblent insuffisants face aux grandes masses. Reçoit 107 dmg, n'en inflige que 37 — rôle défensif mal exploité par l'IA.

**Cavalier Lourd (63.7%) et Char (57.1%) équilibrés** : stats refondues correctes.

---

## Recommandations

### Urgentes

1. **Archers** : `ranged_no_defense` les rend structurellement invincibles. Solutions :
   - Permettre une contre-attaque à portée 1 (touche adjacente)
   - Ou réduire vitalité (Archer 240→160, Élite 200→140)

2. **Assassin** : injouable à grand budget (34.9%). 100 PV / armure 6 trop fragile. Buff : armure 12-15, ou PV 150.

3. **Go Hou Mei** : injouable à petit budget (23.3%) mais se rétablit à grand budget (46.7%) — le problème vient de son rôle : Force 10 trop faible pour les petites parties où le général combat souvent. Augmenter Force 10→13 ou PV 80→110.

### A Surveiller

4. **Phalange** : bon à petit budget (94.2%), médiocre à grand budget (60.1%) — son rôle de tank anti-tir n'est pas exploité par l'IA. A réévaluer avec un joueur humain.

5. **Lancier** : reçoit trop de dégâts (122/u à 100k). Bonus anti-cavalerie trop situationnel.

### Fonctionne Correctement

- **Généraux à grand budget** : distribution quasi-parfaite (44-56%), le système N_Go avec grandes armées est bien équilibré.
- **Ou Ki** : référence stable dans toutes les conditions (~52%).
- **Cavalier Lourd / Char** : stats refondues correctes, ratio dmg ~1:1.
- **Cavalier Léger** : correct (70.3%), bon rapport coût/efficacité.

---

## Notes Méthodologiques

- **Agent IA** : Heuristique. Ne joue pas les capacités spéciales (sabotage, construction, ambush, charge). Espion et Bâtisseurs sous-évalués par rapport à leur potentiel réel.
- **Vision** : Brouillard de guerre actif, portée = Stratégie cases.
- **Modificateur de hauteur** : actif dans les deux simulations.
- **Limite budget 2 500** : Cavalier Lourd (1 200g) et Char (1 600g) non achetés par l'IA car trop coûteux proportionnellement.
