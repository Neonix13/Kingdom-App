# IA et tutoriel

## 1. Joueurs IA (`game/bots/`)

Une IA est un joueur ordinaire de la salle (`isBot: true`, nom « Ren Pa (IA) »…) relié à une connexion fictive `bot:<id>`. Elle agit **par les mêmes actions du protocole que les humains** (`submit_army`, `place_unit`, `move_unit`, `attack_unit`, `defend_choice`, `end_turn`, `set_orders`…) : mêmes contrôles, mêmes règles, mêmes diffusions (animations filtrées, combats, défense…). Rien n'est jamais envoyé à la connexion fictive.

| Fichier | Rôle |
|---|---|
| `index.js` | Création d'une IA (`addBot`), prochaine action d'une IA selon la phase (`planStep`), rythme |
| `runner.js` | Pilote : après chaque transaction de la salle, planifie l'action suivante, attend son délai, l'exécute ; filet de sécurité |
| `profiles.js` | Niveaux de difficulté (tous les réglages de comportement) |
| `army.js` | Recrutement dans le budget (variété tirée par salle et par joueur) |
| `deploy.js` | Déploiement dans sa zone |
| `battle.js` | Décisions de bataille (mode séquentiel) et choix de défense |
| `simultaneous.js` | Ordres du mode simultané (`set_orders` puis `commit_orders`) |
| `world.js` | Ce que l'IA sait : uniquement ce que son joueur voit (brouillard + camouflage via `room.canSee`), la carte, les objectifs |
| `pathing.js` | Coût de marche vers un but sur toute la carte (contourne falaises, murs, rivières) |
| `tutorial.js` | Scénario du tutoriel |

### Brouillard de guerre
L'IA ne lit jamais les positions qu'elle ne voit pas : ennemis = unités visibles par son joueur, chemins bloqués seulement par les unités visibles (une embuscade l'arrête comme un humain). **Mémoire** (`world.js`, cache du processus comme les itinéraires : un démarrage à froid de la lambda l'oublie seulement) : dernière position de chaque ennemi aperçu, oubliée quand sa case est revue vide (une case de forêt ou de bâtiment seulement de près, l'ennemi pouvant s'y cacher) ou après 12 tours, et dernier tour où chaque case a été vue. Sans ennemi en vue, l'armée va vers le dernier ennemi aperçu (le général d'abord) ; sinon elle explore : premier point non encore vu de l'**itinéraire de recherche** tiré d'informations publiques (les zones fixes de la carte s'il y en a ; sinon l'arc des cases situées à environ un diamètre du cercle des zones aléatoires (`10 + 4 × joueurs`) de sa propre zone, en commençant par le secteur tourné vers le centre de la carte), puis la case d'une grille grossière vue depuis le plus longtemps près de l'armée (abandonnée après 14 tours si elle reste hors d'atteinte). Les buts inaccessibles (de l'autre côté de falaises ou de murs) sont remplacés par la case accessible la plus proche.

**Fin de partie** : un général resté sans armée part chercher le général adverse si c'est le seul ennemi qu'il connaît (le duel tranche) ; s'il a vu au moins deux unités ennemies, l'IA **abandonne** (`leave_room` : elle est éliminée, « a quitté la partie »). Jamais dans le tutoriel. Le simulateur d'équilibrage applique la même règle.

### Niveaux

| | Recrue | Vétéran | Stratège |
|---|---|---|---|
| Armée | au hasard (≈ 85 % du budget) | composition du simulateur d'équilibrage | compositions travaillées (ligne de front + tireurs + choc) |
| Erreurs | 25 % (unité oubliée, cible ou case au hasard) | 8 % | aucune |
| Tir concentré | non | partiel | oui (unités blessées, coups mortels, général) |
| Terrain | ignoré | en partie | forêts, bâtiments, hauteur, évite les rivières |
| Cohésion | fonce | avance groupée (écart 6) | avance groupée (écart 3), tient en bonne position si elle est en infériorité locale |
| Général | combat en première ligne | reste à 2 cases de l'ennemi | reste à 3 cases, duel seulement s'il a l'avantage |
| Postures, capacité, motivation | rarement | souvent | toujours à bon escient |
| Objectifs | seulement s'ils sont à portée | 1 unité dédiée (+1 si points de victoire) | 2 unités (+1) |
| Rythme | 1,3 s entre deux actions | 1 s | 0,8 s |

