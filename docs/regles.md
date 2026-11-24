# Kingdom Battleground — Règles du jeu

Référence des règles telles qu'elles sont appliquées par le serveur. Les valeurs réglables se trouvent dans `public/js/rules.js` (fichier partagé serveur / navigateur) et dans les données d'équilibrage (`data/balance/*.json`).

## 1. Déroulé d'une partie

1. **Salle** : l'hôte choisit la carte, le budget (arrondi à la centaine), le mode et les paramètres (voir §12). Chaque joueur choisit un général et un **drapeau** (royaume : Qin, Zhao, Wei, Chu, Yan, Qi, Han), qui donne sa couleur, puis se déclare **prêt** ; la partie démarre quand tous les joueurs humains sont prêts (ou quand l'hôte la lance). Un joueur sans drapeau au lancement reçoit celui du royaume de son général s'il est libre.
2. **Armée** : chaque joueur achète ses unités dans la limite du budget. Le général est ajouté gratuitement. L'hôte peut encore changer le budget ou revenir au salon.
3. **Déploiement** : toutes les unités sont **placées d'office** au hasard dans la zone de départ (le général d'abord, jamais sur une rivière) ; chacun les réarrange (poser une unité sur une autre des siennes échange leurs places) puis clique « Prêt ». Les zones ont toutes le même nombre de cases (4 × budget / 1000 + 2), choisies par un score (distance au centre de la zone, terrain, segments à franchir, éloignement des autres zones). Les positions adverses ne sont pas visibles.
4. **Mode par équipe** (option de l'hôte) : les joueurs sous le même drapeau sont **alliés** — ils se voient, ne peuvent pas s'attaquer (ni s'affronter en mode simultané), et gagnent ensemble quand il ne reste que des alliés.
5. **Bataille** : tours successifs jusqu'à la victoire (§9).

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
| Attaquer | toute la vitesse restante (au moins 1), une attaque par manche ; cavalier léger : 2 de vitesse, et il peut encore se déplacer |
| Attaquer à distance (clic sur un ennemi hors de portée) | l'unité se rend sur la meilleure case d'où elle peut frapper (§5), puis attaque : une seule action |
| Motiver (général) | toute la vitesse restante (au moins 1), remplace l'attaque du général |
| Capacité active (général) | une fois par manche, puis temps de recharge |

- **Fin de manche automatique** : dès qu'aucune unité ne peut plus agir (ni bouger, ni attaquer une cible visible à portée, ni motiver une unité démoralisée, ni utiliser la capacité), la manche se termine toute seule.
- **Confirmation** : terminer sa manche alors que des unités peuvent encore agir demande une confirmation.
- **Minuteur** (optionnel, réglage de salle) : la manche se termine automatiquement à l'expiration.
- **Joueur absent** : sa manche passe au bout de 60 s (30 s les manches suivantes) ; abandon après 10 min d'absence.

## 3. Déplacement

La vitesse d'une unité est recalculée au début de chacune de ses manches : vitesse de base + modificateur de posture + modificateur du terrain occupé, au moins 1 (−1 supplémentaire la nuit, minimum 1). Une unité lente au Repos ou en Combat dans une forêt peut donc toujours changer de posture.

Chaque pas coûte le **coût du terrain que l'on quitte** :

| Terrain quitté | Coût |
|---|---|
| Route, pont | 1/3 |
| Plaine, bâtiment | 1 |
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
| **Escalier de pierre** | coût fixe de **2** (pente ignorée) — infanterie et généraux seulement ; monte au chemin de ronde des remparts, franchit une marche de rocher. Ne se sabote pas, ne se construit pas. Combattre à travers : attaquant en bas désavantagé (attaque −3 au corps à corps), défenseur avantagé (défense +2) — valeurs dans `data/balance/segments.json` |
| **Rampe** | pente praticable par tous (coût normal de la pente) posée sur un fort dénivelé pour éviter la falaise automatique |
| Cavalerie et chars | ne franchissent jamais falaises, murs, échelles ni escaliers |

- **Falaises automatiques** : entre deux cases voisines dont la hauteur diffère de **2 niveaux ou plus**, le bord est une falaise (infranchissable) même sans segment, sauf s'il porte un escalier, une échelle, une rampe, un pont ou une passerelle. Un seul niveau d'écart est une pente douce praticable. Même règle pour le serveur, l'IA, les aperçus, la 2D et la 3D (`KBMapProps.effectiveSegments`, `public/js/mapProps.js`).
- **Remparts** : on ne monte sur le chemin de ronde (cases `decor.ramparts`) et on n'en descend que par un **escalier de pierre** ou une **échelle** ; tous les autres bords entre une case de rempart et une case voisine hors rempart sont des murs à pic (falaise), quelle que soit la hauteur. Le chemin de ronde reste continu d'une case de rempart à l'autre.

- **Pas minimum** : une unité qui n'a encore rien dépensé de sa vitesse ce tour (ni déplacement, ni posture, ni pivot) peut toujours avancer d'**une case**, même si ce pas coûte plus que sa vitesse (sauf falaise, mur, ou échelle et escalier pour la cavalerie) ; ce pas consomme toute sa vitesse. Personne ne reste ainsi bloqué dans un fleuve (−1 vitesse) ou au pied d'une pente, même de nuit.
- On ne traverse pas une case occupée par une unité visible.
- **Embuscade** : si le chemin rencontre une unité ennemie cachée (§7), l'unité s'arrête net devant elle et perd le reste de sa vitesse pour la manche ; l'embusqué est révélé.
- Les falaises bloquent le passage mais pas la vue.

### Marche sur plusieurs tours

- On peut donner à une unité une **destination hors de portée ce tour** : un premier clic sur la case montre la route (la partie de ce tour en pointillés blancs, les tours suivants plus pâles, un disque numéroté là où chaque tour s'arrête — estimation avec la vitesse actuelle de l'unité), un second clic donne l'ordre. Les étapes du chemin (Maj+clic / outil Étapes) peuvent elles aussi dépasser la portée du tour : le chemin devient alors une marche. Avec Maj+clic, la dernière étape est la destination : en planification l'ordre suit chaque étape posée, en mode classique l'unité part quand on relâche Maj.
- L'unité avance tout de suite de ce que sa vitesse paie (pas minimum compris), puis **reprend seule la route au début de chacune de ses manches** (mode classique), avant que le joueur n'agisse ; la route reste celle choisie (200 cases au plus).
- La marche **s'arrête** : à l'arrivée ; quand l'unité est au contact d'un ennemi visible (avant de repartir ou après avoir avancé) ; en cas d'embuscade ; quand une unité visible ou un bord devenu infranchissable barre la route ; quand l'unité fuit ; dès qu'on lui donne un autre ordre de déplacement ou d'attaque ; avec le bouton **STOP MARCHE** de la fiche d'unité.
- La route restante apparaît en pointillés pâles (couleur du joueur) sur la carte, avec les numéros de tour quand l'unité est sélectionnée ; la liste de l'armée et la fiche affichent **MARCHE**. Les autres joueurs ne voient jamais l'ordre de marche (seulement les déplacements qu'ils aperçoivent).
- Protocole : `move_unit { unitId, targetQ, targetR, march: true, path }` (route complète, origine exclue) ; `cancel_march { unitId }`.

## 4. Postures

Changer de posture coûte 2 de vitesse (les généraux n'ont pas de posture). Les unités commencent en **Combat**. Chaque posture modifie vitesse, attaque, défense, puissance, intimidation, **courage**, esquive, précision et armure (au corps à corps et au tir) — valeurs dans `data/balance/stances.json`, page `/stances.html` et infobulle de chaque posture. Le **courage** du défenseur (et du terrain) est retranché de l'intimidation de l'attaquant.

| Posture | En bref |
|---|---|
| Marche | +1 vitesse, plus fragile |
| Combat | posture neutre de référence (tout à 0) |
| Charge | +2 vitesse, gros bonus de mêlée, −10 moral par manche |
| **Repos** (remplace la Percée) | −1 vitesse, combat affaibli ; +1 armure, +10 moral et +5 vitalité par manche ; **la nuit : +20 moral et +5 vitalité supplémentaires** |
| Défense de combat | forte défense au corps à corps, −1 vitesse ; **renforcée la nuit** (+5 moral par manche) |
| Défense à distance | forte esquive contre le tir |

**Angle d'attaque** : selon la direction d'où vient l'attaquant par rapport à l'orientation du défenseur et sa posture, l'attaquant gagne 0, +2 (flanc) ou +4 (dos) en attaque, puissance et intimidation, et le défenseur perd autant d'armure, de défense, de puissance et d'intimidation en riposte (`RULES.combat.angleMods`) :

| Posture du défenseur | face | avant-flanc | arrière-flanc | dos | arrière-flanc | avant-flanc |
|---|---|---|---|---|---|---|
| Marche | 0 | 2 | 2 | 4 | 2 | 2 |
| Combat | 0 | 0 | 2 | 4 | 2 | 0 |
| Charge | 2 | 2 | 4 | 4 | 4 | 2 |
| Repos | 0 | 2 | 4 | 4 | 4 | 2 |
| Défense de combat | 0 | 0 | 0 | 4 | 0 | 0 |
| Défense à distance | 0 | 2 | 4 | 4 | 4 | 2 |

L'outil **Côtés faibles** (vue 2D) colore les bords de chaque unité : vert (face), orange (flanc), rouge (dos).

## 5. Combat

**Portée** : toujours 1 case en mêlée ; pour les tireurs, la portée de l'unité (archers 3, archers d'élite 4), +1 par niveau de hauteur au-dessus de la cible, −1 par niveau au-dessous (au moins 1). Un archer au contact de sa cible se bat en mêlée (la cible peut riposter). La cible doit être visible (§7) et ne pas être alliée.

**Attaque à distance** : cliquer un ennemi visible hors de portée (case orange) déplace d'abord l'unité sur la case d'approche choisie — mêlée : la moins chère à atteindre (puis la plus haute) ; tireur : la plus éloignée de la cible encore à portée (puis la moins chère) — puis lance l'attaque, en une seule action vérifiée d'un bloc par le serveur. Si aucune case accessible ce tour ne permet de frapper, l'unité ne bouge pas. Une embuscade sur le chemin arrête l'unité et annule l'attaque.

Résolution « NGO » (`RULES.combat`, `GameRoom._resolveCombat`) :

1. **Dés** : chaque unité lance **1 d20 par tranche de 5 de vitalité** (NGO = vitalité ÷ 5, au moins 1).
2. **Jet d'attaque** : chaque d20 ≤ attaque effective est une **réussite** ; attaque effective = attaque + posture + terrain + segment − esquive de la cible + différence de hauteur + angle (+ malus de nuit, + bonus de charge en mode simultané).
3. **Ratio d'armure** du défenseur : AR = NGO du défenseur × armure effective (armure + posture + terrain + segment + bonus contre les tirs − angle) ; ratio = 1 − AR / (AR + 100).
4. **Dégâts** (vitalité perdue) = réussites × puissance effective (puissance + posture + terrain + segment + lanciers + angle) × ratio.
5. **Moral perdu** = réussites × intimidation effective (intimidation + posture + terrain + segment − **courage** du défenseur + angle) ; à 0 de moral, l'unité **fuit** vers le bord de la carte (elle peut être remotivée).
6. **Généraux** : un seul d20 ; dégâts = (Force − d20 + 80) × Puissance ÷ 5 × ratio ÷ 2 ; moral = (Charisme − d20 + 80) × Intimidation ÷ 100 (même d20). Un général touche toujours.
7. **Réponse du défenseur** (20 s pour choisir, sinon « Rien ») :
   - **Rien** : aucun jet.
   - **Contre-attaquer** (mêlée) : le défenseur lance ses dés contre sa défense effective (défense + posture + terrain + segment − précision de l'attaquant − hauteur − angle) ; chaque réussite rend puissance × ratio d'armure de l'attaquant (NGO de l'attaquant × armure + angle).
   - **Encaisser** : même jet, mais les dégâts et le moral reçus **et** la riposte sont divisés par deux.
   - Contre un tir : pas de défense ni de riposte, sauf la **phalange**, qui peut encaisser — mais jamais contre des archers. Une attaque qui ne peut pas être défendue est résolue aussitôt, sans demander de réponse.
5. L'attaquant et le défenseur qui riposte se tournent l'un vers l'autre.

**Motivation** (général) : D20 ≤ Charisme → les unités à Charisme/5 cases ou moins regagnent (Charisme − D20) × 10 de moral (et cessent de fuir). **1** : réussite critique, moral au maximum. **20** : échec critique, −20 moral.

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

Règles combinées de l'ami (vision) et de l'embuscade (`RULES.vision`, `RULES.concealment`) :

- **Brouillard de guerre** : chaque unité voit à 3 cases (les généraux à leur Stratégie), 2 cases depuis une forêt ; depuis l'extérieur, on ne voit dans une forêt que ses **2 premières rangées** de cases ; la hauteur allonge la vue (+1 par niveau au-dessus de la case regardée).
- **Ligne de vue** (`RULES.vision.los`, `game/los.js`) : une case n'est vue que si la ligne droite entre l'œil de l'unité (hauteur de sa case + 0,6 niveau) et la case visée (+ 0,4 niveau) n'est coupée par rien. La ligne est suivie case par case (deux tracés légèrement décalés de part et d'autre : un rayon qui frôle un coin passe si l'un des deux est libre). La bloquent :
  - le **relief** : toute case traversée dont le sol est plus haut que la ligne (crêtes, montagnes, remparts : au pied du mur de Kankoku on ne voit pas la plaine, du chemin de ronde si) ;
  - les **forêts** : leurs cimes (+1,2 niveau), sauf jusqu'à 2 cases de l'observateur (4 pour un espion : on voit la lisière) et sauf pour un **général** au-dessus d'elles (il voit par-dessus une forêt plus basse que sa case) ;
  - les **bâtiments** (+1 niveau) ;
  - les **murs** posés sur un côté de case (segment « mur », +1,5 niveau au-dessus du côté le plus haut) ; les barrières, chevaux de frise, échelles et escaliers ne bloquent pas la vue, les falaises sont prises en compte par le relief.
- **Depuis un bâtiment** : une unité voit sa pièce (sa case) et les pièces voisines (cases de bâtiment adjacentes), et l'extérieur par ses propres ouvertures (toute ligne qui ne traverse aucune autre case de bâtiment) ; elle ne voit pas une pièce située derrière une autre. En 3D, le toit et le haut des murs du bâtiment s'effacent quand une de vos unités y est (ou l'unité sélectionnée).
- **Espion** : voit à **6 cases** (4 depuis une forêt) et **voit l'intérieur des forêts jusqu'à 4 cases**.
- **Général en hauteur** : +2 de vue par niveau de sa case, dans toutes les directions ; il voit **derrière** une forêt plus basse que lui, mais pas **dedans** au-delà de 2 cases.
- **Assassin** : invisible pour un ennemi qui n'a **aucune unité à 4 cases** ou moins, quel que soit le terrain.
- **Unités cachées** : une unité en **forêt** ou dans un **bâtiment** est invisible pour l'ennemi, même dans sa vision, sauf si :
  - une unité ennemie lui est **adjacente** ;
  - un **espion** ennemi est à **4 cases** ou moins (il voit dans les forêts jusqu'à cette distance) ;
  - elle a **attaqué** (ou riposté au corps à corps) : elle reste révélée jusqu'à la fin de la prochaine manche de son camp.
- On ne peut pas attaquer une unité qu'on ne voit pas. Vos propres unités cachées sont signalées comme « camouflées ». Les alliés (mode par équipe) se voient toujours.
- Un joueur **éliminé** regarde la suite de la partie avec la vision réunie des joueurs encore en vie.

## 8. Duel de généraux

Quand un général attaque un général ennemi au corps à corps, c'est un **duel** (pas de choix de défense) :

- Jusqu'à **3 passes**. À chaque passe, chacun lance D20 + Force ; le plus haut frappe pour **Puissance + écart des jets − armure × 0,5** (au moins 1). Égalité : parade.
- Vainqueur : celui qui a gagné le plus de passes (puis le plus de dégâts). Égalité parfaite : pas de vainqueur.
- **Le vaincu** (s'il survit) : son armée perd **15 % de son moral maximum**, et il ne peut pas se déplacer à sa prochaine manche. **Le vainqueur** : ses unités à 5 cases ou moins gagnent 10 % de moral maximum.
- Un général dont la vitalité tombe à 0 meurt : son camp est éliminé.

## 9. Objectifs et victoire

- Certaines cartes ont des **objectifs** (drapeaux). On capture un objectif en ayant une unité dessus **à la fin de sa manche** ; il reste à son propriétaire jusqu'à ce qu'un autre le prenne (il redevient neutre si son propriétaire est éliminé).
- Au début de chaque tour, chaque objectif tenu rapporte ses **points** (1 par défaut, indiqué sur la carte).
- **Conditions de victoire** :
  1. être le dernier camp dont le général est en vie (mode par équipe : il ne reste que des alliés) ;
  2. atteindre le **seuil de points de victoire** (réglage, 0 = désactivé) ;
  3. à la **limite de tours** (réglage, 0 = illimité) : le meilleur score l'emporte ; à égalité, l'armée la plus intacte (somme des vitalités restantes en proportion) ; sinon match nul.

## 10. Capacités des généraux

| Général | Capacité | Recharge | Effet |
|---|---|---|---|
| Ou Ki | Sourire du Monstre | 3 | Puissance de l'armée +2 pendant 2 tours ; moral −1 pour les armées en infériorité numérique |
| Mou Bu | Poing du Titan | 3 | Choisir une armée ennemie : son armure −1 pendant 2 tours |
| Ri Boku | Vision du Sage | 2 | Révèle les unités ennemies cachées dans votre vision jusqu'au tour suivant |

## 10 bis. Capacités des unités

Chaque type d'unité a une capacité (champ `bonusType` de `data/balance/units.json`, texte dans `bonus`). Les règles de l'ami priment ; les capacités actives ajoutées avant la fusion (Saboter, Disparaître, Construire un pont / une barrière / brûler) sont gardées quand elles ne le contredisent pas. Les valeurs se règlent dans l'éditeur d'équilibrage (`bonusValue`, `bonusRange`, `bonusCost` ; défauts : `RULES.abilities` dans `public/js/rules.js`). Les capacités actives se lancent avec le bouton **Capacité** (touche C) ; en mode simultané, elles font partie de l'ordre de l'unité.

| Unité | Règle appliquée |
|---|---|
| Piétaille | **+10 moral** au début de chacun de ses tours si son général est dans le rayon **Charisme ÷ 5**. |
| Soldats | Après **leur attaque**, une unité ennemie à **moins de 10 %** de sa vitalité max est exécutée (jamais un général, pas en riposte). |
| Phalange | **+20 armure** contre les tirs ; peut encaisser un tir, sauf d'archers. |
| Lancier | **+6 puissance** contre la cavalerie et les chars (en attaque et en riposte) ; **+20 armure** contre les tirs. |
| Espion | Vision : 6 cases (4 en forêt), voit dans les forêts jusqu'à 4 cases, révèle les unités cachées à 4 cases (§7). Garde l'action **Saboter** (2 vitesse : détruit pont, passerelle, échelle, barrière ou chevaux de frise voisins). |
| Assassin | **Invisible** pour un ennemi sans unité à 4 cases ou moins. Garde l'action **Disparaître** (2 vitesse, aucun ennemi visible à 6 cases : caché jusqu'à la fin de la journée). L'avantage au premier jet de la journée est retiré (il n'a plus de sens avec plusieurs dés). |
| Cavalier léger | Attaquer lui coûte **2 de vitesse** et il **peut encore se déplacer** ensuite ; garde **+1 vitesse** en début de tour sans ennemi adjacent. |
| Cavalier lourd | **50 %** du moral qu'il inflige frappe aussi les unités ennemies adjacentes à sa cible (pas les généraux). Le bonus en Charge d'avant la fusion est retiré. |
| Archer, Archer d'élite | La cible ne fait aucun jet de défense. Portée 3 et 4 cases (± hauteur). |
| Bâtisseurs | Ne peuvent pas construire après avoir attaqué ; jusqu'à 2 de vitesse. **Échelle** sur une falaise, **chevaux de frise** sur une arête libre (règle de l'ami, action `build_segment`) ; gardent aussi barrière, pont sur une rivière et forêt brûlée. |
| Char | **Traverse** les unités ennemies visibles (jamais un allié, jamais pour s'arrêter sur une case occupée) et **frappe chacune** au passage, sans riposte. La frappe de l'unité « derrière la cible » d'avant la fusion est retirée. En mode simultané, le char ne traverse pas (il combat normalement). |

Les modifications de carte (sabotages, constructions, forêts brûlées) sont gardées avec la partie et visibles de tous.

## 11. Information

- Vous ne recevez que ce que vous voyez : un combat entre d'autres joueurs n'est montré que si vous voyez l'une des deux unités, et l'unité que vous ne voyez pas apparaît comme « Unité inconnue », sans le détail des jets.
- Les déplacements ennemis ne sont animés que sur la partie visible du trajet.
- **Spectateurs** (réglage de l'hôte) : vision **complète** (tout en direct), **différée** (positions du tour précédent, sans les combats en direct) ou **aucune**. Après la partie, tout est visible.
- **Fiches de combat** : réglage « Fermeture des fiches » (réglages 3D) — *manuelle pour mes combats* (par défaut : la fiche d'un combat où l'une de vos unités est engagée reste affichée jusqu'à ✕, Espace, Échap ou un clic ; les autres se ferment seules), *toujours manuelle* ou *automatique*. Chaque combat de la partie se rouvre depuis le journal (bouton **FICHE** sur chaque entrée de l'historique) ou le bouton **Dernier combat** au-dessus du fil d'événements ; ◀ ▶ (ou les flèches du clavier) passent d'un combat à l'autre du même tour. Pendant la lecture du mode simultané, les fiches restent petites et se ferment seules pour ne pas bloquer la lecture.

## 12. Paramètres de salle (hôte)

| Paramètre | Valeurs | Défaut |
|---|---|---|
| Carte, budget (arrondi à 100), mode (séquentiel / simultané) | — | défaut, 2500, séquentiel |
| Mode par équipe | oui / non | non |
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
