# Mode simultané — règles appliquées

Tous les joueurs donnent leurs ordres en même temps, en secret, puis le serveur résout tous les ordres ensemble, case par case (« ticks »). Le mode se choisit dans la salle (hôte) : **Mode de tour → Simultané (ordres secrets)**.

Code : `game/turns/simultaneous.js` (contrôleur, protocole documenté en tête de fichier), `game/rules/resolve.js` (résolution), `game/protocol.js` (minuteurs, validation, envoi), `public/js/simultaneous.js` (client 2D). Valeurs réglables : `RULES.simultaneous` dans `public/js/rules.js`. Calcul d'un combat et effets des postures : [postures-et-combat.md](postures-et-combat.md).

## Déroulé d'un tour

1. **Planification** : chaque joueur sélectionne ses unités et leur donne des ordres (`set_orders`). Les ordres ne sont jamais envoyés aux autres joueurs ni aux spectateurs.
2. **Validation** : bouton « Ordres prêts » (`commit_orders`). « Modifier les ordres » (`cancel_commit`) annule la validation tant que la résolution n'a pas commencé ; on ne peut pas changer des ordres validés. Chacun voit qui a validé, jamais quoi.
3. La résolution démarre quand **tous les joueurs en vie ont validé**, ou à l'expiration du **minuteur de planification** (les ordres déjà donnés sont exécutés, même non validés). Un joueur **déconnecté** compte comme prêt 30 s après le plus tardif de ces deux instants : sa déconnexion, le début de la planification. Ses ordres déjà donnés s'appliquent et ses autres unités tiennent. Il abandonne après 10 min d'absence, comme en mode classique.
4. **Lecture** : chaque client rejoue la chronologie tick par tick (animation 2D/3D, combats), puis le tour suivant commence. La durée estimée de la lecture vaut 700 ms par tick, plus 1300 ms par tick avec combat, et au moins 1,5 s. Le minuteur du tour suivant ne démarre qu'à la fin de cette durée. Le client peut passer la lecture et planifier aussitôt.

Il n'y a ni initiative ni manches : un tour = une planification + une résolution. L'heure avance d'un cran par tour (jour / nuit comme en mode classique).

## Ordres

- **Points de commandement** : nombre d'unités pouvant recevoir un ordre par tour = `2 + ⌈Stratégie du général / 3⌉`, ou un nombre fixe réglé par l'hôte (1 – 50). Exemples : Gai Mou (10), Mou Bu (11), Ren Pa (12) : 6 ; Ou Ki, Shi Ba Shou (13), Ou Sen, Kan Ki, Kei Sha, Go Kei (15) : 7 ; Ri Boku (16), Go Hou Mei (17) : 8. Chaque unité qui a un ordre coûte 1 point. Une unité **sans ordre tient** sa position et réagit selon sa posture : « Tenir » seul ne coûte rien, mais « Tenir » avec un changement de posture, d'orientation ou une capacité coûte 1 point.
- Un ordre principal par unité :

| Ordre | Effet |
|---|---|
| **Déplacer** | suit le chemin tracé (coût de terrain, pentes, segments comme en mode classique, dans la limite de la vitesse ; 60 cases au plus) |
| **Attaquer** une unité visible | mêlée : l'unité se rapproche de la cible par le chemin le moins cher, suit sa dernière position vue, puis frappe au contact. Tireur : il tire dès que la cible est à portée et en vue. Si elle est hors de portée au moment de l'ordre, l'ordre porte le chemin vers la meilleure position de tir (la plus éloignée de la cible encore à portée), que le tireur suit jusqu'à ce que la cible soit à portée |
| **Charger** une unité visible (pas les tireurs) | comme Attaquer, avec le bonus de charge (voir Combats) |
| **Tenir** | ne bouge pas |
| **Motiver** (général) | au tick 0 ; le général ne bouge pas |