Défense : phalange « Encaisser » contre les tirs ; au corps à corps, contre-attaque si la défense est bonne et l'unité en forme, sinon encaisse (Recrue : parfois au hasard).

### Tactique (`game/bots/tactics.js`, réglage `tactics` des profils : Recrue 0, Vétéran 0,5, Stratège 1)
- **Angles** : l'estimation d'un coup tient compte de l'angle d'attaque (flanc, dos : bonus d'attaque et de puissance, armure réduite) et du bonus de charge ; elle retranche la riposte attendue (contre-attaque en séquentiel ; en simultané, la réaction de la posture du défenseur).
- **Mode simultané** : chaque unité de mêlée liste les cases de contact atteignables ce tour **sans être arrêtée par une zone de contrôle** (chemin qui ne longe aucun autre ennemi), avec l'échange attendu ; les frappes sont attribuées en commençant par les meilleures, avec un bonus pour frapper une cible déjà visée (supériorité locale) jusqu'à ce qu'elle soit condamnée. Ordre **Charger** quand l'élan (2 cases) apporte le bonus, jamais contre des lanciers ou une Défense de combat ; le chemin choisi est transmis avec l'ordre.
- **Sans frappe intéressante**, une unité menacée se met en garde au lieu de s'avancer : Défense de combat contre la cavalerie (annule la charge, pas de flanc), Combat sinon, et s'oriente vers la menace quand son flanc ou son dos est exposé. Les unités brisées (moral < 30 % ou vitalité < 25 %) se replient vers le général. Les tireurs restent derrière une unité de mêlée et attendent en Défense à distance quand rien n'est à portée.
- **Général** : reste derrière ses troupes (centre de l'armée décalé à l'opposé de l'ennemi), hors de portée des tireurs (portée + 2) et de la cavalerie ennemie, dans les deux modes.
- **Séquentiel** : mêmes estimations ; Défense de combat face à la cavalerie quand l'unité attend ; orientation face à la menace avec la vitesse restante.
- **Arène** : `node scripts/bots/arena.js --games 30 --pairs stratege:veteran --modes simultaneous,sequential --maps default,kankoku` joue des parties IA contre IA par le protocole (horloge simulée). Un niveau suffixé `_old` joue avec une copie d'une ancienne version (`--old <dossier>`), pour mesurer un changement ; `--kills 1` compte les généraux tués par camp, `--trace 1` affiche les ordres tour par tour.

### Rythme et exécution
- **Serveur local** : une action à la fois, après une pause (minuterie de la salle, `nextDeadline`). Début de manche : pause un peu plus longue. `config.botPace` multiplie les pauses (0 en test).
- **Lambda** : pas de minuterie ; à chaque message reçu (et au `tick` client toutes les 15 s), l'IA joue tout ce qu'elle peut sans pause (au plus `botBurst` actions).
- Les IA ne jouent que si un humain (joueur ou spectateur) est connecté.

### Une IA ne bloque jamais la partie
- Chaque action renvoyée consomme quelque chose (vitesse, attaque, capacité) ; quand rien d'utile ne reste, l'IA termine sa manche ; au-delà de `botMaxSteps` actions dans une manche, elle termine aussi.
- Action refusée → repli : fin de manche, défense « rien », déploiement « prêt », armée minimale, ordres vides. Après 4 échecs dans la même situation, le pilote s'arrête jusqu'au prochain changement d'état.
- Une IA visée par une attaque répond en ~1 s (pas les 20 s du minuteur de défense).

### Mode simultané
Chaque planification, l'IA envoie tous ses ordres (`set_orders`, `replace: true`, dans la limite des points de commandement : attaques/charges d'abord, capacité et motivation du général, puis déplacements) puis les valide (`commit_orders`). Chaque ordre est d'abord vérifié avec la règle du serveur (`room.turns.validateOrder`) : un ordre refusé faisait rejeter tout le lot.
- Un tireur ne bouge pas quand il a un ordre d'attaque : hors de portée, il marche d'abord vers une position de tir (loin des unités de mêlée ennemies).
- Le général attaque quand le duel lui est favorable (mêmes critères qu'en séquentiel) ou une unité affaiblie.
- Long trajet sans ennemi en vue : posture Marche (le changement coûte la vitesse du tour, la posture la rend ensuite).

## 2. Protocole et salle

| Action | Qui | Effet |
|---|---|---|
| `add_bot { difficulty?: 'recrue'\|'veteran'\|'stratege', generalId? }` | hôte, salle d'attente | ajoute une IA (général libre au hasard si absent, couleur libre) ; `player_joined { isBot: true }` + `room_update` |
| `remove_bot { playerId }` | hôte, salle d'attente | retire l'IA (`player_left`) |
| `create_solo { playerName, difficulty?, generalId?, mapId? }` | tous | crée une salle avec une IA et passe directement au recrutement |
| `start_tutorial { playerName? }` | tous | crée la bataille du tutoriel et la lance |

`room_update` contient `bots: [{ id, difficulty, label }]` et `tutorial: true|false`. Une salle sans humain est supprimée ; l'hôte est toujours un humain.

Accueil (`index.html`) : carte « Jouer contre l'IA » (difficulté, général, **Jouer en solo**, **Tutoriel**). Salle d'attente : l'hôte ajoute/retire des IA sous la liste des joueurs ; les IA sont toujours prêtes.

## 3. Tutoriel

Serveur (`game/bots/tutorial.js`) : carte par défaut, réglages fixes (5 tours par demi-journée → nuit au tour 6 ; 6 points de victoire), armées et déploiement fixes, drapeau « Drapeau du gué » (q 21, r 3) ajouté à la salle, le joueur commence. IA « tutoriel » : tient ses positions et ne frappe que ce qu'elle peut atteindre près d'elle (une piétaille est cachée dans la forêt à côté du drapeau).

| Camp | Unités |
|---|---|
| Joueur (Ou Ki) | général (20, 9), Soldats (20, 7), Archers (19, 8), Cavalier léger (22, 7) |
| IA (Go Hou Mei) | général (26, −1), Piétaille cachée (20, 3), Soldats (23, 0), Archers (24, −1) |

Client (`public/js/tutorial.js`, chargé par `game.html`) : panneau d'aide en bas à gauche (passe à gauche en colonne quand une fenêtre — défense, posture, fin de tour — est ouverte), « Passer le tutoriel », réduction, progression conservée en cas de rechargement. Étapes : bienvenue → sélectionner une unité → fiche → déplacement (cases vertes, chemin) → postures → prendre le drapeau → forêts et camouflage → fin du tour → tour de l'IA → attaque et défense → tir à distance → initiative, heure et nuit → victoire → fin.

Les étapes avancent sur de vrais événements (`window.gameEventHooks`) et sur l'état client (`window.gameBridge`). Conseils ponctuels quand ils arrivent : être attaqué (choix de défense), ennemi débusqué, embuscade, drapeau pris, nuit, fuite.

Vue 3D : rien ne dépend du canevas 2D. Le panneau (z-index 9500) est au-dessus de la vue 3D, il surligne des éléments d'interface, nomme les cases (q, r) et pointe les cases importantes avec un **ping** (affiché par les deux vues). Pour la vue 3D, chaque étape émet aussi `window.dispatchEvent(new CustomEvent('tutorial_hint', { detail: { stepId, hexes, unitIds } }))` (dernière valeur dans `window.tutorialHint`).

## 4. Tests

`tests/bots.test.js` (`npm test`) : ajout/retrait d'IA, salle supprimée sans humain, partie solo complète, parties IA contre IA (toutes les paires de niveaux, petite carte et carte par défaut, avec et sans sérialisation à chaque action) sans erreur ni blocage, version avec minuteries réelles, IA en attente sans humain, tutoriel, mode simultané.

## 5. Mesures (carte par défaut, zones aléatoires)

**Parties nulles (novembre 2026)** — IA réelles par le protocole, 60 parties par paire, budget 4 000, limite de 100 tours :

| Paire | Simultané avant | Simultané après | Séquentiel avant | Séquentiel après |
|---|---|---|---|---|
| Vétéran – Vétéran | 37 nuls (62 %) | 0 | 8 (13 %) | 4 (7 %) |
| Stratège – Stratège | 35 (58 %) | 1 (2 %) | 21 (35 %) | 4 (7 %) |
| Recrue – Stratège | 35 (58 %) | 0 | 2 (3 %) | 0 |

Causes des nuls : armées qui se perdaient de vue sans mémoire ; tireurs en mode simultané qui gardaient un ordre d'attaque sur une cible hors de portée (ils ne bougent pas) ; généraux restés seuls qui ne bougeaient plus ; unités lentes bloquées au Repos (vitesse 0, posture impossible à changer) ; lots d'ordres rejetés pour une seule posture sans vitesse ; armure qui annulait les dégâts (voir `docs/equilibrage.md`). Après : Stratège bat Recrue 57–3 (simultané) et 56–4 (séquentiel), Stratège bat Vétéran 35–25 et 36–20. Simulateur d'équilibrage : nuls 55 % → 0,8 % (simultané), 8,3 % → 2,7 % (séquentiel).

Mesures précédentes :

- **Niveaux** (30 parties IA contre IA par paire, budget 4000, 30 tours max) : Vétéran bat Recrue 20–10 ; Stratège bat Vétéran 19–8 (2 nuls) ; Stratège bat Recrue 23–6. 2 parties sur 90 bloquées au déploiement (zone vide, corrigé depuis : `getStartingZones` refait le tirage).
- **Contre un joueur immobile** (15 parties par niveau, 30 tours) : contact établi dans environ 2 parties sur 3 (Recrue 14/15, Vétéran 10/15, Stratège 11/15 lors d'une mesure ; les zones étant tirées au hasard, les chiffres varient d'une série à l'autre). Un joueur qui avance rencontre l'IA bien plus tôt.

**Capacités d'unités** (`unitAbilityPlan` dans `battle.js`, utilisé aussi en mode simultané) : un assassin disparaît dès qu'il ne voit aucun ennemi à 6 cases ; des bâtisseurs posent des chevaux de frise sur l'arête tournée vers l'ennemi le plus proche quand il arrive à 4 cases ou moins. Les espions ne sabotent pas (ils servent d'éclaireurs : leur présence révèle les embuscades à 2 cases) ; l'IA ne construit ni pont ni échelle et ne brûle pas de forêt.

## 5 bis. Mesures après la tactique (arène, 30 parties par paire, budget 5000, 30 tours max, nouvelle IA contre l'ancienne)

| Carte, mode | Stratège / ancien | Vétéran / ancien | Recrue / ancienne | Morts de généraux (nouveau / ancien, Stratège) |
|---|---|---|---|---|
| défaut, simultané | 20 – 10 | 20 – 10 | 17 – 13 | 2 / 11 |
| défaut, séquentiel | 16 – 14 | 21 – 9 | 14 – 16 | 5 / 14 |
| Kankoku, simultané | 23 – 7 | 25 – 5 | 15 – 15 | 1 / 13 |
| Kankoku, séquentiel | 15 – 15 | 18 – 12 | 20 – 10 | 7 / 14 |

Échelle des niveaux (nouvelle IA) : Stratège bat Vétéran 22 – 8 (défaut, simultané), 20 – 10 (défaut, séquentiel), 16 – 14 (Kankoku, simultané), 23 – 7 (Kankoku, séquentiel) ; Stratège bat Recrue 26 à 30 sur 30 ; Vétéran bat Recrue 23 à 29 sur 30. Aucune partie nulle, aucune erreur d'IA ; temps de planification moyen 2 à 6 ms par décision (pointe 170 ms).

## 6. Limites connues
- Lambda : l'IA joue toute sa manche d'un coup à la réception d'un message (pas de pause possible sans minuterie).
- La mémoire de l'IA est un cache du processus : sur la lambda, une nouvelle instance repart sans mémoire (elle retrouve l'ennemi par l'exploration).
- Un joueur qui cache son général seul dans une forêt loin de l'armée de l'IA peut encore tenir longtemps (l'exploration finit par passer, la limite de tours ou les objectifs départagent sinon).
- Le Stratège avance groupé, donc lentement : il arrive au contact plus tard que la Recrue.
- Les capacités des généraux autres qu'Ou Ki, Mou Bu et Ri Boku n'ont pas d'effet côté serveur : l'IA ne les utilise pas.
