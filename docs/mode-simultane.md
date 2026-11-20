# Mode simultané — règles appliquées

Tous les joueurs donnent leurs ordres en même temps, en secret, puis tous les ordres sont résolus ensemble par le serveur, case par case (« ticks »). Le mode se choisit dans la salle (hôte) : **Mode de tour → Simultané (ordres secrets)**.

Code : `game/turns/simultaneous.js` (contrôleur, protocole documenté en tête de fichier), `game/rules/resolve.js` (résolution), `public/js/simultaneous.js` (client 2D). Valeurs réglables : `RULES.simultaneous` dans `public/js/rules.js`.

## Déroulé d'un tour

1. **Planification** : chaque joueur sélectionne ses unités et leur donne des ordres. Les ordres ne sont jamais envoyés aux autres joueurs ni aux spectateurs.
2. **Validation** : bouton « Ordres prêts » (on peut revenir en arrière avec « Modifier les ordres » tant que la résolution n'a pas commencé). Chacun voit qui a validé, jamais quoi.
3. La résolution démarre quand **tous les joueurs en vie ont validé**, ou à l'expiration du **minuteur de planification** (les ordres déjà donnés sont exécutés, même non validés). Un joueur **déconnecté depuis 30 s** (comptées à partir du début de la planification au plus tôt) est considéré comme prêt (ses ordres déjà donnés s'appliquent, ses autres unités tiennent). Abandon après 10 min d'absence, comme en mode classique.
4. **Lecture** : chaque client rejoue la chronologie tick par tick (animation 2D/3D, combats), puis le tour suivant commence. Le minuteur du tour suivant ne démarre qu'à la fin de la durée estimée de la lecture.

Il n'y a ni initiative ni manches : un tour = une planification + une résolution. L'heure avance d'un cran par tour (jour / nuit identiques au mode classique).

## Ordres

- **Points de commandement** : nombre d'unités pouvant recevoir un ordre par tour = `2 + ⌈Stratégie du général / 3⌉` (Ou Ki : 8, Mou Bu : 6), ou un nombre fixe réglé par l'hôte. Une unité sans ordre **tient** sa position et réagit selon sa posture ; « Tenir » sans autre changement ne coûte rien.
- Un ordre principal par unité :

| Ordre | Effet |
|---|---|
| **Déplacer** | suit le chemin tracé (coût de terrain, pentes, segments identiques au mode classique, dans la limite de la vitesse) |
| **Attaquer** une unité visible | mêlée : l'unité se rapproche de la cible (suivie si elle bouge) puis frappe au contact ; tireur : tire dès que la cible est à portée et en vue — si elle est hors de portée au moment de l'ordre, l'ordre porte le chemin vers la meilleure position de tir (la plus éloignée de la cible encore à portée), que le tireur suit jusqu'à ce que la cible soit à portée |
| **Charger** une unité visible (pas les tireurs) | comme Attaquer, avec le bonus de charge si l'unité a parcouru au moins 2 cases |
| **Tenir** | ne bouge pas |
| **Motiver** (général) | au début de la résolution ; le général ne bouge pas |

- Options combinables : **changer de posture** (−2 vitesse, appliqué au début de la résolution), **orientation finale** (−1 vitesse, appliquée à la fin si l'unité n'a pas attaqué), **capacité du général** (au début de la résolution), **capacité d'unité** : sabotage de l'espion, construction des bâtisseurs, disparition de l'assassin (coût en vitesse, au début de la résolution, avant les déplacements ; voir `docs/regles.md` §10 bis).
- **Pas minimum** : une unité sans changement de posture ni d'orientation peut toujours faire un pas, même trop cher pour sa vitesse (voir [regles.md](regles.md) §3).
- Les chemins ne sont vérifiés que par leur coût : une unité invisible sur le trajet devient une embuscade à la résolution, jamais une erreur de planification. La cible d'une attaque doit être visible au moment de l'ordre.

## Résolution

**Tick 0 (préparation)** : les unités en fuite fuient vers le bord, changements de posture, capacités, motivation.

**Puis, à chaque tick** :

1. **Tirs** : les tireurs dont la cible est à portée et en vue tirent (positions du début du tick) ; puis les **tirs de réaction**.
2. **Déplacements simultanés** : chaque unité en mouvement avance d'**une case** si sa vitesse restante paie le pas (la cavalerie a donc plus de ticks ; sur route, jusqu'à 3 cases par point de vitesse).
3. **Contacts** (zone de contrôle, embuscades).
4. **Mêlées**.

La résolution s'arrête au premier tick sans déplacement ni combat (40 ticks au plus). Un tireur dont la cible n'est jamais passée à portée a un **tir perdu** (indiqué au seul tireur).

### Conflits de case

