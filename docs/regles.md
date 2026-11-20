# Kingdom Battleground — Règles du jeu

Référence des règles telles qu'elles sont appliquées par le serveur. Les valeurs réglables se trouvent dans `public/js/rules.js` (fichier partagé serveur / navigateur) et dans les données d'équilibrage (`data/balance/*.json`).

## 1. Déroulé d'une partie

1. **Salle** : l'hôte choisit la carte, le budget, le mode et les paramètres (voir §12). Chaque joueur choisit un général et une couleur.
2. **Armée** : chaque joueur achète ses unités dans la limite du budget. Le général est ajouté gratuitement.
3. **Déploiement** : chacun place ses unités dans sa zone de départ (jamais sur une rivière), le général compris, puis clique « Prêt ». Les positions adverses ne sont pas visibles.
4. **Bataille** : tours successifs jusqu'à la victoire (§9).

Deux modes de tour (réglage de l'hôte) : **séquentiel** (initiative, §2, décrit ci-dessous) et **simultané** (ordres secrets donnés en même temps puis résolus ensemble, case par case) — voir [mode-simultane.md](mode-simultane.md). Toutes les autres règles (déplacement, combat, nuit, vision, duels, objectifs, victoire) sont communes.

## 2. Tours, manches et initiative (mode séquentiel)

- Un **tour** est un passage de tous les joueurs ; chaque joueur y joue une **manche**.
- Au début de chaque tour, l'**initiative** est relancée : Stratégie du général + D20 (égalité : le plus haut D20). L'ordre de jeu suit ce total, du plus grand au plus petit.
- Pendant sa manche, un joueur peut, pour chaque unité :

| Action | Coût |
|---|---|
| Se déplacer | coût du chemin (§3) |
| Pivoter (clic droit) | 1 vitesse |
| Changer de posture | 2 vitesse |
| Attaquer | toute la vitesse restante (au moins 1), une attaque par manche |
| Motiver (général) | toute la vitesse restante (au moins 1), remplace l'attaque du général |
| Capacité active (général) | une fois par manche, puis temps de recharge |

- **Fin de manche automatique** : dès qu'aucune unité ne peut plus agir (ni bouger, ni attaquer une cible visible à portée, ni motiver une unité démoralisée, ni utiliser la capacité), la manche se termine toute seule.
- **Confirmation** : terminer sa manche alors que des unités peuvent encore agir demande une confirmation.
- **Minuteur** (optionnel, réglage de salle) : la manche se termine automatiquement à l'expiration.
- **Joueur absent** : sa manche passe au bout de 60 s (30 s les manches suivantes) ; abandon après 10 min d'absence.

## 3. Déplacement

La vitesse d'une unité est recalculée au début de chacune de ses manches : vitesse de base + modificateur de posture + modificateur du terrain occupé (−1 supplémentaire la nuit, minimum 1).

Chaque pas coûte le **coût du terrain que l'on quitte** :

| Terrain quitté | Coût |
|---|---|
| Route | 1/3 |
| Plaine, bâtiment, pont | 1 |
| Forêt, fleuve | 2 |

Puis on ajoute :

| Situation | Effet |
|---|---|
| **Pente montante** (case plus haute, sans falaise) | +1 par niveau gravi |
| Pente descendante | gratuite |
| Rivière (segment) | +1 |
| Barrière | +1 |
| **Falaise** | **infranchissable** (pour tout le monde) |
| **Mur** | **infranchissable** |
| **Échelle** | coût fixe de **3** (pente ignorée) — infanterie et généraux seulement |
| Cavalerie et chars | ne franchissent jamais falaises, murs ni échelles |

- On ne traverse pas une case occupée par une unité visible.
- **Embuscade** : si le chemin rencontre une unité ennemie cachée (§7), l'unité s'arrête net devant elle et perd le reste de sa vitesse pour la manche ; l'embusqué est révélé.
- Les falaises bloquent le passage mais pas la vue.

## 4. Postures

Changer de posture coûte 2 de vitesse (les généraux n'ont pas de posture). Chaque posture modifie vitesse, attaque, défense, puissance, intimidation, esquive, précision et armure (au corps à corps et au tir) — détail dans l'infobulle de chaque posture.

| Posture | En bref |
|---|---|
| Marche | +1 vitesse, plus fragile |
| Combat | équilibrée, bonus d'attaque et de puissance, −1 vitesse |
| Charge | +2 vitesse, gros bonus de mêlée, −1 moral par manche |
| Percée | +1 vitesse, bonus de mêlée |
| Défense de combat | forte défense et armure au corps à corps, −1 vitesse ; **renforcée la nuit** (+5 moral par manche) |
| Défense à distance | forte esquive contre le tir |
| **Repos** | −2 vitesse, combat très affaibli ; +5 moral et +2 vitalité par manche ; **la nuit : +20 moral et +5 vitalité supplémentaires** |

## 5. Combat

**Portée** : 1 case (mêlée) ou la portée de l'unité (archers 3, archers d'élite 4), +1 par niveau de hauteur au-dessus de la cible. La cible doit être visible (§7).

1. **Jet d'attaque** : D20 ≤ attaque + posture + terrain + segment − esquive de la cible + différence de hauteur (+ malus de nuit). Les généraux utilisent leur Force.
2. **Dégâts** : (vitalité de l'attaquant) dés de (puissance effective), multipliés par 1 + hauteur/10, moins l'absorption de l'armure (vitalité × armure de la cible), divisés par 10.
3. **Moral** : l'intimidation de l'attaquant fait perdre du moral ; à 0 de moral, l'unité **fuit** vers le bord de la carte (elle peut être remotivée).
4. **Réponse du défenseur** (20 s pour choisir, sinon « Rien ») :
   - **Rien** : aucun jet.
   - **Contre-attaquer** (mêlée) : jet de défense ; s'il réussit, le défenseur rend les coups.
   - **Encaisser** : jet de défense ; s'il réussit, dégâts et perte de moral divisés par deux, et demi-riposte en mêlée.
   - Contre un tir : seule la **phalange** peut encaisser ; personne ne contre-attaque.
5. L'attaquant et le défenseur qui riposte se tournent l'un vers l'autre.

**Motivation** (général) : D20 ≤ Charisme → toutes les unités alliées à moins de Charisme/5 cases regagnent du moral (et cessent de fuir).

## 6. Jour et nuit

- La bataille commence à **8 h**. Chaque tour fait avancer l'heure ; l'hôte règle le nombre de **tours par demi-journée (5 à 20, 12 par défaut** → 1 h par tour).
- Jour : 6 h – 18 h. **Nuit : 18 h – 6 h** (avec le réglage par défaut, la nuit tombe au tour 11).

| Effet de nuit | Valeur |
|---|---|
| Vision | ×0,5 (minimum 2 cases) |
| Vitesse | −1 en début de manche (minimum 1) |
| Attaque | −2 au corps à corps, −3 au tir |
| Repos | +20 moral et +5 vitalité par manche en plus |
| Défense de combat | +5 moral par manche |

## 7. Vision et embuscades

- **Brouillard de guerre** : chaque unité voit à 3 cases (les généraux à leur Stratégie), 2 cases depuis une forêt ; une forêt cache ce qui est au-delà de 2 cases ; la hauteur allonge la vue ; les murs bloquent la vue.
- **Unités cachées** : une unité en **forêt** ou dans un **bâtiment** est invisible pour l'ennemi, même dans sa vision, sauf si :
  - une unité ennemie lui est **adjacente** ;
  - un **espion** ennemi est à **2 cases** ou moins ;
  - elle a **attaqué** (ou riposté au corps à corps) : elle reste révélée jusqu'à la fin de la prochaine manche de son camp.
- On ne peut pas attaquer une unité qu'on ne voit pas. Vos propres unités cachées sont signalées comme « camouflées ».

## 8. Duel de généraux

Quand un général attaque un général ennemi au corps à corps, c'est un **duel** (pas de choix de défense) :

- Jusqu'à **3 passes**. À chaque passe, chacun lance D20 + Force ; le plus haut frappe pour **dégâts de l'arme + écart des jets − armure × 0,5** (au moins 1). Égalité : parade.
- Vainqueur : celui qui a gagné le plus de passes (puis le plus de dégâts). Égalité parfaite : pas de vainqueur.
- **Le vaincu** (s'il survit) : son armée perd **15 % de son moral maximum**, et il ne peut pas se déplacer à sa prochaine manche. **Le vainqueur** : ses unités à 5 cases ou moins gagnent 10 % de moral maximum.
- Un général dont la vitalité tombe à 0 meurt : son camp est éliminé.

## 9. Objectifs et victoire

- Certaines cartes ont des **objectifs** (drapeaux). On capture un objectif en ayant une unité dessus **à la fin de sa manche** ; il reste à son propriétaire jusqu'à ce qu'un autre le prenne (il redevient neutre si son propriétaire est éliminé).
- Au début de chaque tour, chaque objectif tenu rapporte ses **points** (1 par défaut, indiqué sur la carte).
- **Conditions de victoire** :
  1. être le dernier camp dont le général est en vie ;
  2. atteindre le **seuil de points de victoire** (réglage, 0 = désactivé) ;
  3. à la **limite de tours** (réglage, 0 = illimité) : le meilleur score l'emporte ; à égalité, l'armée la plus intacte (somme des vitalités restantes en proportion) ; sinon match nul.

## 10. Capacités des généraux

| Général | Capacité | Recharge | Effet |
|---|---|---|---|
| Ou Ki | Sourire du Monstre | 3 | Puissance de l'armée +2 pendant 2 tours ; moral −1 pour les armées en infériorité numérique |
| Mou Bu | Poing du Titan | 3 | Choisir une armée ennemie : son armure −1 pendant 2 tours |
| Ri Boku | Vision du Sage | 2 | Révèle les unités ennemies cachées dans votre vision jusqu'au tour suivant |

## 11. Information

- Vous ne recevez que ce que vous voyez : un combat entre d'autres joueurs n'est montré que si vous voyez l'une des deux unités, et l'unité que vous ne voyez pas apparaît comme « Unité inconnue », sans le détail des jets.
- Les déplacements ennemis ne sont animés que sur la partie visible du trajet.
- **Spectateurs** (réglage de l'hôte) : vision **complète** (tout en direct), **différée** (positions du tour précédent, sans les combats en direct) ou **aucune**. Après la partie, tout est visible.

## 12. Paramètres de salle (hôte)

| Paramètre | Valeurs | Défaut |
|---|---|---|
| Carte, budget, mode (séquentiel / simultané) | — | défaut, 2500, séquentiel |
| Tours par demi-journée | 5 – 20 | 12 |
| Nombre de tours maximum | 0 (illimité) – 200 | 0 |
| Points de victoire pour gagner | 0 (désactivé) – 1000 | 0 |
| Minuteur de manche (séquentiel) | 0 (aucun) ou 15 – 600 s | 0 |
| Minuteur de planification (simultané) | 0 (aucun) ou 15 – 600 s | 90 |
| Points de commandement (simultané) | 0 (2 + ⌈Stratégie / 3⌉) ou 1 – 50 | 0 |
| Vision des spectateurs | complète / différée / aucune | complète |

## 13. Fin de bataille

- Un **récapitulatif** présente, par joueur et par unité : dégâts infligés et subis, éliminations, pertes, objectifs pris, points, duels.
- Le **replay** de la bataille peut être revu (page Replay) et téléchargé au format JSON ; la salle est supprimée 30 minutes après la fin.