- Options combinables, prises sur le budget de vitesse : **changer de posture** (−2 vitesse, appliqué au tick 0, ou **sur une étape du trajet** : `stanceAt: n` = après le n-ième pas, payé au départ, pris en fin de tour si l'unité est arrêtée avant ; les généraux n'ont pas de posture) ; **orientation finale** (−1 vitesse, appliquée à la fin si l'unité n'a pas frappé) ; **capacité du général** (au tick 0) ; **capacité d'unité** au tick 0, avant les déplacements, pour son coût en vitesse : sabotage de l'espion, construction des bâtisseurs, disparition de l'assassin (voir `docs/regles.md` §10 bis). Le modificateur de vitesse de la nouvelle posture ne compte qu'à partir du tour suivant (la vitesse est calculée au début de la planification).
- **Pas minimum** : une unité qui n'a rien dépensé (ni posture, ni orientation, ni pas) peut toujours faire un pas, même trop cher pour sa vitesse (voir [regles.md](regles.md) §3).
- **Marche sur plusieurs tours** : un ordre Déplacer peut viser une case hors de portée (`{ type: 'move', path, march: true }`, route complète jusqu'à 200 cases). Le serveur garde la partie que le budget du tour paie (`path`) et le reste (`marchRest`). Après la résolution, si l'unité est bien arrivée au bout de la partie du tour et n'est pas au contact d'un ennemi visible, la marche continue : à chaque nouvelle planification, l'ordre Déplacer suivant est **prérempli** (il coûte 1 point de commandement comme tout ordre ; s'il n'en reste plus, la marche attend le tour suivant). Le joueur peut le modifier ; s'il le retire ou le remplace par un autre ordre, la marche s'arrête à la fin de la résolution. Le bouton STOP MARCHE arrête la marche sans toucher à l'ordre du tour.
- Le serveur ne vérifie les chemins que sur leur coût. Une unité invisible sur le trajet devient une embuscade à la résolution, jamais une erreur de planification. La cible d'une attaque doit être visible au moment de l'ordre et ne pas être alliée.

## Résolution

Tous les dés viennent d'un générateur initialisé par la **graine** du tour. Dans chaque phase, le serveur parcourt les unités dans un **ordre de priorité tiré au sort à chaque tour** à partir de la graine (aucune armée n'est favorisée d'un tour sur l'autre ; même graine = même ordre).

**Tick 0 (préparation)** : d'abord, les unités en fuite de tous les joueurs fuient vers le bord. Puis chaque unité applique, dans l'ordre de priorité du tour, son changement de posture, le coût de l'orientation, sa capacité d'unité, la capacité du général et la motivation. Enfin, le serveur repère les tireurs en **tir de réaction** (voir plus bas).

**Puis, à chaque tick (1 à 40)** :

1. **(A) Tirs** : sur les positions du début du tick, et en **un seul lot**. Un tireur qui a un ordre d'attaque tire si sa cible est à portée et en vue. Un tireur en réaction tire sur l'ennemi entré à sa portée au tick précédent. Chaque tireur tire une fois par tour au plus.
2. **(B) Déplacements simultanés** : chaque unité en mouvement avance d'**une case** si sa vitesse restante paie le pas. Tout le monde avance au même rythme : la cavalerie va plus loin parce qu'elle a plus de ticks, pas parce qu'elle va plus vite. Sur route (1/3), une vitesse de 1 paie 3 cases, soit 3 ticks.
3. **(C) Contacts** : zone de contrôle, embuscades sur des unités à couvert, changement de cible.
4. **(D) Mêlées** : rencontres, unités qui butent sur un ennemi immobile, ordres d'attaque ou de charge au contact.

La résolution s'arrête au premier tick sans déplacement ni combat, et au plus tard après 40 ticks. **Fin du tour** : un tireur qui n'a pas tiré a un **tir perdu** (seul le tireur le voit). L'orientation finale s'applique aux unités qui n'ont pas frappé et ne fuient pas.

### Conflits de case (phase B, calculés en boucle jusqu'à stabilité)

- **Deux ennemis visent la même case** au même tick : aucun n'y entre et ils livrent une **mêlée de rencontre**. S'il y a plus de deux unités, toutes restent sur place et chaque unité livre au plus une rencontre : le serveur forme les paires d'ennemis dans l'ordre de priorité du tour.
- **Deux alliés** (ou deux unités du même joueur) visent la même case : celle qui a la plus grande **vitesse du tour** passe (la vitesse en début de tour, avant le coût de posture) ; à égalité, la première dans l'ordre de priorité du tour. L'autre ne perd rien et réessaie au tick suivant.
- **Croisement** (A va sur la case de B et B sur celle de A) : entre ennemis, rencontre et chacun reste ; entre alliés, l'échange se fait. Les rotations (A→B→C→A) passent aussi.
- Une unité peut entrer dans une case **libérée au même tick** : une colonne avance d'un bloc. Une case tenue par une unité qui ne bouge pas, ou dont le pas vient d'être annulé, bloque toute la file derrière elle :
  - **allié** : l'unité attend (elle réessaie au tick suivant) ;
  - **ennemi visible** : l'unité s'arrête et **l'attaque** (même avec un simple ordre de déplacement), sauf si elle est déjà engagée dans une rencontre ;
  - **ennemi invisible**, quel que soit le terrain (unité à couvert, assassin caché) : **embuscade**.
- Le char ne traverse pas les unités en mode simultané.

### Zone de contrôle, embuscades (phase C)