- **Deux ennemis visent la même case** au même tick : aucun n'y entre, chacun reste sur sa case et ils livrent une **mêlée de rencontre** (les deux se battent : le défenseur riposte toujours).
- **Deux alliés** visent la même case : le plus rapide (vitesse du tour) passe, l'autre attend un tick.
- **Croisement** (A va sur la case de B et B sur celle de A) : entre ennemis, mêlée de rencontre et chacun reste ; entre alliés, l'échange se fait.
- Une unité peut entrer dans une case **libérée au même tick** (une colonne avance d'un bloc) ; une case tenue par un allié qui ne bouge pas bloque toute la file derrière lui.
- Entrer sur la case d'un **ennemi immobile** est impossible : l'unité s'arrête et l'attaque.
- Plus de deux unités ennemies sur une même case : chaque paire d'ennemis libres livre une rencontre.

### Zone de contrôle, embuscades

- Une unité qui **arrive au contact** d'un ennemi visible s'arrête. Un simple déplacement n'attaque pas ; une unité qui avait un ordre d'attaque ou de charge frappe l'ennemi qui l'a arrêtée si ce n'est pas sa cible.
- Une unité qui découvre ainsi un ennemi **caché** (forêt, bâtiment) tombe dans une **embuscade** : elle s'arrête, perd le reste de sa vitesse, et l'embusqué est révélé.

### Combats

Les jets sont ceux du mode classique (`_resolveCombat`). La **réponse du défenseur** n'est pas demandée : elle découle de sa posture.

| Posture du défenseur | Réponse |
|---|---|
| Marche | Encaisser, ou **rien** si l'unité s'est déplacée ce tour (prise en mouvement) |
| Combat, Charge | Contre-attaquer |
| Défense à distance | Encaisser |
| Défense de combat | Contre-attaquer ; **annule le bonus de charge** adverse |
| Repos | Rien |
| Général | Contre-attaquer |

- Contre un tir, seule la phalange encaisse (comme en mode classique).
- **Charge** (ordre Charger, ou ordre d'attaque d'une unité en posture Charge) : au premier contact après au moins 2 cases parcourues, **+2 attaque et +3 puissance**. Contre des **lanciers**, le bonus devient un **malus de −2 attaque** ; contre la Défense de combat, il est annulé.
- **Tir de réaction** : un tireur en posture Défense à distance **sans ordre de mouvement ni d'attaque** tire une fois sur la première unité ennemie qui entre à sa portée (au tick suivant son entrée, avant qu'elle ne bouge à nouveau).
- **Simultanéité** : tous les combats d'une même phase sont calculés sur l'état du début de la phase, puis appliqués dans l'ordre ; une unité détruite ou en fuite plus tôt dans la phase ne frappe plus.
- Deux unités qui s'attaquent mutuellement au même tick livrent une seule mêlée de rencontre.
- **Duel** : un général qui attaque (ou rencontre) le général adverse au contact livre un duel (règles du mode classique).
- Une unité qui attaque est révélée ; une unité dont le moral tombe à 0 s'enfuit et n'exécute plus ses ordres.

## Fin de tour

Captures d'objectifs (unité sur l'objectif à la fin de la résolution), fin des révélations, recharge des capacités, effets actifs, points d'objectifs, heure, conditions de victoire — identiques au mode classique. Régénération (postures, terrain, nuit) et vitesse recalculées au début de chaque planification.

## Brouillard et information

- La chronologie envoyée à chaque joueur est **filtrée par sa vision à chaque tick** : il voit ses unités, les déplacements des ennemis qu'il voit avant et après le pas, l'**apparition** (descripteur de l'unité) et la **disparition** des ennemis qui entrent dans ou sortent de sa vision, et les combats dont il voit au moins un camp (l'autre camp anonymisé, détail des jets réservé aux deux camps).
- Spectateurs : chronologie complète en vision **complète** ; rien en vision différée ou aucune.
- Reconnexion : pendant la planification, ses ordres et l'état de validation sont restaurés ; pendant la lecture, la chronologie est renvoyée avec le temps écoulé et la lecture reprend où elle en était.

## Déterminisme

Chaque résolution tire une **graine** (journal serveur, chronologie, replay) : même salle + mêmes ordres + même graine = même résultat (tests `tests/simultaneous.test.js`).

## Réglages de salle

| Paramètre | Valeurs | Défaut |
|---|---|---|
| Mode | séquentiel / simultané | séquentiel |
| Minuteur de planification | 0 (aucun) ou 15 – 600 s | 90 s |
| Points de commandement | 0 (formule) ou 1 – 50 | 0 |

Les autres réglages (tours par demi-journée, tours max, points de victoire, vision des spectateurs) s'appliquent tels quels ; le minuteur de manche du mode classique est sans effet.

## Écarts par rapport à la proposition initiale

- Le bonus de charge porte sur l'attaque et la puissance (+2 / +3) ; la phalange n'annule pas la charge, seuls les lanciers (malus) et la Défense de combat (annulation).
- « Riposte gratuite » de la Défense de combat = réponse Contre-attaquer automatique (jet de défense habituel).
- Les rencontres à mi-chemin peuvent opposer deux unités à 2 cases l'une de l'autre (case disputée entre elles).
- Simulateur : `node simulation/run.js --simultaneous` (ordres des IA de `game/bots`).
- Replay : les déplacements d'un tour sont enregistrés par unité (regroupés jusqu'au combat suivant) ; le replay ne montre donc pas toute la simultanéité.

## Après la fusion avec la branche de l'ami

- La Percée n'existe plus (remplacée par le Repos) : plus de poursuite après une mêlée gagnée.
- Les combats suivent la résolution NGO (règles §5) ; le bonus de charge s'ajoute à l'attaque et à la puissance effectives.
- Mode par équipe : les alliés ne s'affrontent pas (pas de rencontre ni d'attaque entre eux, ils peuvent se croiser).
- Le char ne traverse pas les unités en mode simultané.
