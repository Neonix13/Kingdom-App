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
L'IA ne lit jamais les positions qu'elle ne voit pas : ennemis = unités visibles par son joueur, chemins bloqués seulement par les unités visibles (une embuscade l'arrête comme un humain). Sans ennemi en vue, elle suit un **itinéraire de recherche** tiré d'informations publiques : les zones fixes de la carte s'il y en a ; sinon l'arc des cases situées à environ un diamètre du cercle des zones aléatoires (`10 + 4 × joueurs`) de sa propre zone, en commençant par le secteur tourné vers le centre de la carte. Les points sont visités selon un calendrier (≈ 2,5 cases par tour + 2 tours sur place), sans mémoire. Les buts inaccessibles (de l'autre côté de falaises ou de murs) sont remplacés par la case accessible la plus proche.

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

### Rythme et exécution
- **Serveur local** : une action à la fois, après une pause (minuterie de la salle, `nextDeadline`). Début de manche : pause un peu plus longue. `config.botPace` multiplie les pauses (0 en test).
- **Lambda** : pas de minuterie ; à chaque message reçu (et au `tick` client toutes les 15 s), l'IA joue tout ce qu'elle peut sans pause (au plus `botBurst` actions).
- Les IA ne jouent que si un humain (joueur ou spectateur) est connecté.

### Une IA ne bloque jamais la partie
- Chaque action renvoyée consomme quelque chose (vitesse, attaque, capacité) ; quand rien d'utile ne reste, l'IA termine sa manche ; au-delà de `botMaxSteps` actions dans une manche, elle termine aussi.
- Action refusée → repli : fin de manche, défense « rien », déploiement « prêt », armée minimale, ordres vides. Après 4 échecs dans la même situation, le pilote s'arrête jusqu'au prochain changement d'état.
- Une IA visée par une attaque répond en ~1 s (pas les 20 s du minuteur de défense).

### Mode simultané
Chaque planification, l'IA envoie tous ses ordres (`set_orders`, `replace: true`, dans la limite des points de commandement : attaques/charges d'abord, capacité et motivation du général, puis déplacements) puis les valide (`commit_orders`).

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

- **Niveaux** (30 parties IA contre IA par paire, budget 4000, 30 tours max) : Vétéran bat Recrue 20–10 ; Stratège bat Vétéran 19–8 (2 nuls) ; Stratège bat Recrue 23–6. 2 parties sur 90 bloquées au déploiement (zone vide, voir ci-dessous).
- **Contre un joueur immobile** (15 parties par niveau, 30 tours) : contact établi dans environ 2 parties sur 3 (Recrue 14/15, Vétéran 10/15, Stratège 11/15 lors d'une mesure ; les zones étant tirées au hasard, les chiffres varient d'une série à l'autre). Un joueur qui avance rencontre l'IA bien plus tôt.

## 6. Limites connues
- `HexUtils.getStartingZones` (zones aléatoires) produit parfois une zone vide (~2 % des salles sur la carte par défaut) : personne ne peut s'y déployer, IA comme humain. Le test le contourne en recommençant.
- Lambda : l'IA joue toute sa manche d'un coup à la réception d'un message (pas de pause possible sans minuterie).
- La mémoire des ennemis aperçus n'est pas conservée d'un tour à l'autre (l'IA ne connaît que ce qu'elle voit maintenant) : contre un joueur qui reste caché ou immobile loin de l'itinéraire de recherche, l'IA peut ne jamais le trouver (la limite de tours ou les objectifs départagent alors).
- Le Stratège avance groupé, donc lentement : il arrive au contact plus tard que la Recrue.
- Les capacités des généraux autres qu'Ou Ki, Mou Bu et Ri Boku n'ont pas d'effet côté serveur : l'IA ne les utilise pas.