- Une unité qui **arrive au contact** d'un ennemi visible qui n'était pas déjà adjacent à sa case précédente s'arrête. Le contrôle ne joue qu'à l'arrivée : une unité qui commence le tour au contact peut partir ou longer l'ennemi.
  - ordre **Déplacer** : elle s'arrête sans attaquer ;
  - ordre **Attaquer / Charger** : si sa cible est au contact, elle la frappe. Sinon elle prend pour cible l'ennemi qui l'a arrêtée (la première dans l'ordre de priorité du tour s'il y en a plusieurs) et le frappe dans la même phase D. Un tireur qui approche change de cible de la même façon, mais ne frappe qu'en phase A du tick suivant (une mêlée, puisque la cible est au contact).
- **Embuscade** : en phase B, une unité qui veut entrer sur la case d'un ennemi invisible s'arrête devant lui. En phase C, une unité qui découvre en arrivant un ennemi **caché à couvert** (forêt, bâtiment) qu'elle ne voyait pas avant le pas tombe aussi dans une embuscade. Dans les deux cas, elle perd le reste de sa vitesse et ses ordres, se tourne vers l'embusqué, et l'embusqué est révélé. L'embuscade ne déclenche aucun combat.

### Combats

Les jets sont ceux du mode classique (`GameRoom._resolveCombat`, détail dans [postures-et-combat.md](postures-et-combat.md)). Le serveur ne demande pas la **réponse du défenseur** : elle découle de sa posture.

| Situation | Réponse du défenseur |
|---|---|
| Marche | Encaisser ; **rien** si l'unité a déjà avancé d'au moins une case pendant cette résolution (prise en mouvement) |
| Combat, Charge | Contre-attaquer |
| Défense de combat | Contre-attaquer ; **annule le bonus de charge** adverse |
| Défense à distance | Encaisser |
| Repos | Rien |
| Général | Contre-attaquer |
| **Rencontre** (même case, croisement, attaques mutuelles) | toujours **Contre-attaquer**, quelle que soit la posture |
| Unité en fuite | sa posture est forcée en Marche et elle ne bouge plus pendant les ticks : Encaisser. Si elle a été mise en fuite après avoir avancé pendant la résolution : Rien |

- **Contre un tir** (distance ≥ 2), la réponse devient « rien », sauf pour la phalange face à un attaquant qui n'est pas un archer (elle encaisse). En mode simultané, cela n'arrive jamais : les seuls tireurs sont des archers, et une unité de mêlée frappe toujours au contact.
- Un tireur au **contact** de sa cible (distance 1) livre une **mêlée** : colonnes `_cac`, la cible riposte selon sa posture.
- **Charge** (+2 attaque, +3 puissance pour l'attaquant). Elle s'applique au premier combat de mêlée de l'unité dans le tour, si elle a parcouru **au moins 2 cases** et qu'elle a l'ordre Charger ou la **posture Charge**. Avec la posture Charge, n'importe quel ordre qui mène à une mêlée compte : attaque, rencontre, unité qui bute sur un ennemi. La charge ne sert qu'une fois par tour, même si elle est arrêtée ou annulée. Contre des **lanciers**, le bonus devient **−2 attaque** (« arrêtée ») ; ce cas est vérifié en premier. Contre un défenseur en **Défense de combat**, le bonus est annulé.
- **Qui attaque dans une rencontre** : en déplacement (même case, croisement), l'unité qui charge (ordre Charger ou posture Charge) est l'attaquant. Si les deux chargent ou qu'aucune ne charge, un tirage à pile ou face (graine du tour) décide. Pour deux unités qui s'attaquent mutuellement au contact, l'attaquant est celle qui charge (ordre Charger ou posture Charge) si une seule des deux charge ; sinon la première dans l'ordre de priorité du tour. Chaque rencontre donne **un seul combat**, où le défenseur contre-attaque.
- **Tir de réaction** : un tireur (pas un général) en posture Défense à distance après le tick 0, **sans ordre ou avec un ordre Tenir**, tire une fois par tour sur un ennemi visible qui **entre** à sa portée. Celui-ci est entré à portée en se déplaçant ou est devenu visible à portée pendant le tick précédent. Le tir part au début du tick suivant, avant que la cible ne bouge à nouveau. Le tireur vise le plus proche, puis le premier dans l'ordre de priorité du tour. Les ennemis déjà à portée au début du tour ne déclenchent rien.
- **Simultanéité** : tous les combats d'une phase sont calculés sur l'état du début de la phase (vitalité, nombre de dés, positions), puis appliqués dans cet ordre : rencontres, unités qui butent, ordres d'attaque, chacun dans l'ordre de priorité du tour. Quand vient son tour, une frappe est annulée si son attaquant est mort ou en fuite, ou si sa cible est morte. Une cible frappée plusieurs fois riposte à chaque attaquant avec sa force du début de phase.
- **Duel** : un général qui attaque (ou rencontre) le général adverse au contact livre un duel (règles du mode classique, §8 de regles.md).
- Une unité qui attaque est révélée. Une unité qui riposte au corps à corps est révélée aussi. Une unité dont le moral tombe à 0 s'enfuit et n'exécute plus ses ordres. Une unité frappe au plus une fois par tour. Le cavalier léger ne repart pas après son attaque, contrairement au mode classique.

## Fin de tour

Captures d'objectifs (unité sur l'objectif à la fin de la résolution), fin des révélations, recharge des capacités, effets actifs, points d'objectifs, heure, conditions de victoire : comme en mode classique. Au début de chaque planification (sauf la première), le serveur applique la régénération (postures, terrain, nuit) puis recalcule la vitesse de chaque unité.

