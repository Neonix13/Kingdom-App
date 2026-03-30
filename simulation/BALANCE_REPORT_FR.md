# Kingdom Battleground — Rapport de Simulation d'Equilibrage

**Date :** 2026-03-30 (rev. dégâts par unité)
**Total de parties simulees :** 6 050
**Configuration :** Budget 10 000 | Initiative normale (d20+strategie) | 50 parties par matchup (121 matchups)

**Parametres d'unite :** Archer armure 6, Archer d'Elite armure 8 (nerf applique).
**Caracteristiques :** Vision/brouillard de guerre active, IA heuristique, 12 types d'unites, 11 generaux, 50 parties par matchup (121 matchups par config).

---

## 1. Equilibrage des Generaux

### Taux de Victoire Global (n=1 100 par general)

| # | General | Royaume | Force | Strategie | PV | Victoire | IC 95% | Verdict |
|---|---------|---------|-------|-----------|-----|----------|--------|---------|
| 1 | **Gai Mou** | WEI | 18 | 12 | 130 | **67.4%** | ±2.8% | Trop fort |
| 2 | **Mou Bu** | QIN | 18 | 12 | 130 | **66.7%** | ±2.8% | Trop fort |
| 3 | **Ren Pa** | ZHAO/WEI | 17 | 16 | 120 | **61.8%** | ±2.9% | Fort |
| 4 | **Shi Ba Shou** | ZHAO | 17 | 15 | 130 | **58.2%** | ±2.9% | Fort |
| 5 | **Ou Ki** | QIN | 15 | 16 | 110 | **53.5%** | ±2.9% | Equilibre |
| 6 | **Kan Ki** | QIN | 14 | 16 | 100 | **49.8%** | ±3.0% | Equilibre |
| 7 | **Ou Sen** | QIN | 13 | 17 | 110 | **44.6%** | ±2.9% | Legerement faible |
| 8 | **Kei Sha** | ZHAO | 13 | 16 | 100 | **42.5%** | ±2.9% | Faible |
| 9 | **Ri Boku** | ZHAO | 11 | 18 | 100 | **41.2%** | ±2.9% | Faible |
| 10 | **Go Kei** | WEI | 14 | 17 | 90 | **41.2%** | ±2.9% | Faible |
| 11 | **Go Hou Mei** | WEI | 10 | 18 | 80 | **22.5%** | ±2.5% | Tres faible |

### Constat Cle : Force >> Strategie (confirme)

Les 4 premiers ont tous Force >= 17. Les 4 derniers ont Force <= 14 malgre une haute Strategie. Go Hou Mei reste injouable a ~22.5%.

---

## 2. Efficacite des Unites

### Taux de Survie (n=6 050 parties)

| # | Unite | Categorie | Cout | Armure | Survie | IC 95% | Dmg infligés/u | Dmg reçus/u | Verdict |
|---|-------|-----------|------|--------|--------|--------|----------------|-------------|---------|
| 1 | Archer d'Elite | Tireurs | 900 | 8 | **97.4%** | ±0.2% | **88** | 7 | Trop fort |
| 2 | Archer | Tireurs | 600 | 6 | **95.2%** | ±0.3% | **42** | 17 | Trop fort |
| 3 | Char | Chars | 1600 | 25 | **86.8%** | ±0.9% | **107** | 12 | Tres fort |
| 4 | Cavalier Lourd | Chevaux | 1200 | 18 | **80.7%** | ±0.9% | **96** | 23 | Fort |
| 5 | Phalange | Infanterie | 700 | 9 | **74.5%** | ±0.8% | 70 | 66 | Tank solide |
| 6 | Piétaille | Infanterie | 400 | 5 | **70.8%** | ±0.5% | 47 | 122 | Reference |
| 7 | Cavalier Leger | Chevaux | 900 | 12 | **67.9%** | ±1.0% | 58 | 57 | Correct |
| 8 | Soldats | Infanterie | 600 | 8 | **66.9%** | ±0.8% | 77 | 81 | Correct |
| 9 | Batisseurs | Chars | 1000 | 9 | **66.9%** | ±1.1% | 11 | 61 | Correct (hors combat) |
| 10 | Assassin | Infanterie | 800 | 18 | **66.6%** | ±0.9% | **92** | 38 | Correct |
| 11 | Lancier | Infanterie | 700 | 8 | **53.3%** | ±0.9% | 56 | 111 | Faible |
| 12 | Espion | Infanterie | 600 | 7 | **50.3%** | ±0.9% | 36 | 147 | Faible |

### Analyse des Dommages

