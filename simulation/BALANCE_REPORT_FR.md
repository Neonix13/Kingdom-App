# Kingdom Battleground — Rapport de Simulation d'Equilibrage

**Date :** 2026-03-26
**Total de parties simulees :** 24 200 (4 configurations x 6 050 parties chacune)
**Configurations testees :**

| Config | Budget | Initiative | Parties |
|--------|--------|-----------|---------|
| A | 5 000 | Normale (d20+strategie) | 6 050 |
| B | 10 000 | Normale (d20+strategie) | 6 050 |
| C | 5 000 | Desactivee (depart aleatoire, alternance) | 6 050 |
| D | 10 000 | Desactivee (depart aleatoire, alternance) | 6 050 |

**Caracteristiques de la simulation :** Vision/brouillard de guerre active, IA heuristique (construction d'armee, deploiement, combat), les 12 types d'unites, les 11 generaux, 50 parties par matchup (11x11=121 matchups par config).

---

## 1. Equilibrage des Generaux

### Taux de Victoire Global (moyenne des 4 configs, n≈4 400 par general)

| # | General | Royaume | Force | Strategie | PV | Victoire Moy. | IC 95% | Verdict |
|---|---------|---------|-------|-----------|-----|---------------|--------|---------|
| 1 | **Gai Mou** | WEI | 18 | 12 | 130 | **56.1%** | ±1.5% | Fort |
| 2 | **Mou Bu** | QIN | 18 | 12 | 130 | **56.0%** | ±1.5% | Fort |
| 3 | **Ren Pa** | ZHAO/WEI | 17 | 16 | 120 | **52.0%** | ±1.5% | Equilibre |
| 4 | **Shi Ba Shou** | ZHAO | 17 | 15 | 130 | **50.4%** | ±1.5% | Equilibre |
| 5 | **Ou Ki** | QIN | 15 | 16 | 110 | **46.4%** | ±1.5% | Legerement faible |
| 6 | **Kan Ki** | QIN | 14 | 16 | 100 | **42.4%** | ±1.5% | Faible |
| 7 | **Ou Sen** | QIN | 13 | 17 | 110 | **39.8%** | ±1.4% | Faible |
| 8 | **Kei Sha** | ZHAO | 13 | 16 | 100 | **36.5%** | ±1.4% | Faible |
| 9 | **Go Kei** | WEI | 14 | 17 | 90 | **37.2%** | ±1.4% | Faible |
| 10 | **Ri Boku** | ZHAO | 11 | 18 | 100 | **35.0%** | ±1.4% | Faible |
| 11 | **Go Hou Mei** | WEI | 10 | 18 | 80 | **24.4%** | ±1.3% | Tres faible |

*IC 95% calcule avec 1.96 × √(p(1-p)/n) ou n ≈ 4 400 parties par general (1 100 par config × 4 configs).*

### Detail des Taux de Victoire par Config (n≈1 100 par general par config, IC 95% ≈ ±3%)

| General | 5k Init | 10k Init | 5k SansInit | 10k SansInit |
|---------|---------|----------|-------------|--------------|
| Gai Mou | 55.4% | 57.5% | 54.8% | 56.5% |
| Mou Bu | 54.4% | 56.5% | 56.6% | 56.3% |
| Ren Pa | 49.7% | 53.1% | 48.9% | 56.2% |
| Shi Ba Shou | 47.6% | 52.4% | 49.4% | 52.0% |
| Ou Ki | 41.9% | 50.1% | 42.6% | 51.1% |
| Kan Ki | 39.3% | 47.4% | 35.9% | 47.0% |
| Ou Sen | 34.3% | 44.5% | 34.3% | 45.9% |
| Kei Sha | 29.1% | 42.8% | 32.5% | 41.4% |
| Go Kei | 31.9% | 42.1% | 32.0% | 42.6% |
| Ri Boku | 29.2% | 40.5% | 29.3% | 41.1% |
| Go Hou Mei | 17.9% | 32.2% | 16.3% | 31.2% |

*Les IC par config sont plus larges (~±3%) en raison de l'echantillon plus petit (n≈1 100).*

### Constat Cle : Force >> Strategie

Le constat le plus net des donnees : **les generaux avec une Force elevee dominent, tandis qu'une Strategie elevee n'apporte que peu d'avantage**.

- Les **4 premiers** generaux ont tous une Force >= 17. Leurs stats de combat (PV, armure, degats d'arme) les rendent dangereux au corps a corps et difficiles a tuer.
- Les **3 derniers** generaux ont tous une Strategie >= 17 mais une Force <= 14. Une strategie elevee donne de meilleurs jets d'initiative, mais ca ne compense pas des stats de combat faibles.
- **Go Hou Mei** est le cas extreme : strategie la plus haute (18) mais force la plus basse (10), PV les plus bas (80), armure la plus basse (17). Il perd systematiquement dans toutes les configs.

Le systeme d'initiative (d20 + strategie) a ete teste en le desactivant completement. **Resultat : quasiment aucune difference** (< 3% d'ecart pour la plupart des generaux). Jouer en premier offre un leger avantage mais ne surmonte pas les deficits de stats.

### Constat Cle : Le Budget Resserre l'Equilibre

A 10k de budget, les taux de victoire convergent davantage vers 50% qu'a 5k :
- **Ecart a 5k :** 16-57% (plage de 41 points)
- **Ecart a 10k :** 31-58% (plage de 27 points)

Avec des armees plus grandes, le combat individuel du general compte moins car il represente une plus petite fraction de la puissance totale. L'equilibrage est donc plus sensible a bas budget.

---

## 2. Efficacite des Unites

### Taux de Survie (moyenne de toutes les configs)

| # | Unite | Categorie | Cout | Survie | IC 95% | PV Perdus Moy. | Verdict |
|---|-------|-----------|------|--------|--------|----------------|---------|
| 1 | Archer d'Elite | Tireurs | 900 | **73.2%** | ±0.4% | 27.4% | Meilleure unite |
| 2 | Archer | Tireurs | 600 | **71.0%** | ±0.3% | 32.7% | Meilleur rapport qualite/prix |
| 3 | Char | Chars | 1600 | **59.0%** | ±0.5% | 43.5% | Fort mais cher |
| 4 | Cavalier Lourd | Chevaux | 1200 | **55.9%** | ±0.5% | 47.7% | Bon |
| 5 | Phalange | Infanterie | 700 | **52.7%** | ±0.3% | 53.2% | Tank solide |
| 6 | Pietaille | Infanterie | 400 | **42.1%** | ±0.3% | 66.3% | Chair a canon correcte |
| 7 | Soldats | Infanterie | 600 | **41.0%** | ±0.3% | 64.2% | Moyen |
| 8 | Batisseurs | Chars | 1000 | **35.3%** | ±0.5% | 71.8% | Faible pour le cout |
| 9 | Cavalier Leger | Chevaux | 900 | **33.1%** | ±0.4% | 70.3% | Sous-performe |
| 10 | Lancier | Infanterie | 700 | **27.9%** | ±0.3% | 77.4% | Faible |
| 11 | Assassin | Infanterie | 800 | **26.7%** | ±0.4% | 76.3% | Canon de verre |
| 12 | Espion | Infanterie | 600 | **20.8%** | ±0.3% | 84.3% | Pire unite |

*Les IC des unites sont tres serres (< ±0.5%) car chaque type d'unite est deploye des milliers de fois sur 24 200 parties.*

### Constat Cle : Les Unites a Distance Dominent

Les Archers et Archers d'Elite ont de loin les meilleurs taux de survie (70-73%) et les moins de PV perdus (27-33%). Cela s'explique par :
1. **Avantage de portee** — ils attaquent a 3-4 hexagones de distance, obtenant souvent plusieurs tirs gratuits avant que les unites de melee ne se rapprochent
2. **Pas de test de defense** — les attaques a distance ignorent completement le jet de defense
3. **Priorite de l'IA** — ils agissent en premier dans l'ordre du tour (Tireurs en priorite 0), donc ils attaquent avant de subir des degats

**Les Archers sont la meilleure unite rapport qualite/prix du jeu** a 600g avec 71% de survie.

### Constat Cle : Plusieurs Unites Sous-Performent par Rapport a Leur Cout

| Unite | Cout | Probleme |
|-------|------|----------|
| **Espion** (600g) | Pire survie (20.8%), perd 84% de PV en moyenne. Capacite de sabotage inutilisee en simulation. En pratique, pire que la Pietaille. |
| **Lancier** (700g) | 27.9% de survie malgre le bonus anti-cavalerie. Le bonus est trop situationnel et n'aide pas contre l'infanterie ou les tireurs. |
| **Cavalier Leger** (900g) | 33% de survie a 900g. La vitesse (6) devrait aider au flanquement mais les PV bas (150) et la defense faible (7) le rendent fragile. |
| **Batisseurs** (1000g) | 35% de survie. Capacite de construction inutilisee en simulation. En tant qu'unite de combat, largement surpaye. |

### Constat Cle : L'Assassin Est une Unite Clivante

L'Assassin a 26.7% de survie mais ses stats racontent une histoire interessante : puissance la plus haute (22) et armure la plus haute (18) parmi l'infanterie, mais seulement 100 PV. C'est un canon de verre — devastateur quand il touche mais meurt vite. A 800g c'est cher vu sa frequence de mort.

---

## 3. Analyse des Matchups

### Matchups les Plus Desequilibres (budget 10k, avec initiative, n=50 par matchup)

| Matchup | Victoire J1 | IC 95% | Note |
|---------|-------------|--------|------|
| Gai Mou vs Go Hou Mei | **91%** | ±7.9% | Le plus desequilibre |
| Mou Bu vs Go Hou Mei | **85%** | ±9.9% | La force ecrase la strategie |
| Mou Bu vs Kei Sha | **83%** | ±10.4% | |
| Ren Pa vs Ri Boku | **79%** | ±11.3% | |
| Gai Mou vs Kei Sha | **78%** | ±11.5% | |

### Matchups les Plus Equilibres (budget 10k, n=50 par matchup)

| Matchup | Victoire J1 | IC 95% |
|---------|-------------|--------|
| Ou Ki miroir | 51% | ±13.9% |
| Shi Ba Shou miroir | 47% | ±13.8% |
| Ou Ki vs Ou Sen | 50% | ±13.9% |
| Kan Ki vs Ri Boku | 48% | ±13.8% |

*Les IC par matchup individuel sont larges (~±14% a 50%) car n=50 par matchup. Les taux de victoire globaux par general sont bien plus precis car ils agregent les 11 adversaires.*

### Matchups Asymetriques Interessants

Certains matchups ou l'ordre de jeu compte significativement (J1 vs J2 differe de > 15%) :
- **Shi Ba Shou vs Mou Bu** : 47% en J1, mais Mou Bu vs Shi Ba Shou donne seulement 54% — relativement equilibre
- **Ren Pa vs Mou Bu** : 61% en J1, mais Mou Bu vs Ren Pa donne 56% — Ren Pa a un leger avantage

---

## 4. Analyse du Systeme d'Initiative

Comparaison initiative (d20 + strategie) vs desactivee (depart aleatoire, alternance). Chaque colonne moyenne 2 configs (5k + 10k), n≈2 200 par general par colonne, IC 95% ≈ ±2%.

| General | Strategie | Avec Initiative | Sans | Delta |
|---------|-----------|----------------|------|-------|
| Go Hou Mei | 18 | 25.1% | 23.8% | -1.3 |
| Ri Boku | 18 | 34.9% | 35.2% | +0.3 |
| Ou Sen | 17 | 39.4% | 40.1% | +0.7 |
| Go Kei | 17 | 37.0% | 37.3% | +0.3 |
| Kan Ki | 16 | 43.4% | 41.5% | -1.9 |
| Ou Ki | 16 | 46.0% | 46.9% | +0.9 |
| Kei Sha | 16 | 36.0% | 37.0% | +1.0 |
| Ren Pa | 16 | 51.4% | 52.6% | +1.2 |
| Shi Ba Shou | 15 | 50.0% | 50.7% | +0.7 |
| Mou Bu | 12 | 55.5% | 56.5% | +1.0 |
| Gai Mou | 12 | 56.5% | 55.7% | -0.8 |

*Tous les deltas sont dans la marge d'IC de ±2%, confirmant qu'aucun n'est statistiquement significatif.*

**Conclusion : L'initiative a un impact negligeable sur l'equilibrage.** Les differences sont dans le bruit statistique (< 3%). Les generaux a haute strategie ne beneficient pas significativement de jouer en premier. La valeur principale de la stat Strategie reside dans la portee de vision, pas dans l'ordre des tours.

---

## 5. Recommandations d'Equilibrage

### Corrections Urgentes

1. **Go Hou Mei a besoin d'un buff significatif.** A 24% de taux de victoire moyen, il est injouable. Options :
   - Augmenter les PV de 80 a 100-110
   - Augmenter la force de 10 a 13-14
   - Lui donner un passif unique qui exploite sa haute strategie (ex : vision etendue pour toutes les unites, redeploiement strategique, pose de pieges)

2. **Ri Boku a besoin d'un buff modere.** A 35% de taux de victoire avec la plus haute strategie, l'archetype du "maitre stratege" ne fonctionne pas. Options :
   - Augmenter la force de 11 a 13
   - Donner aux generaux bases sur la strategie un passif qui scale avec la strategie (bonus aux unites a distance, buffs d'armee)

### A Considerer

3. **L'Espion a besoin d'un rework.** Pire survie, pire retention de PV. La capacite de sabotage n'a aucune valeur en combat standard. Options :
   - Reduire le cout de 600 a 400
   - Augmenter les PV ou donner une mecanique de furtivite/esquive
   - Rendre le sabotage plus impactant

4. **L'Archer / Archer d'Elite est peut-etre trop fort.** Des taux de survie de 70-83% sont des valeurs aberrantes. L'absence de test de defense sur les attaques a distance leur donne des degats gratuits. Options :
   - Reduire la portee de 1 (archer : 2, elite : 3)
   - Permettre un test de defense a courte portee (1-2 hexagones)
   - Reduire legerement les PV

5. **Le bonus anti-cavalerie du Lancier est trop niche.** Il n'aide que contre 2 des 12 types d'unites. Envisager de l'elargir (ex : anti-cavalerie ET anti-charge, ou bonus sur terrain defensif).

### Fonctionne Comme Prevu

- **Gai Mou & Mou Bu** sont forts mais pas casses (~56%). Leur faiblesse est une strategie basse = portee de vision courte, ce que le systeme de brouillard de guerre penalise correctement.
- **Ren Pa** est le general fort le mieux equilibre (~52%) — stats elevees sur toute la ligne sans valeur aberrante.
- **Phalange** est un tank bien concu (53% de survie, bonne defense, cout raisonnable).
- **Char** est cher mais justifie (59% de survie, puissance devastatrice de 30).

---

## 6. Notes Methodologiques

- **Agent IA** : Base sur des heuristiques (pas aleatoire). Construit des armees equilibrees, deploie tactiquement (infanterie devant, tireurs au milieu, cavalerie sur les flancs, general a l'arriere), prend des decisions de combat basees sur la priorite des cibles (generaux > blesses > en fuite), utilise les postures contextuellement.
- **Vision** : Brouillard de guerre active. L'IA ne voit que les ennemis dans la portee de vision partagee de ses unites. Quand aucun ennemi n'est visible, les unites avancent vers le territoire ennemi.
- **Carte** : Generee aleatoirement a chaque partie (terrain, hauteur, segments). Les zones de deploiement varient.
- **Limite** : L'IA n'utilise pas les capacites specifiques des unites (sabotage, construction, embuscade, pietinement). Les unites qui dependent de ces capacites (Espion, Batisseurs) obtiennent des scores inferieurs a ce qu'elles auraient avec des joueurs humains.
- **Limite** : L'IA utilise une strategie de composition d'armee fixe. Des joueurs humains pourraient trouver des compositions optimales significativement differentes.