## Brouillard et information

- La chronologie envoyée à chaque joueur est **filtrée par sa vision à chaque tick**. Il voit :
  - ses propres unités ;
  - les déplacements des ennemis qu'il voit avant et après le pas ;
  - l'**apparition** (avec le descripteur de l'unité) et la **disparition** des ennemis qui entrent dans sa vision ou en sortent ;
  - les combats dont il voit au moins un camp, l'autre camp restant anonyme. L'attaquant reçoit tout le détail des jets. Le défenseur le reçoit s'il voyait l'attaquant. Les tiers ne le reçoivent jamais.
- Une embuscade n'est montrée qu'aux deux camps concernés. Le sabotage et la construction sont montrés à tous (sans l'auteur pour les autres) ; la disparition n'est montrée qu'au propriétaire.
- Spectateurs : chronologie complète en vision **complète** ; rien en vision différée ou aucune.
- Reconnexion : pendant la planification, ses ordres et l'état de validation sont restaurés ; pendant la lecture, la chronologie est renvoyée avec le temps écoulé et la lecture reprend où elle en était.

## Déterminisme

Chaque résolution tire une **graine** (`crypto.randomInt`, notée dans le journal serveur, la chronologie et le replay). Même salle + mêmes ordres + même graine = même résultat (tests `tests/simultaneous.test.js`). Les égalités se départagent par l'ordre de priorité tiré de la graine ou par le générateur de la graine, jamais par l'ordre d'arrivée des messages.

## Réglages de salle

| Paramètre | Valeurs | Défaut |
|---|---|---|
| Mode | séquentiel / simultané | séquentiel |
| Minuteur de planification | 0 (aucun) ou 15 – 600 s | 90 s |
| Points de commandement | 0 (formule) ou 1 – 50 | 0 |

Les autres réglages (tours par demi-journée, tours max, points de victoire, vision des spectateurs, mode par équipe) s'appliquent tels quels. Le minuteur de manche du mode classique est sans effet.

## Écarts par rapport à la proposition initiale

- Le bonus de charge porte sur l'attaque et la puissance (+2 / +3). La phalange n'annule pas la charge : seuls les lanciers (malus) et la Défense de combat (annulation) la contrent.
- « Riposte gratuite » de la Défense de combat = réponse Contre-attaquer automatique (jet de défense habituel).
- Les rencontres à mi-chemin peuvent opposer deux unités à 2 cases l'une de l'autre (case disputée entre elles).
- Simulateur : `node simulation/run.js --simultaneous` (ordres des IA de `game/bots`).
- Replay : les déplacements d'un tour sont enregistrés par unité (regroupés jusqu'au combat suivant). Le replay ne montre donc pas toute la simultanéité.

## Après la fusion avec la branche de l'ami

- La Percée n'existe plus (remplacée par le Repos) : plus de poursuite après une mêlée gagnée.
- Les combats suivent la résolution NGO (règles §5). Le bonus de charge s'ajoute à l'attaque et à la puissance effectives.
- Mode par équipe : les alliés ne s'affrontent pas (pas de rencontre ni d'attaque entre eux, ils peuvent se croiser).
- Le char ne traverse pas les unités en mode simultané. Le cavalier léger ne repart pas après avoir frappé.

## Corrections récentes

- **Tir** : la cible d'un tir ne se tourne plus vers le tireur, et le journal indique la réponse réellement appliquée (« rien », ou « encaisser » pour une phalange face à un tireur qui n'est pas un archer).
- **Archer au contact** : c'est une mêlée normale (riposte possible), affichée comme telle partout (`kind: 'melee'`, `ranged: false`).
- **Priorité** : ordre tiré au sort à chaque tour (graine), au lieu des identifiants qui favorisaient la première armée validée.
- **Portée** : le bonus de hauteur ne vaut que pour les tireurs ; la mêlée frappe toujours à 1 case (aussi en mode classique).