**Dégâts infligés par unité** (dmg HP réels appliqués à l'ennemi, moyenne par unité par partie) :
- Char (107) et Archer d'Elite (88) sont les unités les plus destructrices.
- Assassin (92) et Cavalier Lourd (96) également très offensifs malgré leur coût.
- Bâtisseurs (11) : quasiment pas de dégâts — rôle purement utilitaire confirmé.
- Espion (36) et Archer (42) : ratio dégâts/survie mauvais, l'Espion reçoit 147 dmg pour n'en infliger que 36.

**Les archers dominent structurellement** (aucun test de défense sur les attaques à distance) :
- Archer d'Elite : 88 dmg infligés, seulement 7 reçus → ratio 12.6:1
- Archer : 42 infligés, 17 reçus → ratio 2.5:1
- La mécanique `ranged_no_defense` est le vrai problème, pas l'armure.

---

## 3. Analyse des Matchups

### Matchup Matrix (ligne = J1, colonne = J2, valeur = % victoire J1)

```
          Ou Ki  Mou Bu  Ou Sen  Kan Ki  Ri Boku Kei Sha ShiBaSh  Ren Pa  Go Kei  GoHouM  Gai Mou
Ou Ki       58%    42%    44%    42%     56%     66%     50%     40%     72%     87%     44%
Mou Bu      64%    48%    70%    78%     71%     78%     50%     55%     74%     88%     56%
Ou Sen      34%    32%    50%    48%     58%     48%     32%     26%     52%     78%     22%
Kan Ki      44%    28%    44%    44%     66%     50%     54%     36%     64%     80%     38%
Ri Boku     46%    16%    43%    40%     48%     54%     37%     34%     50%     62%     26%
Kei Sha     40%    26%    56%    38%     54%     50%     36%     30%     48%     78%     20%
Shi Ba S    62%    38%    63%    54%     68%     64%     36%     50%     64%     84%     42%
Ren Pa      62%    44%    74%    74%     68%     64%     50%     40%     60%     84%     40%
Go Kei      34%    28%    40%    34%     46%     54%     24%     36%     40%     74%     28%
Go Hou M    12%     8%    34%    24%     30%     30%     18%      6%     24%     44%     12%
Gai Mou     66%    52%    77%    76%     82%     84%     56%     46%     84%     88%     48%
```

### Matchups les Plus Desequilibres

| Matchup | Victoire J1 | Note |
|---------|-------------|------|
| Gai Mou vs Go Hou Mei | 88% | Le plus desequilibre |
| Mou Bu vs Go Hou Mei | 88% | |
| Gai Mou vs Kei Sha | 84% | |
| Shi Ba Shou vs Go Hou Mei | 84% | |
| Ren Pa vs Go Hou Mei | 84% | |
| Gai Mou vs Go Kei | 84% | |
| Mou Bu vs Kan Ki | 78% | |

---

## 4. Recommandations d'Equilibrage

### Corrections Urgentes

1. **Go Hou Mei toujours injouable (23%).** Le nerf archer n'a pas aide. Buff necessaire :
   - Augmenter PV de 80 a 110
   - Augmenter Force de 10 a 13
   - Passif exploitant la haute Strategie (bonus aux unites a distance, vision etendue)

2. **Les Archers restent trop forts (95-97%).** Ratio dmg infligé/reçu : 12.6:1 (Elite) et 2.5:1 (Archer). Solutions :
   - Permettre un test de defense a courte portee (dist 1-2)
   - Reduire la portee (Archer : 3→2, Elite : 4→3)
   - Reduire la vitalite ou la puissance

3. **Gai Mou / Mou Bu trop forts (67%).** Force 18 trop avantageuse. Option : reduire leur force a 16-17.

### A Considerer

4. **Ri Boku / Go Hou Mei (haute Strategie)** ne beneficient pas de leur stat principale. Envisager des mecaniques qui scalent avec la Strategie : bonus aux unites alliees, portee de vision etendue pour toute l'armee, malus aux ennemis.

5. **Lancier et Espion** toujours en bas (50-54%). Bonus anti-cavalerie trop situationnel en simulation. Reduire leur cout ou ameliorer leur survie de base.

### Fonctionne Comme Prevu

- **Ren Pa / Shi Ba Shou** forts (~62%) mais pas casses, stats equilibrees.
- **Ou Ki** bien centre (54%), general de reference.
- **Char** justifie son cout (88%, puissance 30).
- **Cavalier Lourd** bonne unite a 1200g (82%).
- **Cavalier Leger** correct (70%).

---

## 5. Notes Methodologiques

- **Agent IA** : Heuristique. Construction d'armee aleatoire par poches (infanterie ~30%, tireurs ~20-25%, cavalerie/chars ~25-35% avec variation). Deploiement tactique. Combat base sur priorite des cibles.
- **Budget :** 10 000 or par joueur.
- **Vision** : Brouillard de guerre active. Portee = Strategie cases.
- **Stances** : 6 stances utilisees par l'IA selon distance et etat de l'unite.
- **Dégâts** : "Dmg infligés" = dégâts HP réels appliqués à l'ennemi (après absorption armure). "Dmg reçus" = HP perdus par l'unité (combat + contre-attaque).
- **Limite** : L'IA n'utilise pas les capacites speciales (sabotage, construction, embuscade). Espion et Batisseurs obtiennent des scores inferieurs a leur potentiel reel. Les Bâtisseurs n'infligent que 11 dmg/unité ce qui confirme leur role non-combat.
